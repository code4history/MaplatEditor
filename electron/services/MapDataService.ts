import fs from 'fs-extra';
import path from 'path';
import SettingsService from './SettingsService';
import SqliteDataService from './SqliteDataService';
import SearchDataService, { type MapListResult } from './SearchDataService';

type CompatStore = {
  findOneAsync(query: { _id: string }): Promise<any | null>;
  updateAsync(query: { _id: string }, update: { $set?: any } | any, options?: { upsert?: boolean }): Promise<void>;
  removeAsync(query: { _id: string }, options?: any): Promise<void>;
};

class MapDataService {
  private compatStore: CompatStore | null = null;

  private get folders() {
    const saveFolder = SettingsService.get('saveFolder');
    return {
      saveFolder,
      tileFolder: path.join(saveFolder, "tiles"),
      originalFolder: path.join(saveFolder, "originals"),
      uiThumbnailFolder: path.join(saveFolder, "tmbs"),
    };
  }

  // 互換ラッパー: Phase1 Task5-7 で呼び出し側を uid 化した後に撤去 (plan 2026-07-08)。
  // _id はレンダラ互換のslug。内部の正本キーはuid(SqliteDataService側で解決される)
  async getDBInstance(): Promise<CompatStore> {
    if (this.compatStore) return this.compatStore;
    await SqliteDataService.getDb();
    this.compatStore = {
      findOneAsync: async (query) => SqliteDataService.findMapBySlug(query._id),
      updateAsync: async (query, update) => {
        const mapID = query._id;
        const document = update?.$set ? update.$set : update;
        await SqliteDataService.upsertMapBySlug(mapID, document);
      },
      removeAsync: async (query) => {
        await SqliteDataService.deleteMapBySlug(query._id);
      },
    };
    return this.compatStore;
  }

  async requestMaps(query: string = '', page: number = 1, pageSize: number = 20): Promise<MapListResult> {
    const rawResult = await SearchDataService.listMaps(query, page, pageSize);
    const docs = await Promise.all(rawResult.docs.map(async (doc: any) => {
        const mapID = doc._id || doc.mapID;
        let title = doc.title;
        if (typeof title === 'object' && title !== null) {
            const lang = doc.lang || 'ja';
            title = title[lang] || Object.values(title as Record<string, string>)[0];
        }

        const width = doc.width || (doc.compiled && doc.compiled.wh && doc.compiled.wh[0]);
        const height = doc.height || (doc.compiled && doc.compiled.wh && doc.compiled.wh[1]);

        const previewDisabled = this.isPreviewDisabled(doc);
        const res: any = {
            mapID,
            title: title || mapID,
            width,
            height,
            image: null,
            previewDisabled,
            previewDisabledReason: previewDisabled ? 'appedit.preview.strict_error' : undefined
        };

        if (res.width && res.height) {
            if (res.width > res.height) {
                res.height = Math.round(res.height * 190 / res.width);
                res.width = 190;
            } else {
                res.width = Math.round(res.width * 190 / res.height);
                res.height = 190;
            }
        } else {
            res.width = 190;
            res.height = 190;
        }

        const { tileFolder, uiThumbnailFolder } = this.folders;
        // 正式なサムネイルはデータフォルダのtmbs/{mapID}.jpg。無い場合のみズーム0タイルへフォールバック
        // 同期I/Oはイベントループを直列にブロックするため非同期で確認する(OneDrive等の遅いストレージ対策)
        const uiThumbnail = path.join(uiThumbnailFolder, `${mapID}.jpg`);
        if (await fs.pathExists(uiThumbnail)) {
            res.image = `file://${uiThumbnail.split(path.sep).join('/')}`;
            return res;
        }
        const thumbFolder = path.join(tileFolder, mapID, "0", "0");

        try {
            const files = await fs.readdir(thumbFolder);
            const tileFile = files.find(f => /^0\.(jpg|jpeg|png)$/.test(f));
            if (tileFile) {
                const tilePath = path.join(thumbFolder, tileFile);
                res.image = `file://${tilePath.split(path.sep).join('/')}`;
            }
        } catch (e: any) {
            if (e?.code !== 'ENOENT') {
                console.error(`[MapDataService] ${mapID} のサムネイル読み込みエラー`, e);
            }
        }
        return res;
    }));

    return { ...rawResult, docs };
  }

  private isPreviewDisabled(doc: any): boolean {
    if (this.isStrictErrorCompiled(doc.compiled)) return true;
    return Array.isArray(doc.sub_maps) && doc.sub_maps.some((subMap: any) => this.isStrictErrorCompiled(subMap.compiled));
  }

  private isStrictErrorCompiled(compiled: any): boolean {
    return compiled?.strict_status === 'strict_error' || Boolean(compiled?.kinks_points);
  }

  async searchExtent(extent: number[]): Promise<string[]> {
    return SearchDataService.searchExtent(extent);
  }

  async deleteMap(mapID: string): Promise<void> {
    await SqliteDataService.deleteMapBySlug(mapID);
    const { tileFolder, uiThumbnailFolder, originalFolder } = this.folders;

    const tileDir = path.join(tileFolder, mapID);
    if (fs.existsSync(tileDir)) {
      await fs.remove(tileDir);
    }

    const thumbFile = path.join(uiThumbnailFolder, `${mapID}.jpg`);
    if (fs.existsSync(thumbFile)) {
      await fs.remove(thumbFile);
    }

    if (fs.existsSync(originalFolder)) {
      const files = await fs.readdir(originalFolder);
      for (const file of files) {
        if (new RegExp(`^${mapID}\\.`).test(file)) {
          await fs.remove(path.join(originalFolder, file));
        }
      }
    }
  }

  async generateThumbnail(from: string, to: string) {
      if (!fs.existsSync(path.dirname(to))) {
          await fs.ensureDir(path.dirname(to));
      }
      await fs.copy(from, to, { overwrite: true });
  }

  async switchDataFolder() {
      this.compatStore = null;
      await SearchDataService.reset();
      await SqliteDataService.reset();

      const { tileFolder, originalFolder, uiThumbnailFolder } = this.folders;

      try {
          await fs.ensureDir(tileFolder);
          await fs.ensureDir(originalFolder);
          await fs.ensureDir(uiThumbnailFolder);
          await SqliteDataService.getDb();
          console.log(`[MapDataService] Data folder switched and initialized: ${SettingsService.get('saveFolder')}`);
      } catch (e) {
          console.error("[MapDataService] Failed to initialize new data folders", e);
      }
  }
}

export default new MapDataService();
