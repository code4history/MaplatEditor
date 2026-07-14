import i18next from "i18next";
import type { ResourceListAdapter, ResourceListItemViewModel } from "../resource-list/resourceListTypes";
import type { ImageAssetRow } from "../../electron";
import { localizeTitle } from "../../utils/langResource";

export interface AssetAdapterDeps {
  hasDraft: (uid: string) => boolean;
  selectedUid: () => string | null;
  thumbUrl: (uid: string) => string | null;
  batchSize?: number;
}

// D2: 全件取得（imageAssets.list/search）を client-side batch（配列スライス cursor=offset）で払い出す。
export function createAssetListAdapter(deps: AssetAdapterDeps): ResourceListAdapter<ImageAssetRow, number> {
  const batchSize = deps.batchSize ?? 40;
  return {
    async load({ filter, cursor }) {
      const q = filter.q.trim();
      const all = q ? await window.imageAssets.search(q) : await window.imageAssets.list();
      const offset = cursor ?? 0;
      const slice = all.slice(offset, offset + batchSize);
      const nextOffset = offset + batchSize;
      return { items: slice, total: all.length, nextCursor: nextOffset < all.length ? nextOffset : null };
    },
    toViewModel(item): ResourceListItemViewModel {
      const dims = item.width !== null && item.height !== null ? `${item.width}×${item.height} · ` : "";
      return {
        uid: item.uid,
        slug: item.slug,
        title: localizeTitle(item.title, i18next.language) || item.slug,
        thumbnailUrl: deps.thumbUrl(item.uid),
        metadata: [`${dims}${item.mime}`],
        badges: [],
        selected: deps.selectedUid() === item.uid,
        hasDraft: deps.hasDraft(item.uid),
        actions: ["delete"],
      };
    },
  };
}
