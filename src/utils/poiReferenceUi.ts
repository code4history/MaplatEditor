// POI ソース参照 UI の共有純関数 (Phase 7-8, 43 §2.4)。
// PoiReferenceEditor (AppEdit の appData.pois / MapEdit の mapData.pois の両方から利用) で
// PoiSourceSelector と永続形 pois 配列を往復させる。
// 永続形の参照要素は { poiUid: "<uid>", cachedTitle?, icon?, selectedIcon?, title? }
// (main 側 poiReferenceResolver と同一規約。icon/selectedIcon は参照単位の上書き (POI-112 最小形)、
// title は参照単位のタイトル上書き (LangResource, GUI 検証 D1))。
// 生要素 (URL 文字列 / FC 埋め込み) は位置ごと透過する。
import type { SelectedPoiSourceRef } from "../services/registeredPoiSourceCatalog";

// UUID 形式判定。大文字小文字を区別しない — electron/adapters/StorageAdapter.ts の
// UUID_PATTERN と同じ形（renderer からは import できないため値を揃えてここに再定義する）。
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 参照要素判定は main 側 poiReferenceResolver.poiUidOf と同一規約
// (「string の poiUid キーを持つ object」かつ uid が UUID 形状のもののみ参照扱い。M4)。
// UUID 形でない poiUid は将来拡張の手書き形の可能性があるため生要素として透過し、選択集合の
// 復元・書き戻しの対象にもしない (位置不変で温存)。main 側の findPoiSourceReferences の
// 走査対象 (UUID のみ) と対称。
export function poiUidOf(entry: unknown): string | null {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const uid = (entry as Record<string, unknown>).poiUid;
  return typeof uid === "string" && UUID_PATTERN.test(uid) ? uid : null;
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

// selector の選択変更を pois 配列へ反映した新配列を返す。既存参照は元の相対順を保ち、
// 新規選択は末尾へ追加。生要素 (URL/FC) は位置ごと不変で透過する。
// 選択維持の参照要素は icon/selectedIcon 等の追加キー (Phase 8 の参照単位上書き) を温存する
// (poiUid/cachedTitle 以外を落とさない — 元 entry を base に spread で再構築)
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
    next.push(toPoiReferenceElement(selectedRef, entry as Record<string, unknown>));
    written.add(uid);
  }
  for (const item of selected) {
    if (!written.has(item.sourceId)) next.push(toPoiReferenceElement(item));
  }
  return next;
}

function toPoiReferenceElement(
  item: SelectedPoiSourceRef,
  base?: Record<string, unknown>,
): Record<string, unknown> {
  const element: Record<string, unknown> = { ...(base ?? {}), poiUid: item.sourceId };
  if (item.cachedTitle) element.cachedTitle = item.cachedTitle;
  return element;
}
