// 取り込んだ info.json を「配れるか」の判定に組み立てる smoke。
//
// main の取得の入口（inspectInfo）に偽の lookup・classify・request を渡し、
// 応答の本文は tests/fixtures/iiif の資料から、ヘッダはこの試験の表から作る。
// その戻り値を renderer の判定の組み立て（verdictOf）に渡し、8 通りの結果を
// 1 件ずつ確かめる。vite の ssr build で束ね、子プロセスで走らせる。
//
// 使い方: node scripts/iiif-import-verdict-smoke.mjs
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'iiif-import-verdict-'));
const entryFile = path.join(workDir, 'iiif-import-verdict-smoke-entry.ts');
const electronStubFile = path.join(workDir, 'electron-stub.ts');
const outDir = path.join(workDir, 'dist');
const bundledFile = path.join(outDir, 'iiif-import-verdict-smoke.mjs');

const fixtureDir = path.join(projectRoot, 'tests/fixtures/iiif');
const serviceModulePath = path.join(projectRoot, 'electron/services/iiifImportService.ts');
const verdictModulePath = path.join(projectRoot, 'src/utils/iiifImportVerdict.ts');

try {
  // 取得の入口は下書きの預かり所のために electron の app を読む。前例と同じく
  // electron をスタブして束ねる（この試験は取得の口をすべて差し替えるので app は使わない）。
  await writeFile(
    electronStubFile,
    `
      const handlers = new Map();
      export const __handlers = handlers;
      export const app = {
        getPath(name) {
          if (name === 'documents') return ${JSON.stringify(path.join(workDir, 'documents'))};
          if (name === 'temp') return ${JSON.stringify(path.join(workDir, 'temp'))};
          return ${JSON.stringify(workDir)};
        },
        getName() { return 'MaplatEditorSmoke'; },
        isPackaged: false,
      };
      export const ipcMain = { handle: (ch, fn) => handlers.set(ch, fn), removeHandler: (ch) => handlers.delete(ch) };
      export const dialog = {
        async showOpenDialog() { return { canceled: true, filePaths: [] }; },
      };
      export const BrowserWindow = class {};
      export const session = { defaultSession: { webRequest: { onBeforeRequest: () => {} } } };
    `,
  );
  await writeFile(
    entryFile,
    `
      import assert from 'node:assert/strict';
      import { readFileSync } from 'node:fs';
      import path from 'node:path';
      import { EventEmitter } from 'node:events';
      import { Readable } from 'node:stream';

      const { inspectInfo } = await import(${JSON.stringify(serviceModulePath)});
      const { verdictOf } = await import(${JSON.stringify(verdictModulePath)});

      const fixtureDir = ${JSON.stringify(fixtureDir)};
      const fixture = (name) => readFileSync(path.join(fixtureDir, name));

      const tests = [];
      const test = (name, fn) => { tests.push({ name, fn }); };
      let deliverableCount = 0;

      // 応答をその場で作る。ポートは開かず、外のネットワークへも出ない。
      const fakeMessage = (statusCode, headers, body) => {
        const message = new Readable({ read() {} });
        message.statusCode = statusCode;
        message.headers = headers || {};
        process.nextTick(() => {
          if (body) message.push(Buffer.from(body));
          message.push(null);
        });
        return message;
      };

      // 偽の request は http.ClientRequest に似た最小の EventEmitter。
      // 渡された options.lookup を 1 回呼んでから、決まった応答を返す。
      const makeFakeRequest = (script, state) => (options, onResponse) => {
        const req = new EventEmitter();
        req.destroyed = false;
        req.destroy = (error) => {
          req.destroyed = true;
          if (error) req.emit('error', error);
        };
        req.end = () => {
          state.requests.push(options);
          const answer = () => {
            const selected = script(options);
            if (!selected) {
              const missing = new Error('no scripted response for ' + options.hostname + String(options.path));
              missing.code = 'ENOSCRIPT';
              req.emit('error', missing);
              return;
            }
            state.responses += 1;
            onResponse(fakeMessage(selected.status, selected.headers, selected.body));
          };
          const lookup = options.lookup;
          if (lookup) {
            lookup(options.hostname, { all: true }, (error) => {
              if (error) req.emit('error', error);
              else answer();
            });
          } else {
            answer();
          }
        };
        return req;
      };

      const serviceUrl = 'https://iiif.example/iiif/image';

      // info.json の取得を、決まった本文とヘッダで 1 回だけ行う。
      const inspectWith = (body, headers) => {
        const state = { requests: [], responses: 0 };
        const deps = {
          lookup: (hostname, options, callback) => {
            callback(null, [{ address: '93.184.216.34', family: 4 }]);
          },
          classify: () => ({ blocked: false }),
          request: makeFakeRequest(
            () => ({ status: 200, headers: headers || {}, body }),
            state,
          ),
        };
        return inspectInfo(serviceUrl, deps);
      };

      const ndl = fixture('ndl-948741-r3.info.json');
      const level0Sizes = fixture('level0-sizes.info.json');
      const noRegion = fixture('no-region.info.json');
      const httpService = fixture('http-service.info.json');
      const notJsonBody = fixture('thumb-52.jpg');

      const cases = [
        {
          label: 'deliverable with wildcard cors',
          body: ndl,
          headers: { 'access-control-allow-origin': '*' },
          expected: { kind: 'deliverable' },
          check: (info) => {
            assert.equal(info.version, '2', 'version');
            assert.equal(info.level, 1, 'level');
            assert.equal(info.tiling, 'arbitrary', 'tiling');
            assert.equal(info.width, 4074, 'width');
            assert.equal(info.height, 2705, 'height');
            assert.equal(
              info.serviceUrl,
              'https://dl.ndl.go.jp/api/iiif/948741/R0000003',
              'serviceUrl',
            );
            assert.ok(
              typeof info.imageId === 'string' && info.imageId.length > 0,
              'imageId must be a non-empty string',
            );
          },
        },
        {
          label: 'missing cors header',
          body: ndl,
          headers: {},
          expected: { kind: 'metadata-only', reason: 'cors-not-wildcard' },
        },
        {
          label: 'explicit origin is not wildcard',
          body: ndl,
          headers: { 'access-control-allow-origin': 'https://example.org' },
          expected: { kind: 'metadata-only', reason: 'cors-not-wildcard' },
        },
        {
          label: 'level0 with sizes only',
          body: level0Sizes,
          headers: { 'access-control-allow-origin': '*' },
          expected: { kind: 'metadata-only', reason: 'unsupported-level0' },
        },
        {
          label: 'level0 tiles without arbitrary region support',
          body: noRegion,
          headers: { 'access-control-allow-origin': '*' },
          expected: { kind: 'metadata-only', reason: 'unsupported-level0' },
        },
        {
          label: 'http image service id',
          body: httpService,
          headers: { 'access-control-allow-origin': '*' },
          expected: { kind: 'metadata-only', reason: 'not-https' },
        },
        {
          label: 'response is not json',
          body: notJsonBody,
          headers: { 'access-control-allow-origin': '*' },
          expected: { kind: 'metadata-only', reason: 'not-json' },
        },
        {
          label: 'expected size differs by one pixel',
          body: ndl,
          headers: { 'access-control-allow-origin': '*' },
          expected: { kind: 'metadata-only', reason: 'size-mismatch' },
          expectedSize: { width: 4075, height: 2705 },
        },
      ];

      test('verdict-table', async () => {
        let passed = 0;
        for (const item of cases) {
          const inspected = await inspectWith(item.body, item.headers);
          // 取得の失敗（JSON でないなど）はその理由をそのまま渡す。
          // 成功のときは、main の戻り値を判定の材料の名前に移し替える。
          const input = inspected.ok
            ? {
                facts: {
                  requestedUrl: inspected.requestedUrl,
                  finalUrl: inspected.finalUrl,
                  accessControlAllowOrigin: inspected.accessControlAllowOrigin,
                  infoJson: inspected.json,
                },
              }
            : { failure: inspected };
          if (item.expectedSize) input.expected = item.expectedSize;
          let verdict;
          try {
            verdict = verdictOf(input);
          } catch (error) {
            assert.fail(
              item.label + ': verdictOf must not throw but threw: ' +
                (error instanceof Error ? error.message : String(error)),
            );
          }
          if (item.expected.kind === 'deliverable') {
            assert.equal(
              verdict.kind,
              'deliverable',
              item.label + ': expected deliverable but got ' + JSON.stringify(verdict),
            );
            item.check(verdict.info);
            deliverableCount += 1;
          } else {
            assert.equal(
              verdict.kind,
              'metadata-only',
              item.label + ': expected metadata-only but got ' + JSON.stringify(verdict),
            );
            assert.equal(
              verdict.reason,
              item.expected.reason,
              item.label + ': expected reason ' + item.expected.reason + ' but got ' + verdict.reason,
            );
            assert.ok(
              typeof verdict.message === 'string' && verdict.message.length > 0,
              item.label + ': message must be an i18n key',
            );
          }
          passed += 1;
        }
        assert.equal(
          deliverableCount,
          1,
          'exactly one case must be deliverable but was ' + deliverableCount,
        );
        return '(' + passed + '/' + cases.length + ')';
      });

      let failed = 0;
      for (const item of tests) {
        try {
          const suffix = await item.fn();
          console.log('ok: ' + item.name + (suffix ? ' ' + suffix : ''));
        } catch (error) {
          failed += 1;
          console.error('fail: ' + item.name + ': ' + (error instanceof Error ? error.message : String(error)));
        }
      }
      console.log('deliverable: ' + deliverableCount);
      if (failed > 0) {
        console.error('failed: ' + failed + ' of ' + tests.length);
        process.exit(1);
      }
      console.log('passed: ' + tests.length);
    `,
  );

  await build({
    configFile: false,
    logLevel: 'silent',
    resolve: {
      alias: [
        { find: 'electron', replacement: electronStubFile },
        {
          find: '@maplat/core/src',
          replacement: path.join(projectRoot, 'node_modules/@maplat/core/src'),
        },
      ],
    },
    build: {
      emptyOutDir: true,
      outDir,
      ssr: entryFile,
      target: 'node22',
      rollupOptions: {
        output: {
          entryFileNames: 'iiif-import-verdict-smoke.mjs',
          format: 'es',
        },
      },
    },
  });

  const { stdout, stderr } = await execFileAsync(process.execPath, [bundledFile], {
    cwd: projectRoot,
    timeout: 120000,
    maxBuffer: 1024 * 1024 * 8,
  });
  process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
} catch (error) {
  if (error && typeof error === 'object' && 'stdout' in error && error.stdout) {
    process.stdout.write(String(error.stdout));
  }
  if (error && typeof error === 'object' && 'stderr' in error && error.stderr) {
    process.stderr.write(String(error.stderr));
  }
  console.error(
    'iiif-import verdict smoke: failed: ' +
      (error instanceof Error ? error.message : String(error)),
  );
  process.exitCode = 1;
} finally {
  await rm(workDir, { recursive: true, force: true });
}
