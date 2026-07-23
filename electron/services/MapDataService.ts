import fs from 'fs-extra';
import path from 'path';
import SettingsService from './SettingsService';
import SqliteDataService from './SqliteDataService';
import SearchDataService, { type MapListResult } from './SearchDataService';
import { resolveMapListImage } from './resourceImageResolver';
import MapMutationQueue from './MapMutationQueue';

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

        // M12-T1-HOTFIX-1: 画像解決は共有 resolver（resourceImageResolver.resolveMapListImage）へ
        // 一元化（tmbs 優先 → tiles fallback の順序は従来どおり。search:maps 経路と同一実装）
        res.image = await resolveMapListImage({ uid: doc.uid, _id: mapID, mapID });
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

  // uid正準の削除 (ADR-0007)。参照解決は findMapByRef に一本化
  // (UUID形状はuid優先、旧slugリンク経由の呼び出しにはslugフォールバックで応える)
  // M13-T2 (§5.6): 他の save/rename/clone/migration と直列化するため per-map queue でラップ
  // する。中身のロジックは無変更 (trash lifecycle 化は T4)。
  // 実装レビュー v1 Minor 1: uidOrMapID が空文字列等で fileKey が falsy な場合は、意図的に
  // no-op で早期 return する(設計 §5.6 疑似コードの「既存どおりの処理を queue なしで実行」
  // という記述からの意図的な変更)。fileKey が空だと 108 行の正規表現が `^${''}\.` すなわち
  // `^\.` になり、originals 配下の dotfile (.DS_Store 等) まで削除対象に含まれてしまう
  // (旧実装に存在した誤削除リスク)。この経路は uidOrMapID が空文字列の場合のみ到達し実運用上
  // ほぼ到達不能だが、到達した場合の安全側を優先し no-op を維持する。
  async deleteMap(uidOrMapID: string): Promise<void> {
    const doc = await SqliteDataService.findMapByRef(uidOrMapID);
    const fileKey = doc?.uid || uidOrMapID;
    if (!fileKey) return; // 意図的な no-op 早期 return (上記コメント参照)
    const run = async (): Promise<void> => {
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
    };
    return MapMutationQueue.run(fileKey, 'map-delete', run);
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
