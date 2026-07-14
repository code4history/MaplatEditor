<template>
  <section class="base-map-master-list d-flex flex-column h-100 bg-white">
    <div class="p-3 border-bottom">
      <button type="button" class="btn btn-outline-primary btn-sm w-100 mb-2" data-testid="basemap-new" @click="emit('create')">
        <i class="bi bi-plus-lg me-1" aria-hidden="true"></i>{{ t("resource_list.new_item") }}
        <span v-if="newDrafts.length" class="badge bg-warning text-dark ms-1">{{ t("editor_ui.draft_badge") }}</span>
      </button>
      <input
        :value="query"
        type="search"
        class="form-control form-control-sm mb-2"
        data-testid="basemap-search"
        :placeholder="t('resource_list.search_placeholder', { name: t('resource_list.kind_base_map') })"
        @input="emit('update:query', ($event.target as HTMLInputElement).value)"
      >
      <div class="d-flex gap-2">
        <button type="button" class="btn btn-outline-secondary btn-sm flex-grow-1" data-testid="basemap-range-filter" @click="emit('open-range-filter')">
          <i class="bi bi-bounding-box me-1" aria-hidden="true"></i>{{ t("basemap.master_detail.range_filter") }}
        </button>
        <button
          v-if="rangeFilterActive"
          type="button"
          class="btn btn-outline-secondary btn-sm"
          data-testid="basemap-range-clear"
          :title="t('basemap.master_detail.clear_range_filter')"
          @click="emit('clear-range-filter')"
        >
          <i class="bi bi-x-lg" aria-hidden="true"></i>
        </button>
      </div>
      <small class="text-muted d-block mt-1">{{ t("basemap.master_detail.count_label", { num: items.length }) }}</small>
    </div>

    <div ref="scrollElement" class="flex-grow-1 overflow-auto" data-testid="basemap-list-scroll" @scroll.passive="emit('scroll', scrollElement)">
      <div v-if="loading" class="text-muted text-center py-4">{{ t("basemap.loading") }}</div>
      <div v-else-if="error" class="alert alert-danger m-3">{{ error }}</div>
      <template v-else>
        <div v-if="newDrafts.length" class="border-bottom">
          <h6 class="small text-uppercase text-muted px-3 pt-3 mb-1">{{ t("editor_ui.draft_badge") }}</h6>
          <button
            v-for="draft in newDrafts"
            :key="draft.assetUid"
            type="button"
            class="list-group-item list-group-item-action border-0 rounded-0 px-3 py-2 w-100 text-start"
            :class="{ active: selectedUid === draft.assetUid }"
            :aria-current="selectedUid === draft.assetUid ? 'true' : undefined"
            @click="emit('select-draft', draft.assetUid)"
          >
            <span class="fw-semibold">{{ t("basemap.master_detail.new_draft") }}</span>
            <span class="badge bg-warning text-dark ms-1">{{ t("editor_ui.draft_badge") }}</span>
          </button>
        </div>

        <h6 class="small text-uppercase text-muted px-3 pt-3 mb-1">{{ t("basemap.user_section") }}</h6>
        <div v-if="userItems.length === 0" class="text-muted small px-3 py-2">{{ t("basemap.no_user_basemaps") }}</div>
        <ResourceMasterRow
          v-for="item in userItems"
          :key="item.uid"
          :item="vmOf(item)"
          kind="base-map"
          :draft-label="t('editor_ui.draft_badge')"
          draft-badge-test-id="basemap-draft-badge"
          :data-testid="`basemap-row-${item.mapID}`"
          @select="(uid) => emit('select', uid)"
          @action="(key) => onRowAction(key, item)"
        >
          <template #extra>
            <span class="form-check ms-1" @click.stop>
              <input
                class="form-check-input"
                type="checkbox"
                :title="t('basemap.always_visible')"
                :checked="item.alwaysVisible"
                :disabled="item.alwaysLocked"
                @change="emit('toggle-always', item, ($event.target as HTMLInputElement).checked)"
              >
            </span>
          </template>
        </ResourceMasterRow>

        <details class="border-bottom" open>
          <summary class="small text-uppercase text-muted px-3 py-3">{{ t("basemap.builtin_section") }} ({{ builtinItems.length }})</summary>
          <ResourceMasterRow
            v-for="item in builtinItems"
            :key="item.uid"
            :item="vmOf(item)"
            kind="base-map"
            :draft-label="t('editor_ui.draft_badge')"
            :data-testid="`basemap-row-${item.mapID}`"
            @select="(uid) => emit('select', uid)"
          >
            <template #extra>
              <span class="form-check ms-1" @click.stop>
                <input
                  class="form-check-input"
                  type="checkbox"
                  :title="t('basemap.always_visible')"
                  :checked="item.alwaysVisible"
                  :disabled="item.alwaysLocked"
                  @change="emit('toggle-always', item, ($event.target as HTMLInputElement).checked)"
                >
              </span>
            </template>
          </ResourceMasterRow>
        </details>
      </template>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useTranslation } from "i18next-vue";
import type { AssetDraftSummary } from "../../types/assetDraft";
import type { BaseMapCatalogItem } from "../../utils/baseMapEditorDocument";
import ResourceMasterRow from "../resource-list/ResourceMasterRow.vue";
import { createBaseMapListAdapter } from "./baseMapListAdapter";

const props = defineProps<{
  items: BaseMapCatalogItem[];
  selectedUid: string | null;
  activeLang: string;
  query: string;
  rangeFilterActive: boolean;
  draftUids: Set<string>;
  draftSummaries: AssetDraftSummary[];
  loading: boolean;
  error: string;
}>();

const emit = defineEmits<{
  "update:query": [value: string];
  "open-range-filter": [];
  "clear-range-filter": [];
  "select": [uid: string];
  "select-draft": [uid: string];
  "create": [];
  "delete": [item: BaseMapCatalogItem];
  "toggle-always": [item: BaseMapCatalogItem, always: boolean];
  "scroll": [element: HTMLElement | null];
}>();

const { t } = useTranslation();
const scrollElement = ref<HTMLElement | null>(null);
const newDrafts = computed(() => props.draftSummaries.filter((draft) => draft.baseRevision === null));
const userItems = computed(() => props.items.filter((item) => item.scope === "user"));
const builtinItems = computed(() => props.items.filter((item) => item.scope === "builtin"));

// item→view model 写像は共通 adapter（D3改の filterBaseMapCatalog を内包）へ集約する。
// ここでは toViewModel のみを使い、host が渡す既に filter 済みの props.items を描画する。
const adapter = createBaseMapListAdapter({
  source: () => props.items,
  hasDraft: (uid) => props.draftUids.has(uid),
  selectedUid: () => props.selectedUid,
  activeLang: () => props.activeLang,
});
const vmOf = (item: BaseMapCatalogItem) => adapter.toViewModel(item, props.activeLang);

// 可視 trash を廃し、削除は ResourceActionMenu の `削除`（user のみ）から。builtin は actions 空で ⋮ 非表示（AC17）。
function onRowAction(key: string, item: BaseMapCatalogItem): void {
  if (key === "delete") emit("delete", item);
}

defineExpose({ scrollElement });
</script>

<style scoped>
.base-map-master-list { min-width: 18rem; }
.min-w-0 { min-width: 0; }
</style>
