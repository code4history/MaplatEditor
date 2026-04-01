import { ipcMain, BrowserWindow } from 'electron';
import MapDataService from '../services/MapDataService';

export function registerMapHandlers() {
  ipcMain.handle('maplist:request', async (event, query, page, pageSize) => {
    // 必要に応じてマイグレーション処理を実行
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) await MapDataService.migrateIfNeeded(win);
    return await MapDataService.requestMaps(query, page, pageSize);
  });

  ipcMain.handle('maplist:delete', async (_event, mapID: string, condition: string, page: number) => {
    await MapDataService.deleteMap(mapID);
    return await MapDataService.requestMaps(condition, page);
  });
}
