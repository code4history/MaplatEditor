import { dialogDefaultPath, rememberDialogPath } from '../utils/dialogFolders';
import { dialog, BrowserWindow } from 'electron';
import { ipc } from './registry';
import path from 'path';
import poiSourceService from '../services/PoiSourceService';
import { inspectPoiExport, writePoiExport } from '../services/PoiPackageService';
// #100: 長時間 IPC ハンドラを uncaughtException 時の settle 保証で wrap する
import { runGuarded } from '../utils/inflightGuard';

// POI ソース IPC (Phase 2 Task 3, ADR-0007)。channel prefix は poisource:* を維持しつつ
// 引数契約を uid/slug へ刷新。結果 union は maps/apps と同形 (PoiSourceSaveResult)
export function registerPoisourceHandlers() {
  ipc.handle('poisource:list', (_, request) => poiSourceService.list(request));
  ipc.handle('poisource:get', (_, uid) => poiSourceService.get(uid));
  ipc.handle('poisource:createLocal', (_, input) => poiSourceService.createLocal(input));
  ipc.handle('poisource:save', (_, uid, payload) => poiSourceService.save(uid, payload));
  ipc.handle('poisource:importFile', (_, input) =>
    runGuarded('poisource:importFile', () => poiSourceService.importFile(input)));
  ipc.handle('poisource:detectImportLanguage', (_, filePath, fallbackLang) =>
    poiSourceService.detectImportLanguage(filePath, fallbackLang));
  ipc.handle('poisource:registerRemote', (_, input) => poiSourceService.registerRemote(input));
  ipc.handle('poisource:refreshRemote', (_, uid) =>
    runGuarded('poisource:refreshRemote', () => poiSourceService.refreshRemote(uid)));
  ipc.handle('poisource:cloneToLocal', (_, uid, input) =>
    runGuarded('poisource:cloneToLocal', () => poiSourceService.cloneToLocal(uid, input)));
  ipc.handle('poisource:findReferences', (_, uid) => poiSourceService.findReferences(uid));
  ipc.handle('poisource:delete', (_, uid) => poiSourceService.delete(uid));
  // rendererから任意pathを受け取らず、保存先はnative dialogの返値だけを使う。
  ipc.handle('poisource:exportFile', async (event, uid: string) => {
    try {
      const fc = await poiSourceService.exportForm(uid);
      if (!fc) return { result: 'Error', message: 'POI source not found' } as const;
      const inspection = await inspectPoiExport(fc);
      const extension = inspection.kind === 'zip' ? 'zip' : 'geojson';
      const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
      const options = {
        filters: inspection.kind === 'zip'
          ? [{ name: 'POI package', extensions: ['zip'] }]
          : [{ name: 'GeoJSON', extensions: ['geojson', 'json'] }],
        defaultPath: dialogDefaultPath('export', `${inspection.slug}.${extension}`),
      };
      const ret = win
        ? await dialog.showSaveDialog(win, options)
        : await dialog.showSaveDialog(options);
      if (ret.canceled || !ret.filePath) return { result: 'Canceled' } as const;
      rememberDialogPath('export', ret.filePath, 'file');
      await runGuarded('poisource:exportFile', () => writePoiExport(inspection, ret.filePath));
      return { result: 'Success', filePath: ret.filePath } as const;
    } catch (error) {
      console.error('[poisource:exportFile] failed:', error);
      return {
        result: 'Error',
        message: error instanceof Error ? error.message : String(error),
      } as const;
    }
  });

  // インポート用ファイル選択 (Phase 3)。GeoJSON/JSON を選ばせ path とファイル名を返す。
  // 実取り込みは renderer が slug/title を収集後に poisource:importFile を呼ぶ二段構え。
  ipc.handle('poisource:pickImportFile', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const options = {
      defaultPath: dialogDefaultPath('import'),
      properties: ['openFile' as const],
      filters: [{ name: 'POI data', extensions: ['geojson', 'json', 'zip'] }],
    };
    const ret = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    if (ret.canceled || ret.filePaths.length === 0) return null;
    const filePath = ret.filePaths[0];
    rememberDialogPath('import', filePath, 'file');
    return { filePath, fileName: path.basename(filePath) };
  });
}
