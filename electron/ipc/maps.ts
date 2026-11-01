import { ipc } from './registry';
import StorageAdapter from '../adapters/ElectronStorageAdapter';

export function registerMapHandlers() {
  ipc.handle('maplist:request', async (_event, query, page, pageSize) => {
    return await StorageAdapter.listMaps({ query, page, pageSize });
  });

  // uid正準の削除 (ADR-0007)
  ipc.handle('maplist:delete', async (_event, uid: string, condition: string, page: number) => {
    await StorageAdapter.deleteMap(uid);
    return await StorageAdapter.listMaps({ query: condition, page });
  });
}
