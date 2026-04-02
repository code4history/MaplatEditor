import { ipcMain } from 'electron';
import MapDataService from '../services/MapDataService';

export function registerMapHandlers() {
  ipcMain.handle('maplist:request', async (_event, query, page, pageSize) => {
    return await MapDataService.requestMaps(query, page, pageSize);
  });

  ipcMain.handle('maplist:delete', async (_event, mapID: string, condition: string, page: number) => {
    await MapDataService.deleteMap(mapID);
    return await MapDataService.requestMaps(condition, page);
  });
}
