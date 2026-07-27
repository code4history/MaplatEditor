/**
 * mapupload.ts
 * 旧実装 backend/src/mapupload.js の IPC ハンドラ部分の TypeScript 移植版
 *
 * 主な変更点:
 * - ipcMain.on + ev.reply → ipcMain.handle (Promise化)
 * - プログレスは webContents.send('mapedit:taskProgress', ...) で送信
 * - M12-T20: staging を揮発 tmp から永続 draft-tiles/{assetUid} へ移行（設計 §5.1）。
 *   staging dir は共通バリデータ（draftTilePaths.resolveDraftTileDir）でのみ解決する
 */
import { ipcMain, BrowserWindow } from 'electron';
import { showMapSelectDialog } from '../services/MapUploadService';
import { draftTileRoot, resolveDraftTileDir } from '../services/draftTilePaths';

export function registerMapUploadHandlers() {
    // 旧実装: ipcMain.on('mapupload_showMapSelectDialog', ...)
    ipcMain.handle('mapupload:showMapSelectDialog', async (event, mapImageLabel: string, draftAssetUid: string) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (!win) throw new Error('BrowserWindow not found');

        // M12-T20 (§5.0): ダイアログ表示・fs 操作の前に staging dir を解決。null なら即時 err
        // （正規 UI からは発生しない — uid はアプリ採番 uuid — ため防御専用。renderer は
        // 既存 err 経路で mapedit.error_image_upload を表示する）
        const stagingDir = resolveDraftTileDir(draftTileRoot, draftAssetUid);
        if (!stagingDir) {
            return { err: 'invalid draftAssetUid' };
        }
        return await showMapSelectDialog(win, stagingDir, mapImageLabel);
    });
}
