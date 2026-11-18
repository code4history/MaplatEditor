import { BrowserWindow } from 'electron';
import { ipc } from './registry';
import AppDataService from '../services/AppDataService';
import AppPreviewService from '../services/AppPreviewService';
import AppExportService from '../services/AppExportService';
import { runGuarded } from '../utils/inflightGuard';

export function registerAppHandlers() {
  ipc.handle('applist:request', async (_event, query, page, pageSize) => {
    return await AppDataService.requestApps(query, page, pageSize);
  });

  // 削除はuid正準 (資産の正本の識別子は変わらない uid とし、slug は全種類で一意な利用者向けの名前とする決まり)
  ipc.handle('applist:delete', async (_event, uid: string, condition: string, page: number) => {
    await AppDataService.deleteApp(uid);
    return await AppDataService.requestApps(condition, page);
  });

  // uid正準の読み出し (資産の正本の識別子は変わらない uid とし、slug は全種類で一意な利用者向けの名前とする決まり)。旧経路への保険としてslugでも解決される
  ipc.handle('appedit:request', async (_event, uidOrSlug: string) => {
    return await AppDataService.getApp(uidOrSlug);
  });

  // payload: { document, uid?, slug, expectedRevision? } (the rule that an immutable UUID is the canonical ID and the slug is a user-facing name unique across all asset kinds)
  ipc.handle('appedit:save', async (_event, payload: any) => {
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

  // overrideKeys はオンザフライ入力（保存しない）。省略時は現行どおり
  // runGuarded でメインプロセスの uncaughtException 時にも必ず settle させる
  // （reply was never sent の構造的防壁。適用範囲は appedit:export のみ — blast radius を広げない）
  // #113: 第 3 引数 options.includeTiles（省略時は含める）
  ipc.handle('appedit:export', async (event, document: any, overrideKeys?: { googleApiKey?: string; mapboxToken?: string }, options?: { includeTiles?: boolean }) => {
    const win = BrowserWindow.fromWebContents(event.sender)!;
    try {
      return await runGuarded('appedit:export',
        () => AppExportService.exportApp(win, document, overrideKeys, options));
    } catch (e: any) {
      console.error('Failed to handle appedit:export', e);
      return { result: 'Error', warnings: [], message: e?.message || String(e) };
    }
  });

  ipc.handle('appedit:prepare-preview', async (_event, document: any) => {
    try {
      return await AppPreviewService.prepare(document);
    } catch (e) {
      console.error('Failed to handle appedit:prepare-preview', e);
      throw e;
    }
  });

  // プレビュータブから離れる / AppEdit を離脱する際にサーバを止める。
  // 従来は停止経路が無く、macOS ではウィンドウを閉じてもポートを掴んだまま常駐していた
  ipc.handle('appedit:stop-preview', async () => {
    try {
      await AppPreviewService.shutdown();
    } catch (e) {
      console.error('Failed to handle appedit:stop-preview', e);
      throw e;
    }
  });
}
