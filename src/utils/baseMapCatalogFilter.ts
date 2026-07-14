import type { BaseMapCatalogItemLike } from "./baseMapEditorDocument";

export type Wgs84Bbox = [
  west: number,
  south: number,
  east: number,
  north: number,
];

function isValidBbox(value: number[]): value is Wgs84Bbox {
  if (value.length !== 4 || value.some((part) => !Number.isFinite(part))) return false;
  const [west, south, east, north] = value;
  return (
    west >= -180 && east <= 180 &&
    south >= -90 && north <= 90 &&
    west < east && south < north
  );
}

export function parseBaseMapBboxQuery(value: unknown): Wgs84Bbox | null {
  if (typeof value !== "string") return null;
  const parts = value.split(",").map((part) => Number(part.trim()));
  return isValidBbox(parts) ? parts : null;
}

export function serializeBaseMapBboxQuery(value: Wgs84Bbox | null): string | null {
  return value && isValidBbox(value) ? value.join(",") : null;
}

function coverageBbox(value: unknown): Wgs84Bbox | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const points = value.filter(
    (point): point is [number, number] =>
      Array.isArray(point) &&
      point.length >= 2 &&
      Number.isFinite(point[0]) &&
      Number.isFinite(point[1]),
  );
  if (points.length !== value.length) return null;
  const lngs = points.map(([lng]) => lng);
  const lats = points.map(([, lat]) => lat);
  const bbox = [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
  return isValidBbox(bbox) ? bbox : null;
}

export function coverageIntersectsBbox(
  coverageLngLats: [number, number][] | null | undefined,
  filter: Wgs84Bbox,
): boolean {
  const coverage = coverageBbox(coverageLngLats);
  if (!coverage) return true;
  return !(
    coverage[2] < filter[0] ||
    coverage[0] > filter[2] ||
    coverage[3] < filter[1] ||
    coverage[1] > filter[3]
  );
}

function localizedValues(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.values(value).filter((entry): entry is string => typeof entry === "string");
}

function searchHaystack(item: BaseMapCatalogItemLike): string {
  const data = item.data ?? {};
  return [
    item.mapID,
    typeof data.url === "string" ? data.url : "",
    ...localizedValues(data.title),
    ...localizedValues(data.label),
    ...localizedValues(data.attr),
  ].join("\n").toLocaleLowerCase();
}

export function filterBaseMapCatalog<T extends BaseMapCatalogItemLike>(
  items: T[],
  query: string,
  bbox: Wgs84Bbox | null,
): T[] {
  const needle = query.trim().toLocaleLowerCase();
  return items.filter((item) => {
    if (needle && !searchHaystack(item).includes(needle)) return false;
    if (bbox && !coverageIntersectsBbox(item.data.coverageLngLats as [number, number][] | null | undefined, bbox)) return false;
    return true;
  });
}
