import { dialogDefaultPath, rememberDialogPath } from '../utils/dialogFolders';
import path from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { BrowserWindow, dialog, ipcMain } from 'electron';
import imageAssetService from '../services/ImageAssetService';
// #100: 長時間 IPC ハンドラを uncaughtException 時の settle 保証で wrap する
import { runGuarded } from '../utils/inflightGuard';
// feat2: 指定直後の一次表示。**token 方式**（main が選ばれたファイルにだけ発行し、
// renderer はパスを渡せない）で、判定は electron 非依存の純関数に寄せる
import {
  createPickedPathStore,
  mimeForPreviewExt,
  validatePreviewRequest,
} from '../utils/pickedPreviewSource';

// このプロセスの間だけ「利用者が選んだ画像のパス」を覚える表
// （ディスクへも IPC 応答へもパスを出さない。renderer は token でしか引けない）
const pickedPaths = createPickedPathStore();

// token → パスを引き当て、拡張子 allowlist とサイズ上限を通ったものだけバイト列を返す。
// renderer からパス文字列を受け取る口は作らない（任意ファイル読み出しの禁止。設計書 §8）。
async function readPickedSource(token: string) {
  const resolved = pickedPaths.resolve(token);
  if (!resolved.ok) return { ok: false as const, code: resolved.code };
  const filePath = resolved.filePath;
  const ext = path.extname(filePath).slice(1);
  const mime = mimeForPreviewExt(ext);
  if (!mime) return { ok: false as const, code: 'unsupported' as const };
  let byteSize: number;
  try {
    const info = await stat(filePath);
    if (!info.isFile()) return { ok: false as const, code: 'not-found' as const };
    byteSize = info.size;
  } catch {
    // 指定後に移動・削除された（renderer が理由文へ倒す）
    return { ok: false as const, code: 'not-found' as const };
  }
  const check = validatePreviewRequest({ ext, byteSize });
  if (!check.ok) {
    // 20 MB 超は**表示しない**。保存は従来どおり main が保存時に読み直すので成立する
    return { ok: false as const, code: check.code, byteSize };
  }
  try {
    const buffer = await readFile(filePath);
    return { ok: true as const, mime, byteSize: buffer.byteLength, bytes: new Uint8Array(buffer) };
  } catch {
    return { ok: false as const, code: 'not-found' as const };
  }
}

// 画像アセット IPC (Phase 2 Task 4, ADR-0007)。channel prefix は imageassets:* を使う
// (asset:checkSlug の asset:* 名前空間とは衝突しない)。結果 union は poisource:* と同形の慣習
export function registerImageAssetHandlers() {
  ipcMain.handle('imageassets:add', (_, input) =>
    runGuarded('imageassets:add', () => imageAssetService.add(input)));
  ipcMain.handle('imageassets:list', () => imageAssetService.list());
  ipcMain.handle('imageassets:search', (_, query) => imageAssetService.search(query));
  ipcMain.handle('imageassets:get', (_, ref) => imageAssetService.get(ref));
  ipcMain.handle('imageassets:update-metadata', (_, uid, input) =>
    runGuarded('imageassets:update-metadata', () => imageAssetService.updateMetadata(uid, input)));
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
      defaultPath: dialogDefaultPath('image'),
      properties: ['openFile' as const],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif'] }],
    };
    const ret = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    if (ret.canceled || ret.filePaths.length === 0) return null;
    const filePath = ret.filePaths[0];
    rememberDialogPath('image', filePath, 'file');
    // feat2: 一次表示用の token（renderer はこの token でしかバイト列を要求できない）
    const token = pickedPaths.register(filePath);
    return { filePath, fileName: path.basename(filePath), token };
  });
  // feat2: 指定した画像の一次画像（保存前のプレビュー）。引数は token だけ
  ipcMain.handle('imageassets:readPickedSource', (_, token) =>
    runGuarded('imageassets:readPickedSource', () => readPickedSource(token)));
}
