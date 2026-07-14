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

  function invalidate(): void {
    generation += 1;
    latestSlug = null;
  }

  async function releaseStaleReservation(slug: string): Promise<void> {
    // slug単位 + assetUid条件付きreleaseなので、別slugのcurrent heldは壊さない。
    // newer requestが同じslugを再取得中/取得済みなら、その予約を消さない。
    if (latestSlug === slug || reserved === slug) return;
    try {
      await window.slugReservations.release({ slug, assetUid: opts.assetUid() });
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

      if (token !== generation) {
        if (result.result === 'ok') await releaseStaleReservation(slug);
        return null;
      }
      if (result.result === 'ok') {
        reserved = slug;
        return 'available';
      }
      return result.result === 'conflict' ? 'reserved-by-other' : 'check-failed';
    } catch {
      return token === generation ? 'check-failed' : null;
    }
  }

  // debounce 確認成功(available)時に呼ぶ。既に別 slug を予約中なら move、なければ reserve。
  async function onAvailable(slug: string): Promise<SlugReservationFieldState | null> {
    const token = ++generation;
    latestSlug = slug;
    return acquire(slug, token);
  }

  // originalSlug 復帰・draft 破棄で予約を解放する。
  async function releaseIfHeld(): Promise<void> {
    invalidate();
    const held = reserved;
    reserved = null;
    if (held) await window.slugReservations.release({ slug: held, assetUid: opts.assetUid() });
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
      if (currentSlug === opts.originalSlug()) return { ok: true, state: 'available' };
      const state = await acquire(currentSlug, token);
      if (state == null) return null;
      return { ok: state === 'available' && reserved === currentSlug, state };
    } catch {
      return token === generation ? { ok: false, state: 'check-failed' } : null;
    }
  }

  return { onAvailable, releaseIfHeld, confirmForSave, invalidate };
}
