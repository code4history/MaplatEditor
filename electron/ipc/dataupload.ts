import { ipcMain, BrowserWindow } from 'electron';
import DataUploadService from '../services/DataUploadService';
// #100: 長時間 IPC ハンドラを uncaughtException 時の settle 保証で wrap する
import { runGuarded } from '../utils/inflightGuard';

export function registerDataUploadHandlers() {
    ipcMain.handle('dataupload:showDataSelectDialog', async (event) => {
        const win = BrowserWindow.fromWebContents(event.sender)!;
        return await runGuarded('dataupload:showDataSelectDialog',
            () => DataUploadService.showDataSelectDialog(win));
    });
}
