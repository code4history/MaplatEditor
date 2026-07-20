import fs from 'fs-extra';
import path from 'path';
import { dialog, type BrowserWindow } from 'electron';
import { Jimp } from 'jimp';
import SettingsService from './SettingsService';
import { resourceAssetFileUrl, isUnderFolder } from '../utils/resourceAssets';

const IMAGE_FILTERS = [{ name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }];

type UploadResult = {
  err?: string;
  path?: string;     // saveFolder相対パス（アプリ設定に記録する値）
  splash?: string;   // スプラッシュのみ: ファイル名
  fileUrl?: string;  // UIプレビュー用file:// URL
};

class AppAssetService {
  private get saveFolder(): string {
    return SettingsService.get('saveFolder') as string;
  }

  private toFileUrl(absPath: string): string {
    return `file://${absPath.split(path.sep).join('/')}`;
  }

  private async pickImage(win: BrowserWindow): Promise<string | null> {
    const ret = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: IMAGE_FILTERS,
    });
    if (ret.canceled || ret.filePaths.length === 0) return null;
    return ret.filePaths[0];
  }

  // 非ビルトインTMSのサムネイル: 長辺52pxの長方形規約(縦横比は保持し、正方形は要求しない)
  async uploadTmsThumbnail(win: BrowserWindow, mapID: string): Promise<UploadResult> {
    const file = await this.pickImage(win);
    if (!file) return { err: 'Canceled' };
    let image;
    try {
      image = await Jimp.read(file);
    } catch {
      return { err: 'InvalidImage' };
    }
    resizeToIconLongSide(image);
    const relPath = `tmbs/${sanitizeId(mapID)}.png`;
    const dest = path.join(this.saveFolder, relPath);
    await fs.ensureDir(path.dirname(dest));
    await image.write(dest as `${string}.${string}`);
    return {
      path: relPath,
      fileUrl: this.toFileUrl(dest),
    };
  }

  // スプラッシュ画像: サイズ自由。img/へコピー
  async uploadSplash(win: BrowserWindow): Promise<UploadResult> {
    const file = await this.pickImage(win);
    if (!file) return { err: 'Canceled' };
    try {
      await Jimp.read(file);
    } catch {
      return { err: 'InvalidImage' };
    }
    const fileName = sanitizeFileName(path.basename(file));
    const dest = path.join(this.saveFolder, 'img', fileName);
    await fs.ensureDir(path.dirname(dest));
    await fs.copy(file, dest, { overwrite: true });
    return { splash: fileName, fileUrl: this.toFileUrl(dest) };
  }

  // PWAアイコン元画像: 512x512以上の正方形 → 512x512 PNG
  async uploadPwaIcon(win: BrowserWindow, appID: string): Promise<UploadResult> {
    const file = await this.pickImage(win);
    if (!file) return { err: 'Canceled' };
    let image;
    try {
      image = await Jimp.read(file);
    } catch {
      return { err: 'InvalidImage' };
    }
    if (image.width !== image.height) return { err: 'NotSquare' };
    if (image.width < 512) return { err: 'TooSmall' };
    const dest = path.join(this.saveFolder, 'pwa', `${sanitizeId(appID)}_icon.png`);
    await fs.ensureDir(path.dirname(dest));
    if (image.width !== 512) image.resize({ w: 512, h: 512 });
    await image.write(dest as `${string}.${string}`);
    return {
      path: `pwa/${sanitizeId(appID)}_icon.png`,
      fileUrl: this.toFileUrl(dest),
    };
  }

  // ユーザー定義ベースマップのアイコン自動生成:
  // 存在範囲(coverageLngLats)の矩形をそのまま切り出し、長辺52pxに縮小して保存する
  // (アイコンは長辺52pxの長方形規約。正方形への引き伸ばしはしない)。
  // タイルURLテンプレートと範囲の両方が設定済みの場合のみ有効
  async generateTmsThumbnail(
    mapID: string,
    tms: { url?: string; minZoom?: number; maxZoom?: number },
    coverageLngLats: [number, number][]
  ): Promise<UploadResult> {
    const template = String(tms?.url || '').trim();
    if (!/\{z\}/.test(template) || !/\{x\}/.test(template) || !(/\{y\}/.test(template) || /\{-y\}/.test(template))) {
      return { err: 'InvalidUrl' };
    }
    if (!Array.isArray(coverageLngLats) || coverageLngLats.length === 0) return { err: 'NoCoverage' };

    // 存在範囲のメルカトルbbox
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const point of coverageLngLats) {
      if (!Array.isArray(point) || typeof point[0] !== 'number' || typeof point[1] !== 'number') continue;
      const [x, y] = lngLatToMerc(point[0], point[1]);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    const side = Math.max(maxX - minX, maxY - minY);
    if (!Number.isFinite(side) || side <= 0) return { err: 'NoCoverage' };
    const square = { minX, maxX, minY, maxY };

    // 長辺が約256pxになるズームを選ぶ(52pxへの縮小に十分な解像度、タイル数は高々3x3程度)
    const worldSize = MERC_MAX * 2;
    let zoom = Math.round(Math.log2(worldSize / side));
    const minZoom = Number.isFinite(tms.minZoom) ? Number(tms.minZoom) : 0;
    const maxZoom = Number.isFinite(tms.maxZoom) ? Number(tms.maxZoom) : 18;
    zoom = Math.max(0, Math.min(20, Math.max(minZoom, Math.min(maxZoom, zoom))));

    // 対象タイル範囲(タイル数の上限を超える場合はズームを下げて抑制)
    const tileRange = (z: number) => {
      const n = 2 ** z;
      const clampTile = (v: number) => Math.max(0, Math.min(n - 1, v));
      return {
        n,
        x0: clampTile(Math.floor(((square.minX + MERC_MAX) / worldSize) * n)),
        x1: clampTile(Math.floor(((square.maxX + MERC_MAX) / worldSize) * n)),
        y0: clampTile(Math.floor(((MERC_MAX - square.maxY) / worldSize) * n)),
        y1: clampTile(Math.floor(((MERC_MAX - square.minY) / worldSize) * n)),
      };
    };
    let range = tileRange(zoom);
    const tilesInRange = () => (range.x1 - range.x0 + 1) * (range.y1 - range.y0 + 1);
    // タイル数が多すぎる場合はズームを下げる。ただしタイルが存在しないminZoom未満へは
    // 下げない(下げても403/404で1枚も取れず、必ずNoTilesになるだけのため)
    const zoomFloor = Math.max(0, Math.min(zoom, minZoom));
    while (zoom > zoomFloor && tilesInRange() > 64) {
      zoom--;
      range = tileRange(zoom);
    }
    // minZoomの制約で下げられない場合はそのまま取得する(市街地規模×z15で数十枚程度)。
    // 誤って広大な範囲×高minZoomを組んだ場合の暴走だけ止める
    if (tilesInRange() > 400) {
      console.warn(`[generateTmsThumbnail] too many tiles (${tilesInRange()}) at z${zoom} for ${mapID}`);
      return { err: 'TooManyTiles' };
    }

    // タイル取得({-y}はTMS方式の南起点Y)。欠損タイルは白背景のまま残す
    const fetches: Promise<{ tx: number; ty: number; buffer: Buffer } | null>[] = [];
    const failures: string[] = [];
    for (let tx = range.x0; tx <= range.x1; tx++) {
      for (let ty = range.y0; ty <= range.y1; ty++) {
        const url = template
          .replace('{z}', String(zoom))
          .replace('{x}', String(tx))
          .replace('{y}', String(ty))
          .replace('{-y}', String(range.n - 1 - ty));
        fetches.push(
          fetch(url, {
            signal: AbortSignal.timeout(10000),
            // 識別可能なUAを明示する(既定のnode UAを拒否するタイルサーバー対策も兼ねる)
            headers: { 'User-Agent': 'MaplatEditor (https://github.com/code4history/MaplatEditor)' },
          })
            .then(async (res) => {
              if (res.ok) return { tx, ty, buffer: Buffer.from(await res.arrayBuffer()) };
              failures.push(`${res.status} ${url}`);
              return null;
            })
            .catch((e) => {
              failures.push(`${e?.name || 'fetch error'} ${url}`);
              return null;
            })
        );
      }
    }
    const tiles = (await Promise.all(fetches)).filter((tile): tile is { tx: number; ty: number; buffer: Buffer } => tile != null);
    if (tiles.length === 0) {
      // 原因調査用: 失敗理由(ステータス/例外)の代表例をDevToolsコンソールへ転送する
      console.warn(
        `[generateTmsThumbnail] no tiles fetched for ${mapID} at z${zoom} (${failures.length} failures). ` +
          `samples: ${failures.slice(0, 3).join(' | ')}`
      );
      return { err: 'NoTiles' };
    }

    const canvas = new Jimp({
      width: (range.x1 - range.x0 + 1) * 256,
      height: (range.y1 - range.y0 + 1) * 256,
      color: 0xffffffff,
    });
    for (const tile of tiles) {
      let image;
      try {
        image = await Jimp.read(tile.buffer);
      } catch {
        continue;
      }
      if (image.width !== 256 || image.height !== 256) image.resize({ w: 256, h: 256 });
      canvas.composite(image, (tile.tx - range.x0) * 256, (tile.ty - range.y0) * 256);
    }

    // 存在範囲の矩形をキャンバスのピクセル座標へ変換して切り出し → 長辺52pxへ縮小
    const pixelsPerMeter = (range.n * 256) / worldSize;
    const cropX = Math.round((square.minX + MERC_MAX) * pixelsPerMeter - range.x0 * 256);
    const cropY = Math.round((MERC_MAX - square.maxY) * pixelsPerMeter - range.y0 * 256);
    const cropW = Math.round((square.maxX - square.minX) * pixelsPerMeter);
    const cropH = Math.round((square.maxY - square.minY) * pixelsPerMeter);
    const safeX = Math.max(0, Math.min(canvas.width - 1, cropX));
    const safeY = Math.max(0, Math.min(canvas.height - 1, cropY));
    const safeW = Math.max(1, Math.min(cropW, canvas.width - safeX));
    const safeH = Math.max(1, Math.min(cropH, canvas.height - safeY));
    canvas.crop({ x: safeX, y: safeY, w: safeW, h: safeH });

    // M12-T15 (R4): crop 済みの中間画像から 512px と 52px を同時生成する（stitch を共有）
    // 512px 側を先に clone して縮小（resizeToLongSide は破壊的なため）
    const canvas512 = canvas.clone();
    resizeToLongSide(canvas512, 512);
    const relPath512 = `tmbs/${sanitizeId(mapID)}_512.png`;
    const dest512 = path.join(this.saveFolder, relPath512);
    await fs.ensureDir(path.dirname(dest512));
    await canvas512.write(dest512 as `${string}.${string}`);

    resizeToIconLongSide(canvas);

    // Maplat地図のサムネイル(tmbs/{mapID}.jpg)と同じ規約のパスに置く。
    // このためベースマップのIDはMaplat地図とID空間を共有し一意である必要がある
    const relPath = `tmbs/${sanitizeId(mapID)}.png`;
    const dest = path.join(this.saveFolder, relPath);
    await fs.ensureDir(path.dirname(dest));
    await canvas.write(dest as `${string}.${string}`);
    return { path: relPath, fileUrl: this.toFileUrl(dest) };
  }

  // saveFolder相対パス → file:// URL（存在しない場合はnull）
  // ビルトインベースマップのアイコン(basemap_icons/)はアプリ同梱リソースから解決する
  fileUrlFor(relPath: string): string | null {
    if (typeof relPath !== 'string' || !relPath.trim()) return null;
    if (relPath.startsWith('basemap_icons/')) {
      return resourceAssetFileUrl(relPath);
    }
    const baseFolder = path.resolve(this.saveFolder);
    const resolved = path.resolve(path.join(baseFolder, relPath));
    // sec-3 (M12-T13): 旧実装は startsWith(baseFolder) だったが末尾 path.sep が無く、兄弟ディレクトリ
    // ({saveFolder}-x) が prefix 一致で通過していた。isUnderFolder で厳密化（sec-2 と同型）。
    if (!isUnderFolder(resolved, this.saveFolder)) return null;
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) return null;
    return this.toFileUrl(resolved);
  }
}

const MERC_MAX = 20037508.342789244;

// アイコン規約: 長辺52pxの長方形(縦横比保持)。正方形への引き伸ばしはしない
function resizeToIconLongSide(image: { width: number; height: number; resize: (size: { w: number; h: number }) => unknown }): void {
  resizeToLongSide(image, 52);
}

// M12-T15: 長辺 px への縮小を一般化（52px / 512px 共通）
function resizeToLongSide(image: { width: number; height: number; resize: (size: { w: number; h: number }) => unknown }, px: number): void {
  const longSide = Math.max(image.width, image.height);
  if (longSide === px) return;
  const scale = px / longSide;
  image.resize({
    w: Math.max(1, Math.round(image.width * scale)),
    h: Math.max(1, Math.round(image.height * scale)),
  });
}

function lngLatToMerc(lng: number, lat: number): [number, number] {
  const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const x = (lng * MERC_MAX) / 180;
  const y = (Math.log(Math.tan(((90 + clampedLat) * Math.PI) / 360)) / Math.PI) * MERC_MAX;
  return [x, y];
}

function sanitizeId(value: string): string {
  return String(value || '').replace(/[^\w-]/g, '_');
}

function sanitizeFileName(value: string): string {
  return String(value || '').replace(/[^\w.-]/g, '_');
}

export default new AppAssetService();
