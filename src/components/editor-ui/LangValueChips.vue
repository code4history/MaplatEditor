<template>
  <span v-if="entries.length" class="lang-value-chips" :aria-label="t('editor_ui.translations')">
    <button
      v-for="entry in entries"
      :key="entry.code"
      type="button"
      class="badge rounded-pill text-bg-light border text-uppercase lang-value-chip"
      :title="previewText(entry)"
      :aria-label="previewText(entry)"
      @click="emit('selectLanguage', entry.code)"
    >
      {{ entry.label }}
    </button>
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useTranslation } from 'i18next-vue';
import type { LangCode } from '../../utils/editorLanguages';
import {
  collectLangValueChips,
  type LangValueChip,
  type LanguageValueOption,
} from '../../utils/langValueChips';

const props = defineProps<{
  modelValue?: string | Record<string, string>;
  activeLang: LangCode;
  defaultLang: LangCode;
  languageOptions: readonly LanguageValueOption[];
}>();

const emit = defineEmits<{
  selectLanguage: [code: LangCode];
}>();

const { t } = useTranslation();

const entries = computed(() =>
  collectLangValueChips(
    props.modelValue,
    props.activeLang,
    props.languageOptions,
    props.defaultLang,
  ) as Array<LangValueChip & { code: LangCode }>,
);

function previewText(entry: LangValueChip): string {
  return `${entry.nativeName}: ${entry.value}`;
}
</script>

<style scoped>
.lang-value-chips {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 0.2rem;
}

.lang-value-chip {
  max-width: 5rem;
  overflow: hidden;
  padding: 0.2rem 0.35rem;
  color: var(--bs-secondary-color);
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}
</style>
