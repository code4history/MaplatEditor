import { ipcMain } from 'electron';
import SqliteDataService from '../services/SqliteDataService';

// slug 予約 IPC (M11-T7/§7.2)。payload-only・raw event 非伝搬(m2安全API境界)。
// promote/renewOwn/gc はここに露出しない(save経路とmain timerのみが使う)。
export const registerSlugReservationHandlers = () => {
  ipcMain.handle('slug-reservations:reserve', async (_e, p: { slug: string; assetUid: string; assetKind: string; draftUid: string }) =>
    SqliteDataService.reserveSlug(p));
  ipcMain.handle('slug-reservations:move', async (_e, p: { fromSlug: string | null; toSlug: string; assetUid: string; assetKind: string; draftUid: string }) =>
    SqliteDataService.moveSlug(p));
  ipcMain.handle('slug-reservations:release', async (_e, p: { slug: string; assetUid: string }) => {
    await SqliteDataService.releaseSlug(p);
  });
  ipcMain.handle('slug-reservations:check', async (_e, p: { slug: string; excludeUid?: string }) =>
    SqliteDataService.checkSlugReservation(p));
};
