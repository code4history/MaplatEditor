// The read-only window from the MCP tools into the editor's data. It is the only file under electron/mcp/
// that may import services, adapters, node:path or fs-extra, and it returns plain values only (never a
// service, adapter or class instance). The IPC handlers that read the same data will call these functions
// too, so there is one implementation per read path.
//
// The functions are filled in together with the tools that use them; until then they throw.
import StorageAdapter from '../adapters/ElectronStorageAdapter';
import type { MapListOptions, MapListRequest, MapListResult } from '../adapters/StorageAdapter';

function notImplemented(name: string): never {
  throw new Error(`${name}: not implemented`);
}

/** The map list, as the renderer's list screen gets it. options.sourceSize adds the full image size to each row. */
export async function listMaps(request: MapListRequest, options?: MapListOptions): Promise<MapListResult> {
  const result = await StorageAdapter.listMaps(request, options);
  return result;
}

/** One map as the renderer's edit screen reads it (uid or slug). Throws when there is no such map. */
export async function readMapForEdit(uidOrMapID: string): Promise<any> {
  const result = await StorageAdapter.readMapForEdit(uidOrMapID);
  return result;
}

export async function readThumbnail512(..._args: unknown[]): Promise<never> {
  return notImplemented('readThumbnail512');
}

export async function readTile(..._args: unknown[]): Promise<never> {
  return notImplemented('readTile');
}

export async function transformPoints(..._args: unknown[]): Promise<never> {
  return notImplemented('transformPoints');
}

export async function searchExtent(..._args: unknown[]): Promise<never> {
  return notImplemented('searchExtent');
}

export async function readTilesForRegion(..._args: unknown[]): Promise<never> {
  return notImplemented('readTilesForRegion');
}
