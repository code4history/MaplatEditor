import { ipcMain, BrowserWindow } from 'electron';
import SettingsService from '../services/SettingsService';
import MapDataService from '../services/MapDataService';
import { resolveBaseMapListImage, resolveBaseMapRuntimeTileUrl } from '../services/resourceImageResolver';
import { importTileJson } from '../services/TileJsonImportService';

export function registerSettingsHandlers() {
  ipcMain.handle('settings:get', (_, key: string) => {
    return SettingsService.get(key);
  });

  ipcMain.handle('settings:set', async (_, key: string, value: any) => {
    // M12-T32 §4.3: saveFolder 切替前に旧値を捕捉し switchDataFolder(previous) へ渡す。
    // 旧値は SettingsService.set で上書きされると失われるため、set の前で読む。
    let previousSaveFolder: string | undefined;
    if (key === 'saveFolder') {
      previousSaveFolder = SettingsService.get('saveFolder');
    }
    SettingsService.set(key, value);
    if (key === 'saveFolder') {
        await MapDataService.switchDataFolder(previousSaveFolder);
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
    // M12-T10: basemaps:list / search:baseMaps と同型: resolveBaseMapListImage で thumbnailUrl を付与。
    // basemap_icons/=同梱リソース, tmbs/等=saveFolder 配下、ともに封じ込め済み(M12-T13)
    const items = await SettingsService.getBaseMapVisibilityOfMapID(mapRef);
    return items.map((item: any) => {
      // m22-t1: merc の実行時タイル URL を item レベルへ付与する（data_json は汚さない）。
      // 解決できたときだけキーを立てる。thumbnailUrl（解決不能時も null を own key として立てる）
      // とは意図的に非対称である — url_ が立たない行の大半はそもそも対象外の非 merc であり
      // 「解決できなかった」に表示上の意味が無い（設計書 §3.3 (3)）。
      const runtimeTileUrl = resolveBaseMapRuntimeTileUrl(item);
      return { ...item, thumbnailUrl: resolveBaseMapListImage(item), ...(runtimeTileUrl ? { url_: runtimeTileUrl } : {}) };
    });
  });

  ipcMain.handle('mapedit:set-base-map-visibility', async (_, mapRef: string, baseMapRef: string, enabled: boolean) => {
    await SettingsService.setBaseMapVisibilityForMapID(mapRef, baseMapRef, enabled);
  });

  // m1-t4 (HR-6): ベースマップ位置合わせのシフト値（編集環境ストア）。visibility と同じ 4 層貫通
  ipcMain.handle('mapedit:get-base-map-shifts', async (_, mapRef: string) => {
    return await SettingsService.getBaseMapShiftsOfMapID(mapRef);
  });

  ipcMain.handle('mapedit:set-base-map-shift', async (_, mapRef: string, baseMapRef: string, x: number, y: number) => {
    await SettingsService.setBaseMapShiftForMapID(mapRef, baseMapRef, x, y);
  });

  ipcMain.handle('basemaps:list', async () => {
    const items = await SettingsService.listBaseMaps();
    // M12-T1-HOTFIX-1: マスタの thumbnail(basemap_icons/=同梱リソース, tmbs/等=データフォルダ)の
    // UI表示用URL解決は共有 resolver へ一元化（挙動不変。search:baseMaps 経路と同一実装）。
    // thumbnail未設定の旧ユーザーベースマップはtmbs/{mapID}_menu.jpgの存在で補完する。
    // m22-t1: merc の実行時タイル URL（url_）も同じ層・同じ粒度で付与する（設計書 §3.3）。
    return items.map((item: any) => {
      const runtimeTileUrl = resolveBaseMapRuntimeTileUrl(item);
      return { ...item, thumbnailUrl: resolveBaseMapListImage(item), ...(runtimeTileUrl ? { url_: runtimeTileUrl } : {}) };
    });
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

  // m6-t7: tms 編集画面の「TileJSON から読み込む」ボタン用
  ipcMain.handle('basemaps:import-tilejson', async (_, url: string) => {
    return await importTileJson(url);
  });
}
