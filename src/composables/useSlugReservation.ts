// SlugField 内部で使う予約 lifecycle composable (M11-T7/D6改)。
// window.slugReservations を叩き、available 確定時に reserve/move、originalSlug 復帰や
// draft 破棄で release、保存直前に confirmForSave で予約成立を再確認する。
import { ref } from 'vue';
import type { SlugFieldKind } from '../utils/slugReservationKind';

export type SlugReservationFieldState = 'available' | 'reserved-by-other' | 'check-failed';

export interface SlugReservationConfirmation {
  ok: boolean;
  state: SlugReservationFieldState;
}

interface ReservationIdentity {
  assetUid: string;
  assetKind: string;
  draftUid: string;
}

interface HeldReservation extends ReservationIdentity {
  slug: string;
}

export function useSlugReservation(opts: {
  assetKind: () => string;
  assetUid: () => string;
  draftUid: () => string | undefined;
  originalSlug: () => string | undefined;
}) {
  let reserved: HeldReservation | null = null;
  let generation = 0;
  let latestSlug: string | null = null;
  let operationTail: Promise<void> = Promise.resolve();
  let queuedOperations = 0;
  // Counter-based pending tracking: increment on start, decrement on finish.
  // reservationPendingCount > 0 iff any reserve/release operation is in flight.
  let reservationPendingCount = 0;
  // release失敗/保留を SlugField に伝える reactive 状態(Major-2/Major-D)。
  // plain boolean だと Vue computed が再評価されないため ref を使う。
  const releasePending = ref(false);
  const releaseFailed = ref(false);

  function invalidate(currentSlug?: string): void {
    const trimmed = currentSlug?.trim() || null;
    // slug が実質的に変化した場合のみ generation を increment する。
    // 同一 slug の再通知で generation が進み、onAvailable の結果が stale 扱いになる問題を回避する。
    if (trimmed !== latestSlug) {
      generation += 1;
    }
    latestSlug = trimmed;
  }

  function enqueueOperation<T>(work: () => Promise<T>): Promise<T> {
    queuedOperations += 1;
    const operation = operationTail.then(work);
    operationTail = operation.then(() => undefined, () => undefined);
    return operation.finally(() => { queuedOperations -= 1; });
  }

  function snapshotIdentity(): ReservationIdentity {
    const assetUid = opts.assetUid();
    const draftUid = opts.draftUid();
    // IPC の kind 検証は UI 形式(base-map)を期待する。registry 形式(base_map)は
    // backend の reserve 側で変換する。snapshotIdentity は UI 形式を返す。
    const assetKind = (opts.assetKind() as SlugFieldKind);
    return {
      assetUid,
      assetKind,
      draftUid: draftUid ?? assetUid,
    };
  }

  function sameIdentity(a: ReservationIdentity, b: ReservationIdentity): boolean {
    return a.assetUid === b.assetUid && a.assetKind === b.assetKind && a.draftUid === b.draftUid;
  }

  async function releaseReservation(held: HeldReservation): Promise<void> {
    // 現行IPCは成功時void。将来/障害注入でmutation結果が返る場合も非okを成功扱いしない。
    const result = await window.slugReservations.release({
      slug: held.slug,
      assetUid: held.assetUid,
    }) as unknown as { result?: string; message?: string } | void;
    if (result != null && result.result !== 'ok') {
      throw new Error(result.message ?? `Slug reservation release failed: ${result.result ?? 'unknown'}`);
    }
  }

  async function releaseStaleReservation(held: HeldReservation): Promise<void> {
    // 後続operationがある場合は、それが実行時のheldからmove/releaseする。
    // 後続なし（invalid slug等）だけstale成功分を明示解放する。
    if (queuedOperations > 1 || latestSlug === held.slug) return;
    try {
      await releaseReservation(held);
      if (reserved === held) reserved = null;
    } catch {
      // stale cleanup失敗を現在のfield状態へ伝播させない。lease/GCが最終回収する。
    }
  }

  async function acquire(
    slug: string,
    token: number,
    identity: ReservationIdentity,
  ): Promise<SlugReservationFieldState | null> {
    let from = reserved;
    try {
      if (from && !sameIdentity(from, identity)) {
        await releaseReservation(from);
        if (reserved === from) reserved = null;
        from = null;
      }
      const result = from && from.slug !== slug
        ? await window.slugReservations.move({
            fromSlug: from.slug, toSlug: slug, ...identity,
          })
        : await window.slugReservations.reserve({
            slug, ...identity,
          });

      if (result.result === 'ok') {
        // IPC mutationが成功した時点の実heldはstale UI応答でも必ず追跡する。
        reserved = { slug, ...identity };
        if (token !== generation) {
          await releaseStaleReservation(reserved);
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
  // Counter-based pending: reservationPendingCount を increment/decrement し、
  // 旧 request の finally が新 request の pending を解除しないようにする(Major-C)。
  async function onAvailable(slug: string): Promise<SlugReservationFieldState | null> {
    const token = ++generation;
    latestSlug = slug;
    releaseFailed.value = false;
    releasePending.value = false;
    const identity = snapshotIdentity();
    reservationPendingCount += 1;
    try {
      return await enqueueOperation(() => acquire(slug, token, identity));
    } finally {
      reservationPendingCount -= 1;
    }
  }

  // originalSlug 復帰・draft 破棄で予約を解放する。
  // reserved は release 成功後にのみクリアする(Major-2)。
  // release失敗時は reject を維持し、呼出元の close/reset を止める(Major-D)。
  async function releaseIfHeld(): Promise<void> {
    invalidate();
    releaseFailed.value = false;
    const held = reserved;
    if (!held) return;
    releasePending.value = true;
    try {
      await releaseReservation(held);
      if (reserved === held) reserved = null;
      releasePending.value = false;
    } catch (e) {
      releaseFailed.value = true;
      releasePending.value = false;
      throw e;
    }
  }

  // 保存直前はcheckだけで終えず、変更slugのreserve/moveを再確立する。
  // DB上の自己予約と予約なしを区別し、stale heldでも再reserveしてDB ownershipを再確立する(Major-2)。
  // 未変更slugもDB確認で他者予約を検出し、自己所有なら冪等claimする(AC15)。
  async function confirmForSave(currentSlug: string): Promise<SlugReservationConfirmation | null> {
    const identity = snapshotIdentity();
    const originalSlug = opts.originalSlug();
    const token = ++generation;
    latestSlug = currentSlug;

    // slug未変更: held一致なら即成功。それ以外はDB確認で自己所有判定(AC15)。
    if (currentSlug === originalSlug) {
      // held一致: 既に予約済み。generation increment なしで成功。
      if (reserved && reserved.slug === currentSlug && sameIdentity(reserved, identity)) {
        return { ok: true, state: 'available' };
      }
      // heldあり but 不一致 → releaseしてからDB確認。release失敗はcheck-failed(Major-2)。
      // releaseIfHeld は invalidate で generation を進めるため、直接 release 操作を行う。
      if (reserved) {
        const held = reserved;
        releasePending.value = true;
        try {
          await releaseReservation(held);
          if (reserved === held) reserved = null;
          releasePending.value = false;
        } catch {
          releaseFailed.value = true;
          releasePending.value = false;
          return { ok: false, state: 'check-failed' };
        }
      }
      // heldなし/解放済み: DB確認で自己所有判定
      try {
        const dbCheck = await window.slugReservations.check({
          slug: currentSlug,
          excludeUid: identity.assetUid,
        });
        if (dbCheck !== 'available') {
          reserved = null;
          return { ok: false, state: 'reserved-by-other' };
        }
      } catch {
        return { ok: false, state: 'check-failed' };
      }
      return token === generation ? { ok: true, state: 'available' } : null;
    }

    // slug変更: 常にacquire()でDB ownershipを再確立する。
    // stale held → release + 新 reserve/claim。DB上の他者予約 → reserved-by-other。
    // DB上の自己予約(再試行時) → 冪等claim。DB上の予約なし → 新規reserve。
    // acquire() の前にDB checkを行い、他者予約を検出したら即座にreturnする(Major-2)。
    // acquire() はstale heldを解放する際、DB上の他者予約も巻き込んで消す場合があるため。
    releaseFailed.value = false;
    releasePending.value = false;
    try {
      const preCheck = await window.slugReservations.check({
        slug: currentSlug,
        excludeUid: identity.assetUid,
      });
      if (preCheck !== 'available') {
        reserved = null;
        return { ok: false, state: 'reserved-by-other' };
      }
      const state = await enqueueOperation(() => acquire(currentSlug, token, identity));
      if (state == null) return null;
      // acquire成立 && DBで最終確認
      if (state === 'available' && reserved?.slug === currentSlug && sameIdentity(reserved, identity)) {
        try {
          const dbCheck = await window.slugReservations.check({
            slug: currentSlug,
            excludeUid: identity.assetUid,
          });
          if (dbCheck !== 'available') {
            reserved = null;
            return { ok: false, state: 'reserved-by-other' };
          }
        } catch {
          return { ok: false, state: 'check-failed' };
        }
        return { ok: true, state: 'available' };
      }
      return { ok: false, state };
    } catch {
      return token === generation ? { ok: false, state: 'check-failed' } : null;
    }
  }

  // release失敗/保留を SlugField に伝える(Major-2/Major-D)。
  // ref なので Vue computed が再評価され、check-failed 表示が保証される。
  function hasFailedRelease(): boolean {
    return releaseFailed.value || releasePending.value;
  }

  return { onAvailable, releaseIfHeld, confirmForSave, invalidate, hasFailedRelease, releaseFailed, releasePending };
}
