// POI ソース参照 UI の共有純関数 (Phase 7, 43 §2.4)。
// AppEdit (器 = poiSources JSON 文字列を parse した配列) と MapEdit (器 = mapData.pois 配列) の
// 両エディタで PoiSourceSelector と永続形 pois 配列を往復させる。JSON 文字列⇄配列の層は呼び出し側の責務。
// 永続形の参照要素は { poiUid: "<uid>", cachedTitle? } (main 側 poiReferenceResolver と同一規約)。
// 生要素 (URL 文字列 / FC 埋め込み) は位置ごと透過する。
import type { SelectedPoiSourceRef } from "../services/registeredPoiSourceCatalog";

// 参照要素判定は main 側 poiReferenceResolver.poiUidOf と同一規約
// (「string の poiUid キーを持つ object」。空白のみの uid は生要素扱い)
export function poiUidOf(entry: unknown): string | null {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const uid = (entry as Record<string, unknown>).poiUid;
  return typeof uid === "string" && uid.trim() !== "" ? uid : null;
}

// pois 配列から selector の選択集合を復元する。重複参照は先勝ちで1つに畳む
export function extractPoiRefs(pois: unknown[]): SelectedPoiSourceRef[] {
  const restored: SelectedPoiSourceRef[] = [];
  for (const entry of pois) {
    const uid = poiUidOf(entry);
    if (!uid || restored.some((item) => item.sourceId === uid)) continue;
    const cachedTitle = (entry as Record<string, unknown>).cachedTitle;
    restored.push({
      kind: "registered-poi-source",
      sourceId: uid,
      catalogKey: `poi-source:${uid}`,
      // mode は一覧カードの表示都合の補助情報で選択判定 (sourceId) には使われない。
      // 保存形からは引けないため 'local' 仮置き
      mode: "local",
      cachedTitle: typeof cachedTitle === "string" ? cachedTitle : undefined,
    });
  }
  return restored;
}

export function samePoiSelection(a: SelectedPoiSourceRef[], b: SelectedPoiSourceRef[]): boolean {
  return (
    a.length === b.length &&
    a.every((item, index) => item.sourceId === b[index].sourceId && item.cachedTitle === b[index].cachedTitle)
  );
}

// selector の選択変更を pois 配列へ反映した新配列を返す。既存参照は元の相対順を保ち、
// 新規選択は末尾へ追加。生要素 (URL/FC) は位置ごと不変で透過する
export function applyPoiSelection(pois: unknown[], selected: SelectedPoiSourceRef[]): unknown[] {
  const selectedByUid = new Map(selected.map((item) => [item.sourceId, item]));
  const next: unknown[] = [];
  const written = new Set<string>();
  for (const entry of pois) {
    const uid = poiUidOf(entry);
    if (!uid) {
      next.push(entry);
      continue;
    }
    const selectedRef = selectedByUid.get(uid);
    if (!selectedRef || written.has(uid)) continue; // 解除された参照と重複参照は除去
    next.push(toPoiReferenceElement(selectedRef));
    written.add(uid);
  }
  for (const item of selected) {
    if (!written.has(item.sourceId)) next.push(toPoiReferenceElement(item));
  }
  return next;
}

function toPoiReferenceElement(item: SelectedPoiSourceRef): Record<string, string> {
  const element: Record<string, string> = { poiUid: item.sourceId };
  if (item.cachedTitle) element.cachedTitle = item.cachedTitle;
  return element;
}
