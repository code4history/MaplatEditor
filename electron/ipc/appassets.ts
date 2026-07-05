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
