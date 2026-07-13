import { ref } from 'vue';
import {
  useSlugAvailability,
  validateSlugSyntax,
} from '../../src/composables/useSlugAvailability';

export { validateSlugSyntax };

export function createSlugAvailabilityHarness(options: {
  initialSlug: string;
  delayMs: number;
  check: (input: { slug: string; excludeUid?: string }) => Promise<boolean>;
}) {
  const slug = ref(options.initialSlug);
  const excludeUid = ref<string>();
  return {
    slug,
    excludeUid,
    availability: useSlugAvailability({
      slug,
      excludeUid,
      delayMs: options.delayMs,
      check: options.check,
    }),
  };
}
