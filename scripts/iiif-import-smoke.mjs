// IIIF 取り込みの取得層（electron/services/iiifFetch.ts）の smoke。
//
// 前例（scripts/m12-t13-resolver-containment-smoke.mjs）と同じ形で、main の TS を
// vite の ssr build で束ね、子プロセスで走らせる。electron に依存しないので
// スタブは要らない。試験は 1 つずつ `ok: <機能の名前>` を出し、1 つでも失敗したら
// exit 1 で終わる。この先の段で試験を足せるよう、entry の中の `test(...)` に
// 1 件ずつ並べる形にしている。
//
// 使い方: node scripts/iiif-import-smoke.mjs
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'iiif-import-'));
const entryFile = path.join(workDir, 'iiif-import-smoke-entry.ts');
const outDir = path.join(workDir, 'dist');
const bundledFile = path.join(outDir, 'iiif-import-smoke.mjs');

const fetchModulePath = path.join(projectRoot, 'electron/services/iiifFetch.ts');
const classifyModulePath = path.join(projectRoot, 'src/utils/ipClassify.ts');

try {
  await writeFile(
    entryFile,
    `
      import assert from 'node:assert/strict';
      import http from 'node:http';

      const { fetchIiifResource, createPinnedLookup } = await import(${JSON.stringify(fetchModulePath)});
      const { classifyAddress, BLOCKED_ADDRESS_RANGES } = await import(${JSON.stringify(classifyModulePath)});

      const tests = [];
      const test = (name, fn) => { tests.push({ name, fn }); };

      // 拒む URL では取得の口（request）も名前解決（lookup）も触らないことを測る。
      // 呼ばれたら数えて例外にする（戻り値の試験と取り違えないため）。
      const makeDeps = () => {
        const calls = { request: 0, lookup: 0 };
        const deps = {
          lookup: () => {
            calls.lookup += 1;
            throw new Error('lookup must not be called for a rejected url');
          },
          classify: () => ({ blocked: false }),
          request: () => {
            calls.request += 1;
            throw new Error('request must not be called for a rejected url');
          },
        };
        return { calls, deps };
      };

      const rejectedCases = [
        { label: 'http scheme', url: 'http://example.org/iiif/manifest', reason: 'not-https' },
        { label: 'file scheme', url: 'file:///etc/passwd', reason: 'bad-url' },
        { label: 'data scheme', url: 'data:application/json,{}', reason: 'bad-url' },
        { label: 'javascript scheme', url: 'javascript:alert(1)', reason: 'bad-url' },
        { label: 'app scheme', url: 'app://bundle/__local/manifest.json', reason: 'bad-url' },
        { label: 'unreadable string', url: 'this is not a url', reason: 'bad-url' },
        { label: 'port zero', url: 'https://example.org:0/manifest', reason: 'bad-url' },
      ];

      test('rejects-non-http-schemes', async () => {
        for (const item of rejectedCases) {
          const { calls, deps } = makeDeps();
          let result;
          try {
            result = await fetchIiifResource(item.url, { kind: 'manifest' }, deps);
          } catch (error) {
            assert.fail(
              item.label + ': must not throw but threw: ' + (error instanceof Error ? error.message : String(error)),
            );
          }
          assert.equal(result.ok, false, item.label + ': result must be a failure: ' + JSON.stringify(result));
          assert.equal(
            result.reason,
            item.reason,
            item.label + ': expected reason ' + item.reason + ' but got ' + result.reason,
          );
          assert.equal(calls.request, 0, item.label + ': request must not be called');
          assert.equal(calls.lookup, 0, item.label + ': lookup must not be called');
        }
      });

      // 名前解決を 1 回だけ行い、判定したアドレスへ接続を固定することを、
      // 本物の要求で確かめる。誰も待っていないポート（9）へ要求するので、
      // ポートを開かない（listen しない）。外のネットワークへも出ない。
      const pinnedLookupCalls = { count: 0 };
      const pinnedDeps = {
        lookup: (hostname, options, callback) => {
          pinnedLookupCalls.count += 1;
          callback(null, [{ address: '127.0.0.1', family: 4 }]);
        },
        classify: (address) => ({ blocked: address !== '127.0.0.1' }),
        request: http.request,
      };
      let pinnedPromise;
      const pinnedResult = () => {
        if (!pinnedPromise) {
          pinnedPromise = fetchIiifResource(
            'https://rebind.example:9/info.json',
            { kind: 'info', timeoutMs: 3000 },
            pinnedDeps,
          );
        }
        return pinnedPromise;
      };

      test('lookup-called-once', async () => {
        const result = await pinnedResult();
        assert.equal(result.ok, false, 'must be a failure: ' + JSON.stringify(result));
        assert.equal(
          pinnedLookupCalls.count,
          1,
          'lookup must be called exactly once but was ' + pinnedLookupCalls.count,
        );
      });

      test('refused-at-pinned-address', async () => {
        const result = await pinnedResult();
        assert.equal(result.reason, 'fetch-failed', 'expected fetch-failed but got ' + JSON.stringify(result));
        const cause = result.cause || {};
        assert.equal(
          cause.code,
          'ECONNREFUSED',
          'the original error must be ECONNREFUSED but was ' + String(cause.code),
        );
      });

      test('pinned-remote-address', async () => {
        const result = await pinnedResult();
        const cause = result.cause || {};
        assert.equal(
          cause.address,
          '127.0.0.1',
          'the connection must go to the pinned address but went to ' + String(cause.address),
        );
      });

      test('no-invalid-ip-address', async () => {
        const result = await pinnedResult();
        const cause = result.cause || {};
        assert.notEqual(
          cause.code,
          'ERR_INVALID_IP_ADDRESS',
          'the pinned lookup must not produce ERR_INVALID_IP_ADDRESS',
        );
        assert.equal(
          result.reason,
          'fetch-failed',
          'ERR_INVALID_IP_ADDRESS would fail here instead of reaching the address',
        );

        // 名前解決の呼び方の両方の形（配列・単数）を返せることを直接確かめる。
        const observed = [];
        const lookup = createPinnedLookup(
          (hostname, options, callback) => {
            observed.push(options);
            callback(null, [{ address: '93.184.216.34', family: 4 }]);
          },
          () => ({ blocked: false }),
        );
        const callPinned = (options) =>
          new Promise((resolve, reject) => {
            lookup('example.org', options, (err, address, family) => {
              if (err) reject(err);
              else resolve({ address, family });
            });
          });
        const allShape = await callPinned({ all: true });
        assert.ok(Array.isArray(allShape.address), 'all: true must answer with an array');
        assert.equal(allShape.address.length, 1, 'all: true must answer with exactly one entry');
        assert.equal(allShape.address[0].address, '93.184.216.34');
        assert.equal(allShape.address[0].family, 4);
        const singleShape = await callPinned({});
        assert.equal(singleShape.address, '93.184.216.34');
        assert.equal(singleShape.family, 4);
        assert.equal(observed.length, 2, 'lookup must be called once per resolution');
        assert.equal(observed[0].all, true, 'the inner lookup must ask for every address');
      });

      test('dns-rebinding-single-lookup', async () => {
        let calls = 0;
        const result = await fetchIiifResource(
          'https://rebind.example:9/info.json',
          { kind: 'info', timeoutMs: 3000 },
          {
            lookup: (hostname, options, callback) => {
              calls += 1;
              // 2 回目に別のアドレスを返そうとする筋書き。1 回しか呼ばれないはず。
              const address = calls === 1 ? '127.0.0.1' : '127.0.0.2';
              callback(null, [{ address, family: 4 }]);
            },
            classify: (address) => ({ blocked: address !== '127.0.0.1' }),
            request: http.request,
          },
        );
        assert.equal(calls, 1, 'lookup must be called exactly once but was ' + calls);
        assert.equal(result.ok, false, 'must be a failure: ' + JSON.stringify(result));
        const cause = result.cause || {};
        assert.equal(
          cause.address,
          '127.0.0.1',
          'the connection must stay on the first answer but went to ' + String(cause.address),
        );
      });

      // §3.3-3 の分類の規則。表の各行に 1 つ以上の拒む見本を当て、行数を数える。
      const blockedAddressSamples = [
        // クラウドのメタデータ（最優先で拒む）
        '169.254.169.254',
        'fd00:ec2::254',
        '100.100.100.200',
        // loopback
        '127.0.0.1',
        '::1',
        // private
        '10.1.2.3',
        '172.16.0.1',
        '192.168.1.1',
        'fc00::1',
        // link-local
        '169.254.1.1',
        'fe80::1',
        // 未指定・この機械
        '0.0.0.0',
        '::',
        // IPv4 を写した IPv6
        '::ffff:127.0.0.1',
        // NAT の内側（CGNAT）
        '100.64.0.1',
        // マルチキャスト
        '224.0.0.1',
        'ff02::1',
        // その他の予約
        '192.0.0.1',
        '192.0.2.1',
        '198.18.0.1',
        '198.51.100.1',
        '203.0.113.1',
        '240.0.0.1',
        '255.255.255.255',
        '2001:db8::1',
        '64:ff9b::7f00:1',
        '2002:7f00:1::',
        // 追加の予約
        '::7f00:1',
        '::ffff:0:7f00:1',
        '64:ff9b:1::1',
        '2001::1',
        'fec0::1',
        '100::1',
        '192.88.99.1',
        // 境界（172.16.0.0/12 の上限）
        '172.31.255.255',
        // [ ] 付きでも同じ
        '[::1]',
      ];
      const allowedAddressSamples = [
        '93.184.216.34',
        '2606:2800:220:1::1',
        // 境界（172.16.0.0/12 の外・100.64.0.0/10 の外）
        '172.32.0.1',
        '100.128.0.1',
      ];
      const notAnIpSamples = ['example.org', 'localhost', 'not an ip', '999.1.1.1', ''];

      test('address-blocklist', async () => {
        for (const address of blockedAddressSamples) {
          const verdict = classifyAddress(address);
          assert.equal(
            verdict.blocked,
            true,
            address + ' must be blocked but was allowed: ' + JSON.stringify(verdict),
          );
        }
        for (const address of allowedAddressSamples) {
          const verdict = classifyAddress(address);
          assert.equal(
            verdict.blocked,
            false,
            address + ' must be allowed but was blocked: ' + JSON.stringify(verdict),
          );
        }
        for (const address of notAnIpSamples) {
          const verdict = classifyAddress(address);
          assert.equal(verdict.blocked, true, address + ' must be blocked: ' + JSON.stringify(verdict));
          assert.equal(
            verdict.reason,
            'not-an-ip',
            address + ' must be refused as not-an-ip: ' + JSON.stringify(verdict),
          );
        }

        // 表の行数と、拒む見本が当たった行の数を突き合わせる。
        const rows = Array.isArray(BLOCKED_ADDRESS_RANGES) ? BLOCKED_ADDRESS_RANGES : [];
        assert.ok(rows.length > 0, 'the table must not be empty');
        const hitKinds = new Map();
        for (const address of blockedAddressSamples) {
          const verdict = classifyAddress(address);
          if (verdict.kind) hitKinds.set(verdict.kind, (hitKinds.get(verdict.kind) || 0) + 1);
        }
        const missed = rows.filter((row) => !hitKinds.has(row.kind)).map((row) => row.kind);
        assert.deepEqual(missed, [], 'the table has rows with no blocked sample: ' + missed.join(', '));
        const hitRows = rows.length - missed.length;
        return '(' + hitRows + '/' + rows.length + ')';
      });

      // 既定の classify が classifyAddress に替わっていることを、依存を渡さずに測る。
      // 拒むアドレスなので、取得の口（request）は触らない。
      test('default-classify-blocks-private', async () => {
        let requestCalls = 0;
        const result = await fetchIiifResource(
          'https://127.0.0.1:9/info.json',
          { kind: 'info', timeoutMs: 3000 },
          {
            request: () => {
              requestCalls += 1;
              throw new Error('request must not be called for a blocked address');
            },
          },
        );
        assert.equal(requestCalls, 0, 'the blocked address must not reach the request');
        assert.equal(result.ok, false, 'must be a failure: ' + JSON.stringify(result));
        assert.equal(
          result.reason,
          'blocked-address',
          'the default classify must block 127.0.0.1 but got ' + String(result.reason),
        );
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
      // Electron で走ったかどうかは記録だけする（CI のふつうの node では飛ばす）。
      const electronVersion = process.versions.electron;
      console.log('electron: ' + (electronVersion ? electronVersion : 'not-electron (skipped)'));
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
    build: {
      emptyOutDir: true,
      outDir,
      ssr: entryFile,
      target: 'node22',
      rollupOptions: {
        output: {
          entryFileNames: 'iiif-import-smoke.mjs',
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
    'iiif-import smoke: failed: ' +
      (error instanceof Error ? error.message : String(error)),
  );
  process.exitCode = 1;
} finally {
  await rm(workDir, { recursive: true, force: true });
}
