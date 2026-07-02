import fs from 'fs-extra';
import path from 'path';
import { dialog, type BrowserWindow } from 'electron';
import { Jimp } from 'jimp';
import SettingsService from './SettingsService';

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

  // saveFolder相対パス → file:// URL（存在しない場合はnull）
  fileUrlFor(relPath: string): string | null {
    if (typeof relPath !== 'string' || !relPath.trim()) return null;
    const baseFolder = path.resolve(this.saveFolder);
    const resolved = path.resolve(path.join(baseFolder, relPath));
    if (!resolved.startsWith(baseFolder)) return null;
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) return null;
    return this.toFileUrl(resolved);
  }
}

function sanitizeId(value: string): string {
  return String(value || '').replace(/[^\w-]/g, '_');
}

function sanitizeFileName(value: string): string {
  return String(value || '').replace(/[^\w.-]/g, '_');
}

export default new AppAssetService();
