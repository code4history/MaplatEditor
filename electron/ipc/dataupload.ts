import { ipcMain, BrowserWindow } from 'electron';
import DataUploadService from '../services/DataUploadService';

export function registerDataUploadHandlers() {
    ipcMain.handle('dataupload:showDataSelectDialog', async (event) => {
        const win = BrowserWindow.fromWebContents(event.sender)!;
        return DataUploadService.showDataSelectDialog(win);
    });
}
