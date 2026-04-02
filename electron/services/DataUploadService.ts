import fs from 'fs-extra';
import path from 'path';
import AdmZip from 'adm-zip';
import { app, dialog, BrowserWindow } from 'electron';
import SettingsService from './SettingsService';
import * as storeHandler from '../utils/store_handler';
import MapDataService from './MapDataService';

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

    async extractZip(zipFile: string): Promise<any> {
        const { tileFolder, uiThumbnailFolder, tmpFolder } = this.folders;
        const dataTmpFolder = path.join(tmpFolder, 'zip');

        try {
            await fs.remove(dataTmpFolder);
            await fs.ensureDir(dataTmpFolder);

            const zip = new AdmZip(zipFile);
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
            const tileToPath = path.join(tileFolder, mapID);
            const tmbToPath  = path.join(uiThumbnailFolder, `${mapID}.jpg`);

            // --- 原版と同じバリデーション ---
            const db = await MapDataService.getDBInstance();
            const existCheck = await db.findOneAsync({ _id: mapID });
            if (existCheck) throw 'Exist';
            if (!fs.existsSync(tilePath)) throw 'NoTile';
            if (!fs.existsSync(tmbPath))  throw 'NoTmb';

            // --- 原版と同じ: raw mapData をそのまま upsert ---
            await db.updateAsync({ _id: mapID }, { $set: mapData }, { upsert: true });

            // タイルとサムネイルを移動
            await fs.remove(tileToPath);
            await fs.move(tilePath, tileToPath);
            await fs.remove(tmbToPath);
            await fs.move(tmbPath, tmbToPath);

            // --- 原版の normalizeRequestData 相当 ---
            // store2HistMap で store 形式 → histMap 形式に変換
            const [histMap, tins] = await storeHandler.store2HistMap(mapData as any);
            (histMap as any).mapID  = mapID;
            (histMap as any).status = 'Update';

            // タイル URL を発見して url_ にセット
            const thumbFolder = path.join(tileToPath, '0', '0');
            if (fs.existsSync(thumbFolder)) {
                const thumbs = await fs.readdir(thumbFolder);
                const tileFile = thumbs.find(f => /^0\.(jpg|jpeg|png)$/.test(f));
                if (tileFile) {
                    let thumbURL = `file://${path.join(tileToPath, '0', '0', tileFile).split(path.sep).join('/')}`;
                    thumbURL = thumbURL.replace(/\/0\/0\/0\./, '/{z}/{x}/{y}.');
                    (histMap as any).url_ = thumbURL;
                }
            }

            return { mapData: histMap, tins };
        } catch (err: any) {
            console.error('[DataUploadService] extractZip error', err);
            return { err: typeof err === 'string' ? err : (err.message || 'Unknown') };
        }
    }
}

export default new DataUploadService();
