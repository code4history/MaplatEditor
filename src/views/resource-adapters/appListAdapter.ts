import type { ResourceListAdapter, ResourceListItemViewModel } from "../../components/resource-list/resourceListTypes";
import { localizeTitle } from "../../utils/langResource";

export interface AppListRow { uid: string; appID: string; title: string; image: string | null }

export interface AppListAdapterDeps { hasDraft: (uid: string) => boolean; selectedUid: () => string | null }

// page式 applist backend を cursor(=ページ番号) へ内部包装する（D1）。
// 件数表示統一(2026-07-16 人間指示、旧D8改を更新): backend が total を返すようになったため実値を通す。
export function createAppListAdapter(deps: AppListAdapterDeps): ResourceListAdapter<AppListRow, number> {
  return {
    async load({ filter, cursor, limit }) {
      const page = cursor ?? 1;
      const result = await window.search.apps({ q: filter.q, bbox: filter.bbox ?? undefined, page, pageSize: limit });
      const items = result.docs.map((doc: any): AppListRow => ({
        uid: String(doc.uid),
        appID: String(doc.appID ?? doc.slug ?? doc._id),
        title: localizeTitle(doc.title ?? doc.appName, "") || String(doc.appID ?? doc.slug ?? doc._id),
        image: doc.image ?? doc.thumbnail ?? null,
      }));
      return { items, total: result.total, nextCursor: result.next ?? null };
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
        actions: ["duplicate", "delete"],
      };
    },
  };
}
