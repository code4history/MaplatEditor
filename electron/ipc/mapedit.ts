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
import MapEditService from '../services/MapEditService';
import MapDataService from '../services/MapDataService';
import SettingsService from '../services/SettingsService';
import * as storeHandler from '../utils/store_handler';
import { ProgressReporter } from '../utils/ProgressReporter';
// @ts-ignore
import Tin from '@maplat/tin';

async function createTinFromGcpsAsync(
    gcps: any[], edges: any[], wh: any, bounds: any, strict: any, vertex: any
): Promise<any> {
    if (gcps.length < 3) return 'tooLessGcps';
    return new Promise((resolve, reject) => {
        const tin = new Tin({});
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
    ipcMain.handle('mapedit:request', async (_event, mapID: string) => {
        try {
            return await MapEditService.request(mapID);
        } catch (e) {
            console.error('Failed to handle mapedit:request', e);
            throw e;
        }
    });

    ipcMain.handle('mapedit:save', async (_event, mapObject: any, tins: any[]) => {
        try {
            return await MapEditService.save(mapObject, tins);
        } catch (e) {
            console.error('Failed to handle mapedit:save', e);
            return 'Error';
        }
    });

    ipcMain.handle('mapedit:checkID', async (_event, mapID: string) => {
        try {
            const db = await MapDataService.getDBInstance();
            const found = await db.findOneAsync({ _id: mapID });
            // 旧実装: found がない場合 true (使用可能), ある場合 false
            return !found;
        } catch (e) {
            console.error('Failed to handle mapedit:checkID', e);
            return false;
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
        const mapID = mapObject.mapID;
        const tmpFolder  = SettingsService.get('tmpFolder') as string;
        const saveFolder = SettingsService.get('saveFolder') as string;
        const tileFolder = path.join(saveFolder, 'tiles');
        const thumbFolder = path.join(saveFolder, 'tmbs');

        // histMap2Store で store 形式に変換してから JSON 保存
        const compiled = await storeHandler.histMap2Store(mapObject, tins);
        const tmpFile = path.join(tmpFolder, `${mapID}.json`);
        await fs.ensureDir(tmpFolder);
        await fs.writeFile(tmpFile, JSON.stringify(compiled));

        // ZIP に追加するファイルリスト: [localPath, zipDir, zipName]
        const targets: [string, string, string][] = [
            [tmpFile, 'maps', `${mapID}.json`],
            [path.join(thumbFolder, `${mapID}.jpg`), 'tmbs', `${mapID}.jpg`],
        ];

        // タイルファイルを再帰的に収集
        try {
            const { files } = await recursiveFs.read(path.join(tileFolder, mapID));
            for (const file of files) {
                const localPath = path.resolve(file);
                const zipName   = path.basename(localPath);
                const zipPath   = path.dirname(localPath).match(/[/\\](tiles[/\\].+$)/)?.[1];
                if (zipPath) targets.push([localPath, zipPath, zipName]);
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

        const zipFilePath = path.join(tmpFolder, `${mapID}.zip`);
        const zip = new AdmZip();
        for (let i = 0; i < targets.length; i++) {
            const [localPath, zipDir, zipName] = targets[i];
            if (fs.existsSync(localPath)) {
                zip.addLocalFile(localPath, zipDir, zipName);
            }
            reporter.update(i + 1);
        }
        zip.writeZip(zipFilePath);

        const ret = await dialog.showSaveDialog(win, {
            defaultPath: path.join(app.getPath('documents'), `${mapID}.zip`),
            filters: [{ name: 'Output file', extensions: ['zip'] }],
        });

        await fs.remove(tmpFile);

        if (!ret.canceled && ret.filePath) {
            await fs.move(zipFilePath, ret.filePath, { overwrite: true });
            return 'Success';
        } else {
            await fs.remove(zipFilePath);
            return 'Canceled';
        }
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
};

