import fs from 'fs-extra';
import path from 'path';
import SettingsService from './SettingsService';
import SqliteDataService from './SqliteDataService';
import SearchDataService, { type MapListResult } from './SearchDataService';
import { resolveMapListImage } from './resourceImageResolver';
import { deleteMapWithTrash } from './MapDeleteTrashService';
import { hasStrictError } from './MapEditService';
import AssetDraftService from './AssetDraftService';

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

        const previewDisabled = hasStrictError(doc);
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

  async searchExtent(extent: number[]): Promise<string[]> {
    return SearchDataService.searchExtent(extent);
  }

  // uid正準の削除 (ADR-0007)。参照解決は findMapByRef に一本化
  // (UUID形状はuid優先、旧slugリンク経由の呼び出しにはslugフォールバックで応える)
  // M13-T4 (§5.3): 中身を MapDeleteTrashService.deleteMapWithTrash() へ委譲する。
  // シグネチャは不変。trash lifecycle (canonical/legacy を trash へ move → DB delete →
  // 失敗時のみ live へロールバック → tiles/tmbs/tmbs_512 削除) は同サービスの責務。
  async deleteMap(uidOrMapID: string): Promise<void> {
    return deleteMapWithTrash(uidOrMapID);
  }

  async generateThumbnail(from: string, to: string) {
      if (!fs.existsSync(path.dirname(to))) {
          await fs.ensureDir(path.dirname(to));
      }
      await fs.copy(from, to, { overwrite: true });
  }

  // M12-T32 §4.3: previousSaveFolder（切替前の旧 saveFolder）を optional 引数で受ける。
  // 呼び出し側（ipc/settings.ts）は SettingsService.set 実行前に旧値を捕捉して渡す。
  // previousSaveFolder が未指定（既存の無引数呼び出し: m7/m8-t3 smoke）の場合は消去しない
  // （保守的既定・シグネチャ互換）。消去は try 内 getDb() 成功後のみ実行し、切替失敗時
  // （catch で swallow される失敗を含む）には消去しない。同値ガードは path.resolve 正規化で比較。
  async switchDataFolder(previousSaveFolder?: string) {
      await SearchDataService.reset();
      await SqliteDataService.reset();

      const { tileFolder, originalFolder, uiThumbnailFolder } = this.folders;

      try {
          await fs.ensureDir(tileFolder);
          await fs.ensureDir(originalFolder);
          await fs.ensureDir(uiThumbnailFolder);
          await SqliteDataService.getDb();
          // M12-T32 §4.3: 切替成功後・同値ガード通過時のみ全ドラフト消去
          // （保存済みデータには触れない。per-draft 経路で staging も回収）
          if (previousSaveFolder !== undefined) {
              const newSaveFolder = SettingsService.get('saveFolder');
              if (path.resolve(previousSaveFolder) !== path.resolve(newSaveFolder)) {
                  AssetDraftService.wipeAllDrafts();
              }
          }
          console.log(`[MapDataService] Data folder switched and initialized: ${SettingsService.get('saveFolder')}`);
      } catch (e) {
          console.error("[MapDataService] Failed to initialize new data folders", e);
      }
  }
}

export default new MapDataService();
