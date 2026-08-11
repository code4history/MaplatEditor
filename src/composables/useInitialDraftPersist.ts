// AC6 (M11-T7/§5.1 S3): 新規 asset の slug 予約成功時に初期 draft を即時保存し、
// reservation と draft_uid のGC保護リンケージを確立する。
// 既存 draft lifecycle は debounce(2s) で遅延するが、予約成功時点で即時 flush することで
// 予約が lease 失効後も GC (D4 draft保護) によって保持される。
import { ref, watch, type Ref } from 'vue';
import type { SlugFieldState } from './useSlugAvailability';

export function useInitialDraftPersist(opts: {
  slugState: Ref<SlugFieldState>;
  isNewAsset: () => boolean;
  flushDraft: () => Promise<void>;
}) {
  const initialPersisted = ref(false);

  watch(opts.slugState, async (state) => {
    if (state !== 'available' || !opts.isNewAsset() || initialPersisted.value) return;
    // flush成功後にのみ完了フラグを立てる。失敗時は再試行可能。
    try {
      await opts.flushDraft();
      initialPersisted.value = true;
    } catch {
      // flush失敗: initialPersistedはfalseのままなので、次回available遷移で再試行される。
      // 予約自体は成立しているため、lease/GC が最終回収するまで保持される。
    }
  });

  // asset/session identity切替時にone-shot状態をresetする。
  // 同一コンポーネントが複数assetを扱う場合(例: リスト→新規→リスト→新規)、
  // 2件目以降の新規assetでも初期draft保存が実行される。
  const reset = () => { initialPersisted.value = false; };

  return { initialPersisted, reset };
}
