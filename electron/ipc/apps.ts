import { ipcMain, BrowserWindow } from 'electron';
import AppDataService from '../services/AppDataService';
import AppPreviewService from '../services/AppPreviewService';

export function registerAppHandlers() {
  ipcMain.handle('applist:request', async (_event, query, page, pageSize) => {
    return await AppDataService.requestApps(query, page, pageSize);
  });

  ipcMain.handle('applist:delete', async (_event, appID: string, condition: string, page: number) => {
    await AppDataService.deleteApp(appID);
    return await AppDataService.requestApps(condition, page);
  });

  ipcMain.handle('appedit:request', async (_event, appID: string) => {
    return await AppDataService.getApp(appID);
  });

  ipcMain.handle('appedit:save', async (_event, appID: string, document: any) => {
    try {
      const result = await AppDataService.saveApp(appID, document);
      if (result === 'Success') {
        BrowserWindow.getAllWindows().forEach(win => {
          win.webContents.send('applist:refresh');
        });
      }
      return result;
    } catch (e) {
      console.error('Failed to handle appedit:save', e);
      return 'Error';
    }
  });

  ipcMain.handle('appedit:checkID', async (_event, appID: string) => {
    try {
      return await AppDataService.isAppIdAvailable(appID);
    } catch (e) {
      console.error('Failed to handle appedit:checkID', e);
      return false;
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
}
