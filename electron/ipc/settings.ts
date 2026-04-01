import { ipcMain, BrowserWindow } from 'electron';
import SettingsService from '../services/SettingsService';
import MapDataService from '../services/MapDataService';

export function registerSettingsHandlers() {
  ipcMain.handle('settings:get', (_, key: string) => {
    return SettingsService.get(key);
  });

  ipcMain.handle('settings:set', async (_, key: string, value: any) => {
    SettingsService.set(key, value);
    if (key === 'saveFolder') {
        await MapDataService.switchDataFolder();
        // saveFolder変更時、全ウィンドウにマップリストの更新を通知する
        BrowserWindow.getAllWindows().forEach(win => {
            win.webContents.send('maplist:refresh');
        });
    }
  });

  ipcMain.handle('settings:select-folder', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    return await SettingsService.showSaveFolderDialog(window);
  });

  ipcMain.handle('mapedit:get-tms-list', async (_, mapID: string) => {
    return await SettingsService.getTmsListOfMapID(mapID);
  });
}
