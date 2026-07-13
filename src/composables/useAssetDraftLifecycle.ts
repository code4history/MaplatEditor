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
      remove: (kind, assetUid) => window.assetDrafts.remove(kind, assetUid),
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

  const open = async (assetUid: string, revision: number | null) => {
    currentUid.value = assetUid;
    currentRevision.value = revision;
    draftRestored.value = false;
    conflictDraft.value = null;
    configureCore(assetUid, revision);
    const draft = await window.assetDrafts.get(options.kind, assetUid) as AssetDraftEnvelope<T> | null;
    const decision = decideDraftRestore(draft, revision);
    if (decision === 'auto-apply' && draft) await applyDraft(draft);
    if (decision === 'conflict' && draft) conflictDraft.value = draft;
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

  const beforeUnload = () => {
    const shouldPersist = options.shouldPersist?.() ?? false;
    if (shouldPersist) core.schedule(true);
    core.flushSync();
  };

  const flush = async () => {
    if (options.shouldPersist?.()) core.schedule(true);
    await core.flush();
  };

  const markSaved = async () => {
    await core.markSaved();
    draftRestored.value = false;
    conflictDraft.value = null;
  };

  const discard = async () => {
    await core.markSaved();
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
    discard,
    flushSync: core.flushSync,
    currentUid,
    currentRevision,
  };
}
