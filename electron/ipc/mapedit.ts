import { ipcMain, BrowserWindow, dialog, app } from 'electron';
import fs from 'fs-extra';
import path from 'path';
import AdmZip from 'adm-zip';
// @ts-ignore
import recursiveFs from 'recursive-fs';
// @ts-ignore
import csvParser from 'csv-parser';
// @ts-ignore
import proj from 'proj4';
import MapDataService from '../services/MapDataService';
import SqliteDataService from '../services/SqliteDataService';
import SettingsService from '../services/SettingsService';
import StorageAdapter from '../adapters/ElectronStorageAdapter';
import * as storeHandler from '../utils/store_handler';
import { compactMapLangFields } from '../../src/utils/langResource';
import { ProgressReporter } from '../utils/ProgressReporter';
import { resolvePoisArray, type IconFile } from '../services/poiReferenceResolver';
// @ts-ignore
import Tin from '@maplat/tin';

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

// download 用の交換形 map JSON を組み立てる (M2)。histMap2Store + 言語畳み込みの後、
// pois 内の {poiUid} 参照を resolvePoisArray で export 形 FC へ解決する
// (AppExportService/AppPreviewService と同じ viewer 互換の扱いに統一)。
// icon 参照文法も同時に imgs/... へ解決され (POI-117, M1)、実体コピー要求 files を返す
// (呼び出し側が ZIP の imgs/... へ同梱する)。
// mapedit:download の戻り値は 'Success'|'Canceled' の文字列契約 (renderer 未配線) を保つため、
// warnings はここでは返すのみに留め、呼び出し側で console.warn するか判断させる
export async function composeDownloadMapJson(
    mapObject: any, tins: any[]
): Promise<{ compiled: any; warnings: string[]; files: IconFile[] }> {
    const compiled = compactMapLangFields(await storeHandler.histMap2Store(mapObject, tins));
    // 交換形にはv2の内部メタデータ(uid/slug/revision)を含めない (ADR-0007)
    delete (compiled as any).uid;
    delete (compiled as any).slug;
    delete (compiled as any).revision;
    let warnings: string[] = [];
    let files: IconFile[] = [];
    if (Array.isArray((compiled as any).pois)) {
        const resolved = await resolvePoisArray((compiled as any).pois);
        warnings = resolved.warnings;
        files = resolved.files;
        (compiled as any).pois = resolved.pois;
    }
    return { compiled, warnings, files };
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
    ipcMain.handle('mapedit:download', async (event, mapObject: any, tins: any[]) => {
        const win = BrowserWindow.fromWebContents(event.sender)!;
        const tmpFolder  = SettingsService.get('tmpFolder') as string;
        const saveFolder = SettingsService.get('saveFolder') as string;
        const tileFolder = path.join(saveFolder, 'tiles');
        const thumbFolder = path.join(saveFolder, 'tmbs');

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

        // histMap2Store で store 形式に変換してから JSON 保存。
        // エクスポート(交換形)ではデフォルト言語のみの言語別フィールドを
        // プレーン文字列に畳み込む (ADR-0005)。pois 内の {poiUid} 参照は export 形 FC へ
        // 解決する (viewer 互換, M2)。renderer には warnings を表示する経路が未配線のため
        // console.warn で可視化するに留める (判断根拠は Phase 7 品質レビュー M2 参照)
        const { compiled, warnings, files } = await composeDownloadMapJson(mapObject, tins);
        if (warnings.length > 0) {
            console.warn('[mapedit:download] POI reference warnings:', warnings);
        }
        const tmpFile = path.join(tmpFolder, `${slug}.json`);
        await fs.ensureDir(tmpFolder);
        await fs.writeFile(tmpFile, JSON.stringify(compiled));

        // ZIP に追加するファイルリスト: [localPath, zipDir, zipName]
        const targets: [string, string, string][] = [
            [tmpFile, 'maps', `${slug}.json`],
            [path.join(thumbFolder, `${fileKey}.jpg`), 'tmbs', `${slug}.jpg`],
        ];

        // 解決済み POI icon の実体 (POI-117): zip ルート相対 imgs/... へ同梱
        // (viewer は icon をページ URL 基準で解決するため、index.html と同階層に置かれる想定の配置)
        for (const file of files) {
            const destSegments = file.dest.split('/');
            const zipName = destSegments.pop()!;
            targets.push([file.src, destSegments.join('/'), zipName]);
        }

        // タイルファイルを再帰的に収集(読み込みはtiles/{uid}、zip内はtiles/{slug})
        const tileRoot = path.join(tileFolder, fileKey);
        try {
            const { files } = await recursiveFs.read(tileRoot);
            for (const file of files) {
                const localPath = path.resolve(file);
                const zipName   = path.basename(localPath);
                const relDir    = path.relative(tileRoot, path.dirname(localPath));
                const zipPath   = ['tiles', slug, ...relDir.split(path.sep).filter(Boolean)].join('/');
                targets.push([localPath, zipPath, zipName]);
            }
        } catch (_e) { /* タイルなし */ }

        const reporter = new ProgressReporter(
            'mapedit:taskProgress',
            targets.length,
            'mapdownload.adding_zip',
            'mapdownload.creating_zip'
        );
        reporter.setWindow(win);
        reporter.update(0);

        const zipFilePath = path.join(tmpFolder, `${slug}.zip`);
        const zip = new AdmZip();
        for (let i = 0; i < targets.length; i++) {
            const [localPath, zipDir, zipName] = targets[i];
            if (fs.existsSync(localPath)) {
                zip.addLocalFile(localPath, zipDir, zipName);
            }
            reporter.update(i + 1);
        }
        zip.writeZip(zipFilePath);

        await fs.remove(tmpFile);
        await fs.move(zipFilePath, ret.filePath, { overwrite: true });
        return 'Success';
    });

    // 旧実装: mapedit_uploadCsv 相当（CSV インポート）
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
