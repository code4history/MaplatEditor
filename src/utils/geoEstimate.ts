import { bboxToEnvelope as bboxToEnvelopeFromAppSource } from "./appSourceModel";

export type LngLat = [number, number];
export type Bbox = [west: number, south: number, east: number, north: number];

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

// 緯度 35° 付近で 1km ≒ 0.009°。簡易定数。
const MIN_BBOX_DEG = 0.009;

/**
 * 複数点の WGS84 座標から bbox と重心を返す。
 * bbox の縦または横が 0 の場合（1点のみ、または同一直線上の多点）は、
 * 退化した軸のみを最小 1km 相当に拡張してから返す。非退化軸は元の範囲を維持する。
 */
export function computeBboxAndCentroid(points: LngLat[]): { bbox: Bbox; centroid: LngLat } | null {
  if (!Array.isArray(points) || points.length === 0) return null;
  let sumLng = 0;
  let sumLat = 0;
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  let valid = 0;
  for (const p of points) {
    if (!Array.isArray(p) || p.length < 2) continue;
    const [lng, lat] = p;
    if (typeof lng !== "number" || typeof lat !== "number" || Number.isNaN(lng) || Number.isNaN(lat)) continue;
    sumLng += lng;
    sumLat += lat;
    west = Math.min(west, lng);
    south = Math.min(south, lat);
    east = Math.max(east, lng);
    north = Math.max(north, lat);
    valid += 1;
  }
  if (valid === 0) return null;
  const centroid: LngLat = [round6(sumLng / valid), round6(sumLat / valid)];
  let width = east - west;
  let height = north - south;
  // 経度方向が退化していれば centroid を中心に 1km 相当に拡張
  if (width < MIN_BBOX_DEG) {
    const half = MIN_BBOX_DEG / 2;
    west = centroid[0] - half;
    east = centroid[0] + half;
  }
  // 緯度方向が退化していれば centroid を中心に 1km 相当に拡張
  if (height < MIN_BBOX_DEG) {
    const half = MIN_BBOX_DEG / 2;
    south = centroid[1] - half;
    north = centroid[1] + half;
  }
  // 緯度は極を超えないよう clamp
  south = Math.max(-90, south);
  north = Math.min(90, north);
  return {
    bbox: [round6(west), round6(south), round6(east), round6(north)],
    centroid,
  };
}

/**
 * bbox から OpenLayers View で概ね fit する zoom を推定。
 * 実 pixel サイズではなく経緯度幅に基づく近似。maxZoom で上限固定。
 */
export function estimateZoomForBbox(bbox: Bbox, maxZoom: number = 18): number {
  const width = bbox[2] - bbox[0];
  const height = bbox[3] - bbox[1];
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return 1;
  // 経緯度幅の大きい方を zoom 0 の 1 tile(256px) と仮定し、1段多めに zoom しておく
  const zoom = Math.log2(360 / Math.max(width, height)) + 1;
  return Math.min(maxZoom, Math.max(1, Math.floor(zoom)));
}

/** envelope / bbox 配列の論理和を計算。 */
export function unionBboxes(bboxes: Bbox[]): Bbox | null {
  if (!Array.isArray(bboxes) || bboxes.length === 0) return null;
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const b of bboxes) {
    if (!b) continue;
    west = Math.min(west, b[0]);
    south = Math.min(south, b[1]);
    east = Math.max(east, b[2]);
    north = Math.max(north, b[3]);
  }
  if (!Number.isFinite(west)) return null;
  return [round6(west), round6(south), round6(east), round6(north)];
}

/** bbox を ratio 倍外側に拡張し clamp する。 */
export function expandBboxByRatio(bbox: Bbox, ratio: number): Bbox {
  const width = bbox[2] - bbox[0];
  const height = bbox[3] - bbox[1];
  const dw = width * ratio;
  const dh = height * ratio;
  const west = bbox[0] - dw;
  const east = bbox[2] + dw;
  const south = Math.max(-90, bbox[1] - dh);
  const north = Math.min(90, bbox[3] + dh);
  return [round6(west), round6(south), round6(east), round6(north)];
}

/** bbox から 4 隅の envelopeLngLats を返す。 */
export function bboxToEnvelope(bbox: Bbox): [number, number][] {
  return bboxToEnvelopeFromAppSource(bbox);
}
