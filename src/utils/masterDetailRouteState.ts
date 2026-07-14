import type { LocationQueryRaw } from "vue-router";

export function mergeMasterDetailQuery(
  current: LocationQueryRaw,
  selection: { uid: string | null; isNew?: boolean },
): LocationQueryRaw {
  const query: LocationQueryRaw = { ...current };
  if (!selection.uid) {
    delete query.uid;
    delete query.new;
    return query;
  }
  query.uid = selection.uid;
  if (selection.isNew) query.new = "1";
  else delete query.new;
  return query;
}

export function mergeMasterDetailFilters(
  current: LocationQueryRaw,
  filters: { q?: string | null; bbox?: string | null },
): LocationQueryRaw {
  const query: LocationQueryRaw = { ...current };
  if (filters.q === null || filters.q === "") delete query.q;
  else if (filters.q !== undefined) query.q = filters.q;
  if (filters.bbox === null || filters.bbox === "") delete query.bbox;
  else if (filters.bbox !== undefined) query.bbox = filters.bbox;
  return query;
}

export function clampScrollTop(
  requested: number,
  clientHeight: number,
  scrollHeight: number,
): number {
  return Math.max(0, Math.min(requested, Math.max(0, scrollHeight - clientHeight)));
}
