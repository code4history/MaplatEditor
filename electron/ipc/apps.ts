import { ipcMain, BrowserWindow } from 'electron';
import AppDataService from '../services/AppDataService';
import AppPreviewService from '../services/AppPreviewService';
import AppExportService from '../services/AppExportService';
import { runGuarded } from '../utils/inflightGuard';

export function registerAppHandlers() {
  ipcMain.handle('applist:request', async (_event, query, page, pageSize) => {
    return await AppDataService.requestApps(query, page, pageSize);
  });

  // 削除はuid正準 (ADR-0007)
  ipcMain.handle('applist:delete', async (_event, uid: string, condition: string, page: number) => {
    await AppDataService.deleteApp(uid);
    return await AppDataService.requestApps(condition, page);
  });

  // uid正準の読み出し (ADR-0007)。旧経路への保険としてslugでも解決される
  ipcMain.handle('appedit:request', async (_event, uidOrSlug: string) => {
    return await AppDataService.getApp(uidOrSlug);
  });

  // payload: { document, uid?, slug, expectedRevision? } (ADR-0007)
  ipcMain.handle('appedit:save', async (_event, payload: any) => {
    try {
      const result = await AppDataService.saveApp(payload);
      if (result && 'result' in result && result.result === 'Success') {
        BrowserWindow.getAllWindows().forEach(win => {
          win.webContents.send('applist:refresh');
        });
      }
      return result;
    } catch (e) {
      console.error('Failed to handle appedit:save', e);
      return { result: 'Error' };
    }
  });

  // m6-t6 (§3.2): overrideKeys はオンザフライ入力（保存しない）。省略時は現行どおり
  // t1 (§4.5): runGuarded でメインプロセスの uncaughtException 時にも必ず settle させる
  // （reply was never sent の構造的防壁。適用範囲は appedit:export のみ — blast radius を広げない）
  ipcMain.handle('appedit:export', async (event, document: any, overrideKeys?: { googleApiKey?: string; mapboxToken?: string }) => {
    const win = BrowserWindow.fromWebContents(event.sender)!;
    try {
      return await runGuarded('appedit:export',
        () => AppExportService.exportApp(win, document, overrideKeys));
    } catch (e: any) {
      console.error('Failed to handle appedit:export', e);
      return { result: 'Error', warnings: [], message: e?.message || String(e) };
    }
  });

  ipcMain.handle('appedit:prepare-preview', async (_event, document: any) => {
    try {
      return await AppPreviewService.prepare(document);
    } catch (e) {
      console.error('Failed to handle appedit:prepare-preview', e);
      throw e;
    }
  });

  // M1-T6 (d-2): プレビュータブから離れる / AppEdit を離脱する際にサーバを止める。
  // 従来は停止経路が無く、macOS ではウィンドウを閉じてもポートを掴んだまま常駐していた
  ipcMain.handle('appedit:stop-preview', async () => {
    try {
      await AppPreviewService.shutdown();
    } catch (e) {
      console.error('Failed to handle appedit:stop-preview', e);
      throw e;
    }
  });
}
