import { ipcMain, BrowserWindow } from 'electron';
import SettingsService from '../services/SettingsService';
import MapDataService from '../services/MapDataService';

export function registerSettingsHandlers() {
  ipcMain.removeHandler('settings:get'); // Remove if exists (idempotent)
  ipcMain.handle('settings:get', (_, key: string) => {
    return SettingsService.get(key);
  });

  ipcMain.handle('settings:set', async (event, key: string, value: any) => {
    SettingsService.set(key, value);
    if (key === 'saveFolder') {
        await MapDataService.switchDataFolder();
        // Notify all windows that map list needs refresh
        BrowserWindow.getAllWindows().forEach(win => {
            win.webContents.send('maplist:refresh');
        });
    }
  });

  ipcMain.handle('settings:select-folder', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    return await SettingsService.showSaveFolderDialog(window);
  });
}
