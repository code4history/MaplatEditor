// M12-T14 smoke: AppPreviewService.serveDataFile/serveLocalFile のパス封じ込め
// （startsWith 末尾 path.sep 欠落 → isUnderFolder 適用）を検証する。
// m12-t13 smoke と同型の harness（electron/electron-store stub + vite ssr build）で
// AppPreviewService の private メソッドを直接起動し、以下を検証する:
//   AC1:  serveDataFile は {baseFolder}-x（{saveFolder}/tmbs-x 兄弟ディレクトリ）への
//         segments ['..', 'tmbs-x', 'evil.jpg'] で 403
//         （実ファイルを用意。旧実装 startsWith(baseFolder) なら prefix 一致で 200 配信されうる = RED）
//   AC1b: serveDataFile は saveFolder 外脱出（['..', '..', 'evil.jpg']）でも 403
//   AC1c: serveDataFile は saveFolder 内でも baseFolder 外（['..', '{saveFolderBasename}-x', 'evil.jpg']）で 403
//   AC2:  serveLocalFile は {saveFolder}-x 兄弟ディレクトリへの filePath で 403
//         （実ファイルを用意。旧実装 startsWith(saveFolder) なら prefix 一致で 200 配信されうる = RED）
//   AC3:  正常系（saveFolder/tmbs 内の実ファイル、saveFolder/tiles 内の実ファイル）は 200 配信（非退行）
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'm12-t14-containment-'));
const entryFile = path.join(workDir, 'm12-t14-containment-smoke.ts');
const electronStubFile = path.join(workDir, 'electron-stub.ts');
const electronStoreStubFile = path.join(workDir, 'electron-store-stub.ts');
const outDir = path.join(workDir, 'dist');
const bundledFile = path.join(outDir, 'm12-t14-containment-smoke.mjs');

try {
  const dataDir = path.join(workDir, 'data');
  await mkdir(dataDir, { recursive: true });
  await writeFile(
    electronStubFile,
    `
      const handlers = new Map();
      export const __handlers = handlers;
      export const app = {
        getPath(name: string) {
          if (name === 'documents') return ${JSON.stringify(path.join(workDir, 'documents'))};
          if (name === 'temp') return ${JSON.stringify(path.join(workDir, 'temp'))};
          if (name === 'appData') return ${JSON.stringify(path.join(workDir, 'appData'))};
          return ${JSON.stringify(workDir)};
        },
        getName() { return 'MaplatEditor'; },
        whenReady() { return Promise.resolve(); },
        exit(code?: number) { if (code && code !== 0) process.exitCode = code; },
      };
      export const dialog = {
        showOpenDialog() { return Promise.resolve({ canceled: true, filePaths: [] }); },
        showMessageBox() { return Promise.resolve({ response: 0 }); },
      };
      export const ipcMain = {
        handle(channel: string, fn: any) { handlers.set(channel, fn); },
        removeHandler() {},
      };
      export const BrowserWindow = class {
        static getAllWindows() { return []; }
      };
      // AppPreviewService が import する named export。smoke では purgePreviewStorage を呼ばないが
      // vite ssr build の named export 解決のため実体を用意する
      export const session = {
        defaultSession: {
          clearStorageData() { return Promise.resolve(); },
        },
      };
    `
  );
  await writeFile(
    electronStoreStubFile,
    `
      export default class Store<T extends Record<string, any>> {
        store: T;
        constructor(options: { defaults?: T } = {}) {
          this.store = { ...(options.defaults || {}) } as T;
        }
        get(key: string) { return this.store[key]; }
        set(key: string, value: any) { this.store[key as keyof T] = value; }
        has(key: string) { return Object.prototype.hasOwnProperty.call(this.store, key); }
      }
    `
  );

  await writeFile(
    entryFile,
    `
      import assert from 'node:assert/strict';
      import { mkdir as fsMkdir, writeFile as fsWriteFile } from 'node:fs/promises';
      import nodePath from 'node:path';
      import { Writable } from 'node:stream';

      const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', 'base64');
      const dataDir = ${JSON.stringify(dataDir)};
      const workDir = ${JSON.stringify(workDir)};

      const { default: SettingsService } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/SettingsService.ts'))});
      SettingsService.set('saveFolder', dataDir);
      SettingsService.set('lang', 'ja');

      const { default: AppPreviewService } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/AppPreviewService.ts'))});
      const service = AppPreviewService as any;

      // mock res: sendFileIfExists が stream.pipe(res) を呼ぶため Writable を継承する。
      // writeHead/end/destroy/headersSent の呼び出しを記録する簡易実装。
      class MockRes extends Writable {
        statusCode: number | undefined;
        headersSent = false;
        writeHeadCalls: Array<[number, unknown]> = [];
        _write(_chunk: unknown, _enc: unknown, cb: () => void) { cb(); }
        writeHead(status: number, headers?: unknown) {
          this.statusCode = status;
          this.headersSent = true;
          this.writeHeadCalls.push([status, headers]);
          return this;
        }
      }
      const finish = (res: MockRes) => new Promise<void>((resolve) => res.on('finish', resolve));

      // ---- ファイル配置 ----
      const baseName = nodePath.basename(dataDir); // 'data'
      // AC1 用: baseFolder ({saveFolder}/tmbs) の兄弟 {saveFolder}/tmbs-x に実ファイル
      const tmbsSiblingDir = nodePath.join(dataDir, 'tmbs-x');
      await fsMkdir(tmbsSiblingDir, { recursive: true });
      await fsWriteFile(nodePath.join(tmbsSiblingDir, 'evil.jpg'), PNG);
      // AC1c 用: saveFolder 内だが baseFolder 外の {saveFolder}/{saveFolderBasename}-x に実ファイル
      const innerDataXDir = nodePath.join(dataDir, baseName + '-x');
      await fsMkdir(innerDataXDir, { recursive: true });
      await fsWriteFile(nodePath.join(innerDataXDir, 'evil.jpg'), PNG);
      // AC1b 用: saveFolder 外 (workDir/evil.jpg) に実ファイル
      await fsWriteFile(nodePath.join(workDir, 'evil.jpg'), PNG);
      // AC2 用: saveFolder の兄弟 {saveFolder}-x に実ファイル
      const saveSiblingDir = nodePath.join(nodePath.dirname(dataDir), baseName + '-x');
      await fsMkdir(saveSiblingDir, { recursive: true });
      await fsWriteFile(nodePath.join(saveSiblingDir, 'evil.jpg'), PNG);
      // AC3 用: saveFolder/tmbs/ok.jpg と saveFolder/tiles/x/0/0/0.png に実ファイル
      const tmbsDir = nodePath.join(dataDir, 'tmbs');
      await fsMkdir(tmbsDir, { recursive: true });
      await fsWriteFile(nodePath.join(tmbsDir, 'ok.jpg'), PNG);
      const tileDir = nodePath.join(dataDir, 'tiles', 'x', '0', '0');
      await fsMkdir(tileDir, { recursive: true });
      await fsWriteFile(nodePath.join(tileDir, '0.png'), PNG);

      // ---- AC1: serveDataFile の {baseFolder}-x 兄弟ディレクトリ排除 ----
      // segments = ['..', 'tmbs-x', 'evil.jpg'] → resolved = {saveFolder}/tmbs-x/evil.jpg
      // 旧実装 startsWith(baseFolder) では prefix 一致（'tmbs-x' は 'tmbs' で始まる）で 200 配信されうる。
      // isUnderFolder（startsWith(base + path.sep)）では 403。
      const ac1Res = new MockRes();
      await service.serveDataFile('tmbs', ['..', 'tmbs-x', 'evil.jpg'], ac1Res);
      assert.equal(ac1Res.statusCode, 403,
        'AC1: {baseFolder}-x（tmbs-x）への segments は 403（旧実装なら 200 配信されうる）: ' + ac1Res.statusCode);
      console.log('ok: AC1 sibling {baseFolder}-x segments returns 403');

      // ---- AC1b: serveDataFile の saveFolder 外脱出 ----
      // segments = ['..', '..', 'evil.jpg'] → resolved = workDir/evil.jpg（saveFolder 外）
      const ac1bRes = new MockRes();
      await service.serveDataFile('tmbs', ['..', '..', 'evil.jpg'], ac1bRes);
      assert.equal(ac1bRes.statusCode, 403,
        'AC1b: saveFolder 外脱出 segments は 403: ' + ac1bRes.statusCode);
      console.log('ok: AC1b segments escaping saveFolder returns 403');

      // ---- AC1c: serveDataFile の saveFolder 内・baseFolder 外 ----
      // segments = ['..', '{saveFolderBasename}-x', 'evil.jpg'] → resolved = {saveFolder}/data-x/evil.jpg
      // （saveFolder 内だが baseFolder 配下ではない。新旧いずれの実装でも 403）
      const ac1cRes = new MockRes();
      await service.serveDataFile('tmbs', ['..', baseName + '-x', 'evil.jpg'], ac1cRes);
      assert.equal(ac1cRes.statusCode, 403,
        'AC1c: saveFolder 内だが baseFolder 外の segments は 403: ' + ac1cRes.statusCode);
      console.log('ok: AC1c segments inside saveFolder but outside baseFolder returns 403');

      // ---- AC2: serveLocalFile の {saveFolder}-x 兄弟ディレクトリ排除 ----
      // filePath = {saveFolder}-x/evil.jpg（saveFolder の兄弟）
      // 旧実装 startsWith(path.resolve(saveFolder)) では prefix 一致（'data-x' は 'data' で始まる）で
      // 200 配信されうる。isUnderFolder では 403。
      const ac2Res = new MockRes();
      await service.serveLocalFile(nodePath.join(saveSiblingDir, 'evil.jpg'), ac2Res);
      assert.equal(ac2Res.statusCode, 403,
        'AC2: {saveFolder}-x への filePath は 403（旧実装なら 200 配信されうる）: ' + ac2Res.statusCode);
      console.log('ok: AC2 sibling {saveFolder}-x filePath returns 403');

      // ---- AC3: 正常系（非退行） ----
      // saveFolder/tmbs/ok.jpg は 200 配信（writeHead(200) が呼ばれる）
      const ac3aRes = new MockRes();
      await service.serveDataFile('tmbs', ['ok.jpg'], ac3aRes);
      assert.equal(ac3aRes.statusCode, 200,
        'AC3 正常系: saveFolder/tmbs 内の実ファイルは 200 配信: ' + ac3aRes.statusCode);
      await finish(ac3aRes);
      console.log('ok: AC3 (non-regression) saveFolder/tmbs file served with 200');

      // saveFolder/tiles/x/0/0/0.png 相当を serveLocalFile で 200 配信（非退行）
      const ac3bRes = new MockRes();
      await service.serveLocalFile(nodePath.join(dataDir, 'tiles', 'x', '0', '0', '0.png'), ac3bRes);
      assert.equal(ac3bRes.statusCode, 200,
        'AC3 正常系: saveFolder/tiles 内の実ファイルは serveLocalFile で 200 配信: ' + ac3bRes.statusCode);
      await finish(ac3bRes);
      console.log('ok: AC3 (non-regression) saveFolder/tiles file served with 200');

      console.log('m12-t14 smoke: ALL PASS');
    `
  );

  await build({
    configFile: false,
    logLevel: 'silent',
    resolve: {
      alias: [
        { find: 'electron', replacement: electronStubFile },
        { find: 'electron-store', replacement: electronStoreStubFile },
      ],
    },
    build: {
      emptyOutDir: true,
      outDir,
      ssr: entryFile,
      target: 'node22',
      rollupOptions: {
        external: ['@duckdb/node-api', '@duckdb/node-bindings', /^@duckdb\/node-bindings-.*/, 'jimp'],
        output: {
          entryFileNames: 'm12-t14-containment-smoke.mjs',
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
} finally {
  await rm(workDir, { recursive: true, force: true });
}
