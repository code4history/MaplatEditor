import { ipcMain } from 'electron';
import poiSourceService from '../services/PoiSourceService';

// POI ソース IPC (Phase 2 Task 3, ADR-0007)。channel prefix は poisource:* を維持しつつ
// 引数契約を uid/slug へ刷新。結果 union は maps/apps と同形 (PoiSourceSaveResult)
export function registerPoisourceHandlers() {
  ipcMain.handle('poisource:list', (_, request) => poiSourceService.list(request));
  ipcMain.handle('poisource:get', (_, uid) => poiSourceService.get(uid));
  ipcMain.handle('poisource:createLocal', (_, input) => poiSourceService.createLocal(input));
  ipcMain.handle('poisource:save', (_, uid, payload) => poiSourceService.save(uid, payload));
  ipcMain.handle('poisource:importFile', (_, input) => poiSourceService.importFile(input));
  ipcMain.handle('poisource:registerRemote', (_, input) => poiSourceService.registerRemote(input));
  ipcMain.handle('poisource:refreshRemote', (_, uid) => poiSourceService.refreshRemote(uid));
  ipcMain.handle('poisource:cloneToLocal', (_, uid, input) => poiSourceService.cloneToLocal(uid, input));
  ipcMain.handle('poisource:findReferences', (_, uid) => poiSourceService.findReferences(uid));
  ipcMain.handle('poisource:delete', (_, uid) => poiSourceService.delete(uid));
}
