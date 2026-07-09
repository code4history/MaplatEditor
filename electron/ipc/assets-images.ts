import { ipcMain } from 'electron';
import imageAssetService from '../services/ImageAssetService';

// 画像アセット IPC (Phase 2 Task 4, ADR-0007)。channel prefix は imageassets:* を使う
// (asset:checkSlug の asset:* 名前空間とは衝突しない)。結果 union は poisource:* と同形の慣習
export function registerImageAssetHandlers() {
  ipcMain.handle('imageassets:add', (_, input) => imageAssetService.add(input));
  ipcMain.handle('imageassets:list', () => imageAssetService.list());
  ipcMain.handle('imageassets:search', (_, query) => imageAssetService.search(query));
  ipcMain.handle('imageassets:get', (_, ref) => imageAssetService.get(ref));
  ipcMain.handle('imageassets:rename', (_, uid, input) => imageAssetService.rename(uid, input));
  ipcMain.handle('imageassets:delete', (_, uid) => imageAssetService.delete(uid));
  ipcMain.handle('imageassets:getFilePath', (_, ref) => imageAssetService.getFilePath(ref));
}
