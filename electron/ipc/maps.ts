import { ipcMain } from 'electron';
import StorageAdapter from '../adapters/ElectronStorageAdapter';

export function registerMapHandlers() {
  ipcMain.handle('maplist:request', async (_event, query, page, pageSize) => {
    return await StorageAdapter.listMaps({ query, page, pageSize });
  });

  ipcMain.handle('maplist:delete', async (_event, mapID: string, condition: string, page: number) => {
    await StorageAdapter.deleteMap(mapID);
    return await StorageAdapter.listMaps({ query: condition, page });
  });
}
