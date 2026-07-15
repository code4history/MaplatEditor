// SlugField 内部で使う予約 lifecycle composable (M11-T7/D6改)。
// window.slugReservations を叩き、available 確定時に reserve/move、originalSlug 復帰や
// draft 破棄で release、保存直前に confirmForSave で予約成立を再確認する。
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
  async function onAvailable(slug: string): Promise<SlugReservationFieldState | null> {
    const token = ++generation;
    latestSlug = slug;
    const identity = snapshotIdentity();
    return enqueueOperation(() => acquire(slug, token, identity));
  }

  // originalSlug 復帰・draft 破棄で予約を解放する。
  async function releaseIfHeld(): Promise<void> {
    invalidate();
    await enqueueOperation(async () => {
      const held = reserved;
      if (!held) return;
      await releaseReservation(held);
      if (reserved === held) reserved = null;
    });
  }

  // 保存直前はcheckだけで終えず、変更slugのreserve/moveを再確立する。
  // 未変更slugも自己registry ownerを除外したcheckがavailableの時だけ通すが予約はしない(AC15)。
  async function confirmForSave(currentSlug: string): Promise<SlugReservationConfirmation | null> {
    const identity = snapshotIdentity();
    // 常にDBの状態を確認してから判定する。
    // composable内部のreservedはIPC release等でDB側と不整合になる場合があるため。
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

    // DB上でslugが空き → 予約状態に応じて処理
    if (reserved && reserved.slug === currentSlug && sameIdentity(reserved, identity)) {
      // 既に予約済み。generation increment なしで成功。
      return { ok: true, state: 'available' };
    }

    // 予約が無い/不一致 → 新規reserve
    const token = ++generation;
    latestSlug = currentSlug;
    const originalSlug = opts.originalSlug();
    try {
      if (currentSlug === originalSlug) {
        await enqueueOperation(async () => {
          const held = reserved;
          if (!held) return;
          await releaseReservation(held);
          if (reserved === held) reserved = null;
        });
        return token === generation ? { ok: true, state: 'available' } : null;
      }
      const state = await enqueueOperation(() => acquire(currentSlug, token, identity));
      if (state == null) return null;
      return { ok: state === 'available' && reserved?.slug === currentSlug && sameIdentity(reserved, identity), state };
    } catch {
      return token === generation ? { ok: false, state: 'check-failed' } : null;
    }
  }

  return { onAvailable, releaseIfHeld, confirmForSave, invalidate };
}
