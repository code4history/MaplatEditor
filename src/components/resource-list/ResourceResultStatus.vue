<template>
  <div class="resource-list__status" data-resource-status :data-state="state" role="status" aria-live="polite">
    <template v-if="state === 'loading'">{{ t("resource_list.loading") }}</template>
    <template v-else-if="state === 'empty'">{{ t("resource_list.empty") }}</template>
    <template v-else-if="state === 'error'">
      {{ t("resource_list.load_error") }}
      <button type="button" class="btn btn-sm btn-link p-0 ms-1" data-resource-retry @click="emit('retry')">{{ t("resource_list.retry") }}</button>
    </template>
    <template v-else>
      <span data-resource-count>{{ countLabel }}</span>
      <span v-if="state === 'appending'" class="ms-2">{{ t("resource_list.loading") }}</span>
      <span v-else-if="state === 'append-error'" class="ms-2 text-danger">
        {{ t("resource_list.append_error") }}
        <button type="button" class="btn btn-sm btn-link p-0 ms-1" data-resource-retry @click="emit('retry')">{{ t("resource_list.retry") }}</button>
      </span>
    </template>
    <div v-if="failureTexts" class="mt-1">
      <div data-load-failure-reason>{{ failureTexts.reason }}</div>
      <div class="text-muted" data-load-failure-fix>{{ failureTexts.fix }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useTranslation } from "i18next-vue";
import type { ResourceListState } from "./resourceListTypes";
import type { ResourceLoadFailure } from "./loadFailure";

const props = defineProps<{ state: ResourceListState; total: number | null; loaded: number; failure?: ResourceLoadFailure | null }>();
const emit = defineEmits<{ retry: [] }>();

const { t } = useTranslation();
// 件数表示の統一ルール(2026-07-20 人間指示 M12-T7/F6):
//   total 判明 → 常に「全N件」（無限scroll のため部分表示の M件は出さない） / total 不明 → 「M件表示中」
const countLabel = computed(() => {
  if (props.total != null) {
    return t("resource_list.total_only", { total: props.total });
  }
  return t("resource_list.loaded_only", { loaded: props.loaded });
});
// 保存先フォルダの DB を開けない失敗: 理由（権限が無い／場所が無い／その他）と直し方を出す。
// code は表示しない（理由で文言を選び、code は main 側のログと試験が使う）
const REASON_KEYS: Record<ResourceLoadFailure["reason"], string> = {
  permission: "resource_list.load_error_reason_permission",
  "not-found": "resource_list.load_error_reason_not_found",
  other: "resource_list.load_error_reason_other",
};
const FIX_KEYS: Record<ResourceLoadFailure["reason"], string> = {
  permission: "resource_list.load_error_fix_permission",
  "not-found": "resource_list.load_error_fix_not_found",
  other: "resource_list.load_error_fix_other",
};
const failureTexts = computed(() => {
  const failure = props.failure;
  if (!failure) return null;
  return {
    reason: t(REASON_KEYS[failure.reason]),
    fix: t(FIX_KEYS[failure.reason]),
  };
});
</script>
