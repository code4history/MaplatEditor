// NOV26-IM-NETFETCH-CONTINGENCY-0483: main プロセスの外向き fetch を
// Chromium のネットワークスタック（net.fetch）へ載せたことの e2e。
//
// 背景: Node 24.22.1 で直った CVE-2026-111497（Brotli 展開の範囲外書き込み）は
// Electron 43.8.3 同梱の Node 24.22.0 に残っている。Node の fetch（undici）は
// `Content-Encoding: br` を Node 同梱 brotli で自動展開するため、外部 URL を読む
// 経路がこの CVE を通る。net.fetch は Chromium 側で展開するので通らない。
//
// ここでは実アプリ（実 Electron）を起動し、**製品の IPC 経路だけ**を使って確かめる:
//   1. br 圧縮された TileJSON が読める（remoteFetchGuard → net.fetch）
//   2. br 圧縮された POI GeoJSON が登録できる（PoiSourceService.fetchSnapshot）
//   3. br 圧縮されたタイル画像から TMS サムネイルが作れる（AppAssetService.readTile）
//   4. 既存の防御が今までどおり効く: scheme 制限・大きさの上限・http-status
//   5. 宛先の拒否は **今日も存在しない**（内部宛ては到達を試みる）。挙動を固定して
//      可視化するのが目的で、防御を新設したわけではない
//      （electron/services/remoteFetchGuard.ts 冒頭のセキュリティ境界を参照）
//   6. 取得が本当に Chromium 側で行われている指紋: 閉じたポートは undici の
//      ECONNREFUSED ではなく Chromium の ERR_UNSAFE_PORT になる
//
// NOV26-IM-NETFETCH-CONTINGENCY-0484: 0483 の net.fetch は**既定の session** で動くため、
// http の応答が `302 Location: app://bundle/__local/...` を返すと、リダイレクトに追随した先で
// 既定の session の `app://` handler が保存フォルダのファイルを読み、中身が返っていた
// （scheme 制限は最初の URL にしか効いていなかった）。いまは外部取得専用の session
// （`maplat-remote-fetch`）で取得し、http/https 以外（リダイレクト先を含む）を拒否する。
// ここでは実 Electron で次を確かめる:
//   (a) http → 302 → app:// の保存フォルダのファイルは読めない（TileJSON・POI・タイルの3経路）
//   (b) http → 302 → file:// も拒否される
//   (c) http → 302 → 別の http は従来どおり追随する
//   (d) 10 秒の上限が効き、接続が閉じる
//   (e) content-length の無い chunked の大きな応答は too-large で打ち切る
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import zlib from 'node:zlib';
import { quitElectronApplication } from './helpers/electronLifecycle';

const projectRoot = path.resolve(import.meta.dirname, '../..');

const TILEJSON_NAME = 'br tiles';
const POI_SLUG = 'netfetch-br-poi';
const TMS_MAP_ID = 'netfetch-br-map';
const COVERAGE: [number, number][] = [
  [135.75, 35.0],
  [135.76, 35.0],
  [135.76, 35.01],
  [135.75, 35.01],
];

type ServerHandle = { server: Server; base: string };

/** br 圧縮して返す応答（Content-Length は圧縮後の長さ＝Node の http もそう記録する） */
function sendBrotli(res: ServerResponse, body: Buffer, type: string): void {
  const compressed = zlib.brotliCompressSync(body);
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Encoding': 'br',
    'Content-Length': String(compressed.length),
  });
  res.end(compressed);
}

test.describe.configure({ mode: 'serial' });

let app: ElectronApplication | null = null;
let page: Page | null = null;
let handle: ServerHandle | null = null;
let e2eRoot = '';
let saveFolder = '';
// ローカルサーバの base URL（listen 後に確定する。ハンドラは必ずその後で走る）
let base = '';
// 0484: 保存フォルダに置いた「漏れたら困るファイル」の app:// / file:// URL。
// 起動後に saveFolder が確定してから埋まる（ハンドラはテスト開始後にしか走らない）。
let secretTileJsonAppUrl = '';
let secretPoiAppUrl = '';
let secretTileAppUrl = '';
let secretFileUrl = '';
// (d) タイムアウトで接続が閉じたことをサーバ側で観測する
let slowRequestClosed = false;
// (a) readTile のテストが「取得を試みたうえで拒否された」ことを確かめるための要求数
let leakTileRequestCount = 0;

test.beforeAll(async () => {
  const tilePng = await readFile(path.join(projectRoot, 'tests/e2e/fixtures/fake-osm-tile.png'));

  handle = await new Promise<ServerHandle>((resolve) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      // タイル（br 圧縮した 256x256 PNG）: AppAssetService.readTile の経路
      if (/^\/tiles\/\d+\/\d+\/\d+\.png$/.test(url.pathname)) {
        sendBrotli(res, tilePng, 'image/png');
        return;
      }
      // (a) タイル取得のリダイレクト先も app:// にする（テンプレートの {z}/{x}/{y} を保つ）
      if (/^\/leak-app-tile\/\d+\/\d+\/\d+\.png$/.test(url.pathname)) {
        leakTileRequestCount += 1;
        res.writeHead(302, { Location: secretTileAppUrl });
        res.end();
        return;
      }
      switch (url.pathname) {
        case '/tiles.json': {
          // tiles[0] は自分自身を指す（サムネイル生成と同じサーバを使う）
          const body = {
            tiles: [`${base}/tiles/{z}/{x}/{y}.png`],
            minzoom: 0,
            maxzoom: 18,
            name: TILEJSON_NAME,
            attribution: 'br attribution',
            bounds: [135.75, 35.0, 135.76, 35.01],
          };
          sendBrotli(res, Buffer.from(JSON.stringify(body), 'utf8'), 'application/json');
          return;
        }
        case '/poi.geojson': {
          const body = {
            type: 'FeatureCollection',
            lang: 'ja',
            features: [
              {
                type: 'Feature',
                properties: { name: 'br poi' },
                geometry: { type: 'Point', coordinates: [135.755, 35.005] },
              },
            ],
          };
          sendBrotli(res, Buffer.from(JSON.stringify(body), 'utf8'), 'application/geo+json');
          return;
        }
        case '/big.json': {
          // content-length 先読みで弾かれることの確認用（本文は読まれない）
          res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': '60000000' });
          res.end('{}');
          return;
        }
        case '/redirect-ok': {
          res.writeHead(302, { Location: `${base}/tiles.json` });
          res.end();
          return;
        }
        case '/redirect-internal': {
          // 内部（ループバック）宛てへのリダイレクト: 今日は追随を試みる
          res.writeHead(302, { Location: 'http://127.0.0.1:1/' });
          res.end();
          return;
        }
        // ---- 0484: 独自スキーム・file: へのリダイレクト（保存フォルダの中身を返させない） ----
        case '/leak-app-tilejson': {
          res.writeHead(302, { Location: secretTileJsonAppUrl });
          res.end();
          return;
        }
        case '/leak-app-poi': {
          res.writeHead(302, { Location: secretPoiAppUrl });
          res.end();
          return;
        }
        case '/leak-file-tilejson': {
          res.writeHead(302, { Location: secretFileUrl });
          res.end();
          return;
        }
        case '/slow': {
          // (d) 10 秒の上限で打ち切られることを確かめる（応答は 30 秒後）
          req.on('close', () => {
            slowRequestClosed = true;
          });
          const late = setTimeout(() => {
            if (res.destroyed || res.writableEnded) return;
            try {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ tiles: [`${base}/tiles/{z}/{x}/{y}.png`] }));
            } catch {
              /* 打ち切られた後の書き込みは失敗してよい */
            }
          }, 30_000);
          // テスト終了後にタイマーがイベントループを引き留めない
          late.unref?.();
          return;
        }
        case '/redirect-chain': {
          // (c) 2 ホップの http → http リダイレクト（1 回だけではないこと）
          res.writeHead(302, { Location: `${base}/redirect-ok` });
          res.end();
          return;
        }
        case '/huge-chunked': {
          // (e) content-length の無い chunked。本文を読みながら too-large で打ち切る
          res.writeHead(200, { 'Content-Type': 'application/json' });
          let stopped = false;
          res.on('error', () => {
            /* 打ち切られた後の書き込みは失敗してよい */
          });
          res.on('close', () => {
            stopped = true;
          });
          const chunk = Buffer.alloc(256 * 1024, 0x20);
          let sent = 0;
          const pump = (): void => {
            if (stopped) return;
            while (sent < 60 * 1024 * 1024) {
              sent += chunk.length;
              if (!res.write(chunk)) {
                res.once('drain', pump);
                return;
              }
            }
            res.end();
          };
          pump();
          return;
        }
        case '/status-500': {
          res.writeHead(500, 'Internal Server Error');
          res.end('boom');
          return;
        }
        default: {
          res.writeHead(404);
          res.end('no');
          return;
        }
      }
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      base = `http://127.0.0.1:${port}`;
      resolve({ server, base });
    });
  });

  e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-netfetch-contingency-'));
  app = await electron.launch({
    args: [projectRoot, `--user-data-dir=${e2eRoot}`],
    cwd: projectRoot,
    env: { ...process.env, VITE_DEV_SERVER_URL: '', MAPLAT_E2E_ROOT: e2eRoot },
  });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');

  // 0484: 保存フォルダに「漏れたら困るファイル」を置き、app:// の URL を組む。
  // app:// の handler は既定の session にしか無い（外部取得用 session では解決できない）。
  saveFolder = await page.evaluate(() => window.settings.get('saveFolder'));
  if (!path.resolve(saveFolder).startsWith(path.resolve(e2eRoot) + path.sep)) {
    throw new Error(`E2E storage isolation failed: ${saveFolder} is outside ${e2eRoot}`);
  }
  await mkdir(saveFolder, { recursive: true });
  await writeFile(
    path.join(saveFolder, 'secret-tile.json'),
    JSON.stringify({ tiles: [`${base}/tiles/{z}/{x}/{y}.png`], name: 'SECRET-TILEJSON', attribution: 'secret' }),
    'utf8',
  );
  await writeFile(
    path.join(saveFolder, 'secret-poi.geojson'),
    JSON.stringify({
      type: 'FeatureCollection',
      lang: 'ja',
      features: [
        {
          type: 'Feature',
          properties: { name: 'SECRET-POI' },
          geometry: { type: 'Point', coordinates: [135.755, 35.005] },
        },
      ],
    }),
    'utf8',
  );
  await writeFile(path.join(saveFolder, 'secret-tile.png'), tilePng);
  // localFileUrl と同じ形（区切りごとに encode し、ネイティブ絶対パスをそのまま後ろへ付ける）
  const appUrlOf = (absPath: string): string =>
    `app://bundle/__local${absPath.split('/').map(encodeURIComponent).join('/')}`;
  secretTileJsonAppUrl = appUrlOf(path.join(saveFolder, 'secret-tile.json'));
  secretPoiAppUrl = appUrlOf(path.join(saveFolder, 'secret-poi.geojson'));
  secretTileAppUrl = appUrlOf(path.join(saveFolder, 'secret-tile.png'));
  secretFileUrl = pathToFileURL(path.join(saveFolder, 'secret-tile.json')).toString();
});

test.afterAll(async () => {
  try {
    if (app) await quitElectronApplication(app);
  } finally {
    app = null;
    page = null;
    if (handle) {
      // 遅延応答・chunked の接続が残っていても close が待ち続けないよう先に切る
      handle.server.closeAllConnections?.();
      await new Promise<void>((resolve) => handle!.server.close(() => resolve()));
      handle = null;
    }
  }
});

function requirePage(): Page {
  if (!page) throw new Error('page is not available');
  return page;
}

test('br 圧縮された TileJSON が製品の IPC 経路で読める（a）', async () => {
  test.setTimeout(120_000);
  const result = await requirePage().evaluate(
    async (url) => await (window as any).baseMaps.importTileJson(url),
    `${base}/tiles.json`,
  );
  expect(result.ok, JSON.stringify(result)).toBe(true);
  expect(result.fields.title).toBe(TILEJSON_NAME);
  expect(result.fields.attr).toBe('br attribution');
  expect(result.fields.url).toBe(`${base}/tiles/{z}/{x}/{y}.png`);
  expect(result.fields.minZoom).toBe(0);
  expect(result.fields.maxZoom).toBe(18);
});

test('リダイレクトは従来どおり追随され、追随先の br 応答も読める', async () => {
  test.setTimeout(120_000);
  const result = await requirePage().evaluate(
    async (url) => await (window as any).baseMaps.importTileJson(url),
    `${base}/redirect-ok`,
  );
  expect(result.ok, JSON.stringify(result)).toBe(true);
  expect(result.fields.title).toBe(TILEJSON_NAME);
});

test('br 圧縮された POI GeoJSON がリモート登録できる（同じ guardedFetch の第2経路）', async () => {
  test.setTimeout(120_000);
  const result = await requirePage().evaluate(
    async ({ url, slug }) =>
      await (window as any).poiSources.registerRemote({ slug, title: { ja: 'br poi' }, url }),
    { url: `${base}/poi.geojson`, slug: POI_SLUG },
  );
  expect(result.result, JSON.stringify(result)).toBe('Success');
});

test('br 圧縮されたタイルから TMS サムネイルが作れる（AppAssetService.readTile の経路）', async () => {
  test.setTimeout(180_000);
  const result = await requirePage().evaluate(
    async ({ mapID, template, coverage }) =>
      await (window as any).appAssets.generateTmsThumbnail(mapID, { url: template, minZoom: 0, maxZoom: 18 }, coverage),
    { mapID: TMS_MAP_ID, template: `${base}/tiles/{z}/{x}/{y}.png`, coverage: COVERAGE },
  );
  expect(result.err, JSON.stringify(result)).toBeUndefined();
  expect(typeof result.path).toBe('string');
  expect(result.path).toContain('netfetch-br-map');
});

test('scheme 制限は transport より前で維持される（net.fetch は file: を読めてしまう）', async () => {
  test.setTimeout(120_000);
  const result = await requirePage().evaluate(
    async () => await (window as any).baseMaps.importTileJson('file:///etc/passwd'),
  );
  expect(result.ok).toBe(false);
  expect(result.code).toBe('unsupported-scheme');
});

test('大きさの上限（content-length 先読み）は今までどおり効く（b）', async () => {
  test.setTimeout(120_000);
  const result = await requirePage().evaluate(
    async (url) => await (window as any).baseMaps.importTileJson(url),
    `${base}/big.json`,
  );
  expect(result.ok).toBe(false);
  expect(result.code).toBe('too-large');
});

test('HTTP エラー応答は http-status として扱われる', async () => {
  test.setTimeout(120_000);
  const result = await requirePage().evaluate(
    async (url) => await (window as any).baseMaps.importTileJson(url),
    `${base}/status-500`,
  );
  expect(result.ok).toBe(false);
  expect(result.code).toBe('http-status');
  expect(String(result.message)).toContain('500');
});

test('取得は Chromium 側で行われている（閉じたポートは ERR_UNSAFE_PORT になる）', async () => {
  test.setTimeout(120_000);
  const result = await requirePage().evaluate(
    async () => await (window as any).baseMaps.importTileJson('http://127.0.0.1:1/'),
  );
  expect(result.ok).toBe(false);
  expect(result.code).toBe('network');
  // undici なら ECONNREFUSED。この文言は Chromium のネットワークスタックを通った証拠
  expect(String(result.message)).toContain('ERR_UNSAFE_PORT');
});

test('内部（ループバック）宛てのリダイレクトは拒否されない＝今日の挙動の固定（b）', async () => {
  test.setTimeout(120_000);
  const result = await requirePage().evaluate(
    async (url) => await (window as any).baseMaps.importTileJson(url),
    `${base}/redirect-internal`,
  );
  // 現状の guardedFetch は宛先を検査しない ∴ リダイレクト先まで到達を試み、
  // その先の接続が（Chromium の unsafe port 制限で）失敗する。
  // 「内部宛てだから拒否された」ではないことを code と文言の両方で固定する。
  expect(result.ok).toBe(false);
  expect(result.code).toBe('network');
  expect(String(result.message)).toContain('ERR_UNSAFE_PORT');
});

// ---- NOV26-IM-NETFETCH-CONTINGENCY-0484: リダイレクト先の scheme 制限 ----
// 外部取得は専用 session（maplat-remote-fetch）で行い、http/https 以外への要求
// （リダイレクト先を含む）は webRequest で拒否する。既定の session の app:// handler には
// 届かない。ここでは実 Electron で「保存フォルダの中身が返らない」ことを確かめる。

test('(a) http → 302 → app:// の保存フォルダのファイルは TileJSON として読めない', async () => {
  test.setTimeout(120_000);
  const result = await requirePage().evaluate(
    async (url) => await (window as any).baseMaps.importTileJson(url),
    `${base}/leak-app-tilejson`,
  );
  expect(result.ok, JSON.stringify(result)).toBe(false);
  expect(result.code, JSON.stringify(result)).toBe('unsupported-scheme');
  // 中身が返っていないこと（漏洩の直接証拠）
  expect(JSON.stringify(result)).not.toContain('SECRET-TILEJSON');
});

test('(a) http → 302 → app:// は POI の registerRemote でも拒否される', async () => {
  test.setTimeout(120_000);
  const result = await requirePage().evaluate(
    async ({ url, slug }) =>
      await (window as any).poiSources.registerRemote({ slug, title: { ja: 'secret' }, url }),
    { url: `${base}/leak-app-poi`, slug: `${POI_SLUG}-redirect` },
  );
  expect(result.result, JSON.stringify(result)).not.toBe('Success');
  expect(result.issues?.[0]?.code, JSON.stringify(result)).toBe('unsupported-scheme');
  expect(JSON.stringify(result)).not.toContain('SECRET-POI');
});

test('(a) http → 302 → app:// はタイルの readTile でも拒否される（保存フォルダの画像は読めない）', async () => {
  test.setTimeout(180_000);
  const result = await requirePage().evaluate(
    async ({ mapID, template, coverage }) =>
      await (window as any).appAssets.generateTmsThumbnail(mapID, { url: template, minZoom: 0, maxZoom: 18 }, coverage),
    { mapID: `${TMS_MAP_ID}-redirect`, template: `${base}/leak-app-tile/{z}/{x}/{y}.png`, coverage: COVERAGE },
  );
  // 取得そのものは試みられている（テンプレート検証で早期に落ちたわけではない）
  expect(leakTileRequestCount).toBeGreaterThan(0);
  // 漏洩するとタイルが 1 枚読めてサムネイルが作られる（err 無し）。拒否されれば全滅して NoTiles
  expect(result.err, JSON.stringify(result)).toBe('NoTiles');
  expect(result.path).toBeUndefined();
});

test('(b) http → 302 → file:// も拒否される', async () => {
  test.setTimeout(120_000);
  const result = await requirePage().evaluate(
    async (url) => await (window as any).baseMaps.importTileJson(url),
    `${base}/leak-file-tilejson`,
  );
  expect(result.ok, JSON.stringify(result)).toBe(false);
  expect(result.code, JSON.stringify(result)).toBe('unsupported-scheme');
  expect(JSON.stringify(result)).not.toContain('SECRET-TILEJSON');
});

test('(c) http → 302 → http のリダイレクトは 2 ホップでも従来どおり追随する', async () => {
  test.setTimeout(120_000);
  const result = await requirePage().evaluate(
    async (url) => await (window as any).baseMaps.importTileJson(url),
    `${base}/redirect-chain`,
  );
  expect(result.ok, JSON.stringify(result)).toBe(true);
  expect(result.fields.title).toBe(TILEJSON_NAME);
});

test('(d) 10 秒のタイムアウトが効き、接続が閉じる', async () => {
  test.setTimeout(120_000);
  const startedAt = Date.now();
  const result = await requirePage().evaluate(
    async (url) => await (window as any).baseMaps.importTileJson(url),
    `${base}/slow`,
  );
  const elapsed = Date.now() - startedAt;
  expect(result.ok, JSON.stringify(result)).toBe(false);
  expect(result.code).toBe('network');
  expect(String(result.message)).toMatch(/timed out/i);
  // 10 秒の上限が効いている（30 秒の応答を待っていない）
  expect(elapsed).toBeLessThan(20_000);
  // 打ち切りは接続の切断としてサーバ側にも届く
  await expect.poll(() => slowRequestClosed, { timeout: 10_000 }).toBe(true);
});

test('(e) content-length の無い chunked の大きな応答は too-large で打ち切られる', async () => {
  test.setTimeout(120_000);
  const result = await requirePage().evaluate(
    async (url) => await (window as any).baseMaps.importTileJson(url),
    `${base}/huge-chunked`,
  );
  expect(result.ok, JSON.stringify(result)).toBe(false);
  expect(result.code).toBe('too-large');
});
