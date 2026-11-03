// The read-only window from the MCP tools into the editor's data. It is the only file under electron/mcp/
// that may import services, adapters, node:path or fs-extra, and it returns plain values only (never a
// service, adapter or class instance). The IPC handlers that read the same data will call these functions
// too, so there is one implementation per read path.
//
// The functions are filled in together with the tools that use them; until then they throw.
import StorageAdapter from '../adapters/ElectronStorageAdapter';
import type { MapListOptions, MapListRequest, MapListResult } from '../adapters/StorageAdapter';
import { Transform } from '@maplat/transform';
import { WEB_MERCATOR_MAX_LAT, mercatorToWgs84, wgs84ToMercator } from '../utils/webMercator';
import { compiledOf } from './compiled';

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

export async function readTile(..._args: unknown[]): Promise<never> {
  return notImplemented('readTile');
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

export async function readTilesForRegion(..._args: unknown[]): Promise<never> {
  return notImplemented('readTilesForRegion');
}
