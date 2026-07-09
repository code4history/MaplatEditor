import { ipcMain, BrowserWindow } from 'electron';
import fs from 'fs-extra';
import path from 'path';
import SettingsService from '../services/SettingsService';
import MapDataService from '../services/MapDataService';
import { resourceAssetFileUrl } from '../utils/resourceAssets';

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

  // ベースマップ表示設定 (ADR-0007): 引数はuid正準
  // (mapRefは未保存地図のみslug。baseMapRefはlistBaseMapsが返すuid)
  ipcMain.handle('mapedit:get-tms-list', async (_, mapRef: string) => {
    return await SettingsService.getTmsListOfMapID(mapRef);
  });

  ipcMain.handle('mapedit:get-base-map-visibility', async (_, mapRef: string) => {
    return await SettingsService.getBaseMapVisibilityOfMapID(mapRef);
  });

  ipcMain.handle('mapedit:set-base-map-visibility', async (_, mapRef: string, baseMapRef: string, enabled: boolean) => {
    await SettingsService.setBaseMapVisibilityForMapID(mapRef, baseMapRef, enabled);
  });

  ipcMain.handle('basemaps:list', async () => {
    const items = await SettingsService.listBaseMaps();
    const saveFolder = SettingsService.get('saveFolder') as string;
    // マスタのthumbnail(basemap_icons/=同梱リソース, tmbs/等=データフォルダ)をUI表示用URLへ解決する。
    // thumbnail未設定の旧ユーザーベースマップはtmbs/{mapID}_menu.jpgの存在で補完する。
    return items.map((item: any) => {
      let thumbnailUrl: string | null = null;
      const thumbnail = typeof item.data?.thumbnail === 'string' ? item.data.thumbnail : '';
      if (thumbnail.startsWith('basemap_icons/')) {
        thumbnailUrl = resourceAssetFileUrl(thumbnail);
      } else if (thumbnail) {
        const thumbPath = path.resolve(path.join(saveFolder, thumbnail));
        if (thumbPath.startsWith(path.resolve(saveFolder)) && fs.existsSync(thumbPath)) {
          thumbnailUrl = `file://${thumbPath.split(path.sep).join('/')}`;
        }
      }
      if (!thumbnailUrl) {
        const legacyPath = path.join(saveFolder, 'tmbs', `${item.mapID}_menu.jpg`);
        if (fs.existsSync(legacyPath)) {
          thumbnailUrl = `file://${legacyPath.split(path.sep).join('/')}`;
        }
      }
      return { ...item, thumbnailUrl };
    });
  });

  // uid正準の保存 (ADR-0007): payload = { uid?, slug, tms }(uidなし=新規作成)
  ipcMain.handle('basemaps:save-user', async (_, payload: { uid?: string; slug: string; tms: any }) => {
    return await SettingsService.saveUserBaseMap(payload);
  });

  ipcMain.handle('basemaps:delete-user', async (_, baseMapUid: string) => {
    await SettingsService.deleteUserBaseMap(baseMapUid);
  });

  ipcMain.handle('basemaps:set-always', async (_, baseMapUid: string, always: boolean) => {
    await SettingsService.setBaseMapAlways(baseMapUid, always);
  });
}
