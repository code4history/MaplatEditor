import path from 'node:path';
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
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
  // 逆参照 (削除確認フローが使う。43 §7 の AID-006 と同型)
  ipcMain.handle('imageassets:findReferences', (_, ref) => imageAssetService.findReferences(ref));
  // インポート用ファイル選択 (poisource:pickImportFile と同型)。SVG / webp は Jimp でデコードできず
  // add が invalid-request で拒否するため、フィルタから外す(選ばせても必ず失敗する形式を
  // ダイアログに出さない)。webp は Jimp 1.6 が decode 非対応(実機で
  // "Mime type image/webp does not support decoding" を確認済み。@jimp/wasm-webp 導入は本 Phase 対象外)
  ipcMain.handle('imageassets:pickImageFile', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const options = {
      defaultPath: app.getPath('documents'),
      properties: ['openFile' as const],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif'] }],
    };
    const ret = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    if (ret.canceled || ret.filePaths.length === 0) return null;
    const filePath = ret.filePaths[0];
    return { filePath, fileName: path.basename(filePath) };
  });
}
