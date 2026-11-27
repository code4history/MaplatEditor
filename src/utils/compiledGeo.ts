import {
  builtinProjectionEngine,
  createProj4ProjectionEngine,
  type CrsObject,
  type EdgeSet,
  type YaxisMode,
} from '@maplat/transform';
import proj4 from 'proj4';

const proj4ProjectionEngine = createProj4ProjectionEngine(proj4);

export function projectionEngineForCrs(crs?: CrsObject) {
  // Core と同じく、内蔵 CRS は内蔵式と定義照合を使う。
  const isBuiltin = crs?.epsg === 3857 || crs?.epsg === 4326;
  return !isBuiltin && typeof crs?.proj4 === 'string' && crs.proj4.trim()
    ? proj4ProjectionEngine
    : builtinProjectionEngine;
}

/** compiled 内部の地理座標を、層の外部 CRS の東・北へ戻す。 */
export function compiledPointToExternalCrs(
  point: readonly number[],
  yaxisMode?: YaxisMode,
): [number, number] {
  return [point[0], yaxisMode === 'follow' ? -point[1] : point[1]];
}

/** Tin の対応線は GCP と違い、受け渡しの両方向で内部軸と外部軸を変換する。 */
export function reverseFollowEdgeAxis(edges: EdgeSet[]): EdgeSet[] {
  return edges.map(([pixels, geo, endpoints]) => [
    pixels, geo.map((point) => compiledPointToExternalCrs(point, 'follow')), endpoints,
  ]);
}

/** compiled 内部の地理座標を、外部 CRS と経緯度を経て Web メルカトルに写す。 */
export function compiledPointToMercator(
  point: readonly number[],
  yaxisMode?: YaxisMode,
  crs?: CrsObject,
): number[] | false {
  const native = compiledPointToExternalCrs(point, yaxisMode);
  if (!native.every(Number.isFinite)) return false;
  if (crs === undefined || crs.epsg === 3857) return native;
  const lonLat = projectionEngineForCrs(crs).toLonLat(native, crs);
  return lonLat === false ? false : builtinProjectionEngine.fromLonLat(lonLat, { epsg: 3857 });
}

/** GeoJSON の全座標を同じ規則で戻し、一つでも投影できなければ描画を拒否する。 */
export function compiledGeoJsonToMercator<T>(geoJson: T, yaxisMode?: YaxisMode, crs?: CrsObject): T | false {
  let valid = true;
  const convert = (value: any): any => {
    if (!Array.isArray(value)) return value;
    if (value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
      const converted = compiledPointToMercator(value, yaxisMode, crs);
      if (converted === false) valid = false;
      return converted || value;
    }
    return value.map(convert);
  };
  const clone = structuredClone(geoJson) as any;
  if (clone?.geometry?.coordinates) clone.geometry.coordinates = convert(clone.geometry.coordinates);
  if (Array.isArray(clone?.features)) {
    for (const feature of clone.features) {
      if (feature?.geometry?.coordinates) feature.geometry.coordinates = convert(feature.geometry.coordinates);
    }
  }
  if (clone?.coordinates) clone.coordinates = convert(clone.coordinates);
  return valid ? clone : false;
}
