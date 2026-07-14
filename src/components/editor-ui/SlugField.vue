<template>
  <EditorField :label="t('editor_ui.slug_label')" :label-for="fieldId" :diagnostics="diagnostics">
    <template #help>
      <ContextHelp
        :text="t('editor_ui.slug_format_help')"
        :ariaLabel="t('editor_ui.slug_format_help')"
      />
    </template>
    <input
      :id="fieldId"
      class="form-control editor-ui-mono"
      :value="modelValue"
      :disabled="disabled"
      @input="onInput(($event.target as HTMLInputElement).value)"
    />
    <span class="visually-hidden" role="status">{{ statusText }}</span>
  </EditorField>
</template>

<script setup lang="ts">
import { computed, toRef, watch } from 'vue';
import { useTranslation } from 'i18next-vue';
import EditorField from './EditorField.vue';
import ContextHelp from './ContextHelp.vue';
import { useSlugAvailability, type SlugFieldState } from '../../composables/useSlugAvailability';
import { useSlugReservation } from '../../composables/useSlugReservation';
import type { DiagnosticItem } from './editorUiTypes';

const props = withDefaults(defineProps<{
  modelValue: string;
  assetKind: string;
  assetUid: string;
  draftUid?: string;
  originalSlug?: string;
  disabled?: boolean;
}>(), { disabled: false });

const emit = defineEmits<{
  'update:modelValue': [string];
  'state-change': [SlugFieldState];
}>();

const { t } = useTranslation();
const fieldId = `slug-${Math.random().toString(36).slice(2, 8)}`;
const slugRef = toRef(props, 'modelValue');
// 既存資産(originalSlug あり)は自 uid を excludeUid にして自己 slug を空き扱いにする
const excludeUid = computed(() => (props.originalSlug ? props.assetUid : undefined));
const availability = useSlugAvailability({ slug: slugRef, excludeUid });
const reservation = useSlugReservation({
  assetKind: () => props.assetKind,
  assetUid: () => props.assetUid,
  draftUid: () => props.draftUid,
  originalSlug: () => props.originalSlug,
});

const state = availability.fieldState; // §7.1 の 6 値 (D1)
// idle は無音(空文字)。それ以外は slug_state.<state> を読む(role=status のアクセシブル表示)
const statusText = computed(() => (state.value === 'idle' ? '' : t(`editor_ui.slug_state.${state.value}`)));

watch(state, (s) => {
  emit('state-change', s);
  const current = slugRef.value.trim();
  if (current === props.originalSlug) {
    void reservation.releaseIfHeld();
  } else if (s === 'available') {
    void reservation.onAvailable(current);
  }
});

const diagnostics = computed<DiagnosticItem[]>(() => {
  if (state.value === 'invalid-format') {
    return [{ key: 'fmt', severity: 'danger', message: t('editor_ui.slug_state.invalid-format') }];
  }
  if (state.value === 'reserved-by-other') {
    return [{ key: 'res', severity: 'danger', message: t('editor_ui.slug_state.reserved-by-other') }];
  }
  if (state.value === 'check-failed') {
    return [{ key: 'chk', severity: 'warning', message: t('editor_ui.slug_state.check-failed') }];
  }
  return [];
});

function onInput(v: string): void {
  emit('update:modelValue', v);
}

async function confirmForSave(): Promise<boolean> {
  return reservation.confirmForSave(slugRef.value.trim());
}

defineExpose({ confirmForSave });
</script>
