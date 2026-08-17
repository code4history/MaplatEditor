import { ipcMain } from 'electron';
import SqliteDataService from '../services/SqliteDataService';
import { filterBaseMapsByBbox, filterDocsByExtentSlugs } from '../utils/searchSpatial';
import { wgs84BboxToMercator } from '../utils/webMercator';
import { resolveAppListImage, resolveBaseMapListImage, resolveBaseMapRuntimeTileUrl, resolveMapListImage512 } from '../services/resourceImageResolver';
import { attachAppDiagnostics, attachMapDiagnostics, attachPoiSourceDiagnostics } from '../services/ResourceDiagnosticsService';

function paginate<T>(rawDocs: T[], page: number, pageSize: number): { docs: T[]; total: number; prev?: number; next?: number } {
  if (pageSize <= 0) {
    return { docs: rawDocs, total: rawDocs.length, prev: undefined, next: undefined };
  }
  const start = (page - 1) * pageSize;
  const pageDocs = rawDocs.slice(start, start + pageSize);
  return {
    docs: pageDocs,
    total: rawDocs.length,
    prev: page > 1 ? page - 1 : undefined,
    next: rawDocs.length > start + pageSize ? page + 1 : undefined,
  };
}

// M12-T1-HOTFIX-1: paginate 後の page 分の docs へ画像を添付する。
// pageSize<=0 の全件経路では添付しない（無制限のファイル I/O を防ぐ。レビュー Minor-1）。
// ただし attachWhenUnbounded=true の handler（search:baseMaps）は例外的に全件添付する
// （basemap catalog は内蔵329件＋ユーザ定義の有界集合で、basemaps:list も全件解決している
// 既存挙動のため）。key 引数で添付先フィールドを指定する（maps/apps は `image`、baseMaps は `thumbnailUrl`）。
async function attachImages<T>(
  paged: { docs: T[]; total: number; prev?: number; next?: number },
  pageSize: number,
  resolve: (doc: T) => Promise<string | null> | string | null,
  key: 'image' | 'thumbnailUrl' = 'image',
  attachWhenUnbounded = false,
): Promise<typeof paged> {
  if (pageSize <= 0 && !attachWhenUnbounded) return paged;
  paged.docs = await Promise.all(
    paged.docs.map(async (doc) => {
      (doc as Record<string, unknown>)[key] = await resolve(doc);
      return doc;
    }),
  );
  return paged;
}

async function attachDiagnostics<T extends Record<string, any>>(
  paged: { docs: T[]; total: number; prev?: number; next?: number },
  pageSize: number,
  attach: (docs: T[]) => Promise<T[]>,
): Promise<typeof paged> {
  if (pageSize <= 0) return paged;
  await attach(paged.docs);
  return paged;
}

async function attachMapListExtras<T extends Record<string, any>>(
  paged: { docs: T[]; total: number; prev?: number; next?: number },
  pageSize: number,
): Promise<typeof paged> {
  await attachDiagnostics(paged, pageSize, attachMapDiagnostics);
  return attachImages(paged, pageSize, resolveMapListImage512);
}

async function attachAppListExtras<T extends Record<string, any>>(
  paged: { docs: T[]; total: number; prev?: number; next?: number },
  pageSize: number,
): Promise<typeof paged> {
  await attachDiagnostics(paged, pageSize, attachAppDiagnostics);
  return attachImages(paged, pageSize, resolveAppListImage);
}

// m22-t1: ベースマップ一覧の item レベル添付を1つの wrapper へ畳む
// （同ファイルの attachMapListExtras / attachAppListExtras と同型）。
//
// 契約（落としてはならない挙動）: attachImages は pageSize<=0 && !attachWhenUnbounded で
// 早期 return する（:34）。search:baseMaps は2つの呼び出し点とも attachWhenUnbounded=true
// （全件添付）で呼んでいたため、畳む際にこの真値を落としてはならない。落とすと pageSize<=0 の
// 全件経路（BaseMapList が使う limit:0）で thumbnailUrl ごと添付が消える。
//
// url_ は解決できたときだけ own key として立てる（設計書 §3.3 (3)。undefined own key を作らない）。
async function attachBaseMapListExtras<T extends Record<string, any>>(
  paged: { docs: T[]; total: number; prev?: number; next?: number },
  pageSize: number,
): Promise<typeof paged> {
  // basemap catalog は有界集合のため pageSize<=0 でも全件添付する（basemaps:list と同じ挙動）
  const attached = await attachImages(paged, pageSize, resolveBaseMapListImage, 'thumbnailUrl', true);
  attached.docs = attached.docs.map((doc) => {
    const runtimeTileUrl = resolveBaseMapRuntimeTileUrl(doc);
    return (runtimeTileUrl ? { ...doc, url_: runtimeTileUrl } : doc) as T;
  });
  return attached;
}

type SearchFilter = { q?: string; bbox?: [number, number, number, number]; page: number; pageSize: number };

export function registerSearchHandlers() {
  ipcMain.handle('search:maps', async (_event, filter: SearchFilter) => {
    const docs = await SqliteDataService.searchMaps(filter.q ?? '');
    if (filter.bbox) {
      const extentSlugs = await SqliteDataService.searchExtent(wgs84BboxToMercator(filter.bbox), 'map');
      const filtered = filterDocsByExtentSlugs(docs, extentSlugs, (doc) => doc._id);
      return attachMapListExtras(paginate(filtered, filter.page, filter.pageSize), filter.pageSize);
    }
    return attachMapListExtras(paginate(docs, filter.page, filter.pageSize), filter.pageSize);
  });

  ipcMain.handle('search:apps', async (_event, filter: SearchFilter) => {
    const docs = await SqliteDataService.searchApps(filter.q ?? '');
    if (filter.bbox) {
      const extentSlugs = await SqliteDataService.searchExtent(wgs84BboxToMercator(filter.bbox), 'app');
      const filtered = filterDocsByExtentSlugs(docs, extentSlugs, (doc) => doc._id);
      return attachAppListExtras(paginate(filtered, filter.page, filter.pageSize), filter.pageSize);
    }
    return attachAppListExtras(paginate(docs, filter.page, filter.pageSize), filter.pageSize);
  });

  ipcMain.handle('search:poiSources', async (_event, filter: SearchFilter) => {
    const docs = await SqliteDataService.searchPoiSources(filter.q ?? '');
    if (filter.bbox) {
      const extentSlugs = await SqliteDataService.searchExtent(wgs84BboxToMercator(filter.bbox), 'poi-source');
      const filtered = filterDocsByExtentSlugs(docs, extentSlugs, (doc) => doc.slug);
      return attachDiagnostics(paginate(filtered, filter.page, filter.pageSize), filter.pageSize, attachPoiSourceDiagnostics);
    }
    return attachDiagnostics(paginate(docs, filter.page, filter.pageSize), filter.pageSize, attachPoiSourceDiagnostics);
  });

  ipcMain.handle('search:baseMaps', async (_event, filter: SearchFilter) => {
    const docs = await SqliteDataService.searchBaseMaps(filter.q ?? '');
    if (filter.bbox) {
      const filtered = filterBaseMapsByBbox(docs, filter.bbox);
      return attachBaseMapListExtras(paginate(filtered, filter.page, filter.pageSize), filter.pageSize);
    }
    return attachBaseMapListExtras(paginate(docs, filter.page, filter.pageSize), filter.pageSize);
  });

  ipcMain.handle('search:imageAssets', async (_event, filter: SearchFilter) => {
    const docs = await SqliteDataService.searchAssets(filter.q ?? '');
    return paginate(docs, filter.page, filter.pageSize);
  });

  ipcMain.handle('search:extent', async (_event, kind: 'map' | 'poi-source' | 'app', bbox: [number, number, number, number]) => {
    return SqliteDataService.searchExtent(bbox, kind);
  });

  ipcMain.handle('search:appCoverage', async (_event, appUid: string, mapUids?: string[]) => {
    return SqliteDataService.appCoverage(appUid, mapUids);
  });

  ipcMain.handle('search:resourceBbox', async (_event, kind: 'map', uid: string) => {
    return SqliteDataService.resourceBbox(kind, uid);
  });
}
