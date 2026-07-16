import i18next from "i18next";
import type { ResourceListAdapter, ResourceListItemViewModel } from "../../components/resource-list/resourceListTypes";
import type { PoiSourceListRow } from "../../electron";
import { localizeTitle } from "../../utils/langResource";

export interface PoiSourceAdapterDeps {
  hasDraft: (uid: string) => boolean;
  selectedUid: () => string | null;
  featuresLabel: (count: number) => string; // t('poisource.features') 合成
  localLabel: string;
  remoteLabel: string;
  pageSize?: number;
}

// page式 poiSources.list backend を cursor(=page) 包装。total は実値を通す（D8改）。
export function createPoiSourceListAdapter(deps: PoiSourceAdapterDeps): ResourceListAdapter<PoiSourceListRow, number> {
  const pageSize = deps.pageSize ?? 20;
  return {
    async load({ filter, cursor }) {
      const page = cursor ?? 1;
      const result = await window.poiSources.list({ query: filter.q, page, pageSize });
      const nextCursor = result.hasNext ? result.page + 1 : null;
      return { items: result.items, total: result.total, nextCursor };
    },
    toViewModel(item): ResourceListItemViewModel {
      return {
        uid: item.uid,
        slug: item.slug,
        title: localizeTitle(item.title, i18next.language) || item.slug,
        thumbnailUrl: null,
        metadata: [deps.featuresLabel(item.featureCount)],
        badges: [{ key: "mode", label: item.mode === "local" ? deps.localLabel : deps.remoteLabel, tone: item.mode === "local" ? "info" : "neutral" }],
        selected: deps.selectedUid() === item.uid,
        hasDraft: deps.hasDraft(item.uid),
        actions: ["duplicate", "delete"],
      };
    },
  };
}
