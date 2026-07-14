import { useSlugReservation } from '../../src/composables/useSlugReservation';

export function createSlugReservationHarness(options?: {
  originalSlug?: string;
  currentSlug?: string;
}) {
  let originalSlug = options?.originalSlug;
  let currentSlug = options?.currentSlug ?? '';
  const reservation = useSlugReservation({
    assetKind: () => 'map',
    assetUid: () => '11111111-1111-4111-8111-111111111111',
    draftUid: () => 'draft-1',
    originalSlug: () => originalSlug,
  });
  return {
    reservation,
    setOriginalSlug(value: string | undefined) { originalSlug = value; },
    setCurrentSlug(value: string) {
      currentSlug = value;
      reservation.invalidate(value);
    },
    confirmForSave() { return reservation.confirmForSave(currentSlug); },
  };
}
