import { computed, shallowRef } from 'vue';
import i18next from 'i18next';
import type { AssetDraftKind, AssetDraftSummary } from '../types/assetDraft';

export function useAssetDraftBadges(kind: AssetDraftKind) {
  const draftUids = shallowRef<Set<string>>(new Set());
  const draftSummaries = shallowRef<AssetDraftSummary[]>([]);
  // 新規(未保存)下書き。baseRevision===null が「保存済み行に紐づかない下書き」の共通判定
  const newDrafts = computed(() => draftSummaries.value.filter((draft) => draft.baseRevision === null));
  // M11-T10 (人間検証R4): 「新規追加」は既存の新規下書きがあればそれを引き継ぐ(全一覧共通)
  const latestNewDraft = computed(() => newDrafts.value.at(-1) ?? null);

  const refreshDrafts = async () => {
    const summaries = await window.assetDrafts.list(kind);
    draftSummaries.value = summaries;
    draftUids.value = new Set(summaries.map((summary) => summary.assetUid));
  };

  const hasDraft = (assetUid: string): boolean => draftUids.value.has(assetUid);

  // 新規(未保存)下書きの削除（Map/App の grid 一覧で共用）。保存済み行は存在しないため
  // draft store のみ消すが、下書きが GC 保護していた slug 予約も解放する
  // (M11-T10: 解放しないと lease 更新で -copy 採番がセッション中ずっと占有され続ける)。
  const removeNewDraft = async (draft: AssetDraftSummary): Promise<void> => {
    const name = draft.label ?? draft.slug ?? i18next.t('editor_ui.draft_badge');
    if (!confirm(i18next.t('editor_ui.delete_draft_confirm', { name }))) return;
    try {
      await window.assetDrafts.remove(kind, draft.assetUid);
      if (draft.slug) {
        try {
          await window.slugReservations.release({ slug: draft.slug, assetUid: draft.assetUid });
        } catch (cause) {
          // 予約解放失敗は lease/GC が最終回収する。draft 削除自体は成立させる。
          console.error(`Failed to release slug reservation for removed ${kind} draft`, cause);
        }
      }
      await refreshDrafts();
    } catch (e) {
      console.error(`Failed to delete new-${kind} draft`, e);
    }
  };

  return { draftUids, draftSummaries, newDrafts, latestNewDraft, refreshDrafts, hasDraft, removeNewDraft };
}
