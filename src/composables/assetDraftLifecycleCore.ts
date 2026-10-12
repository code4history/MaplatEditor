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
  // M12-T20 (§5.1): opts.keepStaging=true は envelope のみ削除（staging 物理削除なし）
  remove(kind: AssetDraftKind, assetUid: string, opts?: { keepStaging?: boolean }): Promise<void>;
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
  // nov26-m6-t1 (#117 E3): 明示破棄（discard）の後、利用者の次の編集（schedule(true)）か
  // 次の open まで、編集画面の forced flush（useAssetDraftLifecycle.flush）で下書きを書き戻さない
  let discarded = false;
  let pendingPersist: Promise<void> | null = null;

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
    const operation = options.api.put(envelope());
    pendingPersist = operation;
    try {
      await operation;
      error.value = null;
    } catch (cause) {
      error.value = cause instanceof Error ? cause : new Error(String(cause));
      (options.onError ?? ((value) => console.warn('[asset-draft] automatic save failed:', value)))(error.value);
    } finally {
      if (pendingPersist === operation) pendingPersist = null;
    }
  };

  // M12-T20 (§5.1): keepStaging=true は dirty→clean 遷移（Undo で振出しに戻る等）専用。
  // envelope のみ即時削除し staging dir は残置する（セッション内 Redo → 保存の生存。AC20-9）。
  // Redo せず hot exit した残渣は次回起動時の孤児 GC が回収する（§6.3）
  const removePersisted = async (keepStaging = false) => {
    const target = identity ? { ...identity } : null;
    if (!target) return;
    if (pendingPersist) await pendingPersist.catch(() => undefined);
    await options.api.remove(target.kind, target.assetUid, keepStaging ? { keepStaging: true } : undefined);
  };

  return {
    error,
    open(nextIdentity: DraftIdentity, nextSerialize: () => unknown) {
      cancelTimer();
      identity = { ...nextIdentity };
      serialize = nextSerialize;
      dirty = false;
      discarded = false;
      error.value = null;
    },
    schedule(isDirty: boolean) {
      const wasDirty = dirty;
      dirty = isDirty;
      if (isDirty) discarded = false;
      cancelTimer();
      if (!dirty) {
        // D9/S7a (M11-T7/AC10): dirty→clean 遷移(Undo 等の checkpoint clean)で
        // 永続 draft を即時除去し、再起動時の draft 復活を防ぐ。store が正になるだけで、
        // T5 の liveDraftOverrides/reconcile 契約は不変。
        // M12-T20 (§6.3/AC20-9): この契機のみ keepStaging=true — staging dir を残置し、
        // セッション内 Redo → 保存を退行させない（履歴は in-memory のためセッションを跨いだ
        // Redo は構造的に成立せず、残渣は次回起動時孤児 GC が回収する）
        if (wasDirty && identity) void removePersisted(true);
        return;
      }
      if (!identity) return;
      timer = setTimeoutFn(async () => {
        timer = undefined;
        await persist();
      }, delayMs);
    },
    async flush() {
      cancelTimer();
      if (dirty) await persist();
      else await removePersisted();
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
      dirty = false;
      await removePersisted();
      error.value = null;
    },
    // nov26-m6-t1 (#117 E3): 明示破棄。markSaved と同じく envelope と staging を消すが、
    // 破棄の後（削除の途中を含む）に編集画面が閉じるまでの forced flush で書き戻さないよう、
    // 破棄済みの印を立てる。印は利用者の次の編集（schedule(true)）か open・endDiscardGuard で解ける。
    // endSession=true（新規 asset の破棄 = 破棄の直後に編集画面を離れる）は、この identity での
    // 永続化を以後一切しない（close と同じ）。離れるまでの間に非同期の文書の変化（watcher の
    // schedule(true)）が来ても、unmount の flushSync で書き戻さない
    async discard(opts?: { endSession?: boolean }) {
      cancelTimer();
      dirty = false;
      discarded = true;
      // removePersisted は対象の identity を同期的に捕まえてから await する
      const removal = removePersisted();
      const kept = { identity, serialize };
      if (opts?.endSession) {
        identity = null;
        serialize = null;
      }
      try {
        await removal;
      } catch (cause) {
        // 削除に失敗したら下書きは残っている。編集画面に留まるので、この session の永続化を元へ戻す
        // （identity を失ったまま残ると、以後の編集が保存まで下書きにならない。実装レビュー B19-MIN-2）
        if (opts?.endSession && identity === null) {
          identity = kept.identity;
          serialize = kept.serialize;
        }
        discarded = false;
        throw cause;
      }
      error.value = null;
    },
    isDiscarded() {
      return discarded;
    },
    // 既存 asset の破棄で、編集画面が保存版を読み直し履歴の基点を戻し終えた後に呼ぶ。以後は通常どおり
    // forced flush（shouldPersist）が「最初の 1 回の編集」の隙間を埋める（実装レビュー B19-MAJ-1:
    // 履歴の記録は watcher より後に積まれるため、最初の 1 回は schedule(false) になり印が解けなかった）
    endDiscardGuard() {
      discarded = false;
    },
    close() {
      cancelTimer();
      identity = null;
      serialize = null;
      dirty = false;
      discarded = false;
    },
  };
}
