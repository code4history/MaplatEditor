import { coverageIntersectsBbox, type Wgs84Bbox } from '../../src/utils/baseMapCatalogFilter';

export function filterDocsByExtentSlugs<T>(docs: T[], extentSlugs: string[], slugOf: (doc: T) => unknown): T[] {
  const slugSet = new Set(extentSlugs);
  return docs.filter((doc) => slugSet.has(String(slugOf(doc) ?? '')));
}

export function filterBaseMapsByBbox<T extends { data?: { coverageLngLats?: [number, number][] | null } }>(
  docs: T[],
  bbox: Wgs84Bbox,
): T[] {
  return docs.filter((doc) => coverageIntersectsBbox(doc.data?.coverageLngLats, bbox));
}
