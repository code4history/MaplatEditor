// 書き出したアプリ（Export）とプレビュー（Preview）で、MapLibre GL JS・Mapbox GL JS が実際に読み込まれ、
// MapLibre のベースマップが描かれることを確かめる E2E。
//
// T1 決定的な style（Preview）: リポジトリの fixture（line-layer-opacity を含む）を、テストの中のサーバで配る
// T2 決定的な style（Export）: 同じアプリを書き出し、zip を展開してテストの中のサーバで配り、BrowserWindow で開く
// T3 Mapbox の版（Preview）
// T4 MapLibre GL JS の読み込みが失敗しても、アプリは起動する（Preview）
// T5 プレビューの配信に CSP が無く、CSP の違反がコンソールに出ない（Preview）
// T6 外部の切絵図の style（Export・Preview）。外部に届かないときは注記つきで skip する
//
// WebGL 2 の段（WebGL 2 を要するのは T1・T2・T6）:
//   第 1 段: 通常の起動で WebGL 2 が使える
//   第 2 段: 通常の起動で使えないとき、テストだけの起動引数（swiftshader）で起動し直して使える
//   第 3 段: それでも使えないとき、CI の中に限り T1・T2・T6 を注記つきで skip する。手元では失敗させる
// 段を進めるのは「確かめが正常に終わり、getContext('webgl2') が厳密に null」のときだけ。
// 確かめの例外・時間切れ・想定外の値は、その場で失敗させる。
// 確かめはプレビューを開く前の素の BrowserWindow（about:blank）で行い、プレビューの不具合と切り離す。
import { _electron as electron, expect, test, type ElectronApplication, type Frame, type Page } from '@playwright/test';
import AdmZip from 'adm-zip';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';
import { baseMapMasterDoc, seedBaseMap } from './helpers/baseMapSeed';
import { seedE2EProviderKeys } from './helpers/providerKeys';
import { PROVIDER_GL_CDN } from '../../electron/services/providerGlCdn';

const projectRoot = path.resolve(import.meta.dirname, '../..');
// 他の spec（45782・45784 等）と衝突しない固定ポート
const PREVIEW_PORT = 45791;
const FIXTURE_STYLE = path.join(import.meta.dirname, 'fixtures/provider-gl/line-layer-opacity-style.json');
const KIRIEZU_STYLE = 'https://kanahiro.github.io/maplibre-style-server/styles/kiriezu.json';
const OPENFREEMAP = 'https://tiles.openfreemap.org/planet';
const SWIFTSHADER_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const STYLE_ERROR = /layers\[\d+\]\.(paint|layout)\.|unknown property/;
const LOAD_FAILED = 'MapLibre GL JS could not be loaded';
// fixture の色（line-layer-opacity-style.json）
const BG_RGB: [number, number, number] = [0x2a, 0x9d, 0x8f];
const FILL_RGB: [number, number, number] = [0xe7, 0x6f, 0x51];
// 6×6 の標本で数えた色の種類の閾値。5.6.2（描画されない）と 6 系（描画される）の実測の間に置く
const DISTINCT_MIN = 4;
// 20×20 の標本で、fixture の背景色・塗りの色に近い点の数の下限
const COLOR_HITS_MIN = 10;

type Stage = { n: 1 | 2 | 3; args: string[] };
type ConsoleLine = { type: string; text: string };

let app: ElectronApplication;
let page: Page;
let stage: Stage;
let e2eRoot: string;
const consoleLines: ConsoleLine[] = [];
let styleServer: { origin: string; close: () => Promise<void> };
let mlApp: { uid: string; slug: string };

const shotDir = process.env.PROVIDER_GL_SHOT_DIR || '';

function stageNote(): string {
  if (stage.n === 3) return '[provider-gl stage3] WebGL 2 が使えない（通常の起動・swiftshader の起動の両方で getContext("webgl2") が null）';
  if (stage.n === 2) return `[provider-gl stage2] 起動引数 ${stage.args.join(' ')} で WebGL 2 が使える`;
  return '[provider-gl stage1] 通常の起動で WebGL 2 が使える';
}

function annotateStage(): void {
  test.info().annotations.push({ type: 'webgl-stage', description: stageNote() });
}

function skipWithoutWebGl(): void {
  annotateStage();
  test.skip(stage.n === 3, stageNote());
}

async function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([p, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function launch(root: string, extraArgs: string[]): Promise<{ app: ElectronApplication; page: Page }> {
  const a = await electron.launch({
    args: [...extraArgs, projectRoot, `--user-data-dir=${root}`],
    cwd: projectRoot,
    env: { ...process.env, VITE_DEV_SERVER_URL: '', MAPLAT_E2E_ROOT: root },
  });
  const p = await a.firstWindow();
  await p.waitForLoadState('domcontentloaded');
  return { app: a, page: p };
}

/** WebGL 2 が使えれば true、getContext('webgl2') が厳密に null なら false。それ以外はすべて例外 */
async function probeWebGl2(a: ElectronApplication): Promise<boolean> {
  const result = await withTimeout(
    a.evaluate(async ({ BrowserWindow }) => {
      const win = new BrowserWindow({ show: false, width: 64, height: 64 });
      try {
        await win.loadURL('about:blank');
        return await win.webContents.executeJavaScript(
          "(() => { const c = document.createElement('canvas').getContext('webgl2'); return c === null ? null : (typeof c === 'object' ? 'context' : String(c)); })()",
        );
      } finally {
        win.destroy();
      }
    }),
    30_000,
    'WebGL 2 の確かめが 30 秒で終わらない',
  );
  if (result === 'context') return true;
  if (result === null) return false;
  throw new Error(`WebGL 2 の確かめが想定外の値を返した: ${JSON.stringify(result)}`);
}

function serveStatic(root: string, opts: { cors?: boolean } = {}): Promise<{ origin: string; close: () => Promise<void> }> {
  const types: Record<string, string> = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png',
    '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  };
  const server = http.createServer(async (req, res) => {
    if (opts.cors) res.setHeader('access-control-allow-origin', '*');
    const urlPath = decodeURIComponent(new URL(req.url || '/', 'http://x').pathname);
    const rel = urlPath.endsWith('/') ? `${urlPath}index.html` : urlPath;
    const file = path.resolve(root, `.${rel}`);
    if (file !== root && !file.startsWith(root + path.sep)) { res.statusCode = 403; res.end(); return; }
    try {
      const body = await readFile(file);
      res.setHeader('content-type', types[path.extname(file)] || 'application/octet-stream');
      res.end(body);
    } catch {
      res.statusCode = 404;
      res.end('not found');
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ origin: `http://127.0.0.1:${port}`, close: () => new Promise<void>((r) => server.close(() => r())) });
    });
  });
}

async function status(url: string, timeoutMs: number): Promise<string> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return r.status === 200 ? 'ok' : `HTTP ${r.status}`;
  } catch (e) {
    return String((e as Error)?.message || e);
  }
}

async function seedMapLibreApp(slug: string, style: string): Promise<{ uid: string; slug: string }> {
  const baseMapUid = await seedBaseMap(page, `${slug}-base`, baseMapMasterDoc({ kind: 'maplibre', maptype: 'maplibre', style, url: '' }));
  return seedApp(slug, [{ sourceType: 'tms', mapUid: `${slug}-base`, baseMapUid, role: 'base', startFrom: true, overrides: {} }]);
}

async function seedApp(slug: string, sources: unknown[]): Promise<{ uid: string; slug: string }> {
  const uid = await page.evaluate(async ({ slug: s, sources: src, previewPort }) => {
    const id = crypto.randomUUID();
    const saved = await (window as any).appedit.save({ uid: id, slug: s, create: true, document: {
      appID: s, appName: { ja: s }, title: { ja: s }, description: {}, keywords: '', siteUrl: '', lang: 'ja',
      sources: src, pois: [],
      appSettings: { homeLng: 139.767, homeLat: 35.681, defaultZoom: 15 },
      httpSettings: { previewPort }, manifestSettings: {},
    } });
    if (!saved || saved.result !== 'Success') throw new Error(`app save failed: ${JSON.stringify(saved)}`);
    return id;
  }, { slug, sources, previewPort: PREVIEW_PORT });
  return { uid, slug };
}

/** アプリの編集画面のプレビューのタブを開き、iframe の Frame を返す */
async function openPreview(uid: string): Promise<{ frame: Frame; src: string }> {
  await page.evaluate(() => { location.hash = '/applist'; });
  await expect(page.locator('iframe.preview-map')).toHaveCount(0, { timeout: 30_000 });
  await page.evaluate((u) => { location.hash = `/appedit?uid=${u}`; }, uid);
  await page.locator('[role="tab"]').filter({ hasText: /プレビュー/ }).click();
  await expect(page.locator('iframe.preview-map')).toBeVisible({ timeout: 60_000 });
  const src = (await page.locator('iframe.preview-map').getAttribute('src'))!;
  await expect.poll(() => page.frames().some((f) => f.url() === src), { timeout: 30_000 }).toBe(true);
  return { frame: page.frames().find((f) => f.url() === src)!, src };
}

type MapState = { ready: boolean; map?: boolean; styleLoaded?: boolean; loaded?: boolean; layers?: number; error?: string };

/** プレビューの viewer が起動し、MapLibre の Map の style とタイルが読み終わるまで待つ（待ちきれなくても最後の状態を返す） */
async function waitPreviewMap(frame: Frame, timeoutMs: number): Promise<MapState> {
  const deadline = Date.now() + timeoutMs;
  let last: MapState = { ready: false };
  while (Date.now() < deadline) {
    last = await frame.evaluate(() => {
      const p = (window as any).__maplatPreview;
      if (!p) return { ready: false };
      const m = p.core?.maplibreMap;
      if (!m) return { ready: true, map: false };
      let layers = -1;
      try { layers = m.getStyle()?.layers?.length ?? -1; } catch { layers = -1; }
      return { ready: true, map: true, styleLoaded: Boolean(m.isStyleLoaded()), loaded: Boolean(m.loaded()), layers };
    }).catch((e) => ({ ready: false, error: String(e) }));
    if (last.styleLoaded && last.loaded) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  return last;
}

type Sample = { distinct6: number; bgHits: number; fillHits: number; png: Buffer };

/** 窓の矩形を capturePage で撮り、6×6 の標本の色の種類と、20×20 の標本の fixture の色に近い点の数を数える */
async function sampleWindow(target: Page, rect: { x: number; y: number; width: number; height: number }): Promise<Sample> {
  const bw = await app.browserWindow(target);
  const b64 = await bw.evaluate(async (w, r) => (await w.webContents.capturePage(r)).toPNG().toString('base64'), {
    x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height),
  });
  const png = Buffer.from(b64, 'base64');
  const { Jimp } = await import('jimp');
  const img = await Jimp.read(png);
  const { width, height, data } = img.bitmap;
  const px = (x: number, y: number) => {
    const i = (Math.min(height - 1, y) * width + Math.min(width - 1, x)) * 4;
    return [data[i], data[i + 1], data[i + 2]];
  };
  const seen = new Set<string>();
  for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) {
    seen.add(px(Math.floor((width / 6) * i + width / 12), Math.floor((height / 6) * j + height / 12)).join(','));
  }
  const near = (c: number[], t: number[]) => c.every((v, k) => Math.abs(v - t[k]) <= 12);
  let bgHits = 0;
  let fillHits = 0;
  for (let i = 0; i < 20; i++) for (let j = 0; j < 20; j++) {
    const c = px(Math.floor((width / 20) * i + width / 40), Math.floor((height / 20) * j + height / 40));
    if (near(c, BG_RGB)) bgHits++;
    if (near(c, FILL_RGB)) fillHits++;
  }
  return { distinct6: seen.size, bgHits, fillHits, png };
}

async function saveShot(name: string, png: Buffer): Promise<void> {
  if (!shotDir) return;
  await mkdir(shotDir, { recursive: true });
  await writeFile(path.join(shotDir, `${name}.png`), png);
}

async function iframeRect(): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await page.locator('iframe.preview-map').boundingBox();
  if (!box) throw new Error('プレビューの iframe の矩形が取れない');
  return box;
}

/** アプリを書き出し、zip を展開して配り、BrowserWindow で開く */
async function openExport(uid: string, label: string): Promise<{ win: Page; lines: ConsoleLine[]; close: () => Promise<void> }> {
  const zipPath = path.join(e2eRoot, `${label}.zip`);
  await app.evaluate(async ({ dialog }, outZip) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: outZip })) as typeof dialog.showSaveDialog;
  }, zipPath);
  const result = await page.evaluate(async (u) => {
    const loaded = await (window as any).appedit.request(u);
    return await (window as any).appedit.export(loaded.document ?? loaded);
  }, uid);
  expect(result?.result, `export failed: ${JSON.stringify(result)}`).toBe('Success');
  // 書き出しの進捗のモーダル（ESC・外のクリックでは閉じない）を OK で閉じる。残すと後のテストの操作を遮る
  const progressModal = page.locator('.modal.d-block');
  await progressModal.first().waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {});
  if (await progressModal.count()) {
    const ok = progressModal.getByRole('button', { name: 'OK' });
    await expect(ok).toBeEnabled({ timeout: 30_000 });
    await ok.click();
    await expect(progressModal).toHaveCount(0, { timeout: 30_000 });
  }
  const dir = path.join(e2eRoot, `${label}-extract`);
  new AdmZip(zipPath).extractAllTo(dir, true);
  const server = await serveStatic(dir);
  const windowPromise = app.waitForEvent('window');
  await app.evaluate(({ BrowserWindow }) => {
    const w = new BrowserWindow({ width: 1000, height: 700, show: true });
    void w.loadURL('about:blank');
  });
  const win = await windowPromise;
  const lines: ConsoleLine[] = [];
  win.on('console', (m) => lines.push({ type: m.type(), text: m.text() }));
  await win.goto(`${server.origin}/`);
  return {
    win, lines,
    close: async () => { await win.close().catch(() => {}); await server.close(); },
  };
}

// 失敗したテストの後は worker が作り直され、beforeAll（起動・段の確かめ・fixture の投入）がもう一度走る
test.describe.configure({ timeout: 300_000 });

test.describe('MapLibre / Mapbox GL の注入と描画', () => {
  test.beforeAll(async () => {
    // 製品が実行時に使う CDN。届かなければ何も確かめられないので失敗にする（skip しない）
    for (const url of [PROVIDER_GL_CDN.maplibre.css, PROVIDER_GL_CDN.mapbox.css]) {
      const s = await status(url, 15_000);
      if (s !== 'ok') throw new Error(`CDN に届かない: ${url}: ${s}`);
    }

    e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-provider-gl-'));
    ({ app, page } = await launch(e2eRoot, []));
    if (await probeWebGl2(app)) {
      stage = { n: 1, args: [] };
    } else {
      await quitElectronApplication(app);
      ({ app, page } = await launch(e2eRoot, SWIFTSHADER_ARGS));
      if (await probeWebGl2(app)) {
        stage = { n: 2, args: SWIFTSHADER_ARGS };
      } else if (process.env.CI) {
        stage = { n: 3, args: SWIFTSHADER_ARGS };
      } else {
        throw new Error('手元で WebGL 2 が使えない（通常の起動・swiftshader の起動の両方で getContext("webgl2") が null）。描画の確かめができないので止める');
      }
    }
    console.log(stageNote());

    page.on('console', (m) => consoleLines.push({ type: m.type(), text: m.text() }));
    await seedE2EProviderKeys(page);
    styleServer = await serveStatic(path.dirname(FIXTURE_STYLE), { cors: true });
    // ベースマップの style は IPC（baseMaps.saveUser）で入れる。画面の検査（isAllowedStyleUrl）は maplibre に
    // https しか許さないので、テストの中のサーバ（http://127.0.0.1）の style は画面からは入れられない。
    // main の側はこの検査をしない
    mlApp = await seedMapLibreApp('glr-fixture', `${styleServer.origin}/${path.basename(FIXTURE_STYLE)}`);
  });

  test.afterAll(async () => {
    if (app) await quitElectronApplication(app);
    if (styleServer) await styleServer.close();
  });

  test('T3 Mapbox: プレビューで読み込まれる mapboxgl の版がピン留め版（3.33.0 以上）', async () => {
    annotateStage();
    const baseMapUid = await seedBaseMap(page, 'glr-mapbox-base', baseMapMasterDoc({
      kind: 'mapbox', maptype: 'mapbox', style: 'mapbox://styles/mapbox/streets-v12', url: '',
    }));
    const a = await seedApp('glr-mapbox', [{ sourceType: 'tms', mapUid: 'glr-mapbox-base', baseMapUid, role: 'base', startFrom: true, overrides: {} }]);
    const { frame } = await openPreview(a.uid);
    await expect.poll(() => frame.evaluate(() => (window as any).mapboxgl?.version ?? null), { timeout: 60_000 }).not.toBeNull();
    const version: string = await frame.evaluate(() => (window as any).mapboxgl.version);
    expect(version).toBe(PROVIDER_GL_CDN.mapbox.version);
    const [major, minor] = version.split('.').map(Number);
    expect(major, `mapboxgl.version=${version}`).toBe(3);
    expect(minor, `mapboxgl.version=${version}`).toBeGreaterThanOrEqual(33);
  });

  test('T4 MapLibre GL JS の読み込みが失敗しても、プレビューのアプリは起動する', async () => {
    annotateStage();
    const from = consoleLines.length;
    await app.evaluate(({ session }) => {
      session.defaultSession.webRequest.onBeforeRequest({ urls: ['https://cdn.jsdelivr.net/npm/maplibre-gl@*'] }, (_d, cb) => cb({ cancel: true }));
    });
    try {
      const { frame } = await openPreview(mlApp.uid);
      const started = await expect
        .poll(() => frame.evaluate(() => Boolean((window as any).__maplatPreview)).catch(() => false), { timeout: 60_000 })
        .toBe(true)
        .then(() => true, () => false);
      const bodyText = await frame.evaluate(() => document.body?.innerText?.slice(0, 300) ?? '').catch((e) => String(e));
      const lines = consoleLines.slice(from);
      console.log(`T4: started=${started} loadFailedLogged=${lines.some((l) => l.text.includes(LOAD_FAILED))} body=${JSON.stringify(bodyText)}`);
      expect(lines.some((l) => l.text.includes(LOAD_FAILED)), 'コンソールに読み込みの失敗の行が無い').toBe(true);
      expect(started, `アプリが起動しない（window.__maplatPreview が無い）: ${bodyText}`).toBe(true);
    } finally {
      await app.evaluate(({ session }) => { session.defaultSession.webRequest.onBeforeRequest(null); });
    }
  });

  test('T5 プレビューの配信に CSP が無く、CSP の違反がコンソールに出ない', async () => {
    annotateStage();
    const from = consoleLines.length;
    const { src } = await openPreview(mlApp.uid);
    const res = await fetch(src);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-security-policy')).toBeNull();
    const html = await res.text();
    expect(html).not.toMatch(/http-equiv/i);
    await page.waitForTimeout(5_000);
    const csp = consoleLines.slice(from).filter((l) => l.text.includes('Content Security Policy'));
    expect(csp, JSON.stringify(csp)).toEqual([]);
  });

  test('T1 決定的な style（Preview）: line-layer-opacity を含む style が検証エラーなしで描かれる', async () => {
    skipWithoutWebGl();
    const from = consoleLines.length;
    const { frame } = await openPreview(mlApp.uid);
    const state = await waitPreviewMap(frame, 60_000);
    await page.waitForTimeout(1_500);
    const sample = await sampleWindow(page, await iframeRect());
    await saveShot('T1-preview', sample.png);
    const styleErrors = consoleLines.slice(from).filter((l) => STYLE_ERROR.test(l.text));
    console.log(`T1: state=${JSON.stringify(state)} distinct6=${sample.distinct6} bgHits=${sample.bgHits} fillHits=${sample.fillHits} styleErrors=${JSON.stringify(styleErrors.map((l) => l.text.slice(0, 200)))}`);
    const fixtureLayers = JSON.parse(await readFile(FIXTURE_STYLE, 'utf8')).layers.length;
    expect(styleErrors, 'style の検証エラーがコンソールに出ている').toEqual([]);
    expect(state.ready, `__maplatPreview が無い: ${JSON.stringify(state)}`).toBe(true);
    expect(state.styleLoaded, `style が読み込まれていない: ${JSON.stringify(state)}`).toBe(true);
    expect(state.layers).toBe(fixtureLayers);
    expect(sample.bgHits, 'fixture の背景色が描かれていない').toBeGreaterThanOrEqual(COLOR_HITS_MIN);
    expect(sample.fillHits, 'fixture の塗りの色が描かれていない').toBeGreaterThanOrEqual(COLOR_HITS_MIN);
    expect(sample.distinct6).toBeGreaterThanOrEqual(DISTINCT_MIN);
  });

  test('T2 決定的な style（Export）: 書き出したアプリで同じ style が検証エラーなしで描かれる', async () => {
    skipWithoutWebGl();
    const ex = await openExport(mlApp.uid, 'glr-fixture-export');
    try {
      await expect(ex.win.locator('canvas.maplibregl-canvas')).toHaveCount(1, { timeout: 60_000 });
      let sample = await sampleWindow(ex.win, { x: 0, y: 0, width: 1000, height: 700 });
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline && (sample.bgHits < COLOR_HITS_MIN || sample.fillHits < COLOR_HITS_MIN)) {
        await ex.win.waitForTimeout(1_000);
        sample = await sampleWindow(ex.win, { x: 0, y: 0, width: 1000, height: 700 });
      }
      await saveShot('T2-export', sample.png);
      const styleErrors = ex.lines.filter((l) => STYLE_ERROR.test(l.text));
      console.log(`T2: distinct6=${sample.distinct6} bgHits=${sample.bgHits} fillHits=${sample.fillHits} styleErrors=${JSON.stringify(styleErrors.map((l) => l.text.slice(0, 200)))}`);
      expect(styleErrors, 'style の検証エラーがコンソールに出ている').toEqual([]);
      expect(sample.bgHits, 'fixture の背景色が描かれていない').toBeGreaterThanOrEqual(COLOR_HITS_MIN);
      expect(sample.fillHits, 'fixture の塗りの色が描かれていない').toBeGreaterThanOrEqual(COLOR_HITS_MIN);
      expect(sample.distinct6).toBeGreaterThanOrEqual(DISTINCT_MIN);
    } finally {
      await ex.close();
    }
  });

  test('T6 切絵図の style（外部）: 書き出しとプレビューの両方で検証エラーなしで描かれる', async () => {
    skipWithoutWebGl();
    const reach = await Promise.all([status(KIRIEZU_STYLE, 5_000), status(OPENFREEMAP, 5_000)]);
    test.skip(reach.some((s) => s !== 'ok'), `外部の style／タイルに届かない: style=${reach[0]} tiles=${reach[1]}`);
    const expectedLayers = (await (await fetch(KIRIEZU_STYLE)).json()).layers.length;
    const a = await seedMapLibreApp('glr-kiriezu', KIRIEZU_STYLE);

    const from = consoleLines.length;
    const { frame } = await openPreview(a.uid);
    const state = await waitPreviewMap(frame, 90_000);
    await page.waitForTimeout(2_000);
    const prev = await sampleWindow(page, await iframeRect());
    await saveShot('T6-preview', prev.png);
    const prevErrors = consoleLines.slice(from).filter((l) => STYLE_ERROR.test(l.text));
    console.log(`T6 preview: state=${JSON.stringify(state)} distinct6=${prev.distinct6} styleErrors=${JSON.stringify(prevErrors.map((l) => l.text.slice(0, 200)))}`);

    const ex = await openExport(a.uid, 'glr-kiriezu-export');
    let exp: Sample;
    try {
      await expect(ex.win.locator('canvas.maplibregl-canvas')).toHaveCount(1, { timeout: 60_000 });
      exp = await sampleWindow(ex.win, { x: 0, y: 0, width: 1000, height: 700 });
      const deadline = Date.now() + 45_000;
      while (Date.now() < deadline && exp.distinct6 < DISTINCT_MIN) {
        await ex.win.waitForTimeout(1_500);
        exp = await sampleWindow(ex.win, { x: 0, y: 0, width: 1000, height: 700 });
      }
      await saveShot('T6-export', exp.png);
      const expErrors = ex.lines.filter((l) => STYLE_ERROR.test(l.text));
      console.log(`T6 export: distinct6=${exp.distinct6} styleErrors=${JSON.stringify(expErrors.map((l) => l.text.slice(0, 200)))}`);
      expect(expErrors, '書き出し: style の検証エラーがコンソールに出ている').toEqual([]);
      expect(exp.distinct6, '書き出し: 切絵図が描かれていない').toBeGreaterThanOrEqual(DISTINCT_MIN);
    } finally {
      await ex.close();
    }
    expect(prevErrors, 'プレビュー: style の検証エラーがコンソールに出ている').toEqual([]);
    expect(state.styleLoaded, `プレビュー: style が読み込まれていない: ${JSON.stringify(state)}`).toBe(true);
    expect(state.layers).toBe(expectedLayers);
    expect(prev.distinct6, 'プレビュー: 切絵図が描かれていない').toBeGreaterThanOrEqual(DISTINCT_MIN);
  });
});
