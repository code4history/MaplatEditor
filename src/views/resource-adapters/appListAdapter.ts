import type { ResourceListAdapter, ResourceListItemViewModel } from "../../components/resource-list/resourceListTypes";

export interface AppListRow { uid: string; appID: string; title: string; image: string | null }

export interface AppListAdapterDeps { hasDraft: (uid: string) => boolean; selectedUid: () => string | null }

// page式 applist backend を cursor(=ページ番号) へ内部包装する（D1）。
// 件数表示統一(2026-07-16 人間指示、旧D8改を更新): backend が total を返すようになったため実値を通す。
export function createAppListAdapter(deps: AppListAdapterDeps): ResourceListAdapter<AppListRow, number> {
  return {
    async load({ filter, cursor }) {
      const page = cursor ?? 1;
      const result = await window.applist.request(filter.q, page);
      const effectivePage = (result.pageUpdate ?? page) as number;
      const nextCursor = result.next ? effectivePage + 1 : null;
      return { items: result.docs as AppListRow[], total: (result as { total?: number }).total ?? null, nextCursor };
    },
    toViewModel(item): ResourceListItemViewModel {
      return {
        uid: item.uid,
        slug: item.appID, // AC9: App に Slug（=appID）
        title: item.title || item.appID,
        thumbnailUrl: item.image,
        metadata: [],
        badges: [],
        selected: deps.selectedUid() === item.uid,
        hasDraft: deps.hasDraft(item.uid),
        actions: ["delete"],
      };
    },
  };
}
