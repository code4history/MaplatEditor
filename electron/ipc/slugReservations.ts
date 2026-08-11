import { ipcMain } from 'electron';
import SqliteDataService from '../services/SqliteDataService';
import { toRegistryKind } from '../services/slugReservationKind';

// slug 予約 IPC (M11-T7/§7.2)。payload-only・raw event 非伝搬(m2安全API境界)。
// promote/renewOwn/gc はここに露出しない(save経路とmain timerのみが使う)。

// Minor-1: 型だけに依存せず、main 境界で不正 kind・空 slug/UID・必須フィールド欠落を拒否する。
// renderer 由来の payload は実行時に unknown になり得るため、ここで検証してから service へ渡す。
const VALID_KINDS = new Set(['map', 'app', 'poi-source', 'base-map', 'image-asset']);

class IpcValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IpcValidationError';
  }
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new IpcValidationError(`Missing or empty field: ${field}`);
  }
  return value;
}

function requireOptionalString(value: unknown, field: string): string | undefined {
  if (value == null) return undefined;
  if (typeof value !== 'string') {
    throw new IpcValidationError(`Field ${field} must be a string when present`);
  }
  return value;
}

function validateReservePayload(p: unknown): {
  slug: string; assetUid: string; assetKind: string; draftUid: string;
} {
  if (p == null || typeof p !== 'object') throw new IpcValidationError('reserve payload must be an object');
  const obj = p as Record<string, unknown>;
  const slug = requireString(obj.slug, 'slug');
  const assetUid = requireString(obj.assetUid, 'assetUid');
  const uiKind = requireString(obj.assetKind, 'assetKind');
  if (!VALID_KINDS.has(uiKind)) throw new IpcValidationError(`Invalid assetKind: ${uiKind}`);
  const assetKind = toRegistryKind(uiKind as any);
  const draftUid = requireString(obj.draftUid, 'draftUid');
  return { slug, assetUid, assetKind, draftUid };
}

function validateMovePayload(p: unknown): {
  fromSlug: string | null; toSlug: string; assetUid: string; assetKind: string; draftUid: string;
} {
  if (p == null || typeof p !== 'object') throw new IpcValidationError('move payload must be an object');
  const obj = p as Record<string, unknown>;
  const fromSlugRaw = obj.fromSlug;
  if (fromSlugRaw != null && typeof fromSlugRaw !== 'string') {
    throw new IpcValidationError('fromSlug must be a string or null');
  }
  const fromSlug = fromSlugRaw == null ? null : fromSlugRaw;
  const toSlug = requireString(obj.toSlug, 'toSlug');
  const assetUid = requireString(obj.assetUid, 'assetUid');
  const uiKind = requireString(obj.assetKind, 'assetKind');
  if (!VALID_KINDS.has(uiKind)) throw new IpcValidationError(`Invalid assetKind: ${uiKind}`);
  const assetKind = toRegistryKind(uiKind as any);
  const draftUid = requireString(obj.draftUid, 'draftUid');
  return { fromSlug, toSlug, assetUid, assetKind, draftUid };
}

function validateReleasePayload(p: unknown): { slug: string; assetUid: string } {
  if (p == null || typeof p !== 'object') throw new IpcValidationError('release payload must be an object');
  const obj = p as Record<string, unknown>;
  const slug = requireString(obj.slug, 'slug');
  const assetUid = requireString(obj.assetUid, 'assetUid');
  return { slug, assetUid };
}

function validateCheckPayload(p: unknown): { slug: string; excludeUid?: string } {
  if (p == null || typeof p !== 'object') throw new IpcValidationError('check payload must be an object');
  const obj = p as Record<string, unknown>;
  const slug = requireString(obj.slug, 'slug');
  const excludeUid = requireOptionalString(obj.excludeUid, 'excludeUid');
  return excludeUid != null ? { slug, excludeUid } : { slug };
}

// 検証エラーは result: "error" として renderer へ返す(service のエラー契約と同一)。
function handleError(e: unknown) {
  if (e instanceof IpcValidationError) return { result: 'error' as const, message: e.message };
  throw e;
}

export const registerSlugReservationHandlers = () => {
  ipcMain.handle('slug-reservations:reserve', async (_e, p: unknown) => {
    try {
      return await SqliteDataService.reserveSlug(validateReservePayload(p));
    } catch (e) {
      return handleError(e);
    }
  });
  ipcMain.handle('slug-reservations:move', async (_e, p: unknown) => {
    try {
      return await SqliteDataService.moveSlug(validateMovePayload(p));
    } catch (e) {
      return handleError(e);
    }
  });
  ipcMain.handle('slug-reservations:release', async (_e, p: unknown) => {
    await SqliteDataService.releaseSlug(validateReleasePayload(p));
  });
  ipcMain.handle('slug-reservations:check', async (_e, p: unknown) =>
    SqliteDataService.checkSlugReservation(validateCheckPayload(p)));
};
