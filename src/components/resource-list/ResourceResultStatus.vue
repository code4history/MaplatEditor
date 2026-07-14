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
      <span v-else-if="state === 'end'" class="ms-2">・{{ t("resource_list.end") }}</span>
      <span v-else-if="state === 'append-error'" class="ms-2 text-danger">
        {{ t("resource_list.append_error") }}
        <button type="button" class="btn btn-sm btn-link p-0 ms-1" data-resource-retry @click="emit('retry')">{{ t("resource_list.retry") }}</button>
      </span>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useTranslation } from "i18next-vue";
import type { ResourceListState } from "./resourceListTypes";

const props = defineProps<{ state: ResourceListState; total: number | null; loaded: number }>();
const emit = defineEmits<{ retry: [] }>();

const { t } = useTranslation();
const countLabel = computed(() =>
  props.total == null
    ? t("resource_list.loaded_only", { loaded: props.loaded })
    : t("resource_list.total_loaded", { total: props.total, loaded: props.loaded }),
);
</script>
