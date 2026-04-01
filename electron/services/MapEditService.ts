import path from 'path';
import fs from 'fs-extra';
// @ts-ignore
import fileUrl from 'file-url';
import MapDataService from './MapDataService';
import * as storeHandler from '../utils/store_handler';
import SettingsService from './SettingsService';

class MapEditService {
    async request(mapID: string) {
        const db = await MapDataService.getDBInstance();
        const json = await db.findOneAsync({ _id: mapID });

        if (!json) throw new Error(`Map with ID ${mapID} not found`);

        const saveFolder = SettingsService.get('saveFolder');
        const tileFolder = path.join(saveFolder, "tiles");
        // 旧実装のパス構造: tiles/mapID/0/0
        const thumbFolder = path.join(tileFolder, mapID, "0", "0");

        const res = await this.normalizeRequestData(json, thumbFolder);

        // MapEdit専用フィールドを追加
        res[0].mapID = mapID;
        res[0].status = 'Update';
        res[0].onlyOne = true; // DBに存在するので一意確認済み

        return res[0];
    }

    private async normalizeRequestData(json: any, thumbFolder: string) {
        let url_: string | undefined;
        // 地図画像サイズが確定しているか確認
        const whReady = (json.width && json.height) || (json.compiled && json.compiled.wh);

        if (!whReady) {
            // サイズ未確定時はそのまま返す（旧実装に準拠）
            return [json];
        }

        if (json.url) {
            url_ = json.url;
        } else {
             try {
                if (await fs.pathExists(thumbFolder)) {
                    const thumbs = await fs.readdir(thumbFolder);
                    const tileFile = thumbs.find(f => /^0\.(jpg|jpeg|png)$/.test(f));
                    if (tileFile) {
                        // タイルURLパターンを構築
                        // file-url は file:///... 形式で返す
                        // .../0/0/0.ext を .../{z}/{x}/{y}.ext に変換する
                        let thumbURL = fileUrl(path.join(thumbFolder, tileFile));
                        const pattern = /\/0\/0\/0\.(jpg|jpeg|png)$/;
                        url_ = thumbURL.replace(pattern, '/{z}/{x}/{y}.$1');
                    }
                }
             } catch (e) {
                 console.error("[MapEditService] タイル検索エラー:", e);
             }
        }

        const [store, tins] = await storeHandler.store2HistMap(json, true);
        (store as any).url_ = url_;

        const res = [store, tins];
        return res;
    }
    /**
     * 旧実装 mapedit.save() 相当
     * mapObject: フロントエンドから渡される地図データ（status を含む）
     * tins: 各レイヤーのコンパイル済みTINデータの配列（文字列またはオブジェクト）
     *
     * 返り値: 'Success' | 'Exist' | 'Error' 等の文字列
     */
    async save(mapObject: any, tins: any[]): Promise<string> {
        const status = mapObject.status as string;
        const mapID = mapObject.mapID as string;
        const url_ = mapObject.url_ as string | undefined;
        const imageExtension: string = mapObject.imageExtension || mapObject.imageExtention || 'jpg';

        if (tins.length === 0) tins = ['tooLessGcps'];

        // histMap2Store でシリアライズ（旧実装: storeHandler.histMap2Store）
        const compiled = await storeHandler.histMap2Store(mapObject, tins);

        const saveFolder = SettingsService.get('saveFolder') as string;
        const tileFolder = path.join(saveFolder, 'tiles');
        const originalFolder = path.join(saveFolder, 'originals');
        const thumbFolder = path.join(saveFolder, 'tmbs');

        const tmpFolder = SettingsService.get('tmpFolder') as string;
        const tmpTileFolder = path.join(tmpFolder, 'tiles');
        const tmpUrl = fileUrl(tmpTileFolder);

        const newTile = path.join(tileFolder, mapID);
        const newOriginal = path.join(originalFolder, `${mapID}.${imageExtension}`);
        const newThumbnail = path.join(thumbFolder, `${mapID}.jpg`);

        const regex = new RegExp(`^${tmpUrl}`);
        const tmpCheck = url_ && url_.match(regex);

        // フォルダの確保
        await fs.ensureDir(tileFolder);
        await fs.ensureDir(originalFolder);
        await fs.ensureDir(thumbFolder);

        const db = await MapDataService.getDBInstance();

        try {
            await Promise.all([
                // --- DBとファイル変名/コピー操作 ---
                (async () => {
                    if (status !== 'Update') {
                        // 重複チェック
                        const existCheck = await db.findOneAsync({ _id: mapID });
                        if (existCheck) {
                            throw new Error('Exist');
                        }

                        const changeOrCopyMatch = status.match(/^(Change|Copy):(.+)$/);
                        if (changeOrCopyMatch) {
                            const isCopy = changeOrCopyMatch[1] === 'Copy';
                            const oldMapID = changeOrCopyMatch[2];
                            const oldTile = path.join(tileFolder, oldMapID);
                            const oldOriginal = path.join(originalFolder, `${oldMapID}.${imageExtension}`);
                            const oldThumbnail = path.join(thumbFolder, `${oldMapID}.jpg`);

                            await db.updateAsync({ _id: mapID }, { $set: compiled }, { upsert: true });
                            if (!isCopy) {
                                await db.removeAsync({ _id: oldMapID }, {});
                            }

                            if (tmpCheck) {
                                // tmpからのアップロード時: 旧ファイルだけ消す（新ファイルはtmpCheck側で移動）
                                if (!isCopy) {
                                    try { await fs.remove(oldTile); } catch { /* noop */ }
                                    try { await fs.remove(oldOriginal); } catch { /* noop */ }
                                    try { await fs.remove(oldThumbnail); } catch { /* noop */ }
                                }
                            } else {
                                // 既存フォルダからのMove/Copy
                                const fileOp = isCopy ? fs.copy.bind(fs) : fs.move.bind(fs);
                                if (await fs.pathExists(oldTile)) {
                                    await fileOp(oldTile, newTile);
                                }
                                if (await fs.pathExists(oldOriginal)) {
                                    await fileOp(oldOriginal, newOriginal);
                                }
                                if (await fs.pathExists(oldThumbnail)) {
                                    await fileOp(oldThumbnail, newThumbnail);
                                }
                            }
                        } else {
                            // 'New' status
                            await db.updateAsync({ _id: mapID }, { $set: compiled }, { upsert: true });
                        }
                    } else {
                        // 'Update' status
                        await db.updateAsync({ _id: mapID }, { $set: compiled }, { upsert: true });
                    }
                })(),
                // --- tmpフォルダからの永続フォルダへの移動 ---
                (async () => {
                    if (tmpCheck) {
                        // 旧実装: tmpFolder(=tiles) → newTile への move
                        // 1. 既存 newTile を削除
                        try { await fs.remove(newTile); } catch { /* noop */ }
                        // 2. tmpTileFolder → newTile に移動
                        await fs.move(tmpTileFolder, newTile);
                        // 3. original の移動
                        const tmpOriginal = path.join(newTile, `original.${imageExtension}`);
                        try { await fs.remove(newOriginal); } catch { /* noop */ }
                        if (await fs.pathExists(tmpOriginal)) {
                            await fs.move(tmpOriginal, newOriginal);
                        }
                        // 4. thumbnail の移動
                        const tmpThumb = path.join(newTile, 'thumbnail.jpg');
                        try { await fs.remove(newThumbnail); } catch { /* noop */ }
                        if (await fs.pathExists(tmpThumb)) {
                            await fs.move(tmpThumb, newThumbnail);
                        }
                    }
                })()
            ]);
            return 'Success';
        } catch (e: any) {
            if (e && e.message === 'Exist') return 'Exist';
            console.error('[MapEditService.save] Error:', e);
            return 'Error';
        }
    }
}

export default new MapEditService();
