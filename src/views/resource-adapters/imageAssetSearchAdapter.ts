import type { ResourceDataAdapter } from "../../components/resource-list/resourceListTypes";
import { isSearchFailureReply, ResourceLoadFailureError } from "../../components/resource-list/loadFailure";
import type { ImageAssetRow } from "../../electron";

export const imageAssetSearchAdapter: ResourceDataAdapter<ImageAssetRow, number> = {
  async load({ filter, cursor, limit }) {
    const page = cursor ?? 1;
    const result = await window.search.imageAssets({ q: filter.q, page, pageSize: limit });
    if (isSearchFailureReply(result)) throw new ResourceLoadFailureError(result.failure);
    return { items: result.docs as ImageAssetRow[], total: result.total, nextCursor: result.next ?? null };
  },
};
