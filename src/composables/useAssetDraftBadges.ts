import { shallowRef } from 'vue';
import type { AssetDraftKind, AssetDraftSummary } from '../types/assetDraft';

export function useAssetDraftBadges(kind: AssetDraftKind) {
  const draftUids = shallowRef<Set<string>>(new Set());
  const draftSummaries = shallowRef<AssetDraftSummary[]>([]);

  const refreshDrafts = async () => {
    const summaries = await window.assetDrafts.list(kind);
    draftSummaries.value = summaries;
    draftUids.value = new Set(summaries.map((summary) => summary.assetUid));
  };

  const hasDraft = (assetUid: string): boolean => draftUids.value.has(assetUid);

  return { draftUids, draftSummaries, refreshDrafts, hasDraft };
}
