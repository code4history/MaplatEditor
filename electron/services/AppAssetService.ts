import fs from 'fs-extra';
import path from 'path';
import { dialog, type BrowserWindow } from 'electron';
import { Jimp } from 'jimp';
import SettingsService from './SettingsService';
import { resourceAssetFileUrl } from '../utils/resourceAssets';

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

  // 非ビルトインTMSのサムネイル: 52x52正方形必須(縮小は許容)
  async uploadTmsThumbnail(win: BrowserWindow, mapID: string): Promise<UploadResult> {
    const file = await this.pickImage(win);
    if (!file) return { err: 'Canceled' };
    let image;
    try {
      image = await Jimp.read(file);
    } catch {
      return { err: 'InvalidImage' };
    }
    if (image.width !== image.height) return { err: 'NotSquare' };
    const dest = path.join(this.saveFolder, 'tmbs', `${sanitizeId(mapID)}_menu.jpg`);
    await fs.ensureDir(path.dirname(dest));
    if (image.width !== 52) image.resize({ w: 52, h: 52 });
    await image.write(dest as `${string}.${string}`);
    return {
      path: `tmbs/${sanitizeId(mapID)}_menu.jpg`,
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
  // 存在範囲(coverageLngLats)を中心固定で正方形化し、その領域のタイルを取得・合成して
  // 52x52のPNGに縮小保存する。タイルURLテンプレートと範囲の両方が設定済みの場合のみ有効
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

    // 存在範囲のメルカトルbbox → 中心固定の正方形(アイコンは正方形のため)
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const point of coverageLngLats) {
      if (!Array.isArray(point) || typeof point[0] !== 'number' || typeof point[1] !== 'number') continue;
      const [x, y] = lngLatToMerc(point[0], point[1]);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    const side = Math.max(maxX - minX, maxY - minY);
    if (!Number.isFinite(side) || side <= 0) return { err: 'NoCoverage' };
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const square = { minX: centerX - side / 2, maxX: centerX + side / 2, minY: centerY - side / 2, maxY: centerY + side / 2 };

    // 正方形領域が約256pxになるズームを選ぶ(52pxへの縮小に十分な解像度、タイル数は高々3x3程度)
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
    while (zoom > 0 && (range.x1 - range.x0 + 1) * (range.y1 - range.y0 + 1) > 36) {
      zoom--;
      range = tileRange(zoom);
    }

    // タイル取得({-y}はTMS方式の南起点Y)。欠損タイルは白背景のまま残す
    const fetches: Promise<{ tx: number; ty: number; buffer: Buffer } | null>[] = [];
    for (let tx = range.x0; tx <= range.x1; tx++) {
      for (let ty = range.y0; ty <= range.y1; ty++) {
        const url = template
          .replace('{z}', String(zoom))
          .replace('{x}', String(tx))
          .replace('{y}', String(ty))
          .replace('{-y}', String(range.n - 1 - ty));
        fetches.push(
          fetch(url, { signal: AbortSignal.timeout(10000) })
            .then(async (res) => (res.ok ? { tx, ty, buffer: Buffer.from(await res.arrayBuffer()) } : null))
            .catch(() => null)
        );
      }
    }
    const tiles = (await Promise.all(fetches)).filter((tile): tile is { tx: number; ty: number; buffer: Buffer } => tile != null);
    if (tiles.length === 0) return { err: 'NoTiles' };

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

    // 正方形領域をキャンバスのピクセル座標へ変換して切り出し → 52pxへ縮小
    const pixelsPerMeter = (range.n * 256) / worldSize;
    const cropX = Math.round((square.minX + MERC_MAX) * pixelsPerMeter - range.x0 * 256);
    const cropY = Math.round((MERC_MAX - square.maxY) * pixelsPerMeter - range.y0 * 256);
    const cropSize = Math.round(side * pixelsPerMeter);
    const safeX = Math.max(0, Math.min(canvas.width - 1, cropX));
    const safeY = Math.max(0, Math.min(canvas.height - 1, cropY));
    const safeSize = Math.max(1, Math.min(cropSize, canvas.width - safeX, canvas.height - safeY));
    canvas.crop({ x: safeX, y: safeY, w: safeSize, h: safeSize });
    canvas.resize({ w: 52, h: 52 });

    const relPath = `tmbs/${sanitizeId(mapID)}_menu.png`;
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
    if (!resolved.startsWith(baseFolder)) return null;
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) return null;
    return this.toFileUrl(resolved);
  }
}

const MERC_MAX = 20037508.342789244;

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
