import type { LocationQueryRaw } from "vue-router";

export function mergeMasterDetailQuery(
  current: LocationQueryRaw,
  selection: { uid: string | null; isNew?: boolean; duplicate?: { sourceUid: string; slug: string } },
): LocationQueryRaw {
  const query: LocationQueryRaw = { ...current };
  // M11-T10: duplicateFrom/slug は複製オープン専用のワンショットパラメータ。
  // 選択遷移(新規追加・行選択・保存後・クローズ)で温存すると、以後の「新規追加」が
  // 複製として開き続ける(人間検証R2指摘)ため、duplicate 選択以外では必ず剥がす。
  delete query.duplicateFrom;
  delete query.slug;
  if (!selection.uid) {
    delete query.uid;
    delete query.new;
    return query;
  }
  query.uid = selection.uid;
  if (selection.isNew) query.new = "1";
  else delete query.new;
  if (selection.duplicate) {
    query.duplicateFrom = selection.duplicate.sourceUid;
    query.slug = selection.duplicate.slug;
  }
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
