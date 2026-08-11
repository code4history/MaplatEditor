// M1-T6 smoke: プレビューサーバの認証・オリジン防御。
// m12-t14 smoke と同型の harness（electron/electron-store stub + vite ssr build）だが、
// private メソッドの直接呼び出しでは handle() の Host 検査を素通りしてしまうため、
// 実サーバを prepare() で起動し **実 HTTP リクエスト**を発行して検証する（設計 v1.3 §5.2）。
//
// 検証する受け入れ条件:
//   AC1  Host: evil.example:<port> は 403
//   AC2  Host ヘッダ欠落（HTTP/1.0 生ソケット）は 403
//   AC3  Host: 127.0.0.1:<port> / localhost:<port> は通過（非退行）
//   AC4  Origin: http://evil.example は 403
//   AC5  Origin 不在 / null / localhost 別ポート / 127.0.0.1 同ポートは通過。
//        https://evil.example とパース不能 Origin は 403
//   AC6  /local-file/<絶対パス>（token なし）は 404
//   AC7  /local-file/<不正token>/<絶対パス> は 404
//   AC8  /local-file/<有効token>/<saveFolder 配下> は 200（非退行）
//   AC9  /local-file/<有効token>/<saveFolder 外> は 403
//   AC10 token が randomUUID 形状で毎回異なる
//   AC11 2回目の prepare() 後、1回目の token は 404（セッション失効）
//   AC12 shutdown() 後は ECONNREFUSED、かつ同ポートで再 listen できる
//   AC13 main.ts の win.on('close') / before-quit 双方から shutdown が呼ばれている（ソーステキスト）
//   AC18 shutdown → prepare でポートが漂流しない（INV-3）
//   AC19 競合ケースA（shutdown→prepare 発行）: 最終状態はサーバ存続
//   AC20 競合ケースB（prepare→shutdown 発行）: 最終状態はサーバ停止・ポート解放
//   AC21 ケースB からの復帰: preferred 再取得・旧 token は 404
//   AC22 Windows drive の URL round-trip（path.win32 注入の純関数検証）
//   AC23 Windows UNC / POSIX の URL round-trip（先頭スラッシュ個数の保存）
//   AC24 fromUrlPathname がネイティブパスに対して no-op
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'm1-t6-preview-auth-'));
const entryFile = path.join(workDir, 'm1-t6-preview-auth-smoke.ts');
const electronStubFile = path.join(workDir, 'electron-stub.ts');
const electronStoreStubFile = path.join(workDir, 'electron-store-stub.ts');
const outDir = path.join(workDir, 'dist');
const bundledFile = path.join(outDir, 'm1-t6-preview-auth-smoke.mjs');

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
      import http from 'node:http';
      import net from 'node:net';
      import nodePath from 'node:path';
      import { mkdir as fsMkdir, writeFile as fsWriteFile } from 'node:fs/promises';

      const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', 'base64');
      const dataDir = ${JSON.stringify(dataDir)};
      const workDir = ${JSON.stringify(workDir)};
      // 開発者が実行中の Editor（既定 41781）と衝突しない高位ポートを固定で使う。
      // AC18〜AC21 の判定はこの固定値との一致で行う
      const PREFERRED = 45781;

      const { default: SettingsService } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/SettingsService.ts'))});
      SettingsService.set('saveFolder', dataDir);
      SettingsService.set('lang', 'ja');

      const mod = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/AppPreviewService.ts'))});
      const service = mod.default as any;
      const { toUrlPathname, fromUrlPathname } = mod as any;

      // ---- テスト用ファイル配置 ----
      const tileDir = nodePath.join(dataDir, 'tiles', 'x', '0', '0');
      await fsMkdir(tileDir, { recursive: true });
      const okFile = nodePath.join(tileDir, '0.png');
      await fsWriteFile(okFile, PNG);
      // saveFolder の外（兄弟ディレクトリ）に実ファイル。AC9 用
      const outsideDir = nodePath.join(nodePath.dirname(dataDir), nodePath.basename(dataDir) + '-x');
      await fsMkdir(outsideDir, { recursive: true });
      const outsideFile = nodePath.join(outsideDir, 'evil.png');
      await fsWriteFile(outsideFile, PNG);

      const doc = () => ({ appID: 'smoke', sources: [], lang: 'ja', httpSettings: { previewPort: PREFERRED } });
      const tokenOf = (url: string) => new URL(url).pathname.split('/').filter(Boolean)[1];

      // 実 HTTP。ヘッダを明示的に組み立てられるよう http.request を直接使う。
      // headers 未指定時 Node は Host を自動付与する（= 127.0.0.1:<port>）。
      // agent:false は必須。Node 19+ の http.globalAgent は keepAlive:true が既定で、
      // プールされた socket を再利用すると shutdown 後の判定が ECONNREFUSED ではなく
      // ECONNRESET（死んだ socket への書き込み）になり、ポート解放の検証にならない（実測）
      function request(port: number, urlPath: string, headers: Record<string, string> = {}): Promise<number | string> {
        return new Promise((resolve) => {
          const req = http.request({ host: '127.0.0.1', port, path: urlPath, method: 'GET', headers, agent: false }, (res) => {
            res.resume();
            res.on('end', () => resolve(res.statusCode!));
          });
          req.on('error', (e: any) => resolve('ERR:' + (e.code || e.message)));
          req.end();
        });
      }

      // Host ヘッダを完全に省いた HTTP/1.0 リクエストを生ソケットで送る（AC2）
      function rawRequestWithoutHost(port: number, urlPath: string): Promise<string> {
        return new Promise((resolve, reject) => {
          const sock = net.connect(port, '127.0.0.1', () => {
            sock.write('GET ' + urlPath + ' HTTP/1.0\\r\\n\\r\\n');
          });
          let buf = '';
          sock.on('data', (chunk) => { buf += chunk.toString('utf8'); });
          sock.on('end', () => resolve(buf.split('\\r\\n')[0]));
          sock.on('error', reject);
        });
      }

      const portFree = (port: number): Promise<boolean> => new Promise((resolve) => {
        const srv = net.createServer();
        srv.once('error', () => resolve(false));
        srv.listen(port, '127.0.0.1', () => srv.close(() => resolve(true)));
      });

      // ============ AC22〜AC24: URL 契約の純関数（path.win32 注入。POSIX 環境で実行可） ============
      // 受信側の分解は handle() と同じ手順を再現する（設計 §3.3.4）
      function splitLocalFileUrl(urlPath: string) {
        const p = new URL(urlPath, 'http://127.0.0.1:1').pathname;
        const PREFIX = '/local-file/';
        if (!p.startsWith(PREFIX)) return null;
        const rest = p.slice(PREFIX.length);
        const i = rest.indexOf('/');
        if (i <= 0) return null;
        return { token: rest.slice(0, i), filePath: rest.slice(i) };
      }
      function roundTrip(nativePath: string, sep: string, impl: any) {
        const urlPath = '/local-file/TOK' + encodeURI(toUrlPathname(nativePath, sep)).replace(/%7B/g, '{').replace(/%7D/g, '}');
        const split = splitLocalFileUrl(urlPath);
        assert.ok(split, 'local-file URL の分解に失敗: ' + urlPath);
        assert.equal(split!.token, 'TOK', 'token の切り出しが誤っている: ' + split!.token);
        return { urlPath, filePath: split!.filePath, resolved: impl.resolve(fromUrlPathname(decodeURIComponent(split!.filePath))) };
      }

      {
        // AC22: Windows drive
        assert.equal(toUrlPathname('C:\\\\Users\\\\x\\\\t.jpg', nodePath.win32.sep), '/C:/Users/x/t.jpg',
          'AC22: Windows drive path の URL 表現が /C:/... にならない');
        const w = roundTrip('C:\\\\Users\\\\x\\\\t.jpg', nodePath.win32.sep, nodePath.win32);
        assert.equal(w.urlPath, '/local-file/TOK/C:/Users/x/t.jpg', 'AC22: 生成 URL が想定と違う: ' + w.urlPath);
        assert.equal(w.resolved, 'C:\\\\Users\\\\x\\\\t.jpg', 'AC22: Windows drive の round-trip が一致しない: ' + w.resolved);
        console.log('ok: AC22 windows drive path round-trips through the local-file URL contract');

        // AC23: Windows UNC と POSIX
        const u = roundTrip('\\\\\\\\srv\\\\share\\\\x\\\\t.jpg', nodePath.win32.sep, nodePath.win32);
        assert.equal(u.filePath, '//srv/share/x/t.jpg',
          'AC23: UNC の先頭スラッシュ2個が保存されていない（filter(Boolean) で潰れている）: ' + u.filePath);
        assert.equal(u.resolved, '\\\\\\\\srv\\\\share\\\\x\\\\t.jpg', 'AC23: UNC の round-trip が一致しない: ' + u.resolved);
        const px = roundTrip('/Users/x/t.jpg', nodePath.posix.sep, nodePath.posix);
        assert.equal(px.resolved, '/Users/x/t.jpg', 'AC23: POSIX の round-trip が一致しない: ' + px.resolved);
        console.log('ok: AC23 windows UNC and posix paths round-trip (leading slash count preserved)');

        // AC24: ネイティブパスに対して no-op（servePreviewTile 経路を壊さない）
        assert.equal(fromUrlPathname('C:\\\\d\\\\tiles\\\\a.png'), 'C:\\\\d\\\\tiles\\\\a.png',
          'AC24: Windows ネイティブパスが書き換えられている');
        assert.equal(fromUrlPathname('/d/tiles/a.png'), '/d/tiles/a.png',
          'AC24: POSIX ネイティブパスが書き換えられている');
        console.log('ok: AC24 fromUrlPathname is a no-op for native paths');
      }

      // ============ サーバ起動 ============
      const p1 = await service.prepare(doc());
      const port = p1.port;
      const token1 = tokenOf(p1.url);
      assert.equal(port, PREFERRED, 'preferred ポートで listen していない: ' + port);

      // ---- AC10: token の予測不能性 ----
      assert.match(token1, /^smoke-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
        'AC10: token が randomUUID 形状でない: ' + token1);

      // ---- AC3: 正当な Host は通過 ----
      assert.equal(await request(port, '/preview/' + token1 + '/'), 200,
        'AC3: Host 127.0.0.1:<port> が通過しない');
      assert.equal(await request(port, '/preview/' + token1 + '/', { host: 'localhost:' + port }), 200,
        'AC3: Host localhost:<port> が通過しない');
      console.log('ok: AC3 loopback Host values pass');

      // ---- AC1: 外部ドメインの Host は 403（DNS rebinding 防御） ----
      assert.equal(await request(port, '/preview/' + token1 + '/', { host: 'evil.example:' + port }), 403,
        'AC1: 外部ドメインの Host が 403 にならない（DNS rebinding が通る）');
      console.log('ok: AC1 foreign Host is rejected with 403');

      // ---- AC2: Host 欠落は 403（fail-closed） ----
      const statusLine = await rawRequestWithoutHost(port, '/preview/' + token1 + '/');
      assert.match(statusLine, /^HTTP\\/1\\.[01] 403 /,
        'AC2: Host ヘッダ欠落が 403 にならない: ' + statusLine);
      console.log('ok: AC2 missing Host header is rejected with 403');

      // ---- AC4 / AC5: Origin ----
      assert.equal(await request(port, '/preview/' + token1 + '/', { origin: 'http://evil.example' }), 403,
        'AC4: 外部 Origin が 403 にならない');
      assert.equal(await request(port, '/preview/' + token1 + '/', { origin: 'https://evil.example' }), 403,
        'AC5: https の外部 Origin が 403 にならない');
      assert.equal(await request(port, '/preview/' + token1 + '/', { origin: '%%%' }), 403,
        'AC5: パース不能な Origin が 403 にならない');
      console.log('ok: AC4 foreign Origin is rejected with 403');
      // Origin 不在は AC3 で確認済み（headers 未指定）。以下は許可されるべき Origin 群
      assert.equal(await request(port, '/preview/' + token1 + '/', { origin: 'null' }), 200,
        'AC5: file:// レンダラの Origin: null が通過しない（m18-t5 のレンダラ直 fetch が落ちる）');
      assert.equal(await request(port, '/preview/' + token1 + '/', { origin: 'http://localhost:5173' }), 200,
        'AC5: Vite dev server オリジン（ループバック別ポート）が通過しない');
      assert.equal(await request(port, '/preview/' + token1 + '/', { origin: 'http://127.0.0.1:' + port }), 200,
        'AC5: iframe 自身の Origin が通過しない');
      console.log('ok: AC5 absent/null/loopback Origins pass, foreign and unparsable are rejected');

      // ---- AC6〜AC9: /local-file の token 要求とパス封じ込め ----
      const okUrlPath = toUrlPathname(okFile);
      assert.equal(await request(port, '/local-file' + okUrlPath), 404,
        'AC6: token 無しの /local-file が 404 にならない（無認証で saveFolder 配下が読める）');
      console.log('ok: AC6 /local-file without a token is rejected');
      assert.equal(await request(port, '/local-file/' + token1 + 'x' + okUrlPath), 404,
        'AC7: 不正 token の /local-file が 404 にならない');
      console.log('ok: AC7 /local-file with an unknown token is rejected');
      assert.equal(await request(port, '/local-file/' + token1 + okUrlPath), 200,
        'AC8: 有効 token の /local-file が 200 配信されない（非退行）');
      console.log('ok: AC8 /local-file with a valid token serves the file');
      assert.equal(await request(port, '/local-file/' + token1 + toUrlPathname(outsideFile)), 403,
        'AC9: saveFolder 外のパスが 403 にならない（m12-t14 の封じ込めが新経路で効いていない）');
      console.log('ok: AC9 path containment still holds on the tokenized route');

      // ---- AC11: 2回目の prepare で旧セッションが失効する ----
      const p2 = await service.prepare(doc());
      const token2 = tokenOf(p2.url);
      assert.notEqual(token2, token1, 'AC10: 2回の prepare で token が同一');
      assert.equal(await request(port, '/preview/' + token2 + '/'), 200, 'AC11: 新 token が 200 にならない');
      assert.equal(await request(port, '/preview/' + token1 + '/'), 404,
        'AC11: 旧 token が失効していない（sessions が clear されていない）');
      console.log('ok: AC10 tokens are unpredictable and AC11 the previous session is invalidated');

      // ---- AC12 / AC18: shutdown とポート解放・再取得 ----
      await service.shutdown();
      assert.equal(await request(port, '/preview/' + token2 + '/'), 'ERR:ECONNREFUSED',
        'AC12: shutdown 後も接続を受け付けている');
      assert.equal(await portFree(port), true, 'AC12: shutdown 後にポートが解放されていない');
      console.log('ok: AC12 shutdown closes the server and releases the port');

      const p3 = await service.prepare(doc());
      assert.equal(p3.port, PREFERRED, 'AC18: shutdown → prepare でポートが漂流した: ' + p3.port);
      assert.equal(SettingsService.get('previewPortActive'), PREFERRED,
        'AC18: previewPortActive が preferred と一致しない: ' + SettingsService.get('previewPortActive'));
      console.log('ok: AC18 the port does not drift across a shutdown/prepare pair');

      // ---- AC19: 競合ケースA（shutdown → prepare の発行順）→ 最終状態はサーバ存続 ----
      {
        const stopping = service.shutdown();      // await しない
        const preparing = service.prepare(doc()); // 直後に発行
        const [, pA] = await Promise.all([stopping, preparing]);
        const tokenA = tokenOf(pA.url);
        assert.equal(pA.port, PREFERRED, 'AC19: ケースAでポートが漂流した: ' + pA.port);
        assert.equal(await request(PREFERRED, '/preview/' + tokenA + '/'), 200,
          'AC19: ケースAの最終状態でサーバが存続していない（古い stop が新 session を消した）');
        assert.equal(await request(PREFERRED, '/local-file/' + tokenA + okUrlPath), 200,
          'AC19: ケースAの最終状態で local-file が配信されない');
        console.log('ok: AC19 case A (shutdown then prepare) leaves the server running');
      }

      // ---- AC20: 競合ケースB（prepare → shutdown の発行順）→ 最終状態はサーバ停止 ----
      let tokenB = '';
      {
        const preparing = service.prepare(doc()); // await しない
        const stopping = service.shutdown();      // 直後に発行
        const [pB] = await Promise.all([preparing, stopping]);
        tokenB = tokenOf(pB.url);
        assert.equal(pB.port, PREFERRED,
          'AC20: ケースBでポートが preferred+1 へ漂流した（直列化されていない）: ' + pB.port);
        assert.equal(await request(PREFERRED, '/preview/' + tokenB + '/'), 'ERR:ECONNREFUSED',
          'AC20: ケースBの最終状態でサーバが停止していない');
        assert.equal(await portFree(PREFERRED), true, 'AC20: ケースBの最終状態でポートが解放されていない');
        console.log('ok: AC20 case B (prepare then shutdown) leaves the server stopped');
      }

      // ---- AC21: ケースBからの復帰 ----
      {
        const pC = await service.prepare(doc());
        const tokenC = tokenOf(pC.url);
        assert.equal(pC.port, PREFERRED, 'AC21: 復帰時に preferred ポートを再取得できていない: ' + pC.port);
        assert.equal(await request(PREFERRED, '/preview/' + tokenC + '/'), 200, 'AC21: 復帰後の新 token が 200 にならない');
        assert.equal(await request(PREFERRED, '/preview/' + tokenB + '/'), 404,
          'AC21: ケースBの旧 token が失効していない（INV-2 の最終状態が満たされない）');
        console.log('ok: AC21 recovery from case B re-acquires the preferred port and invalidates the old token');
        await service.shutdown();
      }

      console.log('m1-t6 smoke: ALL PASS');
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
          entryFileNames: 'm1-t6-preview-auth-smoke.mjs',
          format: 'es',
        },
      },
    },
  });

  const { stdout, stderr } = await execFileAsync(process.execPath, [bundledFile], {
    cwd: projectRoot,
    timeout: 180000,
    maxBuffer: 1024 * 1024 * 8,
  });
  process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
} finally {
  await rm(workDir, { recursive: true, force: true });
}

// ---- AC13: main.ts の停止配線（ソーステキスト assert。m5/m12-t30 と同じ様式） ----
{
  const mainSrc = await readFile(path.join(projectRoot, 'electron/main.ts'), 'utf8');
  const closeIdx = mainSrc.indexOf("win.on('close'");
  assert.notEqual(closeIdx, -1, "AC13: main.ts に win.on('close') が見つからない");
  const beforeQuitIdx = mainSrc.indexOf("app.on('before-quit'");
  assert.notEqual(beforeQuitIdx, -1, "AC13: main.ts に app.on('before-quit') が見つからない");
  // 各ハンドラの本体（次の 400 文字）に shutdown 呼び出しがあること。
  // 範囲を絞るのは、ファイル内のどこか1箇所にあるだけで通る vacuous な assert を避けるため
  const closeBody = mainSrc.slice(closeIdx, closeIdx + 400);
  const beforeQuitBody = mainSrc.slice(beforeQuitIdx, beforeQuitIdx + 400);
  assert.match(closeBody, /AppPreviewService\.shutdown\(\)/,
    "AC13: win.on('close') ハンドラから AppPreviewService.shutdown() が呼ばれていない");
  assert.match(beforeQuitBody, /AppPreviewService\.shutdown\(\)/,
    "AC13: app.on('before-quit') ハンドラから AppPreviewService.shutdown() が呼ばれていない");
  assert.match(mainSrc, /import\s+AppPreviewService\s+from\s+'\.\/services\/AppPreviewService'/,
    'AC13: main.ts が AppPreviewService を import していない');
  console.log('ok: AC13 main.ts stops the preview server on window close and before-quit');
}
