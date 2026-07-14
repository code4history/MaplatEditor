// SlugField 内部で使う予約 lifecycle composable (M11-T7/D6改)。
// window.slugReservations を叩き、available 確定時に reserve/move、originalSlug 復帰や
// draft 破棄で release、保存直前に confirmForSave で予約成立を再確認する。
import { toRegistryKind, type SlugFieldKind } from '../utils/slugReservationKind';

export function useSlugReservation(opts: {
  assetKind: () => string;
  assetUid: () => string;
  draftUid: () => string | undefined;
  originalSlug: () => string | undefined;
}) {
  let reserved: string | null = null;

  // debounce 確認成功(available)時に呼ぶ。既に別 slug を予約中なら move、なければ reserve。
  async function onAvailable(slug: string): Promise<void> {
    const kind = toRegistryKind(opts.assetKind() as SlugFieldKind);
    const draftUid = opts.draftUid() ?? opts.assetUid();
    if (reserved && reserved !== slug) {
      await window.slugReservations.move({
        fromSlug: reserved, toSlug: slug, assetUid: opts.assetUid(), assetKind: kind, draftUid,
      });
    } else {
      await window.slugReservations.reserve({
        slug, assetUid: opts.assetUid(), assetKind: kind, draftUid,
      });
    }
    reserved = slug;
  }

  // originalSlug 復帰・draft 破棄で予約を解放する。
  async function releaseIfHeld(): Promise<void> {
    if (reserved) {
      await window.slugReservations.release({ slug: reserved, assetUid: opts.assetUid() });
      reserved = null;
    }
  }

  // 保存直前の再確認(§7.1 confirmForSave)。未変更は予約不要(AC15)。
  // 他者予約(reserved-by-other)なら false で保存を中断させる。
  async function confirmForSave(currentSlug: string): Promise<boolean> {
    if (currentSlug === opts.originalSlug()) return true;
    const state = await window.slugReservations.check({ slug: currentSlug, excludeUid: opts.assetUid() });
    return state !== 'reserved-by-other';
  }

  return { onAvailable, releaseIfHeld, confirmForSave };
}
