import { ipcMain, BrowserWindow, dialog, app } from 'electron';
import fs from 'fs-extra';
import path from 'path';
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
