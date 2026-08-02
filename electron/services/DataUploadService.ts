import fs from 'fs-extra';
import path from 'path';
import AdmZip from 'adm-zip';
import { app, dialog, BrowserWindow } from 'electron';
import SettingsService from './SettingsService';
import * as storeHandler from '../utils/store_handler';
import { deriveRuntimeTileUrl } from '../utils/runtimeTileUrl';
import SqliteDataService from './SqliteDataService';

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

            // --- 原版と同じバリデーション (slugはグローバル一意: ADR-0007) ---
            if (!(await SqliteDataService.isSlugAvailable(mapID))) throw 'Exist';
            if (!fs.existsSync(tilePath)) throw 'NoTile';
            if (!fs.existsSync(tmbPath))  throw 'NoTmb';

            // --- 原版と同じ: raw mapData をそのまま新規作成 (uidが採番される) ---
            const { uid } = await SqliteDataService.createMap(mapID, mapData);

            // 内部ファイル(tiles/tmbs)はuidキーに置く (ADR-0007)。zip内はslug名
            const tileToPath = path.join(tileFolder, uid);
            const tmbToPath  = path.join(uiThumbnailFolder, `${uid}.jpg`);

            // タイルとサムネイルを移動
            await fs.remove(tileToPath);
            await fs.move(tilePath, tileToPath);
            await fs.remove(tmbToPath);
            await fs.move(tmbPath, tmbToPath);

            // --- 原版の normalizeRequestData 相当 ---
            // store2HistMap で store 形式 → histMap 形式に変換。
            // M5-T3: byCompiled=true は MapEditService.request と同じ値。renderer は import 経路でも
            // 通常読み込み経路でも tins の各要素を Tin.setCompiled() へ渡すため、生 Compiled 形が要る
            // （byCompiled=false が返す Transform インスタンスは IPC の structured clone で
            // プロトタイプを失い、own-property も Compiled の形ではない）。
            // compiled を持たない層は createTinFromGcpsAsync が常に文字列 sentinel を返すため
            // byCompiled の影響を受けない
            const [histMap, tins] = await storeHandler.store2HistMap(mapData as any, true);
            (histMap as any).mapID  = mapID;
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
            return { err: typeof err === 'string' ? err : (err.message || 'Unknown') };
        }
    }
}

export default new DataUploadService();
