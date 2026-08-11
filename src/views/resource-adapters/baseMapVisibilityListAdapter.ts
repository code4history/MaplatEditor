// M12-T10: MapEdit ベースマップ選択（2 ペイン）の左ペイン用 adapter。
// baseMapVisibilityList（IPC で取得済みの in-memory 全件）を ResourceListAdapter として包み、
// ResourceSelectorList + ResourceMasterRow へ供給する。load は q/bbox filter を適用、cursor は未使用。
// M12-T10 v2.0: 検索 haystack を全言語値化（Min2 吸収）、metadata からスラッグ重複除去（HM7）、
// added 判定で selected=true（HM6: 追加済み=青）
import type { ResourceListAdapter, ResourceListItemViewModel, Wgs84Bbox } from "../../components/resource-list/resourceListTypes";
import type { BaseMapVisibilityItem } from "../../../electron/services/SqliteDataService";
import { localizeTitle, type LangResource } from "../../utils/langResource";

export interface BaseMapVisibilityListAdapterDeps {
  // in-memory 全件（MapEdit.vue 側で保持する baseMapVisibilityList）
  source: () => BaseMapVisibilityItem[];
  hasDraft: (uid: string) => boolean;
  activeLang: () => string;
}

// bbox と envelope が交差するか（MapEdit.vue:2481-2482 の bboxIntersects と同ロジック）
function bboxIntersects(a: number[], b: number[]): boolean {
  return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
}

// bbox [w,s,e,n] と coverageLngLats（[lng,lat][] の envelope）の交差判定。
// coverage 未設定（OSM 等の全球扱い）は常に true。
function coverageIntersects(coverageLngLats: [number, number][] | null | undefined, bbox: Wgs84Bbox): boolean {
  if (!coverageLngLats || coverageLngLats.length === 0) return true;
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const [lng, lat] of coverageLngLats) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return bboxIntersects([minLng, minLat, maxLng, maxLat], bbox);
}

// M12-T10 v2.0 Min2: 検索 haystack を全言語値化（旧 MapEdit.vue:2466-2472 baseMapSearchHaystack と同仕様に復元）
function searchHaystack(item: BaseMapVisibilityItem): string {
  const title = item.data?.title;
  const titleValues = typeof title === "object" && title !== null ? Object.values(title) : [title];
  return [item.mapID, ...titleValues]
    .filter((v): v is string => typeof v === "string")
    .join("\n")
    .toLowerCase();
}

export function createBaseMapVisibilityListAdapter(
  deps: BaseMapVisibilityListAdapterDeps
): ResourceListAdapter<BaseMapVisibilityItem, null> {
  return {
    async load({ filter }) {
      const all = deps.source();
      const q = filter.q.trim().toLowerCase();
      const bbox = filter.bbox;
      let filtered = all;
      if (q) {
        // Min2: 全言語値でヒット判定（表示言語に依らず全言語タイトル + mapID で検索）
        filtered = filtered.filter((item) => searchHaystack(item).includes(q));
      }
      if (bbox) {
        // チェック済み（表示ON）は空間絞り込みをバイパスし、一覧に残す。
        // これにより、遠隔地のON済みベースマップも絞り込み中にオフにできる（HV-R2、MapEdit.vue:2494-2496 と同一方針）
        filtered = filtered.filter((item) => {
          if (item.enabled) return true;
          return coverageIntersects(item.data?.coverageLngLats, bbox);
        });
      }
      return { items: filtered, total: filtered.length, nextCursor: null };
    },
    toViewModel(item: BaseMapVisibilityItem, activeLang: string): ResourceListItemViewModel {
      const title = item.data?.title as LangResource | null | undefined;
      const localized = title ? localizeTitle(title, activeLang) : String(item.mapID);
      return {
        uid: item.uid,
        slug: String(item.mapID),
        title: localized,
        thumbnailUrl: item.thumbnailUrl ?? null,
        // HM7: metadata からスラッグ重複除去。slug 行が mapID を表示するため scope のみ残す
        metadata: [item.scope],
        // locked は「常時表示」badge で表現
        badges: item.locked ? [{ key: "locked", label: "常時表示", tone: "info" }] : [],
        // HM6: 追加済み（enabled）は selected=true（青表示）。locked も enabled 扱いで selected=true
        selected: item.enabled,
        hasDraft: deps.hasDraft(item.uid),
        actions: [],
      };
    },
  };
}
