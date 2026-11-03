// The read-only window from the MCP tools into the editor's data. It is the only file under electron/mcp/
// that may import services, adapters, node:path or fs-extra, and it returns plain values only (never a
// service, adapter or class instance). The IPC handlers that read the same data will call these functions
// too, so there is one implementation per read path.
//
// The functions are filled in together with the tools that use them; until then they throw.
import path from 'node:path';
import fs from 'fs-extra';
import StorageAdapter from '../adapters/ElectronStorageAdapter';
import { UUID_PATTERN, type MapListOptions, type MapListRequest, type MapListResult } from '../adapters/StorageAdapter';
import SettingsService from '../services/SettingsService';
import { Transform } from '@maplat/transform';
import { WEB_MERCATOR_MAX_LAT, mercatorToWgs84, wgs84ToMercator } from '../utils/webMercator';
import { resolveLocalReal } from '../utils/appScheme';
import { deriveRuntimeTileUrl } from '../utils/runtimeTileUrl';
import { TILE_SIZE, tileLevelSize, tileMaxZoom } from '../utils/tilePyramid';
import { compiledOf } from './compiled';
import { declaredTileSize } from './imageHeader';
import { DEFAULT_LIMITS } from './limits';

function notImplemented(name: string): never {
  throw new Error(`${name}: not implemented`);
}

/** The map list, as the renderer's list screen gets it. options.sourceFields adds the stored values (full image size, title in every language, map language) to each row. */
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

/** One tile of a map's own tile pyramid, as stored. */
export interface TileImage {
  bytes: Buffer;
  mimeType: 'image/png' | 'image/jpeg';
}

/** Tile indexes x0..x1 and y0..y1 (both ends included) of one zoom level. */
export interface TileRange {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface TileSource {
  saveFolder: string;
  tileRoot: string;
  ext: 'png' | 'jpg' | 'jpeg';
  width: number;
  height: number;
  maxZoom: number;
}

/**
 * Where the saved tiles of a map are: <saveFolder>/tiles/<uid>/<z>/<x>/<y>.<ext>. The extension is the one
 * the runtime tile URL is built with. Null when the map has no saved tiles. Throws when there is no such map.
 */
async function tileSourceOf(uidOrMapID: string): Promise<TileSource | null> {
  const map = await readMapForEdit(uidOrMapID);
  const uid = typeof map?.uid === 'string' ? map.uid : '';
  const width = Number(map?.width);
  const height = Number(map?.height);
  const saveFolder = SettingsService.get('saveFolder');
  if (!UUID_PATTERN.test(uid) || !(width > 0) || !(height > 0) || typeof saveFolder !== 'string' || !saveFolder) return null;
  const tileRoot = path.join(saveFolder, 'tiles', uid);
  const url = await deriveRuntimeTileUrl(null, path.join(tileRoot, '0', '0'));
  const ext = /\.(png|jpg|jpeg)$/.exec(url ?? '')?.[1];
  if (!ext) return null;
  return { saveFolder, tileRoot, ext: ext as TileSource['ext'], width, height, maxZoom: tileMaxZoom(width, height) };
}

/** The number of tiles across and down at zoom level z, or null when z is not a level of the pyramid. */
function levelTiles(source: TileSource, z: number): { nx: number; ny: number } | null {
  if (!Number.isInteger(z) || z < 0 || z > source.maxZoom) return null;
  const { pw, ph } = tileLevelSize(source.width, source.height, source.maxZoom, z);
  return { nx: Math.ceil(pw / TILE_SIZE), ny: Math.ceil(ph / TILE_SIZE) };
}

/**
 * Reads one tile file. The path is checked to stay inside the save folder (a link that leads out of it is not
 * followed), the file is opened once and its size is taken from the open file (so it cannot be swapped between
 * the check and the read), and at most maxBytes are kept. The bytes are given only when they are of the kind of
 * the extension and declare at most one tile of pixels, so nothing larger is ever decoded. Null otherwise, and
 * when the tile is missing.
 */
async function readTileFile(source: TileSource, z: number, x: number, y: number, maxBytes: number): Promise<TileImage | null> {
  const file = path.join(source.tileRoot, String(z), String(x), `${y}.${source.ext}`);
  const resolved = await resolveLocalReal(file, [source.saveFolder]);
  if (!resolved.ok) {
    if (resolved.reason !== 'missing') console.log(`[mcp] tile not read: ${resolved.reason}`);
    return null;
  }
  let fd: number | null = null;
  try {
    fd = await fs.open(resolved.realPath, 'r');
    const stat = await fs.fstat(fd);
    if (!stat.isFile() || stat.size > maxBytes) {
      console.log('[mcp] tile not read: not a file or too large');
      return null;
    }
    // Read up to one byte past the size taken (and never past maxBytes + 1): more than that means the file
    // grew after its size was taken, and it is not used.
    const buffer = Buffer.alloc(Math.min(stat.size, maxBytes) + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await fs.read(fd, buffer, length, buffer.length - length, length);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length > stat.size || length > maxBytes) {
      console.log('[mcp] tile not read: changed while it was read, or too large');
      return null;
    }
    const bytes = buffer.subarray(0, length);
    const size = declaredTileSize(bytes, source.ext);
    if (!size || size.width < 1 || size.height < 1 || size.width > TILE_SIZE || size.height > TILE_SIZE) {
      console.log('[mcp] tile not read: not an image of its kind or larger than a tile');
      return null;
    }
    const tile: TileImage = { bytes: Buffer.from(bytes), mimeType: source.ext === 'png' ? 'image/png' : 'image/jpeg' };
    return tile;
  } catch {
    console.log('[mcp] tile not read: read failed');
    return null;
  } finally {
    if (fd !== null) await fs.close(fd).catch(() => undefined);
  }
}

/**
 * One tile of a map's saved tile pyramid (uid or slug, zoom level, tile column and row). Null when the map has
 * no saved tiles, the indexes are outside the pyramid, or the tile is missing or outside the save folder.
 * Throws when there is no such map.
 */
export async function readTile(uidOrMapID: string, z: number, x: number, y: number): Promise<TileImage | null> {
  const source = await tileSourceOf(uidOrMapID);
  if (!source) return null;
  const level = levelTiles(source, z);
  if (!level || !Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= level.nx || y >= level.ny) return null;
  const tile = await readTileFile(source, z, x, y, DEFAULT_LIMITS.maxTileBytes);
  return tile;
}

export type TransformDirection = 'forward' | 'backward';
type Point = [number, number];

/** How many points are converted between two checks of the abort signal. */
const POINTS_PER_STEP = 100;

/**
 * Converts points with the map's compiled transformation (the same data the edit screen reads), using
 * @maplat/transform as the map viewer does. forward: image pixels -> [longitude, latitude]; backward: the
 * reverse. The transformation reaches a little beyond the image, but only the image itself is meaningful, so
 * a point outside the image (on either side of the conversion) is null, and so is a longitude or latitude
 * outside Web Mercator. Resolves to null when the map has no compiled transformation. Throws when there is no
 * such map, "backward not available" when the transformation cannot be inverted (its triangles fold over),
 * and "aborted" once the signal is aborted.
 */
export async function transformPoints(
  uidOrMapID: string,
  points: readonly Point[],
  direction: TransformDirection,
  signal?: AbortSignal,
): Promise<(Point | null)[] | null> {
  const map = await readMapForEdit(uidOrMapID);
  const compiled = compiledOf(map);
  if (!compiled) return null;
  const transform = new Transform();
  transform.setCompiled(compiled as never);
  transform.addIndexedTin();
  const backward = direction === 'backward';
  if (backward && transform.strict_status === Transform.STATUS_ERROR) throw new Error('backward not available');
  const [width, height] = transform.wh ?? [map.width, map.height];
  const onImage = (x: number, y: number) => x >= 0 && y >= 0 && x <= width && y <= height;
  const out: (Point | null)[] = [];
  for (let i = 0; i < points.length; i++) {
    if (i > 0 && i % POINTS_PER_STEP === 0) {
      // Give way to the event loop so the request time limit (a timer) can fire, then look at the signal
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    if (i % POINTS_PER_STEP === 0 && signal?.aborted) throw new Error('aborted');
    const [a, b] = points[i];
    if (backward ? Math.abs(a) > 180 || Math.abs(b) > WEB_MERCATOR_MAX_LAT : !onImage(a, b)) {
      out.push(null);
      continue;
    }
    const result = transform.transform(backward ? wgs84ToMercator([a, b]) : [a, b], backward, false);
    if (!Array.isArray(result) || !Number.isFinite(result[0]) || !Number.isFinite(result[1])) {
      out.push(null);
      continue;
    }
    if (backward) out.push(onImage(result[0], result[1]) ? [result[0], result[1]] : null);
    else out.push(mercatorToWgs84([result[0], result[1]]));
  }
  return out;
}

export async function searchExtent(..._args: unknown[]): Promise<never> {
  return notImplemented('searchExtent');
}

/** The tiles of one region, row by row: tiles[y - range.y0][x - range.x0]; null where a tile is not read. */
export interface RegionTiles {
  range: TileRange;
  tiles: (TileImage | null)[][];
}

/**
 * The tiles of a rectangle of one zoom level (as readTile reads them), clipped to the pyramid. Reads one tile at
 * a time and looks at the signal before each ("aborted"). Null when the map has no saved tiles or z is not a
 * level. Throws when there is no such map, and "too many tiles" when the clipped range has more than maxTiles.
 */
export async function readTilesForRegion(
  uidOrMapID: string,
  z: number,
  range: TileRange,
  signal?: AbortSignal,
  options: { maxTiles?: number; maxTileBytes?: number } = {},
): Promise<RegionTiles | null> {
  const maxTiles = options.maxTiles ?? DEFAULT_LIMITS.maxRegionTiles;
  const maxBytes = options.maxTileBytes ?? DEFAULT_LIMITS.maxTileBytes;
  if (signal?.aborted) throw new Error('aborted');
  const source = await tileSourceOf(uidOrMapID);
  if (!source) return null;
  const level = levelTiles(source, z);
  if (!level) return null;
  const clipped: TileRange = {
    x0: Math.max(0, Math.floor(range.x0)),
    y0: Math.max(0, Math.floor(range.y0)),
    x1: Math.min(level.nx - 1, Math.floor(range.x1)),
    y1: Math.min(level.ny - 1, Math.floor(range.y1)),
  };
  const count = Math.max(0, clipped.x1 - clipped.x0 + 1) * Math.max(0, clipped.y1 - clipped.y0 + 1);
  if (count > maxTiles) throw new Error('too many tiles');
  const tiles: (TileImage | null)[][] = [];
  for (let y = clipped.y0; y <= clipped.y1; y++) {
    const row: (TileImage | null)[] = [];
    for (let x = clipped.x0; x <= clipped.x1; x++) {
      if (signal?.aborted) throw new Error('aborted');
      row.push(await readTileFile(source, z, x, y, maxBytes));
    }
    tiles.push(row);
  }
  if (signal?.aborted) throw new Error('aborted');
  const result: RegionTiles = { range: clipped, tiles };
  return result;
}
