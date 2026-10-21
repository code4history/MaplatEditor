// PWA 画像（アイコン 8 枚・スプラッシュ 46 枚）の**仕様と作図の寸法**を決める純関数群。
//
// 背景（#174 / nov26-rc-editor174 設計書 v3）:
//   これまでは Chrome を起動する生成ライブラリに作らせていた。同ライブラリは画像を 1 枚も
//   書く前に Chrome を探して起動する（利用者の既定プロファイル・他アプリのバンドル走査・
//   ブラウザ実体のダウンロード）。macOS の App Data 保護に当たり、
//   「データアクセスがブロックされました」の通知と、生成失敗→基本アイコン 2 枚への
//   フォールバックが起きていた。いまは Electron 自身の Chromium（非表示ウィンドウ）で描く。
//
// このモジュールは Electron を import しない（node の smoke で実 Electron 無しに検証する）。
// 出力（ファイル名・順序・寸法・manifest の icons・index.html の htmlMeta）は従来と同一に保つ
// （基準 = scripts/fixtures/nov26-rc-editor174-pwa-baseline.json）。
import path from 'node:path';
import appleSplashDevices from '../pwa_apple_splash_devices.json';

/** 端末寸法表の 1 行（Apple 端末の寸法表と同形）。 */
type AppleSplashDevice = {
  device: string;
  portrait: { width: number; height: number };
  landscape: { width: number; height: number };
  scaleFactor: number;
};

export type PwaImageSpec = {
  name: string;
  width: number;
  height: number;
  scaleFactor: number;
  orientation: 'portrait' | 'landscape' | null;
  /** 書き出す絶対パス */
  path: string;
};

/** 作図の矩形（すべて px。CSS の % ではなく明示値） */
export type PwaContainBox = {
  /** キャンバス（出力画像）の寸法 */
  canvasWidth: number;
  canvasHeight: number;
  /** 余白（＝ round(0.1 * 幅)。上下左右とも同じ値） */
  padding: number;
  /** 元画像の左上。中央寄せ */
  x: number;
  y: number;
  width: number;
  height: number;
};

const APPLE_ICON_SIZES = [180];
const MANIFEST_ICON_SIZES = [192, 512];
const FAVICON_SIZES = [196];
const MS_ICON_SIZES: Array<number | { width: number; height: number }> = [128, 270, 558, { width: 558, height: 270 }];

const APPLE_ICON_PREFIX = 'apple-icon';
const MANIFEST_ICON_PREFIX = 'manifest-icon';
const FAVICON_PREFIX = 'favicon';
const MS_ICON_PREFIX = 'mstile-icon';
const APPLE_SPLASH_PREFIX = 'apple-splash';

/** 内容領域のパディング率。CSS の % パディングは「包含ブロックの幅」で解決されるので W 基準。 */
const PADDING_RATIO = 0.1;

/** 縮小倍率の下限（0 除算・極端な縮小を避ける） */
const MIN_ZOOM = 0.05;

/**
 * 保存ファイル名を 1 箇所で決める。
 * manifest-icon だけ `.maskable` が付く（`maskable: true` で呼んでいる現行の出力をそのまま保つ）。
 */
export function pwaAssetRelPath(spec: { name: string; width: number; height: number }): string {
  const maskableSuffix = spec.name.startsWith(MANIFEST_ICON_PREFIX) ? '.maskable' : '';
  return `${spec.name}${maskableSuffix}.png`;
}

function iconSpec(outputDir: string, prefix: string, width: number, height?: number): PwaImageSpec {
  const name = `${prefix}-${width}${height ? `-${height}` : ''}`;
  const spec: PwaImageSpec = {
    name,
    width,
    height: height ?? width,
    scaleFactor: 1,
    orientation: null,
    path: '',
  };
  spec.path = path.join(outputDir, pwaAssetRelPath(spec));
  return spec;
}

/** アイコン 8 枚（幅・順序は従来と同じ）。 */
export function getPwaIconSpecs(outputDir: string): PwaImageSpec[] {
  return [
    ...APPLE_ICON_SIZES.map(size => iconSpec(outputDir, APPLE_ICON_PREFIX, size)),
    ...MANIFEST_ICON_SIZES.map(size => iconSpec(outputDir, MANIFEST_ICON_PREFIX, size)),
    ...FAVICON_SIZES.map(size => iconSpec(outputDir, FAVICON_PREFIX, size)),
    ...MS_ICON_SIZES.map(size =>
      typeof size === 'object'
        ? iconSpec(outputDir, MS_ICON_PREFIX, size.width, size.height)
        : iconSpec(outputDir, MS_ICON_PREFIX, size),
    ),
  ];
}

/** スプラッシュ 46 枚（59 端末 × portrait/landscape から重複を除いたもの。順序は従来と同じ）。 */
export function getPwaSplashSpecs(outputDir: string): PwaImageSpec[] {
  const devices = appleSplashDevices as AppleSplashDevice[];
  const specs: PwaImageSpec[] = [];
  for (const device of devices) {
    for (const orientation of ['portrait', 'landscape'] as const) {
      const size = device[orientation];
      const name = `${APPLE_SPLASH_PREFIX}-${size.width}-${size.height}`;
      const candidate = {
        name,
        width: size.width,
        height: size.height,
        scaleFactor: device.scaleFactor,
        orientation,
      };
      // 同じ名前・寸法・倍率・向きの端末は 1 枚に畳む（従来の isDeepStrictEqual による重複除去）
      if (specs.some(spec =>
        spec.name === candidate.name && spec.width === candidate.width && spec.height === candidate.height &&
        spec.scaleFactor === candidate.scaleFactor && spec.orientation === candidate.orientation,
      )) continue;
      specs.push({ ...candidate, path: path.join(outputDir, pwaAssetRelPath(candidate)) });
    }
  }
  return specs;
}

function assetUrl(pathOverride: string, spec: PwaImageSpec): string {
  return `${pathOverride}/${path.basename(spec.path)}`;
}

/** manifest の icons 4 件（順序・purpose とも従来と同じ）。 */
export function composePwaManifestIcons(iconSaved: PwaImageSpec[], pathOverride: string): unknown[] {
  const icons: unknown[] = [];
  for (const spec of iconSaved) {
    if (!spec.name.startsWith(MANIFEST_ICON_PREFIX)) continue;
    const icon = {
      src: assetUrl(pathOverride, spec),
      sizes: `${spec.width}x${spec.height}`,
      type: 'image/png',
    };
    icons.push({ ...icon, purpose: 'any' }, { ...icon, purpose: 'maskable' });
  }
  return icons;
}

function joinLines(lines: string[]): string {
  return lines.map(line => `${line}\n`).join('');
}

/**
 * index.html へ差し込む htmlMeta。従来の生成ライブラリが出していた文字列と同じ形
 * （行末に改行、複数行は連結）を作る。
 * 対象は renderIndexHtml が読む 4 キーだけ（apple-mobile-web-app-capable は renderIndexHtml が別途出す）。
 */
export function composePwaHtmlMeta(
  saved: { icon: PwaImageSpec[]; splash: PwaImageSpec[] },
  pathOverride: string,
  opts: { favicon: boolean; mstile: boolean },
): Record<string, string> {
  const htmlMeta: Record<string, string> = {};
  if (opts.favicon) {
    htmlMeta.favicon = joinLines(saved.icon
      .filter(spec => spec.name.startsWith(FAVICON_PREFIX))
      .map(spec => `<link rel="icon" type="image/png" sizes="${spec.width}x${spec.height}" href="${assetUrl(pathOverride, spec)}">`));
  }
  htmlMeta.appleTouchIcon = joinLines(saved.icon
    .filter(spec => spec.name.startsWith(APPLE_ICON_PREFIX))
    .map(spec => `<link rel="apple-touch-icon" href="${assetUrl(pathOverride, spec)}">`));
  if (opts.mstile) {
    const msTileElementNames: Record<string, string> = {
      '128x128': 'square70x70logo',
      '270x270': 'square150x150logo',
      '558x558': 'square310x310logo',
      '558x270': 'wide310x150logo',
    };
    htmlMeta.msTileImage = joinLines(saved.icon
      .filter(spec => spec.name.startsWith(MS_ICON_PREFIX))
      .map(spec =>
        `<meta name="msapplication-${msTileElementNames[`${spec.width}x${spec.height}`]}" ` +
        `content="${assetUrl(pathOverride, spec)}">`,
      ));
  }
  htmlMeta.appleLaunchImage = joinLines(saved.splash
    .filter(spec => spec.name.startsWith(APPLE_SPLASH_PREFIX))
    .map(spec => {
      // landscape は device-width / device-height を入れ替える（Apple の要求。従来と同じ）
      const deviceWidth = spec.orientation === 'landscape' ? spec.height : spec.width;
      const deviceHeight = spec.orientation === 'landscape' ? spec.width : spec.height;
      return `<link rel="apple-touch-startup-image" href="${assetUrl(pathOverride, spec)}" ` +
        `media="(device-width: ${deviceWidth / spec.scaleFactor}px) and ` +
        `(device-height: ${deviceHeight / spec.scaleFactor}px) and ` +
        `(-webkit-device-pixel-ratio: ${spec.scaleFactor}) and (orientation: ${spec.orientation})">`;
    }));
  return htmlMeta;
}

/**
 * 1 枚の作図矩形（設計書 v3 §5.2）。
 * 従来の HTML シェルは body に `padding: 10%`（＝ W 基準）と img の `object-fit: contain` を使っていた。
 * ここでは同じ結果を px で明示的に求める（% を書くと広いビューポート基準になって小さい画像が潰れるため）。
 */
export function pwaContainBox(
  spec: { width: number; height: number },
  sourceWidth: number,
  sourceHeight: number,
): PwaContainBox {
  const padding = Math.round(PADDING_RATIO * spec.width);
  const contentWidth = Math.max(1, spec.width - 2 * padding);
  const contentHeight = Math.max(1, spec.height - 2 * padding);
  const scale = Math.min(contentWidth / sourceWidth, contentHeight / sourceHeight);
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  return {
    canvasWidth: spec.width,
    canvasHeight: spec.height,
    padding,
    x: Math.round((spec.width - width) / 2),
    y: Math.round((spec.height - height) / 2),
    width,
    height,
  };
}

/**
 * 描画時に実際に当てる img のボックス（＝従来の CSS `padding: 10%` ＋ `object-fit: contain` と同じ配置）。
 * 元画像はここに contain で中央寄せされる（その結果が pwaContainBox）。
 */
export function pwaImageBox(spec: { width: number; height: number }): PwaContainBox {
  const padding = Math.round(PADDING_RATIO * spec.width);
  return {
    canvasWidth: spec.width,
    canvasHeight: spec.height,
    padding,
    x: padding,
    y: padding,
    width: Math.max(1, spec.width - 2 * padding),
    height: Math.max(1, spec.height - 2 * padding),
  };
}

/**
 * 画面より大きいウィンドウが作れない環境での縮小倍率（設計書 v3 §5.4 S2）。
 * 撮れる最大寸法 (availWidth, availHeight) に収まるよう、スペックごとに 1 以下の倍率を返す。
 */
export function pwaZoomFor(
  spec: { width: number; height: number },
  availWidth: number,
  availHeight: number,
): number {
  if (!(availWidth > 0) || !(availHeight > 0)) return MIN_ZOOM;
  const zoom = Math.min(1, availWidth / spec.width, availHeight / spec.height);
  return Math.max(MIN_ZOOM, Math.min(1, zoom));
}

/** 描画用のシェル HTML（一時ファイルに書いて file: で読む）。CSS に % は書かない。 */
export function buildPwaShellHtml(background: string): string {
  // 【NOV26-IR-EDITOR174-0453 MIN-2】背景色は <style> に埋め込むので、CSS の色として安全な書式だけを通す
  // （`</style><script>` 等を入れさせない）。書式に合わなければ既定の背景色にする
  background = sanitizeCssColor(background);
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;padding:0;overflow:hidden;background:${background}}
  body{box-sizing:border-box;position:relative}
  img{position:absolute;object-fit:contain;display:block}
  </style></head><body><img id="pwa-src" alt=""></body></html>`;
}

/**
 * 1 枚ぶんの寸法を当てて「新しい内容が描かれた」ところまで待つ JS。
 * requestAnimationFrame を 2 回待つのは、1 回では前の寸法の描画を撮ってしまうため（設計書 v3 §4.2 E4）。
 * sourceUrl を渡したときだけ元画像を読み直し、読めなければ reject する（呼び出し側が退避を判断する）。
 */
export function buildPwaApplyScript(box: PwaContainBox, sourceUrl?: string): string {
  const px = (value: number) => `'${value}px'`;
  const source = sourceUrl ? JSON.stringify(sourceUrl) : 'null';
  return `(() => {
  const body = document.body;
  const img = document.getElementById('pwa-src');
  body.style.width = ${px(box.canvasWidth)};
  body.style.height = ${px(box.canvasHeight)};
  img.style.left = ${px(box.x)};
  img.style.top = ${px(box.y)};
  img.style.width = ${px(box.width)};
  img.style.height = ${px(box.height)};
  const source = ${source};
  return new Promise((resolve, reject) => {
    const settle = () => requestAnimationFrame(() => requestAnimationFrame(() => resolve(1)));
    if (source && img.src !== source) {
      img.onload = settle;
      img.onerror = () => reject(new Error('pwa-source-load-failed'));
      img.src = source;
    } else {
      settle();
    }
  });
})()`;
}

/** 背景色として通す書式: #rgb・#rgba・#rrggbb・#rrggbbaa・rgb()/rgba()/hsl()/hsla()（数字・%・空白・カンマ・点・スラッシュだけ）・英字だけの色名・transparent。それ以外は既定の色。 */
export const PWA_DEFAULT_BACKGROUND = '#f6f0d3';
export function sanitizeCssColor(value: unknown): string {
  const v = String(value ?? '').trim();
  if (/^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v)) return v;
  if (/^(?:rgba?|hsla?)\([0-9.,%\s/]+\)$/i.test(v)) return v;
  if (/^[a-zA-Z]{3,30}$/.test(v)) return v;
  return PWA_DEFAULT_BACKGROUND;
}
