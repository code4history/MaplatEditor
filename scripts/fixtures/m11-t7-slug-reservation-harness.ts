import { computed, type Ref } from 'vue';
import { useSlugReservation } from '../../src/composables/useSlugReservation';
import { useSlugAvailability, type SlugFieldState } from '../../src/composables/useSlugAvailability';

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

  // SlugField.vue と同等の SlugFieldState computed を構築し、
  // release失敗時に state が 'check-failed' になることを behavioral に検証できるようにする。
  const slugRef = { value: currentSlug } as Ref<string>;
  const excludeUidRef = { value: assetUid } as Ref<string | undefined>;
  const availability = useSlugAvailability({ slug: slugRef, excludeUid: excludeUidRef });
  const reservation = useSlugReservation({
    assetKind: () => assetKind,
    assetUid: () => assetUid,
    draftUid: () => draftUid,
    originalSlug: () => originalSlug,
  });
  const reservationState: Ref<SlugFieldState | null> = { value: null };
  // SlugField.vue の state computed と同等のロジック(Major-D behavioral test 用)
  const state = computed<SlugFieldState>(() => {
    if (availability.fieldState.value === 'checking') return 'checking';
    if (reservationState.value === null && availability.fieldState.value === 'available'
        && slugRef.value.trim() === originalSlug && reservation.hasFailedRelease()) {
      return 'check-failed';
    }
    return reservationState.value ?? availability.fieldState.value;
  });

  return {
    reservation,
    state,
    setIdentity(value: { assetUid: string; assetKind?: 'map' | 'app'; draftUid?: string }) {
      assetUid = value.assetUid;
      assetKind = value.assetKind ?? assetKind;
      draftUid = value.draftUid ?? draftUid;
      excludeUidRef.value = assetUid;
    },
    setOriginalSlug(value: string | undefined) { originalSlug = value; },
    setCurrentSlug(value: string) {
      currentSlug = value;
      slugRef.value = value;
      reservation.invalidate(value);
    },
    // useSlugAvailability の内部 state ref を直接操作し、fieldState computed を制御する。
    // fieldState は computed なので代入は無効。内部 state を 'available' にすることで
    // fieldState も 'available' になる。
    setAvailabilityInternal(s: 'idle' | 'checking' | 'available' | 'taken' | 'unavailable') {
      availability.state.value = s;
    },
    setReservationState(s: SlugFieldState | null) { reservationState.value = s; },
    confirmForSave() { return reservation.confirmForSave(currentSlug); },
  };
}
