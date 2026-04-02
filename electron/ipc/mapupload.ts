/**
 * mapupload.ts
 * 旧実装 backend/src/mapupload.js の IPC ハンドラ部分の TypeScript 移植版
 *
 * 主な変更点:
 * - ipcMain.on + ev.reply → ipcMain.handle (Promise化)
 * - プログレスは webContents.send('mapedit:taskProgress', ...) で送信
 */
import { ipcMain, BrowserWindow } from 'electron';
import { showMapSelectDialog } from '../services/MapUploadService';
import SettingsService from '../services/SettingsService';

export function registerMapUploadHandlers() {
    // 旧実装: ipcMain.on('mapupload_showMapSelectDialog', ...)
    ipcMain.handle('mapupload:showMapSelectDialog', async (event, mapImageLabel: string) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (!win) throw new Error('BrowserWindow not found');

        const tmpFolder = SettingsService.get('tmpFolder') as string;
        return await showMapSelectDialog(win, tmpFolder, mapImageLabel);
    });
}
