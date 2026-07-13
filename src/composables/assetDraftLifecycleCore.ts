import { shallowRef } from 'vue';
import type { AssetDraftEnvelope, AssetDraftKind } from '../types/assetDraft';

export type DraftRestoreDecision = 'none' | 'auto-apply' | 'conflict';

export function decideDraftRestore(
  draft: AssetDraftEnvelope | null,
  currentRevision: number | null,
): DraftRestoreDecision {
  if (!draft) return 'none';
  return draft.baseRevision === currentRevision ? 'auto-apply' : 'conflict';
}

interface DraftIdentity {
  kind: AssetDraftKind;
  assetUid: string;
  baseRevision: number | null;
}

interface AssetDraftCoreApi {
  put(draft: AssetDraftEnvelope): Promise<void>;
  remove(kind: AssetDraftKind, assetUid: string): Promise<void>;
  flushSync(draft: AssetDraftEnvelope): { ok: boolean; error?: string };
}

interface CoreOptions {
  api: AssetDraftCoreApi;
  delayMs?: number;
  now?: () => string;
  setTimeoutFn?: (callback: () => void | Promise<void>, delay: number) => ReturnType<typeof setTimeout>;
  clearTimeoutFn?: (timer: ReturnType<typeof setTimeout>) => void;
  onError?: (error: Error) => void;
}

export function createAssetDraftLifecycleCore(options: CoreOptions) {
  const delayMs = options.delayMs ?? 2000;
  const now = options.now ?? (() => new Date().toISOString());
  const setTimeoutFn = options.setTimeoutFn ?? ((callback, delay) => setTimeout(callback, delay));
  const clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;
  const error = shallowRef<Error | null>(null);
  let identity: DraftIdentity | null = null;
  let serialize: (() => unknown) | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let dirty = false;

  const envelope = (): AssetDraftEnvelope => {
    if (!identity || !serialize) throw new Error('Draft lifecycle is not open');
    return {
      schemaVersion: 1,
      ...identity,
      updatedAt: now(),
      payload: JSON.parse(JSON.stringify(serialize())),
    };
  };

  const cancelTimer = () => {
    if (timer !== undefined) clearTimeoutFn(timer);
    timer = undefined;
  };

  const persist = async () => {
    if (!dirty || !identity) return;
    try {
      await options.api.put(envelope());
      error.value = null;
    } catch (cause) {
      error.value = cause instanceof Error ? cause : new Error(String(cause));
      (options.onError ?? ((value) => console.warn('[asset-draft] automatic save failed:', value)))(error.value);
    }
  };

  return {
    error,
    open(nextIdentity: DraftIdentity, nextSerialize: () => unknown) {
      cancelTimer();
      identity = { ...nextIdentity };
      serialize = nextSerialize;
      dirty = false;
      error.value = null;
    },
    schedule(isDirty: boolean) {
      dirty = isDirty;
      cancelTimer();
      if (!dirty || !identity) return;
      timer = setTimeoutFn(async () => {
        timer = undefined;
        await persist();
      }, delayMs);
    },
    async flush() {
      cancelTimer();
      await persist();
    },
    flushSync() {
      if (!dirty || !identity) return { ok: true };
      try {
        const result = options.api.flushSync(envelope());
        if (!result.ok) error.value = new Error(result.error ?? 'Draft sync flush failed');
        return result;
      } catch (cause) {
        error.value = cause instanceof Error ? cause : new Error(String(cause));
        return { ok: false, error: error.value.message };
      }
    },
    async markSaved() {
      cancelTimer();
      if (identity) await options.api.remove(identity.kind, identity.assetUid);
      dirty = false;
      error.value = null;
    },
    close() {
      cancelTimer();
      identity = null;
      serialize = null;
      dirty = false;
    },
  };
}
