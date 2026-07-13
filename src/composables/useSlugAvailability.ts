import { computed, ref, watch, type Ref } from 'vue';
import { validateSlugSyntax } from '../utils/slug';

export { validateSlugSyntax } from '../utils/slug';

export type SlugAvailabilityState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'taken'
  | 'unavailable';

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
    validationError,
    refresh: run,
    cancel,
  };
}
