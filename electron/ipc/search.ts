import { ipcMain } from 'electron';
import SqliteDataService from '../services/SqliteDataService';

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

type SearchFilter = { q?: string; bbox?: [number, number, number, number]; page: number; pageSize: number };

export function registerSearchHandlers() {
  ipcMain.handle('search:maps', async (_event, filter: SearchFilter) => {
    const docs = await SqliteDataService.searchMaps(filter.q ?? '');
    if (filter.bbox) {
      const extentSlugs = await SqliteDataService.searchExtent(filter.bbox, 'map');
      const slugSet = new Set(extentSlugs);
      const filtered = docs.filter((d: any) => slugSet.has(d._id ?? d.uid));
      return paginate(filtered, filter.page, filter.pageSize);
    }
    return paginate(docs, filter.page, filter.pageSize);
  });

  ipcMain.handle('search:apps', async (_event, filter: SearchFilter) => {
    const docs = await SqliteDataService.searchApps(filter.q ?? '');
    if (filter.bbox) {
      const extentSlugs = await SqliteDataService.searchExtent(filter.bbox, 'app');
      const slugSet = new Set(extentSlugs);
      const filtered = docs.filter((d: any) => slugSet.has(d._id ?? d.uid));
      return paginate(filtered, filter.page, filter.pageSize);
    }
    return paginate(docs, filter.page, filter.pageSize);
  });

  ipcMain.handle('search:poiSources', async (_event, filter: SearchFilter) => {
    const docs = await SqliteDataService.searchPoiSources(filter.q ?? '');
    if (filter.bbox) {
      const extentSlugs = await SqliteDataService.searchExtent(filter.bbox, 'poi-source');
      const slugSet = new Set(extentSlugs);
      const filtered = docs.filter((d: any) => slugSet.has(d._id ?? d.uid));
      return paginate(filtered, filter.page, filter.pageSize);
    }
    return paginate(docs, filter.page, filter.pageSize);
  });

  ipcMain.handle('search:baseMaps', async (_event, filter: SearchFilter) => {
    const docs = await SqliteDataService.searchBaseMaps(filter.q ?? '');
    if (filter.bbox) {
      const extentSlugs = await SqliteDataService.searchExtent(filter.bbox, 'map');
      const slugSet = new Set(extentSlugs);
      const filtered = docs.filter((d: any) => slugSet.has(d.mapID ?? d.uid));
      return paginate(filtered, filter.page, filter.pageSize);
    }
    return paginate(docs, filter.page, filter.pageSize);
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
}
