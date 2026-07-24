import path from 'path';
import fs from 'fs-extra';
// @ts-ignore
import fileUrl from 'file-url';
import SqliteDataService, { RevisionConflictError } from './SqliteDataService';
import type { MapSaveRequest, MapSaveResult } from '../adapters/StorageAdapter';
import * as storeHandler from '../utils/store_handler';
import SettingsService from './SettingsService';
import { normalizeOriginalExt, resolveRuntimeOriginal } from './MapOriginalImageService';
import MapMutationQueue from './MapMutationQueue';
// @ts-ignore
import Tin from '@maplat/tin';

const TIN_V2_OPTIONS = { useV2Algorithm: true };

// M13-T1 (§2.4): MapDataService.ts の isPreviewDisabled/isStrictErrorCompiled と同一ロジックの
// 3個目の重複実装を避けるため、モジュールレベルの export 関数へ昇格する。
// クラス内の private メソッドは薄いラッパーとしてこれらを呼ぶ
export function isStrictErrorCompiled(compiled: any): boolean {
    return compiled?.strict_status === 'strict_error' || Boolean(compiled?.kinks_points);
}

export function hasStrictError(json: any): boolean {
    if (isStrictErrorCompiled(json.compiled)) return true;
    return Array.isArray(json.sub_maps) && json.sub_maps.some((subMap: any) => isStrictErrorCompiled(subMap.compiled));
}

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

        // M11-T10 (人間検証R6): normalizeRequestData が compiled から生成済みの tins
        // (byCompiled: 平文 compiled or 文字列素体) をエディタへ添付する。エディタは
        // compiled を持つレイヤーを再計算せず種付けし、無いレイヤーだけ再計算する。
        if (res[1]) res[0].compiledTins = res[1];

        return res[0];
    }

    // M13-T1 (§2.5): 既存ロジックをそのまま抽出（strict throw を含まない）。
    // strict-free な読み出し (MapPurposeService.downloadSavedMap など) から再利用する
    async buildPreviewSource(uidOrMapID: string) {
        const json = await SqliteDataService.findMapByRef(uidOrMapID);

        if (!json) throw new Error(`Map with ID ${uidOrMapID} not found`);

        const previewJson = await this.ensurePreviewCompiled({ ...json });
        // ↓ ここに従来の hasStrictError チェックは置かない
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

    // 既存の外部契約(mapedit:preview-source)はこのまま維持
    async requestPreviewSource(uidOrMapID: string) {
        const previewJson = await this.buildPreviewSource(uidOrMapID);
        if (hasStrictError(previewJson)) {
            throw new Error('appedit.preview.strict_error');
        }
        return previewJson;
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
        if (isStrictErrorCompiled(compiled)) {
            throw new Error('appedit.preview.strict_error');
        }
        return compiled;
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
        // M13-T2 (§5.1/§5.3): 従来の imageExtension 変数は legacy 分岐(copySourceUid/renamedFromSlug)
        // 専用に維持する (slug キーの originals ファイル名計算にそのまま使う、無変更)。
        // normalizedExt は tmpCheck 分岐 (新規原本アップロード) の canonical(uid キー)化専用に
        // 新設する。allowed set 外・trim 後 empty のみのフォールバックは normalizeOriginalExt に集約
        const imageExtension: string = mapObject.imageExtension || mapObject.imageExtention || 'jpg';
        const normalizedExt = normalizeOriginalExt(mapObject.imageExtension, mapObject.imageExtention);

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

        // M13-T2 (§5.3): 新規原本アップロード(tmpCheck)で未対応拡張子なら、DB write に
        // 一切触れる前に reject する。既存地図の更新(tmpCheck=false)は従来どおり legacy
        // imageExtension をそのまま使うため、この reject の対象外(AC-T2-3)
        if (tmpCheck && normalizedExt === null) {
            return { result: 'Error', errorKey: 'mapedit.originals.unsupported_extension' };
        }

        // M13-T2 (§5.8): 同一 uid への save/rename/clone/delete/migration を直列化する。
        // queue 対象外は「request.create が truthy ではなく、かつ uid も未指定」の従来型
        // サーバ採番 create 経路のみ(まだ存在しない map identity への書込みで、他 mutation
        // と衝突しうる既存 identity が無いため queue 直列化の対象外としても安全)
        const queueUid = request.create === true ? (request.uid ?? undefined) : (uid ?? undefined);

        const body = async (): Promise<MapSaveResult> => {
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
            // M13-T4 (§5.2): clone 分岐で複製元原本を resolveRuntimeOriginal() で解決するために
            // 複製元の DB 上の imageExtension/imageExtention を extHint として保持する
            let copySourceImageExtension: string | undefined;
            let renamedFromSlug: string | null = null;
            try {
                if (request.create === true) {
                    // 新規作成の明示合図(D11改): rendererが事前採番したuidを採用し、
                    // unique制約 + 予約promoteで二重作成/他者占有を防ぐ。uid有無ではなくcreateフラグで
                    // 分岐するため、既存update経路の復活防止不変条件(lookup失敗=エラー)を侵さない。
                    // excludeUid=事前採番uid: 自分の予約(帰属=asset_uid)を空き扱いにする(D2改)
                    if (!(await SqliteDataService.isSlugAvailable(slug, request.uid ?? undefined))) {
                        throw new Error('Exist');
                    }
                    // M11-T10: 複製は create 経路に乗る(事前採番uid=予約帰属)。複製元の
                    // tiles/tmbs/原本コピーは従来 copy 経路と同じ後段ファイル操作を使う
                    if (request.copyFromUid) {
                        const source = await SqliteDataService.findMap(request.copyFromUid);
                        if (source) {
                            copySourceUid = source.uid;
                            copySourceSlug = source.slug;
                            copySourceImageExtension = source.imageExtension || source.imageExtention || undefined;
                        }
                    }
                    const created = await SqliteDataService.createMap(slug, compiled, request.uid ?? undefined);
                    savedUid = created.uid;
                    savedRevision = 1;
                } else if (uid) {
                    const existing = await SqliteDataService.findMap(uid);
                    if (!existing) throw new Error(`Map with uid ${uid} not found`);
                    if (existing.slug !== slug) {
                        // 改名先slugの空きを確認 (グローバル一意: 地図/アプリ/ベースマップ横断)
                        if (!(await SqliteDataService.isSlugAvailable(slug, uid))) {
                            throw new Error('Exist');
                        }
                        renamedFromSlug = existing.slug;
                    } else if (request.renameFromSlug && request.renameFromSlug !== slug &&
                               !(await SqliteDataService.findMapBySlug(request.renameFromSlug))) {
                        // 再試行の救済(D5改): 前回の保存がDBコミット後のファイル操作で失敗した場合、
                        // DB上のslugは既に改名済みで existing.slug === slug となり renamedFromSlug が
                        // 立たない。editorが成功(saved)まで保持し続ける明示フィールド renameFromSlug を
                        // 手掛かりに、旧slugが孤児(どの地図にも属さない)であれば原本(originals)改名の
                        // 残作業として引き継ぐ。旧status文字列への埋め込みは全廃した。
                        renamedFromSlug = request.renameFromSlug;
                    }
                    const { revision } = await SqliteDataService.upsertMap(
                        uid, slug, compiled, request.expectedRevision ?? undefined
                    );
                    savedUid = uid;
                    savedRevision = revision;
                } else {
                    // 新規 / 複製 (従来のserver採番経路、後方互換) — 新しくslugを名乗るので空きを確認
                    if (!(await SqliteDataService.isSlugAvailable(slug))) {
                        throw new Error('Exist');
                    }
                    if (request.copyFromUid) {
                        const source = await SqliteDataService.findMap(request.copyFromUid);
                        if (source) {
                            copySourceUid = source.uid;
                            copySourceSlug = source.slug;
                            copySourceImageExtension = source.imageExtension || source.imageExtention || undefined;
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
                // registerAsset/renameAssetSlug のslug衝突(レース先取り)と slug 予約 promote conflict
                // (M11-T7/AC4)も duplicate として写像する
                if (e && typeof e.message === 'string' && e.message.startsWith('Slug already in use')) {
                    return { result: 'Exist' };
                }
                if (e?.kind === 'slug-reservation-conflict') return { result: 'Exist' };
                console.error('[MapEditService.save] Error:', e);
                return { result: 'Error' };
            }

            const newTile = path.join(tileFolder, savedUid);
            // legacy(slug キー)の原本パス。copySourceUid/renamedFromSlug 分岐専用(本タスクで無変更)
            const newOriginal = path.join(originalFolder, `${slug}.${imageExtension}`);
            const newThumbnail = path.join(thumbFolder, `${savedUid}.jpg`);

            // --- ファイル操作 (DBコミット後・ここでの失敗はDBを巻き戻さない) ---
            try {
                if (tmpCheck) {
                    // M13-T2 (§5.3): 新規原本アップロードは canonical(uid キー)へ書き込む。
                    // normalizedExt は tmpCheck 分岐の直前で null チェック済みのため non-null
                    const canonicalOriginal = path.join(originalFolder, `${savedUid}.${normalizedExt}`);
                    // tmpフォルダからの永続フォルダへの移動 (uidパス)
                    try { await fs.remove(newTile); } catch { /* noop */ }
                    await fs.move(tmpTileFolder, newTile);
                    const tmpOriginal = path.join(newTile, `original.${normalizedExt}`);
                    try { await fs.remove(canonicalOriginal); } catch { /* noop */ }
                    if (await fs.pathExists(tmpOriginal)) {
                        await fs.move(tmpOriginal, canonicalOriginal);
                    }
                    const tmpThumb = path.join(newTile, 'thumbnail.jpg');
                    try { await fs.remove(newThumbnail); } catch { /* noop */ }
                    if (await fs.pathExists(tmpThumb)) {
                        await fs.move(tmpThumb, newThumbnail);
                    }
                    // M12-T15 R3: thumbnail_512.jpg を tmbs/{uid}_512.jpg へ移動
                    const tmpThumb512 = path.join(newTile, 'thumbnail_512.jpg');
                    const newThumbnail512 = path.join(thumbFolder, `${savedUid}_512.jpg`);
                    try { await fs.remove(newThumbnail512); } catch { /* noop */ }
                    if (await fs.pathExists(tmpThumb512)) {
                        await fs.move(tmpThumb512, newThumbnail512);
                    }
                    // M13-T2: renamedFromSlug の legacy 原本クリーンアップは削除する。canonical
                    // 書込み先が uid キーになったことで新旧ファイル名の衝突が起こらなくなったため
                    // 不要になった。legacy ファイルは非破壊方針(SI-1/SI-2 の精神)により T3
                    // migration / T4 delete が扱うまで放置してよい(旧実装の掃除処理を意図的に削除)
                } else if (copySourceUid) {
                    // 複製: 複製元uidのtiles/tmbsを新キーへコピー
                    const oldTile = path.join(tileFolder, copySourceUid);
                    const oldThumbnail = path.join(thumbFolder, `${copySourceUid}.jpg`);
                    if (await fs.pathExists(oldTile)) await fs.copy(oldTile, newTile);
                    if (await fs.pathExists(oldThumbnail)) await fs.copy(oldThumbnail, newThumbnail);
                    // M12-T15 (Fix-3): 複製元の 512px サムネイルも複製する（複製地図が 512px を持てない問題の修正）
                    const oldThumbnail512 = path.join(thumbFolder, `${copySourceUid}_512.jpg`);
                    const newThumbnail512 = path.join(thumbFolder, `${savedUid}_512.jpg`);
                    if (await fs.pathExists(oldThumbnail512)) await fs.copy(oldThumbnail512, newThumbnail512);
                    // M13-T4 (AC-T4-2): 原本は複製元 uid の canonical-first / legacy-fallback 解決結果を
                    // 複製先の canonical 名 (uid キー) へ複写する。旧実装の legacy slug キー複写
                    // (`${copySourceSlug}.${imageExtension}` -> `${slug}.${imageExtension}`) は廃止する
                    // (T2 以降の新規保存は canonical 名で書かれるため、複製先も canonical 名に揃える)。
                    // 複製元が解決不能 (ambiguous/missing legacy 等) でも clone の DB 行/tiles/tmbs は
                    // 成功させる (milestone §4.7.2: best-effort、source は非破壊)
                    try {
                        const resolved = await resolveRuntimeOriginal(copySourceUid, copySourceSlug!, copySourceImageExtension);
                        if (resolved) {
                            const canonicalDestOriginal = path.join(originalFolder, `${savedUid}.${resolved.ext}`);
                            await fs.copy(resolved.path, canonicalDestOriginal);
                        } else {
                            console.warn(`[MapEditService.save] clone: source original unresolved for copySourceUid=${copySourceUid} slug=${copySourceSlug}; skipping original copy (tiles/tmbs still copied)`);
                        }
                    } catch (e) {
                        console.warn(`[MapEditService.save] clone: failed to copy resolved original for copySourceUid=${copySourceUid}`, e);
                    }
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
        };

        return queueUid ? MapMutationQueue.run(queueUid, 'map-save', body) : body();
    }
}

export default new MapEditService();
