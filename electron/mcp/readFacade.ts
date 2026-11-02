// The read-only window from the MCP tools into the editor's data. It is the only file under electron/mcp/
// that may import services, adapters, node:path or fs-extra, and it returns plain values only (never a
// service, adapter or class instance). The IPC handlers that read the same data will call these functions
// too, so there is one implementation per read path.
//
// The functions are filled in together with the tools that use them; until then they throw.

function notImplemented(name: string): never {
  throw new Error(`${name}: not implemented`);
}

export async function listMaps(..._args: unknown[]): Promise<never> {
  return notImplemented('listMaps');
}

export async function readMapForEdit(..._args: unknown[]): Promise<never> {
  return notImplemented('readMapForEdit');
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
