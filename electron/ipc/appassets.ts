import { ipcMain, BrowserWindow } from 'electron';
import AppAssetService from '../services/AppAssetService';

export function registerAppAssetHandlers() {
  ipcMain.handle('appassets:upload-tms-thumbnail', async (event, mapID: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)!;
    return await AppAssetService.uploadTmsThumbnail(win, mapID);
  });

  ipcMain.handle('appassets:upload-splash', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)!;
    return await AppAssetService.uploadSplash(win);
  });

  ipcMain.handle('appassets:upload-pwa-icon', async (event, appID: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)!;
    return await AppAssetService.uploadPwaIcon(win, appID);
  });

  // M12-T15 (R5): Maplat地図サムネイルの置換アップロード（512px/52px 独立 + 512px→52px 流用）
  // m19-t2: ext を透過（省略時は 'jpg' = 地図の既定）。チャネル名は変えない
  ipcMain.handle(
    'appassets:replace-map-thumbnail',
    async (event, mapUid: string, kind: '512' | '52', derive52: boolean, ext?: string) => {
      const win = BrowserWindow.fromWebContents(event.sender)!;
      return await AppAssetService.replaceMapThumbnail(win, mapUid, kind, derive52, ext);
    },
  );

  ipcMain.handle(
    'appassets:generate-tms-thumbnail',
    async (_event, mapID: string, tms: { url?: string; minZoom?: number; maxZoom?: number }, coverageLngLats: [number, number][]) => {
      return await AppAssetService.generateTmsThumbnail(mapID, tms, coverageLngLats);
    }
  );

  ipcMain.handle('appassets:file-url', (_event, relPath: string) => {
    return AppAssetService.fileUrlFor(relPath);
  });
}
