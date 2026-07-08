import { ipcMain } from 'electron';
import StorageAdapter from '../adapters/ElectronStorageAdapter';

export function registerMapHandlers() {
  ipcMain.handle('maplist:request', async (_event, query, page, pageSize) => {
    return await StorageAdapter.listMaps({ query, page, pageSize });
  });

  // uid正準の削除 (ADR-0007)
  ipcMain.handle('maplist:delete', async (_event, uid: string, condition: string, page: number) => {
    await StorageAdapter.deleteMap(uid);
    return await StorageAdapter.listMaps({ query: condition, page });
  });
}
