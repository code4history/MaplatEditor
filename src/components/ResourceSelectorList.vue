<template>
  <div class="resource-selector-list d-flex flex-column h-100 min-h-0">
    <div class="source-pane-toolbar pb-2">
      <input :value="query" type="search" class="form-control form-control-sm" :placeholder="placeholder" :data-testid="inputTestid" @input="emit('update:query', ($event.target as HTMLInputElement).value)">
      <button v-if="spatialContext" type="button" class="btn btn-outline-secondary btn-sm mt-2 w-100" data-testid="selector-spatial-toggle" @click="emit('toggle-spatial-context')">
        {{ spatialContext.enabled
          ? t('resource_selector.range_auto', { context: t(spatialContext.labelKey) })
          : t('resource_selector.range_none') }}
      </button>
    </div>
    <div class="source-list flex-grow-1 overflow-auto" @scroll.passive="onScroll">
      <slot v-for="item in items" :key="item.uid" name="item" :item="item"></slot>
      <div v-if="state === 'loading' || state === 'appending'" class="text-muted text-center py-3">{{ t('resource_list.loading') }}</div>
      <div v-else-if="state === 'empty'" class="text-muted text-center py-3">{{ t('resource_list.empty') }}</div>
      <button v-else-if="state === 'error' || state === 'append-error'" type="button" class="btn btn-link w-100" @click="retry">{{ t('resource_list.retry') }}</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useTranslation } from "i18next-vue";
import type { ResourceDataAdapter, SelectorSpatialContextView } from "./resource-list/resourceListTypes";
import { useInfiniteResourceList } from "../composables/useInfiniteResourceList";

const props = withDefaults(defineProps<{
  adapter: ResourceDataAdapter<any, any>;
  query: string;
  placeholder: string;
  inputTestid?: string;
  spatialContext?: SelectorSpatialContextView;
  limit?: number;
}>(), { limit: 30, spatialContext: undefined, inputTestid: undefined });
const emit = defineEmits<{ "update:query": [value: string]; "toggle-spatial-context": [] }>();
const { t } = useTranslation();
const effectiveQuery = ref(props.query);
const list = useInfiniteResourceList<any, any>(props.adapter, {
  filter: () => ({ q: effectiveQuery.value, bbox: props.spatialContext?.bbox ?? null }),
  activeLang: () => "",
}, { limit: props.limit });
const { items, state, loadFirst, loadMore, retry, dispose } = list;
let queryTimer: ReturnType<typeof setTimeout> | null = null;

watch(() => props.query, (value) => {
  if (queryTimer) clearTimeout(queryTimer);
  queryTimer = setTimeout(() => { effectiveQuery.value = value; void loadFirst(); }, 250);
});
watch(
  () => props.spatialContext?.bbox?.join(",") ?? "",
  (value, previous) => { if (value !== previous) void loadFirst(); },
);
function onScroll(event: Event): void {
  const el = event.currentTarget as HTMLElement;
  if (el.scrollHeight - el.scrollTop - el.clientHeight < 200) void loadMore();
}
onMounted(() => { void loadFirst(); });
onBeforeUnmount(() => {
  if (queryTimer) clearTimeout(queryTimer);
  dispose();
});
</script>

<style scoped>
.min-h-0 { min-height: 0; }
.source-list { display: flex; flex-direction: column; gap: 4px; }
/* #item slot の行基底スタイル。行 DOM は host 所有だが、見た目の基底は selector 側で統一する
   (host は disabled 等の差分クラスだけ足す)。slot 内容は親 scope のため :slotted で当てる */
:slotted(.source-row) {
  display: grid;
  grid-template-columns: 48px 1fr;
  align-items: center;
  gap: 8px;
  width: 100%;
  border: 1px solid var(--bs-border-color);
  background: #fff;
  border-radius: 4px;
  padding: 6px;
  text-align: left;
  cursor: pointer;
}
:slotted(.source-row:hover) { border-color: var(--bs-primary-border-subtle); }
:slotted(.source-row:disabled) { opacity: 0.58; cursor: not-allowed; }
:slotted(.source-row img) {
  width: 48px;
  height: 48px;
  object-fit: contain;
  background: #f8f9fa;
  border: 1px solid var(--bs-border-color);
}
</style>
