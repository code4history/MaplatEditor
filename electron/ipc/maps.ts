import { ipc } from './registry';
import StorageAdapter from '../adapters/ElectronStorageAdapter';
import * as readFacade from '../mcp/readFacade';

export function registerMapHandlers() {
  // 読み取りは MCP のツールと同じ窓口を通す（読む経路を 1 つにする）
  ipc.handle('maplist:request', async (_event, query, page, pageSize) => {
    return await readFacade.listMaps({ query, page, pageSize });
  });

  // uid正準の削除 (ADR-0007)
  ipc.handle('maplist:delete', async (_event, uid: string, condition: string, page: number) => {
    await StorageAdapter.deleteMap(uid);
    return await StorageAdapter.listMaps({ query: condition, page });
  });
}
