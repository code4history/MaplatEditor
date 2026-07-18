import { ipcMain, BrowserWindow } from 'electron';
import SettingsService from '../services/SettingsService';
import MapDataService from '../services/MapDataService';
import { resolveBaseMapListImage } from '../services/resourceImageResolver';

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
    // M12-T1-HOTFIX-1: マスタの thumbnail(basemap_icons/=同梱リソース, tmbs/等=データフォルダ)の
    // UI表示用URL解決は共有 resolver へ一元化（挙動不変。search:baseMaps 経路と同一実装）。
    // thumbnail未設定の旧ユーザーベースマップはtmbs/{mapID}_menu.jpgの存在で補完する。
    return items.map((item: any) => ({ ...item, thumbnailUrl: resolveBaseMapListImage(item) }));
  });

  // uid正準の保存 (ADR-0007): payload = { uid?, slug, tms }(uidなし=新規作成)
  // NOTE: maplist:refresh は発行しない — リスナーは MapList のみで、ベースマップは地図一覧に
  // 表示されないため実益がない (T12 レビュー Min1)
  ipcMain.handle('basemaps:save-user', async (_, payload: { uid?: string; slug: string; tms: any }) => {
    const result = await SettingsService.saveUserBaseMap(payload);
    return result;
  });

  ipcMain.handle('basemaps:delete-user', async (_, baseMapUid: string) => {
    await SettingsService.deleteUserBaseMap(baseMapUid);
  });

  ipcMain.handle('basemaps:set-always', async (_, baseMapUid: string, always: boolean) => {
    await SettingsService.setBaseMapAlways(baseMapUid, always);
  });
}
