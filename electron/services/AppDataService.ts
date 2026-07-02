import fs from 'fs-extra';
import path from 'path';
import SettingsService from './SettingsService';
import DuckDbDataService, { type AppListResult } from './DuckDbDataService';

class AppDataService {
  private get folders() {
    const saveFolder = SettingsService.get('saveFolder');
    return {
      tileFolder: path.join(saveFolder, "tiles"),
      uiThumbnailFolder: path.join(saveFolder, "tmbs"),
    };
  }

  private getLocalizedTitle(value: any, lang: string, fallback: string): string {
    if (typeof value === 'string' && value.trim()) return value;
    if (value && typeof value === 'object') {
      return value[lang] || value.ja || value.en || Object.values(value as Record<string, string>)[0] || fallback;
    }
    return fallback;
  }

  private async getMapThumbnail(mapID: string): Promise<string | null> {
    // 正式なサムネイルはデータフォルダのtmbs/{mapID}.jpg。無い場合のみズーム0タイルへフォールバック
    const uiThumbnail = path.join(this.folders.uiThumbnailFolder, `${mapID}.jpg`);
    if (fs.existsSync(uiThumbnail)) {
      return `file://${uiThumbnail.split(path.sep).join('/')}`;
    }
    const thumbFolder = path.join(this.folders.tileFolder, mapID, "0", "0");
    if (!fs.existsSync(thumbFolder)) return null;
    try {
      const files = await fs.readdir(thumbFolder);
      const tileFile = files.find(f => /^0\.(jpg|jpeg|png)$/.test(f));
      return tileFile ? `file://${path.join(thumbFolder, tileFile).split(path.sep).join('/')}` : null;
    } catch {
      return null;
    }
  }

  async requestApps(query: string = '', page: number = 1, pageSize: number = 20): Promise<AppListResult> {
    const rawResult = await DuckDbDataService.listApps(query, page, pageSize);
    const docs = await Promise.all(rawResult.docs.map(async (doc: any) => {
      const appID = doc._id || doc.appID;
      const lang = doc.lang || 'ja';
      const sources = Array.isArray(doc.sources) ? doc.sources : [];
      const firstMap = sources.find((source: any) => source?.sourceType === 'maplat' || source?.maptype === 'maplat');
      return {
        appID,
        title: this.getLocalizedTitle(doc.title || doc.appName, lang, appID),
        description: this.getLocalizedTitle(doc.description, lang, ''),
        image: firstMap?.mapID ? await this.getMapThumbnail(firstMap.mapID) : null,
      };
    }));
    return { ...rawResult, docs };
  }

  async getApp(appID: string): Promise<any | null> {
    return DuckDbDataService.findApp(appID);
  }

  async saveApp(appID: string, document: any): Promise<'Success' | 'Exist' | 'Error'> {
    const current = await DuckDbDataService.findApp(appID);
    const originalAppID = document?.originalAppID;
    if (current && originalAppID !== appID) {
      return 'Exist';
    }
    await DuckDbDataService.upsertApp(appID, document);
    if (originalAppID && originalAppID !== appID) {
      await DuckDbDataService.deleteApp(originalAppID);
    }
    return 'Success';
  }

  async deleteApp(appID: string): Promise<void> {
    await DuckDbDataService.deleteApp(appID);
  }

  async isAppIdAvailable(appID: string): Promise<boolean> {
    return DuckDbDataService.isAppIdAvailable(appID);
  }
}

export default new AppDataService();
