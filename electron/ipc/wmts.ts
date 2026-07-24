import { ipcMain, BrowserWindow } from 'electron';
import WmtsGeneratorService from '../services/WmtsGeneratorService';

export function registerWmtsHandlers() {
    ipcMain.handle('wmtsGen:generate', async (
        event,
        uid: string,
        mapID: string,
        width: number,
        height: number,
        tinSerial: any,
        extKey: string,
        hash: string
    ) => {
        const win = BrowserWindow.fromWebContents(event.sender)!;
        return WmtsGeneratorService.generate(win, uid, mapID, width, height, tinSerial, extKey, hash);
    });
}
