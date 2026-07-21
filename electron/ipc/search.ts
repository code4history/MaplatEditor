import { ipcMain } from 'electron';
import SqliteDataService from '../services/SqliteDataService';
import { filterBaseMapsByBbox, filterDocsByExtentSlugs } from '../utils/searchSpatial';
import { wgs84BboxToMercator } from '../utils/webMercator';
import { resolveAppListImage, resolveBaseMapListImage, resolveMapListImage512 } from '../services/resourceImageResolver';

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

type SearchFilter = { q?: string; bbox?: [number, number, number, number]; page: number; pageSize: number };

export function registerSearchHandlers() {
  ipcMain.handle('search:maps', async (_event, filter: SearchFilter) => {
    const docs = await SqliteDataService.searchMaps(filter.q ?? '');
    if (filter.bbox) {
      const extentSlugs = await SqliteDataService.searchExtent(wgs84BboxToMercator(filter.bbox), 'map');
      const filtered = filterDocsByExtentSlugs(docs, extentSlugs, (doc) => doc._id);
      return attachImages(paginate(filtered, filter.page, filter.pageSize), filter.pageSize, resolveMapListImage512);
    }
    return attachImages(paginate(docs, filter.page, filter.pageSize), filter.pageSize, resolveMapListImage512);
  });

  ipcMain.handle('search:apps', async (_event, filter: SearchFilter) => {
    const docs = await SqliteDataService.searchApps(filter.q ?? '');
    if (filter.bbox) {
      const extentSlugs = await SqliteDataService.searchExtent(wgs84BboxToMercator(filter.bbox), 'app');
      const filtered = filterDocsByExtentSlugs(docs, extentSlugs, (doc) => doc._id);
      return attachImages(paginate(filtered, filter.page, filter.pageSize), filter.pageSize, resolveAppListImage);
    }
    return attachImages(paginate(docs, filter.page, filter.pageSize), filter.pageSize, resolveAppListImage);
  });

  ipcMain.handle('search:poiSources', async (_event, filter: SearchFilter) => {
    const docs = await SqliteDataService.searchPoiSources(filter.q ?? '');
    if (filter.bbox) {
      const extentSlugs = await SqliteDataService.searchExtent(wgs84BboxToMercator(filter.bbox), 'poi-source');
      const filtered = filterDocsByExtentSlugs(docs, extentSlugs, (doc) => doc.slug);
      return paginate(filtered, filter.page, filter.pageSize);
    }
    return paginate(docs, filter.page, filter.pageSize);
  });

  ipcMain.handle('search:baseMaps', async (_event, filter: SearchFilter) => {
    const docs = await SqliteDataService.searchBaseMaps(filter.q ?? '');
    if (filter.bbox) {
      const filtered = filterBaseMapsByBbox(docs, filter.bbox);
      // basemap catalog は有界集合のため pageSize<=0 でも全件添付する（basemaps:list と同じ挙動）
      return attachImages(paginate(filtered, filter.page, filter.pageSize), filter.pageSize, resolveBaseMapListImage, 'thumbnailUrl', true);
    }
    return attachImages(paginate(docs, filter.page, filter.pageSize), filter.pageSize, resolveBaseMapListImage, 'thumbnailUrl', true);
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
