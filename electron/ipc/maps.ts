import { ipcMain, BrowserWindow } from 'electron';
import MapDataService from '../services/MapDataService';

export function registerMapHandlers() {
  ipcMain.handle('maplist:request', async (event, query, page, pageSize) => {
    // Also trigger migration if needed
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) await MapDataService.migrateIfNeeded(win);
    return await MapDataService.requestMaps(query, page, pageSize);
  });
}
