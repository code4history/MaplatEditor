import fs from 'fs-extra';
import path from 'path';
import AdmZip from 'adm-zip';
import { app, dialog, BrowserWindow } from 'electron';
import SettingsService from './SettingsService';
import * as storeHandler from '../utils/store_handler';
import { deriveRuntimeTileUrl } from '../utils/runtimeTileUrl';
import SqliteDataService from './SqliteDataService';
import { assertSafeArchiveEntries } from '../../src/utils/poiPackage';
import {
  zipEntryInfos,
  importManagedPoiDocuments,
  type CompensationResidue,
  type PoiZipImportCleanup,
} from './PoiPackageService';
import poiSourceService from './PoiSourceService';
import { resolveImportSlug } from './importSlugResolver';
import { readAppDocumentPois } from '../../src/utils/appPoisFormat';
import { listPoiDocumentEntries } from '../../src/utils/poiPackage';

// M5-T4B (実装レビュー Major-1): restore 失敗経路で先に走った補償の残留を、
// throw する Error へ添えて外側へ運ぶための添え札。
// 例外の identity（型・message・stack）は保つ ∴ 既存の失敗契約は変わらない。
const RESIDUE_ON_ERROR = Symbol.for('maplat.compensationResidue');

function attachResidue(error: unknown, residue: CompensationResidue[]): void {
    if (error === null || (typeof error !== 'object' && typeof error !== 'function')) return;
    const carrier = error as Record<symbol, unknown>;
    const existing = carrier[RESIDUE_ON_ERROR];
    carrier[RESIDUE_ON_ERROR] = Array.isArray(existing) ? [...existing, ...residue] : residue;
}

function detachResidue(error: unknown): CompensationResidue[] {
    if (error === null || (typeof error !== 'object' && typeof error !== 'function')) return [];
    const carried = (error as Record<symbol, unknown>)[RESIDUE_ON_ERROR];
    return Array.isArray(carried) ? (carried as CompensationResidue[]) : [];
}

// M5-T4B: 逆変換の入口は **map JSON の pois 配列** である。
// ZIP のファイル一覧を起点にしてはならない — ファイル一覧は実体の供給元にすぎず、
// 順序・上書き属性・重複参照・透過要素の情報は **すべて map JSON の pois にしかない**。
const MANAGED_POI_DEST = /^pois\/[^/]+\.geojson$/i;

function managedDestOf(entry: unknown): string | null {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
    const layer = (entry as { layer?: unknown }).layer;
    if (typeof layer !== 'string' || !MANAGED_POI_DEST.test(layer)) return null;
    return layer;
}

/** wrapper から layer を除いた上書き属性。**FC へ焼き込まず参照側に載せる**のが上書き仕様の存在意義 */
function overridesOf(entry: unknown): Record<string, unknown> {
    const { layer: _layer, ...rest } = entry as Record<string, unknown>;
    return rest;
}

class DataUploadService {
    private get folders() {
        const saveFolder = SettingsService.get('saveFolder') as string;
        const tmpFolder  = SettingsService.get('tmpFolder') as string;
        return {
            tileFolder:        path.join(saveFolder, 'tiles'),
            uiThumbnailFolder: path.join(saveFolder, 'tmbs'),
            tmpFolder,
        };
    }

    async showDataSelectDialog(win: BrowserWindow): Promise<any> {
        const ret = await dialog.showOpenDialog(win, {
            defaultPath: app.getPath('documents'),
            properties: ['openFile'],
            filters: [{ name: 'Map data zip', extensions: ['zip'] }],
        });
        if (ret.canceled || ret.filePaths.length === 0) {
            return { err: 'Canceled' };
        }
        return this.extractZip(ret.filePaths[0]);
    }

    /**
     * M5-T4B: map JSON が参照する managed POI を editor 正本形へ復元する。
     *
     * **入口は map JSON の pois 配列**（§5.2）。ZIP のファイル一覧は実体の供給元にすぎない。
     * 配列の順序と要素数を保存し、管理下 entry だけを { poiUid, …上書き } へ戻す。
     * 上書き属性は wrapper 側に載せたままにする（FC へ焼き込まない）。
     *
     * 重複排除は **本メソッドの責務**である — createPoiSourceFromManagedDocument は
     * 呼び出しごとに1行作るため、同一 dest を指す複数 entry は Map<dest, poiUid> で畳む。
     */
    private async restoreManagedPois(zipFile: string, mapData: any): Promise<{
        pois: unknown[] | null;
        createdPoiUids: string[];
        cleanupAssets: PoiZipImportCleanup | null;
        warnings: string[];
    }> {
        const empty = { pois: null, createdPoiUids: [] as string[], cleanupAssets: null, warnings: [] as string[] };
        const read = readAppDocumentPois(mapData as { pois?: unknown });
        if (read.pois.length === 0) return empty;

        // 参照されている dest（重複を畳んだ集合）
        const referenced: string[] = [];
        for (const entry of read.pois) {
            const dest = managedDestOf(entry);
            if (dest && !referenced.includes(dest)) referenced.push(dest);
        }
        if (referenced.length === 0) return empty;

        const warnings: string[] = [];

        // 余剰 entry: ZIP にあるのに map JSON が参照しない → warning。import しない
        // （参照されない実体を勝手に取り込むと孤児 source が増える）
        const inZip = listPoiDocumentEntries(zipEntryInfos(new AdmZip(zipFile)).map((i) => i.name));
        for (const name of inZip) {
            if (!referenced.includes(name)) {
                warnings.push(`Unreferenced POI document in package: ${name}`);
            }
        }

        // 欠損 dest は importManagedPoiDocuments が Error にする（黙って落とさない）
        const imported = await importManagedPoiDocuments(zipFile, referenced);
        warnings.push(...imported.warnings);

        const createdPoiUids: string[] = [];
        const byDest = new Map<string, string>();
        try {
            for (const dest of referenced) {
                const fc = imported.documents.get(dest)!;
                const result = await poiSourceService.createPoiSourceFromManagedDocument(fc, { dest });
                if (!('result' in result) || result.result !== 'Success') {
                    throw new Error(
                        `Failed to create POI source for ${dest}: `
                        + ('result' in result ? String((result as any).message ?? result.result) : 'unknown'),
                    );
                }
                createdPoiUids.push(result.uid);
                byDest.set(dest, result.uid);
            }
        } catch (e) {
            // ここで失敗した場合、asset と作成済み source を巻き戻してから投げ直す。
            // map 行はまだ無いので補償対象は2つだけである。
            //
            // M5-T4B (実装レビュー Major-1): **内側の residue を捨てない**。
            // 従来は戻り値を捨てて rethrow しており、外側 catch では restored が null のため
            // 拾い直せず、この経路で asset が retained になっても poi_sources の削除に失敗しても
            // 「残留なし」として申告されていた（I-4c 違反）。
            // throw する Error へ添えて外側へ運ぶ（Error の identity は保つ）。
            const residue = await this.compensate({ createdPoiUids, cleanupAssets: imported.cleanup });
            if (residue.length > 0) attachResidue(e, residue);
            throw e;
        }

        // 順序と要素数を保存したまま復元する
        const restored = read.pois.map((entry) => {
            const dest = managedDestOf(entry);
            if (!dest) return entry;                       // 透過（URL / インライン FC / 未知形）
            return { poiUid: byDest.get(dest)!, ...overridesOf(entry) };
        });

        return { pois: restored, createdPoiUids, cleanupAssets: imported.cleanup, warnings };
    }

    /**
     * M5-T4B: 補償（作成の逆順）。**途中で止めず**、到達できなかったものを残留として返す（I-4c）。
     * 順序: 配置済みファイル → map 行 → poi_sources → asset
     */
    private async compensate(handle: {
        placedPaths?: string[];
        mapUid?: string;
        createdPoiUids?: string[];
        cleanupAssets?: PoiZipImportCleanup | null;
    }): Promise<CompensationResidue[]> {
        const residue: CompensationResidue[] = [];

        // 1) 配置済みの tile・通常/512px サムネイル（新規 UID 配下のみ）
        //    M5-T4B (実装レビュー Major-1): 削除できなければ **残留として申告する**。
        //    console.warn だけだと、タイル数百 MB が live path に残ったまま
        //    「完全に巻き戻した」と申告されてしまう（I-4c 違反）
        for (const p of handle.placedPaths ?? []) {
            try {
                await fs.remove(p);
            } catch (e) {
                residue.push({ kind: 'file', path: p, error: e instanceof Error ? e.message : String(e) });
            }
        }
        // 2) 新規 map 行
        //    同上。消せなければ孤児 map 行が残り slug registry も解放されない
        if (handle.mapUid) {
            try {
                await SqliteDataService.deleteMap(handle.mapUid);
            } catch (e) {
                residue.push({
                    kind: 'mapRow',
                    mapUid: handle.mapUid,
                    dbError: e instanceof Error ? e.message : String(e),
                });
            }
        }
        // 3) 今回作成した poi_sources 行（**成功した作成のみ**が対象。逆順）
        for (const uid of [...(handle.createdPoiUids ?? [])].reverse()) {
            try {
                await poiSourceService.delete(uid);
            } catch (e) {
                // 削除に到達できなかった → slug registry も解放されない ∴ 残留として申告する
                residue.push({
                    kind: 'poiSource',
                    poiSourceUid: uid,
                    dbError: e instanceof Error ? e.message : String(e),
                });
            }
        }
        // 4) 今回新規作成した asset
        if (handle.cleanupAssets) {
            residue.push(...(await handle.cleanupAssets()));
        }
        return residue;
    }

    async extractZip(zipFile: string): Promise<any> {
        const { tileFolder, uiThumbnailFolder, tmpFolder } = this.folders;
        const dataTmpFolder = path.join(tmpFolder, 'zip');

        // M5-T4B: 補償ハンドル。作成に成功したものだけを積み、失敗時に逆順で巻き戻す
        const placedPaths: string[] = [];
        let mapUid: string | undefined;
        let restored: {
            pois: unknown[] | null;
            createdPoiUids: string[];
            cleanupAssets: PoiZipImportCleanup | null;
            warnings: string[];
        } | null = null;

        try {
            await fs.remove(dataTmpFolder);
            await fs.ensureDir(dataTmpFolder);

            const zip = new AdmZip(zipFile);

            // M5-T4 (§6.2.7b): 安全検証は **extractAllTo の前** に、**全 entry へ**、
            // **無条件で** 走らせる。
            //
            // extractAllTo は全 entry を無検証のままファイルシステムへ書くため、
            // 危険 entry が実際に書き込まれるのはこの1行である。一方 map JSON を読めるのは
            // 展開の後であり、外部 POI 参照から検証対象を絞る設計では **書き込みに間に合わない**。
            // 参照されないタイル位置に仕込まれた `..` や symlink も展開時には等しく危険であり、
            // 「参照しないから安全」ではない。∴ dests とも pois/ の有無とも無関係に走らせる。
            //
            // adm-zip 自身の zip-slip 対策には依存しない（バージョン依存の実装詳細であり、
            // 契約として保証されたものではない）。呼び出し側で明示的に検証する。
            //
            // ここで throw しても **まだ何も書いていない** ため、補償は不要である
            // （完全ロールバック。§6.3.2 の residue は付かない）。
            assertSafeArchiveEntries(zipEntryInfos(zip), 'map package');

            zip.extractAllTo(dataTmpFolder, true);

            // maps/{mapID}.json を読む（原版と同じ）
            const mapTmpFolder = path.join(dataTmpFolder, 'maps');
            const tileTmpFolder = path.join(dataTmpFolder, 'tiles');
            const tmbTmpFolder  = path.join(dataTmpFolder, 'tmbs');

            const mapFile = (await fs.readdir(mapTmpFolder))[0];
            const mapID   = mapFile.split('.')[0];
            const mapPath = path.join(mapTmpFolder, mapFile);
            const mapData = await fs.readJson(mapPath);

            const tilePath  = path.join(tileTmpFolder, mapID);
            const tmbPath   = path.join(tmbTmpFolder, `${mapID}.jpg`);

            // --- バリデーション (slugはグローバル一意: ADR-0007) ---
            // M5-T5: 同名 slug は 'Exist' で拒否せず自動解決するため、ここでの slug 検査は
            // 無くなった。構造的な欠落 (タイル・サムネイル) だけを先に弾く。
            if (!fs.existsSync(tilePath)) throw 'NoTile';
            if (!fs.existsSync(tmbPath))  throw 'NoTmb';

            // --- M5-T4B: 準備 — 外部 POI を editor 正本形へ復元する ---
            // **map を保存する前**に行う。保存後だと、復元に失敗したとき既に map 行が
            // 出来ており補償対象が増える。復元が失敗した場合は restoreManagedPois が
            // 自前で asset / source を巻き戻して throw する（map 行はまだ無い）
            restored = await this.restoreManagedPois(zipFile, mapData);
            if (restored.warnings.length > 0) {
                console.warn('[DataUploadService] POI restore warnings:', restored.warnings);
            }
            if (restored.pois !== null) {
                // **常に配列へ復元する**（単独形へ戻さない）。搬出時点で単独形は1要素配列へ
                // 正規化済みであり、ZIP に単独形だったという情報が残らないため戻す余地がない。
                // かつ { poiUid } は非配列位置では読み戻せない（isPoiLayerRefAsWhole が
                // 上書きキーを追加要求するため）∴ 配列に限るのが構造的に安全である
                (mapData as any).pois = restored.pois;
            }

            // --- M5-T5: 地図 slug の解決 ---
            // 同名 slug を 'Exist' で拒否せず、POI import と同じ空き slug 解決へ揃える
            // (base, base-2 … base-100)。規則は共有 API resolveImportSlug が正本。
            //
            // 【解決は restoreManagedPois の **後** で行う】
            // slug は asset 種別を跨いで一意 (ADR-0007) であり、POI 復元は同じ import の中で
            // poi_sources の slug を消費する。復元より前に解決すると、その結果は復元が
            // 走った時点で古くなり、createMap が自分自身の import に負ける。
            // 解決は **書込の直前** に置くのが唯一正しい位置である。
            //
            // 【slug の3系統を混同しない】
            //   読み出し (ZIP 内)   = 元 slug   … ZIP の中身は搬出時の名前のまま
            //   内部格納             = uid       … ADR-0007。既に slug 非依存
            //   DB / 返却 / 再搬出名 = 解決後 slug … 一意性の正本
            // 読みを解決後 slug にすると衝突時に NoTile/NoTmb へ化ける (ZIP にその名前は無い)。
            const resolvedSlug = await resolveImportSlug(mapID);
            if (resolvedSlug === null) throw 'Exist'; // base-100 まで枯渇

            // --- raw mapData をそのまま新規作成 (uidが採番される) ---
            // M5-T4B: pois は復元済みの内部形（{poiUid, …上書き}）で永続化される
            // M5-T5: slug は解決後の値。data_json 側は normalizeMapDocument が mapID を
            // 落とすため、slug の正本は行の slug 列だけになる (ADR-0007)。
            let uid: string;
            try {
              ({ uid } = await SqliteDataService.createMap(resolvedSlug, mapData));
            } catch (e: any) {
              // M5-T5 §5.4: 解決後 slug が createMap 到達までに先取りされた (レース)。
              // 意味は枯渇と同じ「この slug では取り込めない」∴ 'Exist' へ写像し、
              // renderer の既存分岐へ載せる (再試行すれば次の候補で成功する)。
              //
              // 【この写像を外側 catch に置いてはならない】
              // createMap より前に走る restoreManagedPois も POI ソースの slug 衝突で
              // 同じ 'Slug already in use' を投げ得る。外側で message を見ると
              // **POI 復元の失敗を地図 slug のレースとして誤ラベルする**。
              if (e?.kind === 'slug-reservation-conflict'
                  || /^Slug already in use: /.test(String(e?.message ?? ''))) {
                throw 'Exist';
              }
              throw e; // それ以外の createMap 失敗は従来どおり message のまま
            }
            mapUid = uid;

            // 内部ファイル(tiles/tmbs)はuidキーに置く (ADR-0007)。zip内はslug名
            const tileToPath = path.join(tileFolder, uid);
            const tmbToPath  = path.join(uiThumbnailFolder, `${uid}.jpg`);

            // タイルとサムネイルを移動
            await fs.remove(tileToPath);
            await fs.move(tilePath, tileToPath);
            placedPaths.push(tileToPath);
            await fs.remove(tmbToPath);
            await fs.move(tmbPath, tmbToPath);
            placedPaths.push(tmbToPath);

            // M5-T4B: 512px サムネイル。**旧 ZIP 互換のため入力に無い場合は保存対象なし**として扱う
            const tmb512Path = path.join(tmbTmpFolder, `${mapID}_512.jpg`);
            if (fs.existsSync(tmb512Path)) {
                const tmb512ToPath = path.join(uiThumbnailFolder, `${uid}_512.jpg`);
                await fs.remove(tmb512ToPath);
                await fs.move(tmb512Path, tmb512ToPath);
                placedPaths.push(tmb512ToPath);
            }

            // --- 原版の normalizeRequestData 相当 ---
            // store2HistMap で store 形式 → histMap 形式に変換。
            // M5-T3: byCompiled=true は MapEditService.request と同じ値。renderer は import 経路でも
            // 通常読み込み経路でも tins の各要素を Tin.setCompiled() へ渡すため、生 Compiled 形が要る
            // （byCompiled=false が返す Transform インスタンスは IPC の structured clone で
            // プロトタイプを失い、own-property も Compiled の形ではない）。
            // compiled を持たない層は createTinFromGcpsAsync が常に文字列 sentinel を返すため
            // byCompiled の影響を受けない
            const [histMap, tins] = await storeHandler.store2HistMap(mapData as any, true);
            // M5-T5: 返却する mapID は **解決後 slug**（DB の slug と一致させる）。
            // ZIP 内の読み出しに使った元 slug (mapID) とは別物である。
            (histMap as any).mapID  = resolvedSlug;
            (histMap as any).uid = uid;
            (histMap as any).revision = 1;
            (histMap as any).status = 'Update';

            // M5-T3: url_ の導出は共通実装 deriveRuntimeTileUrl() が正本
            // （MapEditService.normalizeRequestData と同一。二重実装の一本化）
            const url_ = await deriveRuntimeTileUrl(mapData, path.join(tileToPath, '0', '0'));
            if (url_) (histMap as any).url_ = url_;

            return { mapData: histMap, tins };
        } catch (err: any) {
            console.error('[DataUploadService] extractZip error', err);
            const message = typeof err === 'string' ? err : (err.message || 'Unknown');

            // M5-T4B (I-4c): 補償し、**到達できなかったものを残留として申告する**。
            // 補償が全て到達した場合のみ従来どおり { err } を返す。
            // 残留が1件でもあれば residue を付ける ∴ 呼び出し側は 'residue' in result で
            // 部分ロールバックを判定できる。renderer の既存 arg.err 分岐は追加フィールドの
            // 影響を受けず無変更で通る
            const residue = [
                // restore 失敗経路で先に走った補償の残留（restored は null なので
                // ハンドルからは拾えない）。Error へ添えられたものを合流させる
                ...detachResidue(err),
                ...await this.compensate({
                    placedPaths,
                    mapUid,
                    createdPoiUids: restored?.createdPoiUids,
                    cleanupAssets: restored?.cleanupAssets,
                }),
            ];
            if (residue.length > 0) {
                console.warn('[DataUploadService] 補償に到達できなかった残留物があります:', residue);
                return { err: message, residue };
            }
            return { err: message };
        }
    }
}

export default new DataUploadService();
