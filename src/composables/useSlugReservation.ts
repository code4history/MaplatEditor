// SlugField 内部で使う予約 lifecycle composable (M11-T7/D6改)。
// window.slugReservations を叩き、available 確定時に reserve/move、originalSlug 復帰や
// draft 破棄で release、保存直前に confirmForSave で予約成立を再確認する。
import { toRegistryKind, type SlugFieldKind } from '../utils/slugReservationKind';

export type SlugReservationFieldState = 'available' | 'reserved-by-other' | 'check-failed';

export interface SlugReservationConfirmation {
  ok: boolean;
  state: SlugReservationFieldState;
}

export function useSlugReservation(opts: {
  assetKind: () => string;
  assetUid: () => string;
  draftUid: () => string | undefined;
  originalSlug: () => string | undefined;
}) {
  let reserved: string | null = null;
  let generation = 0;
  let latestSlug: string | null = null;
  let operationTail: Promise<void> = Promise.resolve();
  let queuedOperations = 0;

  function invalidate(currentSlug?: string): void {
    generation += 1;
    latestSlug = currentSlug?.trim() || null;
  }

  function enqueueOperation<T>(work: () => Promise<T>): Promise<T> {
    queuedOperations += 1;
    const operation = operationTail.then(work);
    operationTail = operation.then(() => undefined, () => undefined);
    return operation.finally(() => { queuedOperations -= 1; });
  }

  async function releaseStaleReservation(slug: string): Promise<void> {
    // 後続operationがある場合は、それが実行時のheldからmove/releaseする。
    // 後続なし（invalid slug等）だけstale成功分を明示解放する。
    if (queuedOperations > 1 || latestSlug === slug) return;
    try {
      await window.slugReservations.release({ slug, assetUid: opts.assetUid() });
      if (reserved === slug) reserved = null;
    } catch {
      // stale cleanup失敗を現在のfield状態へ伝播させない。lease/GCが最終回収する。
    }
  }

  async function acquire(slug: string, token: number): Promise<SlugReservationFieldState | null> {
    const kind = toRegistryKind(opts.assetKind() as SlugFieldKind);
    const draftUid = opts.draftUid() ?? opts.assetUid();
    const fromSlug = reserved;
    try {
      const result = fromSlug && fromSlug !== slug
        ? await window.slugReservations.move({
          fromSlug, toSlug: slug, assetUid: opts.assetUid(), assetKind: kind, draftUid,
        })
        : await window.slugReservations.reserve({
          slug, assetUid: opts.assetUid(), assetKind: kind, draftUid,
        });

      if (result.result === 'ok') {
        // IPC mutationが成功した時点の実heldはstale UI応答でも必ず追跡する。
        reserved = slug;
        if (token !== generation) {
          await releaseStaleReservation(slug);
          return null;
        }
        return 'available';
      }
      if (token !== generation) {
        if (reserved) await releaseStaleReservation(reserved);
        return null;
      }
      return result.result === 'conflict' ? 'reserved-by-other' : 'check-failed';
    } catch {
      if (token === generation) return 'check-failed';
      if (reserved) await releaseStaleReservation(reserved);
      return null;
    }
  }

  // debounce 確認成功(available)時に呼ぶ。既に別 slug を予約中なら move、なければ reserve。
  async function onAvailable(slug: string): Promise<SlugReservationFieldState | null> {
    const token = ++generation;
    latestSlug = slug;
    return enqueueOperation(() => acquire(slug, token));
  }

  // originalSlug 復帰・draft 破棄で予約を解放する。
  async function releaseIfHeld(): Promise<void> {
    invalidate();
    await enqueueOperation(async () => {
      const held = reserved;
      if (!held) return;
      await window.slugReservations.release({ slug: held, assetUid: opts.assetUid() });
      if (reserved === held) reserved = null;
    });
  }

  // 保存直前はcheckだけで終えず、変更slugのreserve/moveを再確立する。
  // 未変更slugも自己registry ownerを除外したcheckがavailableの時だけ通すが予約はしない(AC15)。
  async function confirmForSave(currentSlug: string): Promise<SlugReservationConfirmation | null> {
    const token = ++generation;
    latestSlug = currentSlug;
    try {
      const checked = await window.slugReservations.check({
        slug: currentSlug,
        excludeUid: opts.assetUid(),
      });
      if (token !== generation) return null;
      if (checked !== 'available') return { ok: false, state: 'reserved-by-other' };
      if (currentSlug === opts.originalSlug()) {
        await operationTail;
        return token === generation ? { ok: true, state: 'available' } : null;
      }
      const state = await enqueueOperation(() => acquire(currentSlug, token));
      if (state == null) return null;
      return { ok: state === 'available' && reserved === currentSlug, state };
    } catch {
      return token === generation ? { ok: false, state: 'check-failed' } : null;
    }
  }

  return { onAvailable, releaseIfHeld, confirmForSave, invalidate };
}
