import type { ResourceListAdapter, ResourceListItemViewModel } from "../../components/resource-list/resourceListTypes";

export interface MapListRow { uid: string; mapID: string; title: string; image: string | null; width?: number; height?: number }

export interface MapListAdapterDeps {
  hasDraft: (uid: string) => boolean;
  selectedUid: () => string | null;
}

// page式 maplist backend を cursor(=ページ番号) へ内部包装する（D1）。maplist は total を返さない → total: null（D8改）。
export function createMapListAdapter(deps: MapListAdapterDeps): ResourceListAdapter<MapListRow, number> {
  return {
    async load({ filter, cursor }) {
      const page = cursor ?? 1;
      const result = await window.maplist.request(filter.q, page);
      // pageUpdate: 最終ページ全削除時のバックエンド補正。cursor 連鎖は補正値へ揃える（D9）。
      const effectivePage = (result.pageUpdate ?? page) as number;
      const nextCursor = result.next ? effectivePage + 1 : null;
      return { items: result.docs as MapListRow[], total: null, nextCursor };
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
        actions: ["delete"], // T10 で "duplicate" 追加
      };
    },
  };
}
