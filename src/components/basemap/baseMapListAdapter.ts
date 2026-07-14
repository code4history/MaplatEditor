import type { ResourceListAdapter, ResourceListItemViewModel } from "../resource-list/resourceListTypes";
import type { BaseMapCatalogItem } from "../../utils/baseMapEditorDocument";
import { filterBaseMapCatalog, type Wgs84Bbox } from "../../utils/baseMapCatalogFilter";
import { localizeTitle } from "../../utils/langResource";

export interface BaseMapAdapterDeps {
  source: () => BaseMapCatalogItem[]; // 全件（BaseMapList が保持）
  hasDraft: (uid: string) => boolean;
  selectedUid: () => string | null;
  activeLang: () => string;
  batchSize?: number;
}

// D2: client-side batch（配列スライス cursor=offset）。D3改: filter.bbox 実値を filterBaseMapCatalog へ渡す。
export function createBaseMapListAdapter(deps: BaseMapAdapterDeps): ResourceListAdapter<BaseMapCatalogItem, number> {
  const batchSize = deps.batchSize ?? 40;
  return {
    async load({ filter, cursor }) {
      const all = filterBaseMapCatalog(deps.source(), filter.q, filter.bbox as Wgs84Bbox | null);
      const offset = cursor ?? 0;
      const slice = all.slice(offset, offset + batchSize);
      const nextOffset = offset + batchSize;
      return { items: slice, total: all.length, nextCursor: nextOffset < all.length ? nextOffset : null };
    },
    toViewModel(item, activeLang): ResourceListItemViewModel {
      return {
        uid: item.uid,
        slug: item.mapID,
        title: localizeTitle(item.data.title as any, activeLang || deps.activeLang()) || item.mapID,
        thumbnailUrl: item.thumbnailUrl ?? null,
        metadata: [],
        badges: [],
        selected: deps.selectedUid() === item.uid,
        hasDraft: deps.hasDraft(item.uid),
        // D4改 / AC17: builtin は削除不可（現行区分維持）→ actions 空 → ⋮ 非表示。user のみ delete。
        actions: item.scope === "builtin" ? [] : ["delete"],
      };
    },
  };
}
