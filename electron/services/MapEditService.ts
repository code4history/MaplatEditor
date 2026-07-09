import path from 'path';
import fs from 'fs-extra';
// @ts-ignore
import fileUrl from 'file-url';
import SqliteDataService, { RevisionConflictError } from './SqliteDataService';
import type { MapSaveRequest, MapSaveResult } from '../adapters/StorageAdapter';
import * as storeHandler from '../utils/store_handler';
import SettingsService from './SettingsService';
// @ts-ignore
import Tin from '@maplat/tin';

const TIN_V2_OPTIONS = { useV2Algorithm: true };

class MapEditService {
    // uid正準の読み出し (ADR-0007)。旧保存形のslug参照への保険として
    // slugフォールバック付きの SqliteDataService.findMapByRef で解決する
    async request(uidOrMapID: string) {
        const json = await SqliteDataService.findMapByRef(uidOrMapID);

        if (!json) throw new Error(`Map with ID ${uidOrMapID} not found`);

        const saveFolder = SettingsService.get('saveFolder');
        const tileFolder = path.join(saveFolder, "tiles");
        // 内部タイルはuidパス: tiles/{uid}/0/0 (ADR-0007)
        const thumbFolder = path.join(tileFolder, json.uid, "0", "0");

        const res = await this.normalizeRequestData(json, thumbFolder);

        // MapEdit専用フィールドを追加 (mapID欄はslug編集欄になる)
        res[0].mapID = json.slug;
        res[0].uid = json.uid;
        res[0].revision = json.revision;
        res[0].status = 'Update';
        res[0].onlyOne = true; // DBに存在するので一意確認済み

        return res[0];
    }

    async requestPreviewSource(uidOrMapID: string) {
        const json = await SqliteDataService.findMapByRef(uidOrMapID);

        if (!json) throw new Error(`Map with ID ${uidOrMapID} not found`);

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
            mapID: json.slug,
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
     * 旧実装 mapedit.save() 相当 (ADR-0007: uid正準 + revision楽観ロック)
     * request:
     * - mapObject: フロントエンドから渡される地図データ (mapID = slug)
     * - tins: 各レイヤーのコンパイル済みTINデータの配列（文字列またはオブジェクト）
     * - uid: 既存地図の更新/改名時の正本キー。無指定なら新規作成
     * - slug: 保存するslug (省略時は mapObject.mapID)
     * - expectedRevision: 楽観ロック。不一致なら revision-conflict を返す
     * - copyFromUid: 複製元uid (新規作成 + 複製元ファイルのコピー)
     */
    async save(request: MapSaveRequest): Promise<MapSaveResult> {
        const { mapObject } = request;
        const tins = request.tins.length === 0 ? ['tooLessGcps'] : request.tins;
        const slug = (request.slug ?? mapObject.mapID) as string;
        // 互換フォールバック: 明示のuidが無い場合、複製でなければ読み出し時に付与された
        // mapObject.uid を既存地図の更新とみなす (旧 status ベース呼び出しの救済)
        const uid: string | undefined =
            request.uid ?? (request.copyFromUid ? undefined : mapObject.uid ?? undefined);
        const url_ = mapObject.url_ as string | undefined;
        const imageExtension: string = mapObject.imageExtension || mapObject.imageExtention || 'jpg';

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

        // --- DB操作: uid正準のslug/document書込 (ADR-0007) ---
        // 改名はuid維持のslug付替えになり、tiles/tmbs(uidキー)の移動が不要になる。
        // 複製(copyFromUid)は新uidを採番し、複製元uidのファイルをコピーする
        let savedUid: string;
        let savedRevision: number;
        let copySourceUid: string | null = null;
        let copySourceSlug: string | null = null;
        let renamedFromSlug: string | null = null;
        try {
            if (uid) {
                const existing = await SqliteDataService.findMap(uid);
                if (!existing) throw new Error(`Map with uid ${uid} not found`);
                if (existing.slug !== slug) {
                    // 改名先slugの空きを確認 (グローバル一意: 地図/アプリ/ベースマップ横断)
                    if (!(await SqliteDataService.isSlugAvailable(slug, uid))) {
                        throw new Error('Exist');
                    }
                    renamedFromSlug = existing.slug;
                } else if (!request.copyFromUid) {
                    // 再試行の救済: 前回の保存がDBコミット後のファイル操作で失敗した場合、
                    // DB上のslugは既に改名済みで、この呼び出しでは existing.slug === slug となり
                    // renamedFromSlug が立たない。レンダラが成功まで保持し続ける Change:{旧slug}
                    // を手掛かりに、旧slugが孤児(どの地図にも属さない)であれば
                    // 原本(originals)改名の残作業として引き継ぐ
                    const changeMatch = typeof mapObject.status === 'string'
                        ? mapObject.status.match(/^Change:(.+)$/)
                        : null;
                    const candidate = changeMatch?.[1];
                    if (candidate && candidate !== slug &&
                        !(await SqliteDataService.findMapBySlug(candidate))) {
                        renamedFromSlug = candidate;
                    }
                }
                const { revision } = await SqliteDataService.upsertMap(
                    uid, slug, compiled, request.expectedRevision ?? undefined
                );
                savedUid = uid;
                savedRevision = revision;
            } else {
                // 新規 / 複製 — 新しくslugを名乗るので空きを確認
                if (!(await SqliteDataService.isSlugAvailable(slug))) {
                    throw new Error('Exist');
                }
                if (request.copyFromUid) {
                    const source = await SqliteDataService.findMap(request.copyFromUid);
                    if (source) {
                        copySourceUid = source.uid;
                        copySourceSlug = source.slug;
                    }
                }
                const created = await SqliteDataService.createMap(slug, compiled);
                savedUid = created.uid;
                savedRevision = 1;
            }
        } catch (e: any) {
            if (e instanceof RevisionConflictError) {
                return { error: 'revision-conflict', current: e.current };
            }
            if (e && e.message === 'Exist') return { result: 'Exist' };
            console.error('[MapEditService.save] Error:', e);
            return { result: 'Error' };
        }

        const newTile = path.join(tileFolder, savedUid);
        const newOriginal = path.join(originalFolder, `${slug}.${imageExtension}`);
        const newThumbnail = path.join(thumbFolder, `${savedUid}.jpg`);

        // --- ファイル操作 (DBコミット後・ここでの失敗はDBを巻き戻さない) ---
        try {
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
                if (renamedFromSlug && renamedFromSlug !== slug) {
                    try { await fs.remove(path.join(originalFolder, `${renamedFromSlug}.${imageExtension}`)); } catch { /* noop */ }
                }
            } else if (copySourceUid) {
                // 複製: 複製元uidのtiles/tmbsと複製元slugの原本を新キーへコピー
                const oldTile = path.join(tileFolder, copySourceUid);
                const oldOriginal = path.join(originalFolder, `${copySourceSlug}.${imageExtension}`);
                const oldThumbnail = path.join(thumbFolder, `${copySourceUid}.jpg`);
                if (await fs.pathExists(oldTile)) await fs.copy(oldTile, newTile);
                if (await fs.pathExists(oldOriginal)) await fs.copy(oldOriginal, newOriginal);
                if (await fs.pathExists(oldThumbnail)) await fs.copy(oldThumbnail, newThumbnail);
            } else if (renamedFromSlug && renamedFromSlug !== slug) {
                // 改名: tiles/tmbsはuidキーのため移動不要。原本(slugキー)のみ改名。
                // 再試行でも安全なように「移動先が無く移動元がある」場合のみ移動する
                // (移動先が既にあれば改名は完了済みか新しい原本が置かれている)
                const oldOriginal = path.join(originalFolder, `${renamedFromSlug}.${imageExtension}`);
                if (!(await fs.pathExists(newOriginal)) && (await fs.pathExists(oldOriginal))) {
                    await fs.move(oldOriginal, newOriginal);
                }
            }
        } catch (e: any) {
            // DBは既にコミット済み: 確定したuid/slug/revisionを返してレンダラ側の
            // 編集状態を補正し、再試行が偽のrevision-conflictや'Exist'にならないようにする
            console.error('[MapEditService.save] post-commit file operation failed:', e);
            return { result: 'Error', uid: savedUid, slug, revision: savedRevision };
        }
        return { result: 'Success', uid: savedUid, slug, revision: savedRevision };
    }
}

export default new MapEditService();
