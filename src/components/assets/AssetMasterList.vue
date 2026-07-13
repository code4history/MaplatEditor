<template>
  <section class="asset-master-list d-flex flex-column h-100 bg-white" @click="hideContextMenu">
    <div class="p-3 border-bottom">
      <button type="button" class="btn btn-primary btn-sm w-100 mb-2" @click="emit('create')">
        <i class="bi bi-plus-lg me-1" aria-hidden="true"></i>{{ t("assetlist.add_image") }}
        <span v-if="newDrafts.length" class="badge bg-warning text-dark ms-1">{{ t("editor_ui.draft_badge") }}</span>
      </button>
      <input
        :value="query"
        type="search"
        class="form-control form-control-sm"
        :placeholder="t('assetlist.search_placeholder')"
        @input="emit('update:query', ($event.target as HTMLInputElement).value)"
      >
      <small class="text-muted d-block mt-1">{{ t("assetlist.count_label", { num: items.length }) }}</small>
    </div>

    <div ref="scrollElement" class="flex-grow-1 overflow-auto" @scroll.passive="emit('scroll', scrollElement)">
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

        <div
          v-for="asset in items"
          :key="asset.uid"
          role="button"
          tabindex="0"
          class="asset-row list-group-item list-group-item-action border-0 border-bottom rounded-0 px-3 py-2"
          :class="{ active: selectedUid === asset.uid }"
          :aria-current="selectedUid === asset.uid ? 'true' : undefined"
          @click.stop="selectRow(asset.uid)"
          @keydown.enter.prevent="emit('select', asset.uid)"
          @keydown.space.prevent="emit('select', asset.uid)"
          @contextmenu.prevent.stop="openContextMenu($event, asset)"
        >
          <div class="asset-row__thumb">
            <img
              :src="thumbUrls[asset.uid] || noImage"
              loading="lazy"
              :alt="titleOf(asset)"
              @error="onThumbError(asset.uid)"
            >
          </div>
          <div class="min-w-0 flex-grow-1">
            <span class="d-block text-truncate fw-semibold">{{ titleOf(asset) }}</span>
            <small class="d-block text-truncate" :class="selectedUid === asset.uid ? 'text-white-50' : 'text-muted'">{{ asset.slug }}</small>
            <small class="d-block text-truncate" :class="selectedUid === asset.uid ? 'text-white-50' : 'text-muted'">{{ formatMeta(asset) }}</small>
          </div>
          <span v-if="draftUids.has(asset.uid)" class="badge bg-warning text-dark">{{ t("editor_ui.draft_badge") }}</span>
        </div>
      </template>
    </div>

    <ul
      v-if="contextRow"
      class="dropdown-menu show asset-context-menu"
      :style="{ top: contextPosition.y + 'px', left: contextPosition.x + 'px' }"
      @click.stop
    >
      <li class="dropdown-header">{{ titleOf(contextRow) }}</li>
      <li><button type="button" class="dropdown-item text-danger" @click="emitDelete">{{ t("assetlist.delete_item") }}</button></li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useTranslation } from "i18next-vue";
import noImage from "../../assets/img/no_image.png";
import { useAssetThumbnails } from "../../composables/useAssetThumbnails";
import type { AssetDraftSummary } from "../../types/assetDraft";
import type { ImageAssetRow } from "../../electron";
import { localizeTitle } from "../../utils/langResource";

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
  "scroll": [element: HTMLElement | null];
}>();

const { t } = useTranslation();
const { items, loading, error, searchQuery, thumbUrls, loadAssets, onThumbError } = useAssetThumbnails();
const scrollElement = ref<HTMLElement | null>(null);
const contextRow = ref<ImageAssetRow | null>(null);
const contextPosition = ref({ x: 0, y: 0 });
const newDrafts = computed(() => props.draftSummaries.filter((draft) => draft.baseRevision === null));

const titleOf = (row: ImageAssetRow) => localizeTitle(row.title, props.activeLang) || row.slug;
const formatMeta = (row: ImageAssetRow) => `${row.width !== null && row.height !== null ? `${row.width}×${row.height} · ` : ""}${row.mime}`;

function openContextMenu(event: MouseEvent, row: ImageAssetRow): void {
  contextRow.value = row;
  contextPosition.value = { x: event.clientX, y: event.clientY };
}
function hideContextMenu(): void { contextRow.value = null; }
function selectRow(uid: string): void { hideContextMenu(); emit("select", uid); }
function emitDelete(): void {
  if (contextRow.value) emit("delete", contextRow.value);
  hideContextMenu();
}

async function reload(): Promise<void> {
  await loadAssets();
  emit("loaded", items.value);
}

watch(() => props.query, (value) => {
  searchQuery.value = value;
  void reload();
});
function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") hideContextMenu();
}
onMounted(() => window.addEventListener("keydown", onKeydown));
onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));
defineExpose({ reload, scrollElement });
</script>

<style scoped>
.asset-master-list { min-width: 18rem; }
.asset-row { display: flex; align-items: center; gap: .65rem; }
.asset-row__thumb { width: 56px; height: 56px; flex: 0 0 56px; display: grid; place-items: center; overflow: hidden; background: #f8f9fa; border: 1px solid var(--bs-border-color); }
.asset-row__thumb img { max-width: 100%; max-height: 100%; object-fit: contain; }
.asset-context-menu { position: fixed; z-index: 1060; min-width: 10rem; }
.min-w-0 { min-width: 0; }
</style>
