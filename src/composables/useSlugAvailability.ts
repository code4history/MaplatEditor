import { computed, ref, watch, type Ref } from 'vue';
import { validateSlugSyntax } from '../utils/slug';

export { validateSlugSyntax } from '../utils/slug';

export type SlugAvailabilityState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'taken'
  | 'unavailable';

// §7.1 の 6 値状態語彙 (M11-T7/D1)。SlugField はこの語彙で状態を表示する。
// 内部の SlugAvailabilityState を写像する: taken→reserved-by-other(registry既存 or
// 他者予約の双方を包含)、unavailable→check-failed、format不正→invalid-format。
// 既存の 5 値 state は後方互換のため温存する(m11-t1 の state machine テスト等)。
export type SlugFieldState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'invalid-format'
  | 'reserved-by-other'
  | 'check-failed';

interface SlugCheckInput {
  slug: string;
  excludeUid?: string;
}

interface UseSlugAvailabilityOptions {
  slug: Readonly<Ref<string>>;
  excludeUid?: Readonly<Ref<string | undefined>>;
  delayMs?: number;
  check?: (input: SlugCheckInput) => Promise<boolean>;
}

const defaultCheck = (input: SlugCheckInput): Promise<boolean> =>
  window.assets.checkSlug(input);

export function useSlugAvailability(options: UseSlugAvailabilityOptions) {
  const state = ref<SlugAvailabilityState>('idle');
  const validationError = computed(() => validateSlugSyntax(options.slug.value));

  // 6 値語彙への写像 (D1)。SlugField が表示に使う。checking 中は format 判定より
  // 照会状態を優先する。'required'(空) は idle 扱いにしてエラー表示を出さない。
  const fieldState = computed<SlugFieldState>(() => {
    if (state.value === 'checking') return 'checking';
    if (validationError.value === 'invalid') return 'invalid-format';
    if (validationError.value === 'required') return 'idle';
    switch (state.value) {
      case 'available':
        return 'available';
      case 'taken':
        return 'reserved-by-other';
      case 'unavailable':
        return 'check-failed';
      default:
        return 'idle';
    }
  });
  const delayMs = options.delayMs ?? 400;
  const check = options.check ?? defaultCheck;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let requestToken = 0;
  let disposed = false;

  const clearTimer = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };

  const run = async (): Promise<void> => {
    clearTimer();
    const slug = options.slug.value.trim();
    if (disposed || validateSlugSyntax(slug)) {
      state.value = 'idle';
      return;
    }
    const token = ++requestToken;
    state.value = 'checking';
    try {
      const available = await check({
        slug,
        excludeUid: options.excludeUid?.value,
      });
      if (!disposed && token === requestToken) {
        state.value = available ? 'available' : 'taken';
      }
    } catch {
      if (!disposed && token === requestToken) state.value = 'unavailable';
    }
  };

  const schedule = (): void => {
    clearTimer();
    requestToken += 1;
    if (validationError.value) {
      state.value = 'idle';
      return;
    }
    state.value = 'idle';
    timer = setTimeout(() => void run(), delayMs);
  };

  const stopWatch = watch(
    [options.slug, options.excludeUid ?? ref<string | undefined>(undefined)],
    schedule,
    { immediate: true, flush: 'sync' },
  );

  const cancel = (): void => {
    disposed = true;
    clearTimer();
    requestToken += 1;
    stopWatch();
    state.value = 'idle';
  };

  return {
    state,
    fieldState,
    validationError,
    refresh: run,
    cancel,
  };
}
