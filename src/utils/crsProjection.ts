import geographiclib from 'geographiclib-geodesic';
import { builtinProjectionEngine, type CrsObject } from '@maplat/transform';
import type { TransformLayer } from '../composables/useLayerTransformState';
import { projectionEngineForCrs } from './compiledGeo.ts';

const { Geodesic } = geographiclib;

export type GeoPoint = [number, number];
type LayerGcp = TransformLayer['gcps'][number];
type LayerEdge = TransformLayer['edges'][number];

export class CrsReprojectionError extends Error {
  readonly code: 'transform_failed' | 'roundtrip_exceeded' | 'reference_mismatch';
  readonly location: { kind: 'gcp' | 'edge'; index: number; nodeIndex?: number };
  readonly distanceMeters?: number;

  constructor(
    code: 'transform_failed' | 'roundtrip_exceeded' | 'reference_mismatch',
    location: { kind: 'gcp' | 'edge'; index: number; nodeIndex?: number },
    distanceMeters?: number,
  ) {
    super(code);
    this.name = 'CrsReprojectionError';
    this.code = code;
    this.location = location;
    this.distanceMeters = distanceMeters;
  }
}

function finitePoint(point: readonly number[] | false | undefined): point is GeoPoint {
  return Array.isArray(point) && point.length >= 2 && Number.isFinite(point[0]) && Number.isFinite(point[1]);
}

export function crsToLonLat(point: readonly number[], crs?: CrsObject): GeoPoint | false {
  const actual = crs ?? { epsg: 3857 };
  if (!finitePoint(point)) return false;
  try {
    const result = projectionEngineForCrs(actual).toLonLat([point[0], point[1]], actual);
    return finitePoint(result) ? [result[0], result[1]] : false;
  } catch {
    return false;
  }
}

export function lonLatToCrs(point: readonly number[], crs?: CrsObject): GeoPoint | false {
  const actual = crs ?? { epsg: 3857 };
  if (!finitePoint(point)) return false;
  try {
    const result = projectionEngineForCrs(actual).fromLonLat([point[0], point[1]], actual);
    return finitePoint(result) ? [result[0], result[1]] : false;
  } catch {
    return false;
  }
}

export function crsToMercator(point: readonly number[], crs?: CrsObject): GeoPoint | false {
  if (!crs || crs.epsg === 3857) return finitePoint(point) ? [point[0], point[1]] : false;
  const lonLat = crsToLonLat(point, crs);
  if (lonLat === false) return false;
  const result = builtinProjectionEngine.fromLonLat(lonLat, { epsg: 3857 });
  return finitePoint(result) ? [result[0], result[1]] : false;
}

export function mercatorToCrs(point: readonly number[], crs?: CrsObject): GeoPoint | false {
  if (!finitePoint(point)) return false;
  if (!crs || crs.epsg === 3857) return [point[0], point[1]];
  const lonLat = builtinProjectionEngine.toLonLat([point[0], point[1]], { epsg: 3857 });
  return lonLat === false ? false : lonLatToCrs(lonLat, crs);
}

/** WGS84 回転楕円体上の Karney 法による地上距離。 */
export function geodesicDistanceMeters(a: readonly number[], b: readonly number[]): number {
  if (!finitePoint(a) || !finitePoint(b)) return Number.NaN;
  const distance = Geodesic.WGS84.Inverse(a[1], a[0], b[1], b[0], Geodesic.DISTANCE).s12;
  return typeof distance === 'number' ? distance : Number.NaN;
}

export function validateRoundtrip(
  original: readonly number[],
  projected: readonly number[],
  newCrs: CrsObject | undefined,
  location: { kind: 'gcp' | 'edge'; index: number; nodeIndex?: number },
): number {
  const back = crsToLonLat(projected, newCrs);
  if (back === false) throw new CrsReprojectionError('transform_failed', location);
  const distance = geodesicDistanceMeters(original, back);
  if (!(distance <= 1.0)) throw new CrsReprojectionError('roundtrip_exceeded', location, distance);
  return distance;
}

export function csvGeoCoordToTarget(
  raw: readonly number[],
  targetCrs: CrsObject | undefined,
  projectToLonLat: (point: readonly number[]) => readonly number[],
): GeoPoint {
  const lonLat = projectToLonLat(raw);
  if (!finitePoint(lonLat)) throw new Error('invalid source CRS coordinate');
  const result = lonLatToCrs(lonLat, targetCrs);
  if (result === false) throw new Error('invalid target CRS');
  return result;
}

export interface ReprojectedLayerCoords {
  gcps: LayerGcp[];
  edges: LayerEdge[];
  maxRoundtripMeters: number;
}

/** 全点を一時配列で検査し、一点でも失敗したら入力を変えずに拒否する。 */
export function reprojectLayerCoords(
  gcps: readonly LayerGcp[],
  edges: readonly LayerEdge[],
  oldCrs?: CrsObject,
  newCrs?: CrsObject,
): ReprojectedLayerCoords {
  let maxRoundtripMeters = 0;
  const convert = (point: readonly number[], location: { kind: 'gcp' | 'edge'; index: number; nodeIndex?: number }) => {
    const original = crsToLonLat(point, oldCrs);
    if (original === false) throw new CrsReprojectionError('transform_failed', location);
    const projected = lonLatToCrs(original, newCrs);
    if (projected === false) throw new CrsReprojectionError('transform_failed', location);
    maxRoundtripMeters = Math.max(maxRoundtripMeters, validateRoundtrip(original, projected, newCrs, location));
    return projected;
  };
  const nextGcps = gcps.map((gcp, index) => {
    if (!Array.isArray(gcp) || !finitePoint(gcp[1])) throw new CrsReprojectionError('transform_failed', { kind: 'gcp', index });
    const copy = structuredClone(gcp);
    copy[1] = convert(gcp[1], { kind: 'gcp', index });
    return copy;
  });
  const nextEdges = edges.map((edge, index) => {
    if (!Array.isArray(edge) || !Array.isArray(edge[0]) || !Array.isArray(edge[1])) {
      throw new CrsReprojectionError('transform_failed', { kind: 'edge', index });
    }
    const nodes = edge[1].map((node, nodeIndex) => {
      if (!finitePoint(node)) throw new CrsReprojectionError('transform_failed', { kind: 'edge', index, nodeIndex });
      return convert(node, { kind: 'edge', index, nodeIndex });
    });
    const copy = structuredClone(edge);
    copy[1] = nodes;
    return copy;
  });
  return { gcps: nextGcps, edges: nextEdges, maxRoundtripMeters };
}
