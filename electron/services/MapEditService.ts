import path from 'path';
import fs from 'fs-extra';
// @ts-ignore
import fileUrl from 'file-url';
import MapDataService from './MapDataService';
import SqliteDataService from './SqliteDataService';
import * as storeHandler from '../utils/store_handler';
import SettingsService from './SettingsService';
// @ts-ignore
import Tin from '@maplat/tin';

const TIN_V2_OPTIONS = { useV2Algorithm: true };

class MapEditService {
    async request(mapID: string) {
        const db = await MapDataService.getDBInstance();
        const json = await db.findOneAsync({ _id: mapID });

        if (!json) throw new Error(`Map with ID ${mapID} not found`);

        const saveFolder = SettingsService.get('saveFolder');
        const tileFolder = path.join(saveFolder, "tiles");
        // 内部タイルはuidパス: tiles/{uid}/0/0 (ADR-0007)
        const thumbFolder = path.join(tileFolder, json.uid, "0", "0");

        const res = await this.normalizeRequestData(json, thumbFolder);

        // MapEdit専用フィールドを追加
        res[0].mapID = mapID;
        res[0].uid = json.uid;
        res[0].status = 'Update';
        res[0].onlyOne = true; // DBに存在するので一意確認済み

        return res[0];
    }

    async requestPreviewSource(mapID: string) {
        const db = await MapDataService.getDBInstance();
        const json = await db.findOneAsync({ _id: mapID });

        if (!json) throw new Error(`Map with ID ${mapID} not found`);

        const previewJson = await this.ensurePreviewCompiled({ ...json });
        if (this.hasStrictError(previewJson)) {
            throw new Error('appedit.preview.strict_error');
        }

        const saveFolder = SettingsService.get('saveFolder');
        const tileFolder = path.join(saveFolder, "tiles");
        const thumbFolder = path.join(tileFolder, json.uid, "0", "0");
        const [store] = await this.normalizeRequestData(previewJson, thumbFolder);

        return {
            ...previewJson,
            ...store,
            mapID,
            uid: json.uid,
            maptype: 'maplat',
            compiled: previewJson.compiled,
            sub_maps: previewJson.sub_maps ?? store.sub_maps ?? [],
            width: store.width ?? previewJson.width ?? previewJson.compiled?.wh?.[0],
            height: store.height ?? previewJson.height ?? previewJson.compiled?.wh?.[1],
            url: store.url_ ?? previewJson.url,
        };
    }

    private async ensurePreviewCompiled(json: any) {
        if (!json.compiled) {
            json.compiled = await this.createCompiledFromGcps(
                json.gcps,
                json.edges,
                [json.width, json.height],
                null,
                json.strictMode,
                json.vertexMode,
            );
        }

        if (Array.isArray(json.sub_maps)) {
            json.sub_maps = await Promise.all(json.sub_maps.map(async (subMap: any) => {
                if (subMap.compiled) return subMap;
                return {
                    ...subMap,
                    compiled: await this.createCompiledFromGcps(
                        subMap.gcps,
                        subMap.edges,
                        null,
                        subMap.bounds,
                        json.strictMode,
                        json.vertexMode,
                    ),
                };
            }));
        }

        return json;
    }

    private async createCompiledFromGcps(gcps: any[] = [], edges: any[] = [], wh: any, bounds: any, strict: any, vertex: any) {
        if (gcps.length < 3) throw new Error('appedit.preview.too_less_gcps');
        const tin = new Tin(TIN_V2_OPTIONS);
        if (wh?.[0] && wh?.[1]) {
            tin.setWh(wh);
        } else if (bounds) {
            tin.setBounds(bounds);
        } else {
            throw new Error('appedit.preview.missing_bounds');
        }
        tin.setStrictMode(strict || 'strict');
        tin.setVertexMode(vertex || 'plain');
        tin.setPoints(gcps);
        tin.setEdges(edges || []);
        await tin.updateTinAsync();
        const compiled = tin.getCompiled();
        if (this.isStrictErrorCompiled(compiled)) {
            throw new Error('appedit.preview.strict_error');
        }
        return compiled;
    }

    private hasStrictError(json: any) {
        if (this.isStrictErrorCompiled(json.compiled)) return true;
        return Array.isArray(json.sub_maps) && json.sub_maps.some((subMap: any) => this.isStrictErrorCompiled(subMap.compiled));
    }

    private isStrictErrorCompiled(compiled: any) {
        return compiled?.strict_status === 'strict_error' || Boolean(compiled?.kinks_points);
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
        const mapID = mapObject.mapID as string; // レンダラ互換: slug (ADR-0007)
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

        const regex = new RegExp(`^${tmpUrl}`);
        const tmpCheck = url_ && url_.match(regex);

        // フォルダの確保
        await fs.ensureDir(tileFolder);
        await fs.ensureDir(originalFolder);
        await fs.ensureDir(thumbFolder);

        try {
            // --- DB操作: uid解決とslug/document書込 (ADR-0007) ---
            // 改名(Change)はuid維持のslug付替えになり、tiles/tmbs(uidキー)の移動が不要になる。
            // 複製(Copy)は新uidを採番し、旧uidのファイルをコピーする
            let uid: string;
            let copySourceUid: string | null = null;
            let copySourceSlug: string | null = null;
            let renamedFromSlug: string | null = null;
            if (status === 'Update') {
                const saved = await SqliteDataService.upsertMapBySlug(mapID, compiled);
                uid = saved.uid;
            } else {
                // New / Change:旧ID / Copy:旧ID — 新しくslugを名乗るので空きを確認
                // (slugはグローバル一意: 地図/アプリ/ベースマップ横断で判定される)
                if (!(await SqliteDataService.isSlugAvailable(mapID))) {
                    throw new Error('Exist');
                }
                const changeOrCopyMatch = status.match(/^(Change|Copy):(.+)$/);
                const old = changeOrCopyMatch
                    ? await SqliteDataService.findMapBySlug(changeOrCopyMatch[2])
                    : null;
                if (changeOrCopyMatch && old) {
                    if (changeOrCopyMatch[1] === 'Copy') {
                        const created = await SqliteDataService.createMap(mapID, compiled);
                        uid = created.uid;
                        copySourceUid = old.uid;
                        copySourceSlug = old.slug;
                    } else {
                        await SqliteDataService.upsertMap(old.uid, mapID, compiled);
                        uid = old.uid;
                        renamedFromSlug = old.slug;
                    }
                } else {
                    const created = await SqliteDataService.createMap(mapID, compiled);
                    uid = created.uid;
                }
            }

            const newTile = path.join(tileFolder, uid);
            const newOriginal = path.join(originalFolder, `${mapID}.${imageExtension}`);
            const newThumbnail = path.join(thumbFolder, `${uid}.jpg`);

            // --- ファイル操作 ---
            if (tmpCheck) {
                // tmpフォルダからの永続フォルダへの移動 (uidパス)
                try { await fs.remove(newTile); } catch { /* noop */ }
                await fs.move(tmpTileFolder, newTile);
                const tmpOriginal = path.join(newTile, `original.${imageExtension}`);
                try { await fs.remove(newOriginal); } catch { /* noop */ }
                if (await fs.pathExists(tmpOriginal)) {
                    await fs.move(tmpOriginal, newOriginal);
                }
                const tmpThumb = path.join(newTile, 'thumbnail.jpg');
                try { await fs.remove(newThumbnail); } catch { /* noop */ }
                if (await fs.pathExists(tmpThumb)) {
                    await fs.move(tmpThumb, newThumbnail);
                }
                // 改名時: 原本(slugキー)の旧ファイルを掃除(新ファイルはtmpから移動済み)
                if (renamedFromSlug && renamedFromSlug !== mapID) {
                    try { await fs.remove(path.join(originalFolder, `${renamedFromSlug}.${imageExtension}`)); } catch { /* noop */ }
                }
            } else if (copySourceUid) {
                // 複製: 旧uidのtiles/tmbsと旧slugの原本を新キーへコピー
                const oldTile = path.join(tileFolder, copySourceUid);
                const oldOriginal = path.join(originalFolder, `${copySourceSlug}.${imageExtension}`);
                const oldThumbnail = path.join(thumbFolder, `${copySourceUid}.jpg`);
                if (await fs.pathExists(oldTile)) await fs.copy(oldTile, newTile);
                if (await fs.pathExists(oldOriginal)) await fs.copy(oldOriginal, newOriginal);
                if (await fs.pathExists(oldThumbnail)) await fs.copy(oldThumbnail, newThumbnail);
            } else if (renamedFromSlug && renamedFromSlug !== mapID) {
                // 改名: tiles/tmbsはuidキーのため移動不要。原本(slugキー)のみ改名
                const oldOriginal = path.join(originalFolder, `${renamedFromSlug}.${imageExtension}`);
                if (await fs.pathExists(oldOriginal)) {
                    try { await fs.remove(newOriginal); } catch { /* noop */ }
                    await fs.move(oldOriginal, newOriginal);
                }
            }
            return 'Success';
        } catch (e: any) {
            if (e && e.message === 'Exist') return 'Exist';
            console.error('[MapEditService.save] Error:', e);
            return 'Error';
        }
    }
}

export default new MapEditService();
