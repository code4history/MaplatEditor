import fs from 'fs-extra';
import path from 'path';
import Datastore from '@seald-io/nedb';
import SettingsService from './SettingsService';

// 旧実装 nedb_accessor.js checkLocaleAttr 相当:
// 空白区切りの全単語が attr（文字列 or 多言語オブジェクト）にマッチするか確認
function checkLocaleAttr(attr: any, condition: string): boolean {
  if (!attr) return false;
  const conds = condition.trim().split(/\s+/);
  if (typeof attr === 'string') {
    return conds.every(cond => new RegExp(cond, 'i').test(attr));
  }
  // 多言語オブジェクト: 各単語について、いずれかの言語でマッチすれば OK
  return conds.every(cond =>
    Object.values(attr as Record<string, string>).some(v => new RegExp(cond, 'i').test(v))
  );
}

class MapDataService {
  private db: Datastore | null = null;

  private get folders() {
    const saveFolder = SettingsService.get('saveFolder');
    return {
      saveFolder,
      tileFolder: path.join(saveFolder, "tiles"),
      originalFolder: path.join(saveFolder, "originals"),
      uiThumbnailFolder: path.join(saveFolder, "tmbs"),
      dbFile: path.join(saveFolder, "nedb.db")
    };
  }

  async getDBInstance(): Promise<Datastore> {
    return this.getDB();
  }

  private async getDB(): Promise<Datastore> {
    if (this.db) return this.db;
    const { dbFile } = this.folders;
    this.db = new Datastore({ filename: dbFile, autoload: true });
    return this.db;
  }

  async requestMaps(query: string = '', page: number = 1, pageSize: number = 20): Promise<{docs: any[], prev: boolean, next: boolean, pageUpdate?: number}> {
    const db = await this.getDB();

    // 旧実装 nedb_accessor.js に準拠:
    // title・officialTitle・description の3フィールドを空白区切り AND 検索
    // 文字列・多言語オブジェクトの両方に対応
    const where: any = {};
    if (query && query.trim()) {
      const condition = query;
      where['$where'] = function(this: any) {
        return ['title', 'officialTitle', 'description'].some(attr =>
          checkLocaleAttr(this[attr], condition)
        );
      };
    }

    let currentPage = page;
    let pageUpdate: number | undefined;
    let rawDocs: any[] = [];
    let prev: boolean;
    let next: boolean;

    // 旧実装に準拠: 空ページなら自動的に前ページに巻き戻す
    while (true) {
      const skip = (currentPage - 1) * pageSize;
      console.log(`[MapDataService] Requesting maps: query='${query}', page=${currentPage}, skip=${skip}`);

      // 旧実装に準拠: limit+1 取得して pop する方式で次ページ有無を判定
      const fetched = await new Promise<any[]>((resolve, reject) => {
        db.find(where).sort({ _id: 1 }).skip(skip).limit(pageSize + 1).exec((err: any, documents: any[]) => {
          if (err) reject(err);
          else resolve(documents);
        });
      });

      next = fetched.length > pageSize;
      if (next) fetched.pop();
      prev = currentPage > 1;

      if (fetched.length === 0 && currentPage > 1) {
        currentPage--;
        pageUpdate = currentPage;
      } else {
        rawDocs = fetched;
        break;
      }
    }

    const docs = await Promise.all(rawDocs.map(async (doc: any) => {
        const mapID = doc._id || doc.mapID;
        let title = doc.title;
        if (typeof title === 'object' && title !== null) {
            // 旧実装に準拠: doc.lang を優先し、なければ 'ja' にフォールバック
            const lang = doc.lang || 'ja';
            title = title[lang] || Object.values(title as Record<string, string>)[0];
        }

        const width = doc.width || (doc.compiled && doc.compiled.wh && doc.compiled.wh[0]);
        const height = doc.height || (doc.compiled && doc.compiled.wh && doc.compiled.wh[1]);

        const res: any = {
            mapID,
            title: title || mapID,
            width,
            height,
            image: null
        };

        // 旧実装 backend/src/maplist.js に準拠: アスペクト比を保ちつつ190x190以内に収める
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

        const { tileFolder } = this.folders;
        const thumbFolder = path.join(tileFolder, mapID, "0", "0");

        if (fs.existsSync(thumbFolder)) {
            try {
                const files = await fs.readdir(thumbFolder);
                const tileFile = files.find(f => /^0\.(jpg|jpeg|png)$/.test(f));
                if (tileFile) {
                    const tilePath = path.join(thumbFolder, tileFile);
                    res.image = `file://${tilePath.split(path.sep).join('/')}`;
                }
            } catch (e) {
                console.error(`[MapDataService] ${mapID} のサムネイル読み込みエラー`, e);
            }
        }
        return res;
    }));

    const result: {docs: any[], prev: boolean, next: boolean, pageUpdate?: number} = { docs, prev: prev!, next };
    if (pageUpdate !== undefined) result.pageUpdate = pageUpdate;
    return result;
  }

  // 旧実装 nedb_accessor.js searchExtent に準拠:
  // メルカトル extent と重なる地図の mapID 一覧を返す
  async searchExtent(extent: number[]): Promise<string[]> {
    const db = await this.getDB();
    const where: any = {};
    where['$where'] = function(this: any) {
      if (!this.compiled) return false;
      const pts = this.compiled.vertices_points;
      if (!pts || pts.length === 0) return false;
      const ext: number[] = pts.reduce((ret: number[], vertex: any) => {
        const merc = vertex[1];
        if (ret.length === 0) return [merc[0], merc[1], merc[0], merc[1]];
        return [Math.min(ret[0], merc[0]), Math.min(ret[1], merc[1]),
                Math.max(ret[2], merc[0]), Math.max(ret[3], merc[1])];
      }, []);
      return extent[0] <= ext[2] && ext[0] <= extent[2] &&
             extent[1] <= ext[3] && ext[1] <= extent[3];
    };
    const docs = await new Promise<any[]>((resolve, reject) => {
      db.find(where).sort({ _id: 1 }).exec((err: any, documents: any[]) => {
        if (err) reject(err); else resolve(documents);
      });
    });
    return docs.map((d: any) => d._id);
  }

  async deleteMap(mapID: string): Promise<void> {
    const db = await this.getDB();
    const { tileFolder, uiThumbnailFolder, originalFolder } = this.folders;

    await db.removeAsync({ _id: mapID }, {});

    // タイルフォルダ削除
    const tileDir = path.join(tileFolder, mapID);
    if (fs.existsSync(tileDir)) {
      await fs.remove(tileDir);
    }

    // サムネイル削除
    const thumbFile = path.join(uiThumbnailFolder, `${mapID}.jpg`);
    if (fs.existsSync(thumbFile)) {
      await fs.remove(thumbFile);
    }

    // オリジナル画像ファイル（mapID.*）を削除
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
      // 旧実装に準拠: リサイズせずレベル0タイル(256x256)をそのままコピー
      if (!fs.existsSync(path.dirname(to))) {
          await fs.ensureDir(path.dirname(to));
      }
      await fs.copy(from, to, { overwrite: true });
  }

  async switchDataFolder() {
      // 既存DBコネクションをクリア
      this.db = null;

      const { tileFolder, originalFolder, uiThumbnailFolder } = this.folders;

      // 必要なフォルダを全て作成
      try {
          await fs.ensureDir(tileFolder);
          await fs.ensureDir(originalFolder);
          await fs.ensureDir(uiThumbnailFolder);
          console.log(`[MapDataService] Data folder switched and initialized: ${SettingsService.get('saveFolder')}`);
      } catch (e) {
          console.error("[MapDataService] Failed to initialize new data folders", e);
      }
  }
}

export default new MapDataService();
