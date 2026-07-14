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
      :class="{ 'is-invalid': hasDangerDiagnostics }"
      :value="modelValue"
      :disabled="disabled"
      :data-testid="inputTestid"
      @input="onInput(($event.target as HTMLInputElement).value)"
      @change="emit('change', ($event.target as HTMLInputElement).value)"
    />
    <span class="visually-hidden" role="status">{{ statusText }}</span>
  </EditorField>
</template>

<script setup lang="ts">
import { computed, ref, toRef, watch } from 'vue';
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
  // 既存 E2E 互換の data-testid 透過(LangResourceInput の input-testid と同型)
  inputTestid?: string;
}>(), { disabled: false });

const emit = defineEmits<{
  'update:modelValue': [string];
  'state-change': [SlugFieldState];
  // blur 確定(native change)。Edit 側の commit 文法(@change=履歴push)を保つための確定合図
  'change': [string];
}>();

const { t } = useTranslation();
const fieldId = `slug-${Math.random().toString(36).slice(2, 8)}`;
const slugRef = toRef(props, 'modelValue');
// 自 asset_uid は常に excludeUid にする(D2改: 所有判定の正本は reservation.asset_uid)。
// 新規でも自分が張った予約(reserve/claim)を reserved-by-other 扱いにしないため、
// originalSlug の有無によらず自 uid を除外する(registry に自 uid 行が無い新規では無害)。
const excludeUid = computed(() => props.assetUid);
const availability = useSlugAvailability({ slug: slugRef, excludeUid });
const reservation = useSlugReservation({
  assetKind: () => props.assetKind,
  assetUid: () => props.assetUid,
  draftUid: () => props.draftUid,
  originalSlug: () => props.originalSlug,
});

const reservationState = ref<SlugFieldState | null>(null);
const state = computed<SlugFieldState>(() => reservationState.value ?? availability.fieldState.value);
// idle は無音(空文字)。それ以外は slug_state.<state> を読む(role=status のアクセシブル表示)
const statusText = computed(() => (state.value === 'idle' ? '' : t(`editor_ui.slug_state.${state.value}`)));

watch([slugRef, () => props.originalSlug], async ([slug]) => {
  reservation.invalidate(slug.trim());
  reservationState.value = null;
  if (slug.trim() === props.originalSlug) {
    try {
      await reservation.releaseIfHeld();
    } catch {
      if (slugRef.value.trim() === slug.trim() && slug.trim() === props.originalSlug) {
        reservationState.value = 'check-failed';
      }
    }
  }
}, { flush: 'sync' });

watch(availability.fieldState, async (s) => {
  const current = slugRef.value.trim();
  if (current === props.originalSlug) {
    reservationState.value = null;
  } else if (s === 'available') {
    const result = await reservation.onAvailable(current);
    if (result != null && slugRef.value.trim() === current) reservationState.value = result;
  } else {
    reservationState.value = null;
  }
});

watch(state, (s) => emit('state-change', s));

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

// is-invalid 赤枠は danger のみ(check-failed warning では出さない)
const hasDangerDiagnostics = computed(() => diagnostics.value.some((d) => d.severity === 'danger'));

function onInput(v: string): void {
  emit('update:modelValue', v);
}

async function confirmForSave(): Promise<boolean> {
  const current = slugRef.value.trim();
  const result = await reservation.confirmForSave(current);
  if (result != null && slugRef.value.trim() === current) reservationState.value = result.state;
  return result?.ok ?? false;
}

// 新規の放棄(モーダル閉じ・draft 破棄)で保持中の予約を明示解放する(D6改/AC15)。
// promote 消化済み・未予約時は no-op。
async function release(): Promise<void> {
  await reservation.releaseIfHeld();
}

defineExpose({ confirmForSave, release });
</script>
