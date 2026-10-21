// PWA 画像（アイコン 8 枚・スプラッシュ 46 枚）を **Electron 自身の Chromium** で描く。
//
// 背景（#174 / nov26-rc-editor174 設計書 v3）:
//   従来は Chrome を起動する生成ライブラリに描かせていた。同ライブラリは利用者の Chrome を
//   既定プロファイルで起動し、他アプリのバンドルを走査し、無ければブラウザをダウンロードしていた。
//   macOS の App Data 保護に当たり「データアクセスがブロックされました」の通知と生成失敗が起きていた。
//   ここでは画面外（offscreen）の非表示ウィンドウ 1 枚に一時ファイルの HTML を読み込ませ、
//   サイズごとに寸法を当てて capturePage で撮る。Chrome を探さず・起動せず・外へも出ない。
//
// 落とし穴（実測に基づく。設計書 v3 §4.2）:
//   - 画面より大きいウィンドウは offscreen:true でしか作れない（offscreen:false は 2048x796 に切られた）
//   - requestAnimationFrame 1 回待ちでは前の寸法の描画を撮る → 2 回待つ
//   - リサイズ直後の capturePage は UnknownVizError を投げることがある → リトライする
//   - CSS の % による余白はビューポート基準になる → px を明示する
// electron は名前空間で受ける（一部の node smoke は electron を最小のスタブに差し替えており、
// `import { session } from 'electron'` のような名前付き import はリンク時に落ちてしまうため）
import * as electron from 'electron';
import type { NativeImage, Session } from 'electron';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  buildPwaApplyScript,
  buildPwaShellHtml,
  getPwaIconSpecs,
  getPwaSplashSpecs,
  pwaImageBox,
  pwaZoomFor,
  type PwaContainBox,
  type PwaImageSpec,
} from './pwaAssets';
import { installPwaRequestGuard } from './pwaRequestGuard';

/** 描画専用セッション（`persist:` を付けない＝メモリ内。利用者のプロファイルに残らない） */
export const PWA_RENDER_PARTITION = 'pwa-assets-render';

/** capturePage の再試行回数と間隔（リサイズ直後の UnknownVizError 対策） */
const CAPTURE_ATTEMPTS = 40;
const CAPTURE_RETRY_DELAY_MS = 5;

/** 1 ステップが返ってこない場合の上限（固まったら退避へ落とす） */
const STEP_TIMEOUT_MS = 60_000;

export type PwaRenderResult = {
  iconSaved: PwaImageSpec[];
  splashSaved: PwaImageSpec[];
  /** スプラッシュの元画像が読めず、アイコン元画像で描いた（呼び出し側が警告を積む） */
  splashUsedFallback: boolean;
};

let guardInstalled = false;

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`pwa-render-timeout:${label}`)), ms);
    promise.then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); },
    );
  });
}

function fileUrl(filePath: string): string {
  return pathToFileURL(path.resolve(filePath)).href;
}

/** 専用セッションを用意し、外部へのリクエストを拒否する（1 プロセス 1 回） */
function prepareSession(): Session {
  const renderSession = electron.session.fromPartition(PWA_RENDER_PARTITION);
  if (!guardInstalled) {
    installPwaRequestGuard(renderSession.webRequest);
    guardInstalled = true;
  }
  return renderSession;
}

/** その URL の画像をこのウィンドウで描けるか（壊れた webp 等を先に見つける） */
async function canLoadImage(win: electron.BrowserWindow, url: string): Promise<boolean> {
  const script = `new Promise((resolve) => {
    const image = new Image();
    const done = (ok) => resolve(ok);
    const timer = setTimeout(() => done(false), 15000);
    image.onload = () => { clearTimeout(timer); done(true); };
    image.onerror = () => { clearTimeout(timer); done(false); };
    image.src = ${JSON.stringify(url)};
  })`;
  return withTimeout(win.webContents.executeJavaScript(script, true), STEP_TIMEOUT_MS, 'can-load') as Promise<boolean>;
}

/**
 * 1 枚描いて書き出す。
 * zoom は「画面より大きいウィンドウが作れない環境」での縮小（S2）。1 のときは等倍。
 */
async function drawSpec(
  win: electron.BrowserWindow,
  spec: PwaImageSpec,
  sourceUrl: string,
  zoom: number,
  appliedZoom: { value: number },
  // 省略時は PWA の作図（余白 10%＋contain）。og:image は余白なしの全面 contain を渡す
  imageBox: PwaContainBox = pwaImageBox(spec),
): Promise<void> {
  // 等倍のままなら IPC を増やさない（54 枚ぶんの往復は所要時間に効く）
  if (appliedZoom.value !== zoom) {
    win.webContents.setZoomFactor(zoom);
    appliedZoom.value = zoom;
  }
  const box = imageBox;
  await withTimeout(
    win.webContents.executeJavaScript(buildPwaApplyScript(box, sourceUrl), true),
    STEP_TIMEOUT_MS,
    `apply:${spec.name}`,
  );
  const captureWidth = Math.max(1, Math.round(spec.width * zoom));
  const captureHeight = Math.max(1, Math.round(spec.height * zoom));
  let image: NativeImage | null = null;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < CAPTURE_ATTEMPTS; attempt++) {
    try {
      image = await withTimeout(
        win.webContents.capturePage({ x: 0, y: 0, width: captureWidth, height: captureHeight }),
        STEP_TIMEOUT_MS,
        `capture:${spec.name}`,
      );
      break;
    } catch (error) {
      lastError = error;
      // 【NOV26-IR-EDITOR174-0453 MIN-1】再試行するのはリサイズ直後の一時的な失敗（UnknownVizError 等）だけ。
      // 応答が無いまま時間切れになったら、40 回×60 秒固まらないよう、すぐ退避（jimp）へ落とす
      if (error instanceof Error && error.message.startsWith('pwa-render-timeout:')) break;
      await delay(CAPTURE_RETRY_DELAY_MS);
    }
  }
  if (!image) throw lastError instanceof Error ? lastError : new Error(`pwa-capture-failed:${spec.name}`);
  const size = image.getSize();
  // DPR や縮小で画素数がずれた場合は出力の寸法を優先する（ファイル名・寸法は従来と同一に保つ）
  const png = size.width === spec.width && size.height === spec.height
    ? image.toPNG()
    : image.resize({ width: spec.width, height: spec.height, quality: 'best' }).toPNG();
  await fs.outputFile(spec.path, png);
}

/** 描画用の非表示ウィンドウを 1 枚作る（遷移・新しいウィンドウ・権限要求はすべて断る） */
function createRenderWindow(width: number, height: number): electron.BrowserWindow {
  prepareSession();
  const win = new electron.BrowserWindow({
    width,
    height,
    show: false,
    // macOS: 画面より大きいウィンドウを許す（これと offscreen の組み合わせで 2868px が作れる）
    enableLargerThanScreen: true,
    useContentSize: true,
    skipTaskbar: true,
    webPreferences: {
      offscreen: true,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
      partition: PWA_RENDER_PARTITION,
    },
  });
  // 【NOV26-IR-EDITOR174-0453 MIN-2】描画用のウィンドウは、遷移・新しいウィンドウ・権限要求をすべて断る
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  return win;
}

/** 一時ファイルのシェル HTML（背景色だけのページ）を読み、実際に撮れる大きさを返す */
async function loadShell(
  win: electron.BrowserWindow,
  tmpDir: string,
  background: string,
): Promise<{ contentWidth: number; contentHeight: number }> {
  const shellPath = path.join(tmpDir, 'pwa-shell.html');
  await fs.writeFile(shellPath, buildPwaShellHtml(background));
  await withTimeout(win.loadFile(shellPath), STEP_TIMEOUT_MS, 'load-shell');
  const [contentWidth, contentHeight] = win.getContentSize();
  return { contentWidth, contentHeight };
}

/**
 * アイコン 8 枚 → スプラッシュ 46 枚を描いて書き出す（順序は従来と同じ）。
 * 1 回の呼び出しで非表示ウィンドウを 1 枚だけ作り、`finally` で必ず壊す。
 * 描けない場合は throw する（呼び出し側が従来の jimp 退避へ落とす）。
 */
export async function renderPwaAssets(args: {
  iconSourcePath: string;
  splashSourcePath?: string;
  outputDir: string;
  background: string;
}): Promise<PwaRenderResult> {
  if (!electron.app.isReady()) throw new Error('pwa-render-not-ready');
  const iconSpecs = getPwaIconSpecs(args.outputDir);
  const splashSpecs = getPwaSplashSpecs(args.outputDir);
  const allSpecs = [...iconSpecs, ...splashSpecs];
  const maxWidth = Math.max(...allSpecs.map(spec => spec.width));
  const maxHeight = Math.max(...allSpecs.map(spec => spec.height));
  await fs.ensureDir(args.outputDir);

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'maplat-pwa-render-'));
  let win: electron.BrowserWindow | null = null;
  try {
    win = createRenderWindow(maxWidth, maxHeight);
    const renderWindow = win;
    const { contentWidth, contentHeight } = await loadShell(renderWindow, tmpDir, args.background);

    const availWidth = Math.max(1, Math.min(maxWidth, contentWidth));
    const availHeight = Math.max(1, Math.min(maxHeight, contentHeight));
    if (availWidth < maxWidth || availHeight < maxHeight) {
      // S2: 画面の制約で要求どおりの大きさのウィンドウが作れない。縮めて撮り、縮尺を戻す
      console.warn(
        `[PwaChromiumRenderer] window clamped to ${contentWidth}x${contentHeight}; shrinking captures (quality reduced)`,
      );
    }

    const iconUrl = fileUrl(args.iconSourcePath);
    if (!(await canLoadImage(renderWindow, iconUrl))) {
      throw new Error(`pwa-source-load-failed:${args.iconSourcePath}`);
    }
    const appliedZoom = { value: 1 };
    const iconSaved: PwaImageSpec[] = [];
    for (const spec of iconSpecs) {
      await drawSpec(renderWindow, spec, iconUrl, pwaZoomFor(spec, availWidth, availHeight), appliedZoom);
      iconSaved.push(spec);
    }

    let splashUrl = args.splashSourcePath ? fileUrl(args.splashSourcePath) : iconUrl;
    let splashUsedFallback = false;
    if (splashUrl !== iconUrl && !(await canLoadImage(renderWindow, splashUrl))) {
      // 読めない画像（壊れた webp 等）はアイコン元画像で代替する。黙って差し替えない（呼び出し側が警告を積む）
      splashUsedFallback = true;
      splashUrl = iconUrl;
    }
    const splashSaved: PwaImageSpec[] = [];
    for (const spec of splashSpecs) {
      await drawSpec(renderWindow, spec, splashUrl, pwaZoomFor(spec, availWidth, availHeight), appliedZoom);
      splashSaved.push(spec);
    }
    return { iconSaved, splashSaved, splashUsedFallback };
  } finally {
    if (win && !win.isDestroyed()) win.destroy();
    await fs.remove(tmpDir).catch(() => {});
  }
}

/**
 * 画像 1 枚を PNG に描く（nov26-editor-splash-svg #462。SVG のスプラッシュから SNS カード画像を作る）。
 * PWA と同じ非表示ウィンドウ・同じシェル（背景色）を使い、`<img>` へ contain で中央寄せする。
 * **`<img>` なので SVG の中の script も外部参照も動かない**（描けない場合は throw する）。
 */
export async function renderImagePng(args: {
  sourcePath: string;
  outputPath: string;
  width: number;
  height: number;
  background: string;
}): Promise<void> {
  if (!electron.app.isReady()) throw new Error('pwa-render-not-ready');
  const spec: PwaImageSpec = {
    name: path.basename(args.outputPath),
    width: args.width,
    height: args.height,
    scaleFactor: 1,
    orientation: null,
    path: args.outputPath,
  };
  // 余白なしで全面に contain（縦横比を保ち、残りは背景色で埋まる。CSS の object-fit: contain）
  const box: PwaContainBox = {
    canvasWidth: spec.width,
    canvasHeight: spec.height,
    padding: 0,
    x: 0,
    y: 0,
    width: spec.width,
    height: spec.height,
  };
  await fs.ensureDir(path.dirname(args.outputPath));
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'maplat-image-render-'));
  let win: electron.BrowserWindow | null = null;
  try {
    win = createRenderWindow(spec.width, spec.height);
    const { contentWidth, contentHeight } = await loadShell(win, tmpDir, args.background);
    const availWidth = Math.max(1, Math.min(spec.width, contentWidth));
    const availHeight = Math.max(1, Math.min(spec.height, contentHeight));
    const sourceUrl = fileUrl(args.sourcePath);
    if (!(await canLoadImage(win, sourceUrl))) {
      throw new Error(`image-source-load-failed:${args.sourcePath}`);
    }
    await drawSpec(win, spec, sourceUrl, pwaZoomFor(spec, availWidth, availHeight), { value: 1 }, box);
  } finally {
    if (win && !win.isDestroyed()) win.destroy();
    await fs.remove(tmpDir).catch(() => {});
  }
}
