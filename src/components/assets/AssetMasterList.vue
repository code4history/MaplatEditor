<template>
  <section class="asset-master-list d-flex flex-column h-100 bg-white">
    <div class="p-3 border-bottom">
      <button type="button" class="btn btn-outline-primary btn-sm w-100 mb-2" data-testid="asset-new" @click="emit('create')">
        <i class="bi bi-plus-lg me-1" aria-hidden="true"></i>{{ t("resource_list.new_item") }}
        <span v-if="newDrafts.length" class="badge bg-warning text-dark ms-1">{{ t("editor_ui.draft_badge") }}</span>
      </button>
      <input
        :value="query"
        type="search"
        class="form-control form-control-sm"
        :placeholder="t('resource_list.search_placeholder', { name: t('resource_list.kind_asset') })"
        @input="emit('update:query', ($event.target as HTMLInputElement).value)"
      >
      <small class="text-muted d-block mt-1">{{ t("assetlist.count_label", { num: items.length }) }}</small>
    </div>

    <div ref="scrollElement" class="flex-grow-1 overflow-auto" data-testid="asset-list-scroll" @scroll.passive="emit('scroll', scrollElement)">
      <div v-if="loading" class="text-muted text-center py-4">{{ t("assetlist.loading") }}</div>
      <div v-else-if="error" class="alert alert-danger m-3">{{ error }}</div>
      <div v-else-if="items.length === 0 && newDrafts.length === 0" class="text-muted small text-center p-3">{{ t("assetlist.no_assets_found") }}</div>
      <template v-else>
        <button
          v-for="draft in newDrafts"
          :key="draft.assetUid"
          type="button"
          class="list-group-item list-group-item-action border-0 border-bottom rounded-0 px-3 py-2 w-100 text-start"
          :class="{ active: selectedUid === draft.assetUid }"
          :aria-current="selectedUid === draft.assetUid ? 'true' : undefined"
          @click="emit('select-draft', draft.assetUid)"
        >
          <span class="fw-semibold">{{ t("assetlist.master_detail.new_draft") }}</span>
          <span class="badge bg-warning text-dark ms-1">{{ t("editor_ui.draft_badge") }}</span>
        </button>

        <ResourceMasterRow
          v-for="asset in items"
          :key="asset.uid"
          :item="vmOf(asset)"
          kind="image-asset"
          :draft-label="t('editor_ui.draft_badge')"
          draft-badge-test-id="asset-draft-badge"
          :data-testid="`asset-row-${asset.slug}`"
          @select="(uid) => emit('select', uid)"
          @action="(key) => onRowAction(key, asset)"
        />
      </template>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useTranslation } from "i18next-vue";
import { useAssetThumbnails } from "../../composables/useAssetThumbnails";
import type { AssetDraftSummary } from "../../types/assetDraft";
import type { ImageAssetRow } from "../../electron";
import ResourceMasterRow from "../resource-list/ResourceMasterRow.vue";
import { createAssetListAdapter } from "./assetListAdapter";

const props = defineProps<{
  selectedUid: string | null;
  query: string;
  activeLang: string;
  draftUids: Set<string>;
  draftSummaries: AssetDraftSummary[];
}>();
const emit = defineEmits<{
  "update:query": [value: string];
  "loaded": [items: ImageAssetRow[]];
  "select": [uid: string];
  "select-draft": [uid: string];
  "create": [];
  "delete": [row: ImageAssetRow];
  "duplicate": [row: ImageAssetRow];
  "scroll": [element: HTMLElement | null];
}>();

const { t } = useTranslation();
const { items, loading, error, searchQuery, thumbUrls, loadAssets } = useAssetThumbnails();
const scrollElement = ref<HTMLElement | null>(null);
const newDrafts = computed(() => props.draftSummaries.filter((draft) => draft.baseRevision === null));

// item→view model 写像は共通 adapter へ集約。thumbnail の file:// URL は useAssetThumbnails が解決し、
// deps.thumbUrl 経由で参照する。個別失敗の placeholder フォールバックは ResourceMasterRow の <img> が担う。
const adapter = createAssetListAdapter({
  hasDraft: (uid) => props.draftUids.has(uid),
  selectedUid: () => props.selectedUid,
  thumbUrl: (uid) => thumbUrls[uid] ?? null,
});
const vmOf = (asset: ImageAssetRow) => adapter.toViewModel(asset, props.activeLang);

// 削除は ResourceActionMenu の `削除` から host へ委譲（参照チェック・draft 削除は host が担う）
function onRowAction(key: string, asset: ImageAssetRow): void {
  if (key === "delete") emit("delete", asset);
  if (key === "duplicate") emit("duplicate", asset);
}

async function reload(): Promise<void> {
  await loadAssets();
  emit("loaded", items.value);
}

watch(() => props.query, (value) => {
  searchQuery.value = value;
  void reload();
});
defineExpose({ reload, scrollElement });
</script>

<style scoped>
.asset-master-list { min-width: 18rem; }
.min-w-0 { min-width: 0; }
</style>
