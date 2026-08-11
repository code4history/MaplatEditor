import { ipcMain, BrowserWindow, dialog, app } from 'electron';
import fs from 'fs-extra';
import path from 'path';
import fileUrl from 'file-url';
// M12-T20 (§5.0/§5.1): staging パスの解決・検証は共通バリデータのみを使う
import { draftTileRoot, isDraftTileUrl, resolveStagingDirFromUrl, resolveDraftTileDir } from '../services/draftTilePaths';
// @ts-ignore
import csvParser from 'csv-parser';
// @ts-ignore
import proj from 'proj4';
import MapDataService from '../services/MapDataService';
import SqliteDataService from '../services/SqliteDataService';
import SettingsService from '../services/SettingsService';
import StorageAdapter from '../adapters/ElectronStorageAdapter';
import MapPurposeService from '../services/MapPurposeService';
import { buildAndWriteMapZip } from '../utils/mapDownloadZip';
import { deriveRuntimeTileUrl } from '../utils/runtimeTileUrl';
// @ts-ignore
import Tin from '@maplat/tin';

// M13-T1 (§2.6): composeDownloadMapJson は mapDownloadZip.ts へ移設した。
// scripts/m10-t3-mapedit-pois-save-smoke.mjs が electron/ipc/mapedit.ts からの named import で
// composeDownloadMapJson を直接呼び出すため、移設後も同一の関数オブジェクトを解決できるよう
// re-export を残す (mapedit.ts → mapDownloadZip.ts の一方向依存のみで循環 import は発生しない)。
export { composeDownloadMapJson } from '../utils/mapDownloadZip';

const TIN_V2_OPTIONS = { useV2Algorithm: true };

async function createTinFromGcpsAsync(
    gcps: any[], edges: any[], wh: any, bounds: any, strict: any, vertex: any
): Promise<any> {
    if (gcps.length < 3) return 'tooLessGcps';
    return new Promise((resolve, reject) => {
        const tin = new Tin(TIN_V2_OPTIONS);
        if (wh) {
            tin.setWh(wh);
        } else if (bounds) {
            tin.setBounds(bounds);
        } else {
            reject('Both wh and bounds are missing');
            return;
        }
        tin.setStrictMode(strict);
        tin.setVertexMode(vertex);
        tin.setPoints(gcps);
        tin.setEdges(edges);
        tin.updateTinAsync()
            .then(() => {
                resolve(tin.getCompiled());
            })
            .catch((err: any) => {
                const e = String(err);
                console.log('[mapedit:updateTin] TIN error:', e);
                if (e.includes('SOME POINTS OUTSIDE')) resolve('pointsOutside');
                else if (e.indexOf('TOO LINEAR') === 0) resolve('tooLinear');
                else if (e.includes('Vertex indices') || e.includes('is degenerate!') ||
                    e.includes('already exists or intersects with an existing edge!')) resolve('edgeError');
                else reject(err);
            });
    });
}

export const registerMapEditHandlers = () => {
    // uid正準の読み出し (ADR-0007)。AppEdit等の旧経路がslugで呼ぶ間はslugでも解決される
    ipcMain.handle('mapedit:request', async (_event, uidOrMapID: string) => {
        try {
            return await StorageAdapter.readMapForEdit(uidOrMapID);
        } catch (e) {
            console.error('Failed to handle mapedit:request', e);
            throw e;
        }
    });

    ipcMain.handle('mapedit:preview-source', async (_event, uidOrMapID: string) => {
        try {
            return await StorageAdapter.readMapForPreview(uidOrMapID);
        } catch (e) {
            console.error('Failed to handle mapedit:preview-source', e);
            throw e;
        }
    });

    // payload: { mapObject, tins, uid?, slug?, expectedRevision?, copyFromUid? } (ADR-0007)
    ipcMain.handle('mapedit:save', async (_event, payload: any) => {
        try {
            const result = await StorageAdapter.saveMapForEdit(payload);
            if (result && 'result' in result && result.result === 'Success') {
                // 地図保存後は MapList を最新化する (app 保存と同様の一貫性: M11-T10 E2E で
                // 保存直後の一覧遷移時に新規行が表示されないフレークの根因を解消)
                BrowserWindow.getAllWindows().forEach(win => {
                    win.webContents.send('maplist:refresh');
                });
            }
            return result;
        } catch (e) {
            console.error('Failed to handle mapedit:save', e);
            return { result: 'Error' };
        }
    });

    // TIN計算をNode.jsプロセスで実行してコンパイル済みデータを返す
    ipcMain.handle('mapedit:updateTin', async (
        _event,
        gcps: any[], edges: any[], index: number, bounds: any, strict: any, vertex: any
    ) => {
        try {
            const wh = index === 0 ? bounds : null;
            const bd = index !== 0 ? bounds : null;
            const compiled = await createTinFromGcpsAsync(gcps, edges, wh, bd, strict, vertex);
            return [index, compiled];
        } catch (e) {
            console.error('Failed to handle mapedit:updateTin', e);
            throw e;
        }
    });

    // M12-T20 (§5.1): 復元時ガード用の staging 実在照会。
    // alive: url_ の参照先（staging: バリデータ導出 dir / 後方互換 tmp: tmp/tiles 固定 dir）の実在。
    //        恒久 URL・空は true（ガード非対象）。staging プレフィックス一致かつ導出 null は
    //        fs に一切触れず alive:false（§5.0 の表 — 表示のみに接続されるため安全側）。
    // savedTilesExist: uid 指定時に saveFolder/tiles/{uid} の実在（同バリデータ・root 差し替え。
    //        null または uid 未指定なら false）。保存確定直後クラッシュの誤誘導防止（§6.4）
    ipcMain.handle('mapedit:stagingStatus', async (_event, url_: string, uid?: string) => {
        let alive = true;
        if (typeof url_ === 'string' && url_) {
            if (isDraftTileUrl(draftTileRoot, url_)) {
                const stagingDir = resolveStagingDirFromUrl(draftTileRoot, url_);
                alive = stagingDir ? await fs.pathExists(stagingDir) : false;
            } else {
                const tmpTileFolder = path.join(SettingsService.get('tmpFolder') as string, 'tiles');
                if (url_.startsWith(fileUrl(tmpTileFolder) + '/')) {
                    // 後方互換 tmp は固定 dir（url_ 由来の可変部がパス構築に入らないため導出不要）
                    alive = await fs.pathExists(tmpTileFolder);
                }
            }
        }
        let savedTilesExist = false;
        if (typeof uid === 'string' && uid) {
            const tileFolder = path.join(SettingsService.get('saveFolder') as string, 'tiles');
            const savedTileDir = resolveDraftTileDir(tileFolder, uid);
            savedTilesExist = savedTileDir ? await fs.pathExists(savedTileDir) : false;
        }
        return { alive, savedTilesExist };
    });

    /**
     * M5-T7: ランタイム専用タイル URL（url_）の導出。
     *
     * なぜ IPC が要るか（設計 §4）: url が空のとき url_ はファイルシステム上のタイル実体から
     * 組み立てる必要がある。renderer に持ち込むと m5-t3 が1本化した deriveRuntimeTileUrl が
     * 3箇所目として復活するため、導出は main に閉じたままここへ問い合わせる。
     *
     * 探索順は **draft → 保存済み**（設計 §5.2）。draft staging のキーは保存済み uid と同一
     * （mapUpload が mapUid.value || newMapUid を渡す）なので、draft が無ければそのまま
     * 保存済みへ落ちる＝通常ケースは変わらない。draft がある＝再アップロード保留中であり、
     * そのとき mapData.width/height は新画像の値なので、旧保存タイルを返すと
     * 新寸法×旧タイルの源ができてしまう。
     *
     * 導出そのものは deriveRuntimeTileUrl（m5-t3 の正本）に委ね、ここは thumbFolder の
     * 決定だけを行う。パス組み立ては resolveDraftTileDir を通す（'..' 等での親領域参照を
     * 構造的に排除する。M12-T20 §6.1 と同じ防御）。
     */
    ipcMain.handle('mapedit:deriveRuntimeTileUrl', async (_event, url?: string, mapRef?: string) => {
        // url が非空ならタイル実体を見る必要がない（deriveRuntimeTileUrl が url をそのまま返す）
        if (typeof url === 'string' && url) return deriveRuntimeTileUrl({ url }, '');

        const candidates: string[] = [];
        const draftDir = resolveDraftTileDir(draftTileRoot, mapRef);
        if (draftDir) candidates.push(path.join(draftDir, '0', '0'));
        const savedRoot = path.join(SettingsService.get('saveFolder') as string, 'tiles');
        const savedDir = resolveDraftTileDir(savedRoot, mapRef);
        if (savedDir) candidates.push(path.join(savedDir, '0', '0'));

        for (const thumbFolder of candidates) {
            const derived = await deriveRuntimeTileUrl(null, thumbFolder);
            if (derived) return derived;
        }
        return undefined;
    });

    // 旧実装: mapedit_getWmtsFolder 相当
    ipcMain.handle('mapedit:getWmtsFolder', async () => {
        const saveFolder = SettingsService.get('saveFolder') as string;
        return path.join(saveFolder, 'wmts');
    });

    // 旧実装: mapedit_download 相当（ZIP エクスポート）
    // M13-T1 (§2.6): compose + tmpFile書き出し + targets構築 + tileRoot収集 + ProgressReporter +
    // AdmZip + fs.move は buildAndWriteMapZip (mapDownloadZip.ts) へ移設した。
    // win 解決・mapDoc/slug/fileKey 解決・dialog/Canceled 判定のみここに残す
    ipcMain.handle('mapedit:download', async (event, mapObject: any, tins: any[]) => {
        const win = BrowserWindow.fromWebContents(event.sender)!;

        // 内部ファイル(tiles/tmbs)はuidキー、zip内の出力名はslug (ADR-0007: viewer互換)。
        // mapObject.uid が正本参照。uid欠落の旧経路にはslugフォールバックで解決する
        const mapDoc = mapObject.uid
            ? await SqliteDataService.findMap(mapObject.uid)
            : await SqliteDataService.findMapBySlug(mapObject.mapID);
        const slug = mapDoc?.slug || mapObject.mapID;
        const fileKey = mapDoc?.uid || slug;

        const ret = await dialog.showSaveDialog(win, {
            defaultPath: path.join(app.getPath('documents'), `${slug}.zip`),
            filters: [{ name: 'Output file', extensions: ['zip'] }],
        });
        if (ret.canceled || !ret.filePath) return 'Canceled';

        await buildAndWriteMapZip(win, mapObject, tins, slug, fileKey, ret.filePath);
        return 'Success';
    });

    // M13-T1 (§2.1): 保存済み地図専用のstrict-free搬出。strict_error/missing map判定を行わず、
    // 例外は全てcatchして'Error'へ写像する薄いラッパー(実処理はMapPurposeService側)
    ipcMain.handle('mapedit:download-saved', async (event, mapRef: string) => {
        const win = BrowserWindow.fromWebContents(event.sender)!;
        return await MapPurposeService.downloadSavedMap(win, mapRef);
    });

    // 旧実装: mapedit_uploadCsv 相当（CSV インポート）
    // M12-T22: 休眠パネル専用（削除禁止・M12-T23で再編予定）
    ipcMain.handle('mapedit:uploadCsv', async (event, csvRepl: string, csvUpSettings: any) => {
        const win = BrowserWindow.fromWebContents(event.sender)!;

        const ret = await dialog.showOpenDialog(win, {
            defaultPath: app.getPath('documents'),
            properties: ['openFile'],
            filters: [{ name: csvRepl, extensions: [] }],
        });

        if (ret.canceled || ret.filePaths.length === 0) {
            return { err: 'Canceled' };
        }

        const file = ret.filePaths[0];
        const results: any[] = [];
        const options = {
            strict: true,
            headers: false,
            skipLines: csvUpSettings.ignoreHeader ? 1 : 0,
        };

        return new Promise((resolve) => {
            fs.createReadStream(file)
                .pipe(csvParser(options))
                .on('data', (data: any) => results.push(data))
                .on('end', () => {
                    let error: string | null = null;
                    const gcps: any[] = [];
                    if (results.length === 0) {
                        error = 'csv_format_error';
                    }
                    results.forEach((line: any) => {
                        if (error) return;
                        try {
                            const illstCoord: number[] = [];
                            const rawGeoCoord: number[] = [];
                            illstCoord[0] = parseFloat(line[csvUpSettings.pixXColumn - 1]);
                            illstCoord[1] = parseFloat(line[csvUpSettings.pixYColumn - 1]);
                            if (csvUpSettings.reverseMapY) illstCoord[1] = -1 * illstCoord[1];
                            rawGeoCoord[0] = parseFloat(line[csvUpSettings.lngColumn - 1]);
                            rawGeoCoord[1] = parseFloat(line[csvUpSettings.latColumn - 1]);
                            const geoCoord = proj(csvUpSettings.projText, 'EPSG:3857', rawGeoCoord);
                            gcps.push([illstCoord, geoCoord]);
                        } catch (_e) {
                            error = 'csv_format_error';
                        }
                    });
                    if (error) {
                        resolve({ err: error });
                    } else {
                        resolve({ gcps });
                    }
                })
                .on('error', (e: any) => resolve({ err: String(e) }));
        });
    });

    // 旧実装 mapedit.js L.50-52 に準拠:
    // mercMap の表示範囲に重なる地図リストを検索して送信する（デバウンス付き）
    let extentCheckInProgress: boolean = false;
    let extentPending: number[] | null = null;
    ipcMain.handle('mapedit:checkExtentMap', async (event, extent: number[]) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (!win) return;

        if (!extentCheckInProgress) {
            if (!(extentPending && extentPending.every((v, i) => v === extent[i]))) {
                extentCheckInProgress = true;
                extentPending = extent;
                const mapIDs = await MapDataService.searchExtent(extent);
                win.webContents.send('mapedit:extentMapList', mapIDs);
                setTimeout(() => {
                    const queued = extentPending;
                    extentCheckInProgress = false;
                    extentPending = null;
                    if (queued && !queued.every((v, i) => v === extent[i])) {
                        // 1秒以内に新しい extent が来ていた場合、改めて処理
                        win.webContents.send('mapedit:checkExtentMapRetry', queued);
                    }
                }, 1000);
            }
        } else {
            // 処理中は最新 extent を保留
            extentPending = extent;
        }
    });
};
