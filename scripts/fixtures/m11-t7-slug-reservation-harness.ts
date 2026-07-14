import { useSlugReservation } from '../../src/composables/useSlugReservation';

export function createSlugReservationHarness(options?: {
  originalSlug?: string;
  currentSlug?: string;
  assetUid?: string;
  assetKind?: 'map' | 'app';
  draftUid?: string;
}) {
  let originalSlug = options?.originalSlug;
  let currentSlug = options?.currentSlug ?? '';
  let assetUid = options?.assetUid ?? '11111111-1111-4111-8111-111111111111';
  let assetKind = options?.assetKind ?? 'map';
  let draftUid = options?.draftUid ?? 'draft-1';
  const reservation = useSlugReservation({
    assetKind: () => assetKind,
    assetUid: () => assetUid,
    draftUid: () => draftUid,
    originalSlug: () => originalSlug,
  });
  return {
    reservation,
    setIdentity(value: { assetUid: string; assetKind?: 'map' | 'app'; draftUid?: string }) {
      assetUid = value.assetUid;
      assetKind = value.assetKind ?? assetKind;
      draftUid = value.draftUid ?? draftUid;
    },
    setOriginalSlug(value: string | undefined) { originalSlug = value; },
    setCurrentSlug(value: string) {
      currentSlug = value;
      reservation.invalidate(value);
    },
    confirmForSave() { return reservation.confirmForSave(currentSlug); },
  };
}
