import fs from 'fs-extra';
import path from 'path';
import SettingsService from './SettingsService';
import AppAssetService from './AppAssetService';
import SqliteDataService from './SqliteDataService';
import SearchDataService, { type AppListResult } from './SearchDataService';
import { normalizeAppSource, type AppSource } from '../../src/utils/appSourceModel';

class AppDataService {
  private get folders() {
    const saveFolder = SettingsService.get('saveFolder');
    return {
      tileFolder: path.join(saveFolder, "tiles"),
    };
  }

  private getLocalizedTitle(value: any, lang: string, fallback: string): string {
    if (typeof value === 'string' && value.trim()) return value;
    if (value && typeof value === 'object') {
      return value[lang] || value.ja || value.en || Object.values(value as Record<string, string>)[0] || fallback;
    }
    return fallback;
  }

  private async getMapTile(mapID: string): Promise<string | null> {
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

  // アプリの代表ビジュアル: アイコン → スプラッシュ → startFromがMaplat地図なら0/0/0タイル → null(NO IMAGE)
  private async resolveAppImage(doc: any): Promise<string | null> {
    const iconSource = doc.manifestSettings?.iconSource || doc.httpSettings?.iconSource;
    if (typeof iconSource === 'string' && iconSource.trim()) {
      const url = AppAssetService.fileUrlFor(iconSource);
      if (url) return url;
    }
    const splash = doc.appSettings?.splash || doc.splash;
    if (typeof splash === 'string' && splash.trim()) {
      const url = AppAssetService.fileUrlFor(`img/${splash}`);
      if (url) return url;
    }
    const sources: AppSource[] = (Array.isArray(doc.sources) ? doc.sources : []).map((raw: any) => normalizeAppSource(raw));
    const startFromID = doc.startFrom || doc.start_from || sources.find((source) => source.startFrom)?.mapID;
    const startSource = sources.find((source) => source.mapID === startFromID);
    if (startSource?.sourceType === 'maplat') {
      return await this.getMapTile(startSource.mapID);
    }
    return null;
  }

  async requestApps(query: string = '', page: number = 1, pageSize: number = 20): Promise<AppListResult> {
    const rawResult = await SearchDataService.listApps(query, page, pageSize);
    const docs = await Promise.all(rawResult.docs.map(async (doc: any) => {
      const appID = doc._id || doc.appID;
      const lang = doc.lang || 'ja';
      return {
        appID,
        title: this.getLocalizedTitle(doc.title || doc.appName, lang, appID),
        description: this.getLocalizedTitle(doc.description, lang, ''),
        image: await this.resolveAppImage(doc),
      };
    }));
    return { ...rawResult, docs };
  }

  // 互換ラッパー経由: Phase1 Task6 で呼び出し側を uid 化した後に整理 (plan 2026-07-08)
  async getApp(appID: string): Promise<any | null> {
    return SqliteDataService.findAppBySlug(appID);
  }

  async saveApp(appID: string, document: any): Promise<'Success' | 'Exist' | 'Error'> {
    const current = await SqliteDataService.findAppBySlug(appID);
    const originalAppID = document?.originalAppID;
    if (current && originalAppID !== appID) {
      return 'Exist';
    }
    // slugはグローバル一意(ADR-0007): 他種アセット(地図/ベースマップ)が保持している場合も拒否する
    if (!current && !(await SqliteDataService.isSlugAvailable(appID))) {
      return 'Exist';
    }
    if (originalAppID && originalAppID !== appID) {
      const original = await SqliteDataService.findAppBySlug(originalAppID);
      if (original) {
        // 改名: uidを維持したままslugを付け替える(旧実装のdelete+insertを置換)
        await SqliteDataService.upsertApp(original.uid, appID, document);
        return 'Success';
      }
    }
    await SqliteDataService.upsertAppBySlug(appID, document);
    return 'Success';
  }

  async deleteApp(appID: string): Promise<void> {
    await SqliteDataService.deleteAppBySlug(appID);
  }

  async isAppIdAvailable(appID: string): Promise<boolean> {
    return SqliteDataService.isAppIdAvailable(appID);
  }
}

export default new AppDataService();
