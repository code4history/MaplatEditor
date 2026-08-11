export type Bbox = [number, number, number, number];

export const WEB_MERCATOR_MAX_LAT = 85.05112878;
const WEB_MERCATOR_HALF_WORLD = 20037508.342789244;

function clampLatitude(latitude: number): number {
  return Math.max(-WEB_MERCATOR_MAX_LAT, Math.min(WEB_MERCATOR_MAX_LAT, latitude));
}

function longitudeToX(longitude: number): number {
  return longitude * WEB_MERCATOR_HALF_WORLD / 180;
}

function latitudeToY(latitude: number): number {
  const clamped = clampLatitude(latitude);
  const degrees = Math.log(Math.tan((90 + clamped) * Math.PI / 360)) / (Math.PI / 180);
  return degrees * WEB_MERCATOR_HALF_WORLD / 180;
}

function xToLongitude(x: number): number {
  return x / WEB_MERCATOR_HALF_WORLD * 180;
}

function yToLatitude(y: number): number {
  return 180 / Math.PI * (2 * Math.atan(Math.exp(y / WEB_MERCATOR_HALF_WORLD * Math.PI)) - Math.PI / 2);
}

export function wgs84BboxToMercator([west, south, east, north]: Bbox): Bbox {
  return [longitudeToX(west), latitudeToY(south), longitudeToX(east), latitudeToY(north)];
}

export function mercatorBboxToWgs84([minX, minY, maxX, maxY]: Bbox): Bbox {
  return [xToLongitude(minX), yToLatitude(minY), xToLongitude(maxX), yToLatitude(maxY)];
}
