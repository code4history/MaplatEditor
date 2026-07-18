import type { ResourceListAdapter, ResourceListItemViewModel } from "../../components/resource-list/resourceListTypes";
import { localizeTitle } from "../../utils/langResource";

export interface MapListRow { uid: string; mapID: string; title: string; image: string | null; width?: number; height?: number }

export interface MapListAdapterDeps {
  hasDraft: (uid: string) => boolean;
  selectedUid: () => string | null;
}

// page式 maplist backend を cursor(=ページ番号) へ内部包装する（D1）。
// 件数表示統一(2026-07-16 人間指示、旧D8改を更新): backend が total を返すようになったため実値を通す。
export function createMapListAdapter(deps: MapListAdapterDeps): ResourceListAdapter<MapListRow, number> {
  return {
    async load({ filter, cursor, limit }) {
      const page = cursor ?? 1;
      const result = await window.search.maps({ q: filter.q, bbox: filter.bbox ?? undefined, page, pageSize: limit });
      const items = result.docs.map((doc: any): MapListRow => ({
        uid: String(doc.uid),
        mapID: String(doc.mapID ?? doc.slug ?? doc._id),
        title: localizeTitle(doc.title, "") || String(doc.mapID ?? doc.slug ?? doc._id),
        image: doc.image ?? doc.thumbnail ?? null,
        width: doc.width,
        height: doc.height,
      }));
      return { items, total: result.total, nextCursor: result.next ?? null };
    },
    toViewModel(item): ResourceListItemViewModel {
      return {
        uid: item.uid,
        slug: item.mapID, // AC9: Map に Slug（=mapID）を表示
        title: item.title || item.mapID,
        thumbnailUrl: item.image,
        metadata: [],
        badges: [],
        selected: deps.selectedUid() === item.uid,
        hasDraft: deps.hasDraft(item.uid),
        actions: ["duplicate", "delete"],
      };
    },
  };
}
