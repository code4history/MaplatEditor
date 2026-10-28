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
const serviceModulePath = path.join(projectRoot, 'electron/services/iiifImportService.ts');
const classifyModulePath = path.join(projectRoot, 'src/utils/ipClassify.ts');

try {
  await writeFile(
    entryFile,
    `
      import assert from 'node:assert/strict';
      import http from 'node:http';
      import { EventEmitter } from 'node:events';
      import { Readable } from 'node:stream';

      const { fetchIiifResource, createPinnedLookup } = await import(${JSON.stringify(fetchModulePath)});
      const { inspectManifest, inspectInfo, fetchThumbnails } = await import(${JSON.stringify(serviceModulePath)});
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

      // ---- 転送（リダイレクト）の各段で同じ検査を通ること ----
      // 応答とヘッダをその場で作り、ポートを開かない
      // （request・lookup・classify をすべて差し替える）。
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
      // 本物の接続と同じく、渡された options.lookup を必ず 1 回呼んでから応答する
      // （各段で名前解決と分類を通るのを測るため）。
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

      const redirectOn = (to, status) => ({
        status: status || 302,
        headers: { location: to },
        body: 'moved',
      });
      const newState = () => ({ requests: [], responses: 0 });
      const publicLookup = (hostname, options, callback) => {
        callback(null, [{ address: '93.184.216.34', family: 4 }]);
      };

      test('redirect-each-hop', async () => {
        // (a) 公開の URL から内部（127.0.0.1）への転送は、2 段目の要求で拒む。
        const stateA = newState();
        const resultA = await fetchIiifResource(
          'https://public.example/a',
          { kind: 'manifest', timeoutMs: 3000 },
          {
            lookup: (hostname, options, callback) => {
              if (hostname === 'internal.example') {
                callback(null, [{ address: '127.0.0.1', family: 4 }]);
              } else {
                callback(null, [{ address: '93.184.216.34', family: 4 }]);
              }
            },
            classify: classifyAddress,
            request: makeFakeRequest(
              (options) =>
                options.path === '/a'
                  ? redirectOn('https://internal.example/b')
                  : { status: 200, headers: {}, body: 'internal' },
              stateA,
            ),
          },
        );
        assert.equal(resultA.ok, false, '(a) must be a failure: ' + JSON.stringify(resultA));
        assert.equal(
          resultA.reason,
          'blocked-address',
          '(a) expected blocked-address but got ' + JSON.stringify(resultA),
        );
        assert.equal(
          stateA.responses,
          1,
          '(a) the second hop must not be read but responses was ' + stateA.responses,
        );

        // (b) 転送先の scheme が http なら not-https、file なら bad-url。
        const resultHttp = await fetchIiifResource(
          'https://public.example/a',
          { kind: 'manifest', timeoutMs: 3000 },
          {
            lookup: publicLookup,
            classify: () => ({ blocked: false }),
            request: makeFakeRequest(
              (options) =>
                options.path === '/a'
                  ? redirectOn('http://public.example/c')
                  : { status: 200, headers: {}, body: 'ok' },
              newState(),
            ),
          },
        );
        assert.equal(resultHttp.ok, false, '(b) http must be a failure: ' + JSON.stringify(resultHttp));
        assert.equal(
          resultHttp.reason,
          'not-https',
          '(b) expected not-https but got ' + JSON.stringify(resultHttp),
        );
        const resultFile = await fetchIiifResource(
          'https://public.example/a',
          { kind: 'manifest', timeoutMs: 3000 },
          {
            lookup: publicLookup,
            classify: () => ({ blocked: false }),
            request: makeFakeRequest(
              (options) =>
                options.path === '/a'
                  ? redirectOn('file:///etc/passwd')
                  : { status: 200, headers: {}, body: 'ok' },
              newState(),
            ),
          },
        );
        assert.equal(resultFile.ok, false, '(b) file must be a failure: ' + JSON.stringify(resultFile));
        assert.equal(
          resultFile.reason,
          'bad-url',
          '(b) expected bad-url but got ' + JSON.stringify(resultFile),
        );

        // (c) 5 回までは追って最終の 200 を受ける。6 回目の転送で止まる。
        const chain = (prefix, redirectCount) => (options) => {
          const index = Number(String(options.path).slice(prefix.length));
          if (index < redirectCount) {
            return redirectOn('https://public.example' + prefix + (index + 1));
          }
          return { status: 200, headers: {}, body: 'done' };
        };
        const followed = await fetchIiifResource(
          'https://public.example/r0',
          { kind: 'manifest', timeoutMs: 3000 },
          {
            lookup: publicLookup,
            classify: () => ({ blocked: false }),
            request: makeFakeRequest(chain('/r', 5), newState()),
          },
        );
        assert.equal(followed.ok, true, '(c) five redirects must succeed: ' + JSON.stringify(followed));
        assert.equal(followed.requestedUrl, 'https://public.example/r0', '(c) requestedUrl');
        assert.equal(followed.finalUrl, 'https://public.example/r5', '(c) finalUrl: ' + followed.finalUrl);
        assert.equal(String(followed.body), 'done', '(c) the final body must be read');

        const stopped = await fetchIiifResource(
          'https://public.example/t0',
          { kind: 'manifest', timeoutMs: 3000 },
          {
            lookup: publicLookup,
            classify: () => ({ blocked: false }),
            request: makeFakeRequest(chain('/t', 6), newState()),
          },
        );
        assert.equal(stopped.ok, false, '(c) six redirects must be a failure: ' + JSON.stringify(stopped));
        assert.equal(
          stopped.reason,
          'fetch-failed',
          '(c) expected fetch-failed but got ' + JSON.stringify(stopped),
        );
        assert.ok(
          /redirect/i.test(String(stopped.detail)),
          '(c) detail must say too many redirects: ' + String(stopped.detail),
        );

        // (d) 相対の Location は現在の URL を基準に解決する。
        const stateD = newState();
        const relative = await fetchIiifResource(
          'https://public.example/a',
          { kind: 'manifest', timeoutMs: 3000 },
          {
            lookup: publicLookup,
            classify: () => ({ blocked: false }),
            request: makeFakeRequest(
              (options) =>
                options.path === '/a'
                  ? redirectOn('/x')
                  : { status: 200, headers: {}, body: 'ok' },
              stateD,
            ),
          },
        );
        assert.equal(relative.ok, true, '(d) a relative redirect must succeed: ' + JSON.stringify(relative));
        assert.equal(relative.requestedUrl, 'https://public.example/a', '(d) requestedUrl');
        assert.equal(relative.finalUrl, 'https://public.example/x', '(d) finalUrl: ' + relative.finalUrl);
        assert.equal(stateD.requests.length, 2, '(d) exactly two hops were requested');
        assert.equal(stateD.requests[1].path, '/x', '(d) the second hop path: ' + stateD.requests[1].path);
      });

      // ---- 取得の全数（4 種が同じ 1 本の道を通る） ----
      // main の取得の入口を、偽の lookup・classify・request で呼ぶ。偽の request は
      // 渡された options.lookup を 1 回呼ぶので、classify が呼ばれた回数が
      // 「検査を通った回数」になる。応答はその場で作り、ポートは開かない。
      const manifestUrl = 'https://iiif.example/iiif/manifest.json';
      const infoServiceUrl = 'https://iiif.example/iiif/image';
      const thumb52Url = 'https://iiif.example/iiif/image/full/52,/0/default.jpg';
      const thumb512Url = 'https://iiif.example/iiif/image/full/512,/0/default.jpg';
      const manifestPath = '/iiif/manifest.json';
      const infoPath = '/iiif/image/info.json';
      const thumb52Path = '/iiif/image/full/52,/0/default.jpg';
      const thumb512Path = '/iiif/image/full/512,/0/default.jpg';
      const manifestBody = JSON.stringify({
        '@context': 'http://iiif.io/api/presentation/3/context.json',
        id: 'https://iiif.example/iiif/manifest',
        type: 'Manifest',
        label: { none: ['sample'] },
        items: [],
      });
      const infoBody = JSON.stringify({
        '@context': 'http://iiif.io/api/image/3/context.json',
        id: 'https://iiif.example/iiif/image',
        type: 'ImageService3',
        width: 4000,
        height: 3000,
      });
      const thumb52Body = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
      const thumb512Body = Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x20, 0x01, 0x02]);

      const serviceScript = (options) => {
        const requestPath = String(options.path);
        if (requestPath === manifestPath) {
          return {
            status: 200,
            headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
            body: manifestBody,
          };
        }
        if (requestPath === infoPath) {
          return {
            status: 200,
            headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
            body: infoBody,
          };
        }
        if (requestPath === thumb52Path) {
          return { status: 200, headers: { 'content-type': 'image/jpeg' }, body: thumb52Body };
        }
        if (requestPath === thumb512Path) {
          return { status: 200, headers: { 'content-type': 'image/jpeg' }, body: thumb512Body };
        }
        return null;
      };

      const publicDeps = (script, state) => ({
        lookup: (hostname, options, callback) => {
          callback(null, [{ address: '93.184.216.34', family: 4 }]);
        },
        classify: () => ({ blocked: false }),
        request: makeFakeRequest(script, state),
      });

      test('fetch-single-path', async () => {
        const state = newState();
        // classify は request の lookup から呼ばれる ∴ 直前に積まれた要求の path が
        // いま検査している取得になる。
        const inspectedPaths = [];
        const deps = {
          lookup: (hostname, options, callback) => {
            callback(null, [{ address: '93.184.216.34', family: 4 }]);
          },
          classify: () => {
            const current = state.requests[state.requests.length - 1];
            inspectedPaths.push(current ? String(current.path) : '');
            return { blocked: false };
          },
          request: makeFakeRequest(serviceScript, state),
        };

        const manifest = await inspectManifest(manifestUrl, deps);
        assert.equal(manifest.ok, true, 'the manifest must be fetched: ' + JSON.stringify(manifest));
        const info = await inspectInfo(infoServiceUrl, deps);
        assert.equal(info.ok, true, 'the info.json must be fetched: ' + JSON.stringify(info));
        const thumbnails = await fetchThumbnails({ url52: thumb52Url, url512: thumb512Url }, deps);
        assert.equal(thumbnails.url52.ok, true, 'the 52px thumbnail must be fetched');
        assert.equal(thumbnails.url512.ok, true, 'the 512px thumbnail must be fetched');

        const expected = [manifestPath, infoPath, thumb52Path, thumb512Path];
        for (const requestPath of expected) {
          const count = inspectedPaths.filter((entry) => entry === requestPath).length;
          assert.equal(
            count,
            1,
            requestPath + ' must pass the inspection exactly once but passed ' + count,
          );
        }
        assert.equal(
          inspectedPaths.length,
          expected.length,
          'every fetch must go through the inspection once but the inspections were ' +
            JSON.stringify(inspectedPaths),
        );
        const inspected = expected.filter(
          (requestPath) => inspectedPaths.filter((entry) => entry === requestPath).length === 1,
        ).length;
        return '(' + inspected + '/' + expected.length + ')';
      });

      test('inspect-returns-json-and-facts', async () => {
        const state = newState();
        const manifest = await inspectManifest(manifestUrl, publicDeps(serviceScript, state));
        assert.equal(manifest.ok, true, 'the manifest must be fetched: ' + JSON.stringify(manifest));
        assert.equal(typeof manifest.json, 'object', 'the manifest must be a parsed object');
        assert.equal(manifest.json.type, 'Manifest', 'the parsed manifest type');
        assert.equal(manifest.requestedUrl, manifestUrl, 'requestedUrl: ' + manifest.requestedUrl);
        assert.equal(manifest.finalUrl, 'https://iiif.example' + manifestPath, 'finalUrl');
        assert.equal(manifest.accessControlAllowOrigin, '*', 'accessControlAllowOrigin');

        const info = await inspectInfo(infoServiceUrl, publicDeps(serviceScript, state));
        assert.equal(info.ok, true, 'the info.json must be fetched: ' + JSON.stringify(info));
        assert.equal(typeof info.json, 'object', 'the info.json must be a parsed object');
        assert.equal(info.json.width, 4000, 'the parsed info.json width');
        assert.equal(
          info.requestedUrl,
          'https://iiif.example' + infoPath,
          'the requested url of the info.json: ' + info.requestedUrl,
        );
        assert.equal(info.finalUrl, 'https://iiif.example' + infoPath, 'finalUrl');
      });

      test('inspect-json-by-parse', async () => {
        // Content-Type が JSON でも、本文が読めなければ not-json。
        const brokenState = newState();
        const broken = await inspectManifest(
          manifestUrl,
          publicDeps(
            () => ({
              status: 200,
              headers: { 'content-type': 'application/json' },
              body: 'this is not json',
            }),
            brokenState,
          ),
        );
        assert.equal(broken.ok, false, 'an unreadable body must be a failure: ' + JSON.stringify(broken));
        assert.equal(broken.reason, 'not-json', 'expected not-json but got ' + String(broken.reason));

        // Content-Type が JSON でなくても、本文が読めれば通す（ヘッダで決めない）。
        const plainState = newState();
        const plain = await inspectManifest(
          manifestUrl,
          publicDeps(
            () => ({
              status: 200,
              headers: { 'content-type': 'text/plain' },
              body: manifestBody,
            }),
            plainState,
          ),
        );
        assert.equal(plain.ok, true, 'the header must not decide json: ' + JSON.stringify(plain));
        assert.equal(plain.json.type, 'Manifest', 'the parsed manifest type');
      });

      test('info-url-normalized', async () => {
        const state = newState();
        const given = 'https://iiif.example' + infoPath;
        const info = await inspectInfo(given, publicDeps(serviceScript, state));
        assert.equal(info.ok, true, 'the info.json must be fetched: ' + JSON.stringify(info));
        assert.equal(state.requests.length, 1, 'exactly one request must be made');
        assert.equal(state.requests[0].path, infoPath, 'the path must not be doubled: ' + state.requests[0].path);
        assert.equal(info.requestedUrl, given, 'requestedUrl: ' + info.requestedUrl);
      });

      test('thumbnail-bytes', async () => {
        const state = newState();
        const thumbnails = await fetchThumbnails(
          { url52: thumb52Url, url512: thumb512Url },
          publicDeps(serviceScript, state),
        );
        assert.equal(thumbnails.url52.ok, true, 'the 52px thumbnail must be fetched');
        assert.equal(thumbnails.url52.contentType, 'image/jpeg', 'the 52px content type');
        assert.equal(
          Buffer.compare(thumbnails.url52.body, thumb52Body),
          0,
          'the 52px body must be the response bytes',
        );
        assert.equal(thumbnails.url512.ok, true, 'the 512px thumbnail must be fetched');
        assert.equal(thumbnails.url512.contentType, 'image/jpeg', 'the 512px content type');
        assert.equal(
          Buffer.compare(thumbnails.url512.body, thumb512Body),
          0,
          'the 512px body must be the response bytes',
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
