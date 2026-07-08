import fs from 'fs-extra';
import path from 'path';
import SettingsService from './SettingsService';
import SqliteDataService from './SqliteDataService';
import SearchDataService, { type MapListResult } from './SearchDataService';

class MapDataService {
  private get folders() {
    const saveFolder = SettingsService.get('saveFolder');
    return {
      saveFolder,
      tileFolder: path.join(saveFolder, "tiles"),
      originalFolder: path.join(saveFolder, "originals"),
      uiThumbnailFolder: path.join(saveFolder, "tmbs"),
    };
  }

  async requestMaps(query: string = '', page: number = 1, pageSize: number = 20): Promise<MapListResult> {
    const rawResult = await SearchDataService.listMaps(query, page, pageSize);
    const docs = await Promise.all(rawResult.docs.map(async (doc: any) => {
        const mapID = doc._id || doc.mapID;
        // 内部ファイル(tiles/tmbs)はuidキー (ADR-0007)。uid欠落時は旧slugパスへフォールバック
        const fileKey = doc.uid || mapID;
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
            uid: doc.uid,
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
        // 正式なサムネイルはデータフォルダのtmbs/{uid}.jpg。無い場合のみズーム0タイルへフォールバック
        // 同期I/Oはイベントループを直列にブロックするため非同期で確認する(OneDrive等の遅いストレージ対策)
        const uiThumbnail = path.join(uiThumbnailFolder, `${fileKey}.jpg`);
        if (await fs.pathExists(uiThumbnail)) {
            res.image = `file://${uiThumbnail.split(path.sep).join('/')}`;
            return res;
        }
        const thumbFolder = path.join(tileFolder, fileKey, "0", "0");

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

  // uid正準の削除 (ADR-0007)。旧slugリンク経由の呼び出しに備えて slug フォールバックを残す
  // (Task 6/7 で app/basemap 経路が uid 化された後に撤去可)
  async deleteMap(uidOrMapID: string): Promise<void> {
    const doc =
      (await SqliteDataService.findMap(uidOrMapID)) ??
      (await SqliteDataService.findMapBySlug(uidOrMapID));
    const fileKey = doc?.uid || uidOrMapID;
    const slug = doc?.slug || uidOrMapID;
    if (doc) await SqliteDataService.deleteMap(doc.uid);
    const { tileFolder, uiThumbnailFolder, originalFolder } = this.folders;

    const tileDir = path.join(tileFolder, fileKey);
    if (fs.existsSync(tileDir)) {
      await fs.remove(tileDir);
    }

    const thumbFile = path.join(uiThumbnailFolder, `${fileKey}.jpg`);
    if (fs.existsSync(thumbFile)) {
      await fs.remove(thumbFile);
    }

    // 原本(originals)はslugキーのファイル名 (ADR-0007)
    if (fs.existsSync(originalFolder)) {
      const files = await fs.readdir(originalFolder);
      for (const file of files) {
        if (new RegExp(`^${slug}\\.`).test(file)) {
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
