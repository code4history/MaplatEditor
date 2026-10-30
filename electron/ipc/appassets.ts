import { BrowserWindow } from 'electron';
import { ipc } from './registry';
import AppAssetService from '../services/AppAssetService';
// #100: 長時間 IPC ハンドラを uncaughtException 時の settle 保証で wrap する
import { runGuarded } from '../utils/inflightGuard';

export function registerAppAssetHandlers() {
  ipc.handle('appassets:upload-splash', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)!;
    return await runGuarded('appassets:upload-splash', () => AppAssetService.uploadSplash(win));
  });

  ipc.handle('appassets:upload-pwa-icon', async (event, appID: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)!;
    return await runGuarded('appassets:upload-pwa-icon', () => AppAssetService.uploadPwaIcon(win, appID));
  });

  // M12-T15 (R5): Maplat地図サムネイルの置換アップロード（512px/52px 独立 + 512px→52px 流用）
  // m19-t2: ext を透過（省略時は 'jpg' = 地図の既定）。チャネル名は変えない
  // issue #192: copy512From を透過（52px 単独置換で 512px を引き継ぐ元。省略時は従来どおり）
  ipc.handle(
    'appassets:replace-map-thumbnail',
    async (event, mapUid: string, kind: '512' | '52', derive52: boolean, ext?: string, copy512From?: string) => {
      const win = BrowserWindow.fromWebContents(event.sender)!;
      return await runGuarded('appassets:replace-map-thumbnail', () =>
        AppAssetService.replaceMapThumbnail(win, mapUid, kind, derive52, ext, copy512From));
    },
  );

  ipc.handle(
    'appassets:generate-tms-thumbnail',
    async (_event, mapID: string, tms: { url?: string; minZoom?: number; maxZoom?: number }, coverageLngLats: [number, number][]) => {
      return await runGuarded('appassets:generate-tms-thumbnail', () =>
        AppAssetService.generateTmsThumbnail(mapID, tms, coverageLngLats));
    }
  );

  ipc.handle('appassets:file-url', (_event, relPath: string) => {
    return AppAssetService.fileUrlFor(relPath);
  });
}
