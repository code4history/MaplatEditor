import {
  builtinProjectionEngine,
  createProj4ProjectionEngine,
  type CrsObject,
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
