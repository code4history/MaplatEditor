import { shallowRef } from 'vue';
import type { AssetDraftKind } from '../types/assetDraft';

export function useAssetDraftBadges(kind: AssetDraftKind) {
  const draftUids = shallowRef<Set<string>>(new Set());

  const refreshDrafts = async () => {
    const summaries = await window.assetDrafts.list(kind);
    draftUids.value = new Set(summaries.map((summary) => summary.assetUid));
  };

  const hasDraft = (assetUid: string): boolean => draftUids.value.has(assetUid);

  return { draftUids, refreshDrafts, hasDraft };
}
