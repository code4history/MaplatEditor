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

export function clampScrollTop(
  requested: number,
  clientHeight: number,
  scrollHeight: number,
): number {
  return Math.max(0, Math.min(requested, Math.max(0, scrollHeight - clientHeight)));
}
