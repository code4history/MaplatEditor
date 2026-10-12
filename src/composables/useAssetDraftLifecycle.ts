import { onBeforeUnmount, onMounted, shallowRef } from 'vue';
import type { AssetDraftEnvelope, AssetDraftKind } from '../types/assetDraft';
import { createAssetDraftLifecycleCore, decideDraftRestore } from './assetDraftLifecycleCore';

export interface UseAssetDraftLifecycleOptions<T> {
  kind: AssetDraftKind;
  serialize: () => T;
  apply: (payload: T) => void | Promise<void>;
  onRestored?: () => void | Promise<void>;
  shouldPersist?: () => boolean;
}

export function useAssetDraftLifecycle<T>(options: UseAssetDraftLifecycleOptions<T>) {
  const conflictDraft = shallowRef<AssetDraftEnvelope<T> | null>(null);
  const draftRestored = shallowRef(false);
  const currentUid = shallowRef<string | null>(null);
  const currentRevision = shallowRef<number | null>(null);
  const core = createAssetDraftLifecycleCore({
    api: {
      put: (draft) => window.assetDrafts.put(draft),
      // M12-T20 (§5.1): keepStaging opts を IPC までそのまま透過する
      remove: (kind, assetUid, opts) => window.assetDrafts.remove(kind, assetUid, opts),
      flushSync: (draft) => window.assetDrafts.flushSync(draft),
    },
  });

  const configureCore = (assetUid: string, baseRevision: number | null) => {
    core.open({ kind: options.kind, assetUid, baseRevision }, options.serialize);
  };

  const applyDraft = async (draft: AssetDraftEnvelope<T>) => {
    await options.apply(structuredClone(draft.payload));
    await options.onRestored?.();
    draftRestored.value = true;
  };

  const open = async (
    assetUid: string,
    revision: number | null,
    opts?: { shouldApply?: () => boolean },
  ) => {
    currentUid.value = assetUid;
    currentRevision.value = revision;
    draftRestored.value = false;
    conflictDraft.value = null;
    configureCore(assetUid, revision);
    const draft = await window.assetDrafts.get(options.kind, assetUid) as AssetDraftEnvelope<T> | null;
    const decision = decideDraftRestore(draft, revision);
    // M11-T10b（実装レビュー Minor）: get の await 中に遷移が起きた場合、古い session への
    // 復元適用・conflict 提示を shouldApply ガードで抑止する（省略時は従来どおり適用）
    const mayApply = opts?.shouldApply?.() ?? true;
    if (decision === 'auto-apply' && draft && mayApply) await applyDraft(draft);
    if (decision === 'conflict' && draft && mayApply) conflictDraft.value = draft;
    return decision;
  };

  const resolveConflict = async (action: 'discard' | 'apply') => {
    const draft = conflictDraft.value;
    if (!draft) return;
    conflictDraft.value = null;
    if (action === 'discard') {
      await window.assetDrafts.remove(draft.kind, draft.assetUid);
      return;
    }
    // 外部更新との衝突を明示保存まで忘れないよう、元draftのbaseRevisionを維持する。
    configureCore(draft.assetUid, draft.baseRevision);
    await applyDraft(draft);
  };

  // nov26-m6-t1 (#117 E3): 明示破棄の後は、エディタの履歴が dirty のままでも forced に
  // dirty へ戻さない（破棄の後に slug の予約成功・hot exit 等の flush が来ると下書きを書き戻していた）。
  // 利用者が次に編集すれば watcher 経由の schedule(true) で破棄済みの印が解ける
  const forcePersist = () => !core.isDiscarded() && (options.shouldPersist?.() ?? false);

  const beforeUnload = () => {
    if (forcePersist()) core.schedule(true);
    core.flushSync();
  };

  const flush = async () => {
    if (forcePersist()) core.schedule(true);
    await core.flush();
  };

  const markSaved = async () => {
    await core.markSaved();
    draftRestored.value = false;
    conflictDraft.value = null;
  };

  // M11-T10b（実装レビュー Major）: 保存成功後に identity を保存済み行へ再構成する。
  // open() と違い draft store の restore 判定を行わない（保存直後に古い下書きが残っていても
  // conflict dialog を出さない）。baseRevision を保存 revision へ進めることで、
  // 追加編集の下書きが「保存済み行の下書き」として扱われ、新規カード化・復元 conflict を防ぐ。
  // core の dirty フラグは変えず、次の schedule/flush が現在の編集状態をそのまま永続化する。
  const rebase = (assetUid: string, baseRevision: number | null) => {
    currentUid.value = assetUid;
    currentRevision.value = baseRevision;
    configureCore(assetUid, baseRevision);
  };

  // opts.endSession: 破棄の直後に編集画面を離れる（新規 asset の下書きの破棄）ときに true
  const discard = async (opts?: { endSession?: boolean }) => {
    await core.discard(opts);
    draftRestored.value = false;
    conflictDraft.value = null;
  };

  onMounted(() => {
    window.addEventListener('beforeunload', beforeUnload);
    window.addEventListener('maplat:flush-drafts', beforeUnload);
  });
  onBeforeUnmount(() => {
    core.flushSync();
    window.removeEventListener('beforeunload', beforeUnload);
    window.removeEventListener('maplat:flush-drafts', beforeUnload);
    core.close();
  });

  return {
    conflictDraft,
    draftRestored,
    error: core.error,
    open,
    resolveConflict,
    schedule: core.schedule,
    flush,
    markSaved,
    rebase,
    discard,
    flushSync: core.flushSync,
    currentUid,
    currentRevision,
  };
}
