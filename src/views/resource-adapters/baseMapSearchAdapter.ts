import type { ResourceDataAdapter } from "../../components/resource-list/resourceListTypes";
import type { BaseMapCatalogItem } from "../../utils/baseMapEditorDocument";

export const baseMapSearchAdapter: ResourceDataAdapter<BaseMapCatalogItem, number> = {
  async load({ filter, cursor, limit }) {
    const page = cursor ?? 1;
    const result = await window.search.baseMaps({ q: filter.q, bbox: filter.bbox ?? undefined, page, pageSize: limit });
    return { items: result.docs as BaseMapCatalogItem[], total: result.total, nextCursor: result.next ?? null };
  },
};
