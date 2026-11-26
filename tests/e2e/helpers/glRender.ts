// MapLibre / Mapbox GL の描画を確かめる E2E の共通の部品。
//
// provider-gl-render.spec.ts（6 系の注入と描画）と maplibre-version-select.spec.ts（版の選択と判定）が
// 同じ実装を使う（同一扱いの処理は共通実装へ寄せる）。
//
// WebGL 2 の段（WebGL 2 を要する確かめのため）:
//   第 1 段: 通常の起動で WebGL 2 が使える
//   第 2 段: 通常の起動で使えないとき、テストだけの起動引数（swiftshader）で起動し直して使える
//   第 3 段: それでも使えないとき、CI の中に限り WebGL 2 を要する確かめを注記つきで skip する。手元では失敗させる
// 段を進めるのは「確かめが正常に終わり、getContext('webgl2') が厳密に null」のときだけ。
// 確かめの例外・時間切れ・想定外の値は、その場で失敗させる。
// 確かめはプレビューを開く前の素の BrowserWindow（about:blank）で行い、プレビューの不具合と切り離す。
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { quitElectronApplication } from './electronLifecycle';
import { evalMain } from './evalMain';

const projectRoot = path.resolve(import.meta.dirname, '../../..');

export const SWIFTSHADER_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
export const FIXTURE_STYLE = path.resolve(import.meta.dirname, '../fixtures/provider-gl/line-layer-opacity-style.json');
export const OSM_BRIGHT_STYLE = path.resolve(import.meta.dirname, '../fixtures/provider-gl/osm-bright-style.json');
// MapLibre の style の検証の誤り（5.6.2 は line-layer-opacity を知らない）
export const STYLE_ERROR = /layers\[\d+\]\.(paint|layout)\.|unknown property/;
// fixture の色（line-layer-opacity-style.json）
export const BG_RGB: [number, number, number] = [0x2a, 0x9d, 0x8f];
export const FILL_RGB: [number, number, number] = [0xe7, 0x6f, 0x51];
// fixture の線（west-line。塗りの東の縁＝画面の中央の縦線）。line-layer-opacity 0.85 で下の色と混ざるので、
// 塗りの上と背景の上とで色が違う。不透明度が効いていなければ線の色そのもの（LINE_RGB）になり、どちらにも当たらない
export const LINE_RGB: [number, number, number] = [0x26, 0x46, 0x53];
export const LINE_LAYER_OPACITY = 0.85;
const blend = (over: number[], under: number[], a: number) => over.map((v, k) => Math.round(v * a + under[k] * (1 - a)));
export const LINE_ON_FILL_RGB = blend(LINE_RGB, FILL_RGB, LINE_LAYER_OPACITY);
export const LINE_ON_BG_RGB = blend(LINE_RGB, BG_RGB, LINE_LAYER_OPACITY);
// 6×6 の標本で数えた色の種類の閾値。5.6.2（描画されない）と 6 系（描画される）の実測の間に置く。
// 色の多い style（外部の切絵図など）に使う。fixture の style（3 色）には使わない: fixture の地図が 6×6 の
// 標本点に出す色は背景と塗りの 2 色だけ（線は標本点の列の間を通る）で、残りは viewer の操作部品が標本点に
// 乗るかどうかで決まる（@maplat/ui 1.2 では 4、1.3 では部品の配置が変わって 2〜3。地図の描画は同じ）。
// fixture は 3 層それぞれの色（bgHits・fillHits・lineOn*Hits）で確かめる
export const DISTINCT_MIN = 4;
// 20×20 の標本で、fixture の背景色・塗りの色に近い点の数の下限
export const COLOR_HITS_MIN = 10;
// 4 本の横の走査で、fixture の線の色（塗りの上・背景の上）に近い画素の数の下限（それぞれ）。
// 線の幅は 6px で、等倍の画面では 1 本の走査につき塗りの上に 3 画素・背景の上に 3 画素（実測 12・12）
export const LINE_HITS_MIN = 4;

export type Stage = { n: 1 | 2 | 3; args: string[] };

export function stageNote(stage: Stage): string {
  if (stage.n === 3) return '[provider-gl stage3] WebGL 2 が使えない（通常の起動・swiftshader の起動の両方で getContext("webgl2") が null）';
  if (stage.n === 2) return `[provider-gl stage2] 起動引数 ${stage.args.join(' ')} で WebGL 2 が使える`;
  return '[provider-gl stage1] 通常の起動で WebGL 2 が使える';
}

export async function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([p, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function launchGl(root: string, extraArgs: string[]): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [...extraArgs, projectRoot, `--user-data-dir=${root}`],
    cwd: projectRoot,
    env: { ...process.env, VITE_DEV_SERVER_URL: '', MAPLAT_E2E_ROOT: root },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  return { app, page };
}

/** WebGL 2 が使えれば true、getContext('webgl2') が厳密に null なら false。それ以外はすべて例外 */
export async function probeWebGl2(app: ElectronApplication): Promise<boolean> {
  const result = await withTimeout(
    evalMain(app, async ({ BrowserWindow }) => {
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

/** 3 段の規則で Electron を起動する。手元で第 3 段に落ちるときは例外 */
export async function launchWithWebGlStage(root: string): Promise<{ app: ElectronApplication; page: Page; stage: Stage }> {
  let launched = await launchGl(root, []);
  if (await probeWebGl2(launched.app)) return { ...launched, stage: { n: 1, args: [] } };
  await quitElectronApplication(launched.app);
  launched = await launchGl(root, SWIFTSHADER_ARGS);
  if (await probeWebGl2(launched.app)) return { ...launched, stage: { n: 2, args: SWIFTSHADER_ARGS } };
  if (process.env.CI) return { ...launched, stage: { n: 3, args: SWIFTSHADER_ARGS } };
  await quitElectronApplication(launched.app);
  throw new Error('手元で WebGL 2 が使えない（通常の起動・swiftshader の起動の両方で getContext("webgl2") が null）。描画の確かめができないので止める');
}

/**
 * root を静的に配る。opts.requests を渡したときだけ、応答ごとに { path, status } を 1 件積む
 * （書き出したアプリが service-worker.js やタイルを取りに来たかを試験が見るため。#106）
 */
export function serveStatic(root: string, opts: { cors?: boolean; requests?: { path: string; status: number }[] } = {}): Promise<{ origin: string; close: () => Promise<void> }> {
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
    if (opts.requests) res.on('finish', () => opts.requests!.push({ path: urlPath, status: res.statusCode }));
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

/** URL が HTTP 200 なら 'ok'、それ以外は理由の文字列 */
export async function httpStatus(url: string, timeoutMs: number): Promise<string> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return r.status === 200 ? 'ok' : `HTTP ${r.status}`;
  } catch (e) {
    return String((e as Error)?.message || e);
  }
}

export type Sample = { distinct6: number; bgHits: number; fillHits: number; lineOnFillHits: number; lineOnBgHits: number; png: Buffer };

/**
 * 窓の矩形を capturePage で撮り、6×6 の標本の色の種類と、20×20 の標本の fixture の色に近い点の数と、
 * 中央の縦線を横切る 4 本の走査の fixture の線の色に近い画素の数を数える
 */
export async function sampleWindow(
  app: ElectronApplication,
  target: Page,
  rect: { x: number; y: number; width: number; height: number },
): Promise<Sample> {
  const bw = await app.browserWindow(target);
  // BrowserWindow の JSHandle も main の中のオブジェクトなので、handle の evaluate ではなく evalMain に引数で渡す
  const b64 = await evalMain<string>(app, async (_electron, { w, r }) => (await w.webContents.capturePage(r)).toPNG().toString('base64'), {
    w: bw,
    r: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
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
  // fixture の線は画面の中央を縦に通る。中央の 1/3 の幅を、上下 4 本の高さで全画素なめる
  // （高さの中央は viewer の中心の印が線に重なるので外す。左右の端の操作ボタン・上下の端の題名とスライダーにも掛からない）
  const nearLine = (c: number[], t: number[]) => c.every((v, k) => Math.abs(v - t[k]) <= 10);
  let lineOnFillHits = 0;
  let lineOnBgHits = 0;
  for (const fy of [0.3, 0.4, 0.6, 0.7]) {
    const y = Math.floor(height * fy);
    for (let x = Math.floor(width / 3); x < Math.floor((width * 2) / 3); x++) {
      const c = px(x, y);
      if (nearLine(c, LINE_ON_FILL_RGB)) lineOnFillHits++;
      if (nearLine(c, LINE_ON_BG_RGB)) lineOnBgHits++;
    }
  }
  return { distinct6: seen.size, bgHits, fillHits, lineOnFillHits, lineOnBgHits, png };
}

/** 画面の写しを置く（PROVIDER_GL_SHOT_DIR を指定したときだけ。人が見る対比の記録用） */
export async function saveShot(name: string, png: Buffer): Promise<void> {
  const dir = process.env.PROVIDER_GL_SHOT_DIR || '';
  if (!dir) return;
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${name}.png`), png);
}
