import type { ResourceDataAdapter } from "../../components/resource-list/resourceListTypes";
import type { ImageAssetRow } from "../../electron";

export const imageAssetSearchAdapter: ResourceDataAdapter<ImageAssetRow, number> = {
  async load({ filter, cursor, limit }) {
    const page = cursor ?? 1;
    const result = await window.search.imageAssets({ q: filter.q, page, pageSize: limit });
    return { items: result.docs as ImageAssetRow[], total: result.total, nextCursor: result.next ?? null };
  },
};
