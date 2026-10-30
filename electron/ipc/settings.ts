import { app, BrowserWindow } from 'electron';
import { ipc } from './registry';
import SettingsService from '../services/SettingsService';
import { assertRendererSettingsKey, validateRendererSettingsValue } from '../services/settingsKeys';
import MapDataService from '../services/MapDataService';
import { resolveBaseMapListImage, resolveBaseMapRuntimeTileUrl } from '../services/resourceImageResolver';
import { importTileJson } from '../services/TileJsonImportService';
import { checkMaplibreStyle } from '../services/MaplibreStyleCheckService';

// e2e はダイアログを開けないので、開発起動の e2e のときだけ選択との照合を外す（形の検査は残す）
const skipsSaveFolderDialogCheck = (): boolean => Boolean(process.env['MAPLAT_E2E_ROOT']) && !app.isPackaged;

/**
 * 保存フォルダは配信と読み出しの許可ルートになるので、今の値のままか、ダイアログで選んだ値だけを通す。
 * 保存する前に判定する（この後の切り替えが失敗しても値は残るため）。
 */
function assertSaveFolderChange(value: unknown): void {
  if (value === SettingsService.get('saveFolder')) return;
  validateRendererSettingsValue('saveFolder', value);
  if (SettingsService.consumePickedSaveFolder(value) || skipsSaveFolderDialogCheck()) return;
  throw new Error('saveFolder must be chosen with the folder dialog');
}

export function registerSettingsHandlers() {
  ipc.handle('settings:get', (_, key: string) => {
    assertRendererSettingsKey(key);
    return SettingsService.get(key);
  });

  ipc.handle('settings:set', async (_, key: string, value: any) => {
    assertRendererSettingsKey(key);
    // M12-T32 §4.3: saveFolder 切替前に旧値を捕捉し switchDataFolder(previous) へ渡す。
    // 旧値は SettingsService.set で上書きされると失われるため、set の前で読む。
    let previousSaveFolder: string | undefined;
    if (key === 'saveFolder') {
      assertSaveFolderChange(value);
      previousSaveFolder = SettingsService.get('saveFolder');
    } else {
      validateRendererSettingsValue(key, value);
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

  ipc.handle('settings:select-folder', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    return await SettingsService.showSaveFolderDialog(window);
  });

  // ベースマップ表示設定 (ADR-0007): 引数はuid正準
  // (mapRefは未保存地図のみslug。baseMapRefはlistBaseMapsが返すuid)
  ipc.handle('mapedit:get-tms-list', async (_, mapRef: string) => {
    return await SettingsService.getTmsListOfMapID(mapRef);
  });

  ipc.handle('mapedit:get-base-map-visibility', async (_, mapRef: string) => {
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

  ipc.handle('mapedit:set-base-map-visibility', async (_, mapRef: string, baseMapRef: string, enabled: boolean) => {
    await SettingsService.setBaseMapVisibilityForMapID(mapRef, baseMapRef, enabled);
  });

  // m1-t4 (HR-6): ベースマップ位置合わせのシフト値（編集環境ストア）。visibility と同じ 4 層貫通
  ipc.handle('mapedit:get-base-map-shifts', async (_, mapRef: string) => {
    return await SettingsService.getBaseMapShiftsOfMapID(mapRef);
  });

  ipc.handle('mapedit:set-base-map-shift', async (_, mapRef: string, baseMapRef: string, x: number, y: number) => {
    await SettingsService.setBaseMapShiftForMapID(mapRef, baseMapRef, x, y);
  });

  ipc.handle('basemaps:list', async () => {
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
  ipc.handle('basemaps:save-user', async (_, payload: { uid?: string; slug: string; tms: any }) => {
    const result = await SettingsService.saveUserBaseMap(payload);
    return result;
  });

  ipc.handle('basemaps:delete-user', async (_, baseMapUid: string) => {
    await SettingsService.deleteUserBaseMap(baseMapUid);
  });

  ipc.handle('basemaps:set-always', async (_, baseMapUid: string, always: boolean) => {
    await SettingsService.setBaseMapAlways(baseMapUid, always);
  });

  // m6-t7: tms 編集画面の「TileJSON から読み込む」ボタン用
  ipc.handle('basemaps:import-tilejson', async (_, url: string) => {
    return await importTileJson(url);
  });

  // MapLibre のベースマップの style が MapLibre GL JS の 5 系で動くかの判定（引数は URL の文字列だけ。
  // 返すのは判定の結果と理由の種類と場所だけ。検査は checkMaplibreStyle の中）
  ipc.handle('basemaps:check-maplibre-style', async (_, url: unknown) => {
    return await checkMaplibreStyle(url);
  });
}
