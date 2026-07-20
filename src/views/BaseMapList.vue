<template>
  <main class="base-map-master-detail d-flex h-100 overflow-hidden" data-master-detail="base-map">
    <div class="base-map-master-detail__master border-end">
      <BaseMapMasterList
        ref="masterList"
        :items="filteredItems"
        :selected-uid="selectedUid"
        :active-lang="activeLang"
        :query="searchQuery"
        :range-filter-active="!!filterBbox"
        :draft-uids="effectiveDraftUids"
        :draft-summaries="draftSummaries"
        :loading="loading"
        :error="error"
        @select="selectExisting"
        @select-draft="selectDraft"
        @update:query="updateSearchQuery"
        @open-range-filter="rangeFilterOpen = true"
        @clear-range-filter="clearRangeFilter"
        @create="createBaseMap"
        @delete="requestDeleteBaseMap"
        @duplicate="duplicateBaseMap"
        @toggle-always="toggleAlways"
        @scroll="saveScroll"
      />
    </div>
    <div class="base-map-master-detail__detail flex-grow-1 min-w-0">
      <BaseMapEdit
        ref="editor"
        v-if="selectedUid && (selectedItem || isNew)"
        :uid="selectedUid"
        :is-new="isNew"
        :item="selectedItem"
        :duplicate-source-item="duplicateSourceItem"
        :preset-slug="presetSlug"
        :back-visible="false"
        @back="closeEditor"
        @saved="saved"
        @reload="reloadEditor"
        @changed="refreshDraftsSoon"
        @flushed="refreshDraftsNow"
        @draft-state="onDraftState"
      />
      <div v-else-if="notFound" class="h-100 d-grid place-items-center p-4 text-center">
        <div class="alert alert-warning mb-0">
          <p>{{ t("basemap.master_detail.not_found") }}</p>
          <button type="button" class="btn btn-sm btn-outline-secondary" @click="closeEditor">{{ t("editor_ui.back") }}</button>
        </div>
      </div>
      <div v-else class="h-100">
        <ResourceEmptyState
          icon-class="bi bi-map"
          :message="t('basemap.master_detail.select_prompt')"
        />
      </div>
    </div>
    <EnvelopeEditorModal
      v-if="rangeFilterOpen"
      :model-value="filterEnvelope"
      title-key="basemap.coverage_modal_title"
      help-key="appedit.envelope_modal_help"
      @update:model-value="applyRangeFilter"
      @close="rangeFilterOpen = false"
    />

    <!-- M11-T10: 共通削除確認 dialog -->
    <DeleteConfirmDialog
      :visible="deletion.dialog.visible" :title="deletion.dialog.title"
      :deleting="deletion.deleting.value" @confirm="deletion.confirm" @cancel="deletion.cancel"
    />
  </main>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useTranslation } from "i18next-vue";
import i18next from "i18next";
import DeleteConfirmDialog from "../components/resource-list/DeleteConfirmDialog.vue";
import ResourceEmptyState from "../components/resource-list/ResourceEmptyState.vue";
import BaseMapEdit from "../components/basemap/BaseMapEdit.vue";
import BaseMapMasterList from "../components/basemap/BaseMapMasterList.vue";
import EnvelopeEditorModal from "../components/EnvelopeEditorModal.vue";
import { useAssetDraftBadges } from "../composables/useAssetDraftBadges";
import { useMasterDetailRouteState } from "../composables/useMasterDetailRouteState";
import { useResourceDelete } from "../composables/useResourceDelete";
import { reserveCopySlug } from "../composables/useResourceDuplicate";
import { resolveEditorLanguage } from "../utils/editorLanguages";
import type { BaseMapCatalogItem } from "../utils/baseMapEditorDocument";
import { useBboxRangeFilter } from "../composables/useBboxRangeFilter";
import { baseMapSearchAdapter } from "./resource-adapters/baseMapSearchAdapter";
import { localizeTitle } from "../utils/langResource";
import { mergeMasterDetailFilters } from "../utils/masterDetailRouteState";

const { t } = useTranslation();
const route = useRoute();
const router = useRouter();
const {
  bbox: filterBbox,
  modalOpen: rangeFilterOpen,
  envelopeForModal: filterEnvelope,
  apply: applyRangeFilter,
  clear: clearRangeFilter,
} = useBboxRangeFilter({ route, router });
const { select, selectDuplicate, clearSelection, saveScroll, restoreScroll } = useMasterDetailRouteState();
const { draftUids, draftSummaries, latestNewDraft, refreshDrafts } = useAssetDraftBadges("base-map");

const items = ref<BaseMapCatalogItem[]>([]);
const loading = ref(true);
const error = ref("");
const masterList = ref<InstanceType<typeof BaseMapMasterList> | null>(null);
const editor = ref<InstanceType<typeof BaseMapEdit> | null>(null);
const activeLang = computed(() => resolveEditorLanguage(i18next.language));
const searchQuery = computed(() => typeof route.query.q === "string" ? route.query.q : "");
const filteredItems = computed(() => items.value);
const selectedUid = computed(() => typeof route.query.uid === "string" ? route.query.uid : null);
const isNew = computed(() => route.query.new === "1");
const selectedItem = computed(() => items.value.find((item) => item.uid === selectedUid.value) ?? null);
const notFound = computed(() => !!selectedUid.value && !isNew.value && !loading.value && !selectedItem.value);

// F8: Edit 側の live な下書き状態を List バッジへ即時反映する（store の永続化遅延を待たない）。
// 行切替を跨いでも uid ごとの override を保持し、store と一致した項目だけ回収する（Major-1対応）。
// store 未反映の live 状態（persist throttle 中の編集など）は回収せず優先し続ける。
const liveDraftOverrides = ref<Map<string, boolean>>(new Map());
const effectiveDraftUids = computed(() => {
  const set = new Set(draftUids.value);
  for (const [uid, hasDraft] of liveDraftOverrides.value) {
    if (hasDraft) set.add(uid);
    else set.delete(uid);
  }
  return set;
});
function onDraftState(uid: string, hasDraft: boolean): void {
  const next = new Map(liveDraftOverrides.value);
  next.set(uid, hasDraft);
  liveDraftOverrides.value = next;
}
function reconcileDraftOverrides(): void {
  const store = new Set(draftUids.value);
  const next = new Map(liveDraftOverrides.value);
  for (const [uid, hasDraft] of next) {
    if (store.has(uid) === hasDraft) next.delete(uid);
  }
  liveDraftOverrides.value = next;
}
async function refreshDraftsNow(): Promise<void> {
  await refreshDrafts();
  reconcileDraftOverrides();
}

async function updateFilters(filters: { q?: string | null; bbox?: string | null }): Promise<void> {
  await router.replace({ query: mergeMasterDetailFilters(route.query, filters) });
}

function updateSearchQuery(value: string): void {
  void updateFilters({ q: value.trim() ? value : null });
}

async function loadBaseMaps(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    const batch = await baseMapSearchAdapter.load({
      filter: { q: searchQuery.value, bbox: filterBbox.value },
      cursor: null,
      limit: 0,
      signal: new AbortController().signal,
    });
    items.value = batch.items;
    await refreshDraftsNow();
  } catch (cause) {
    console.error("Failed to load base maps", cause);
    error.value = t("basemap.errors.load_failed");
  } finally {
    loading.value = false;
  }
}

async function selectExisting(uid: string): Promise<void> { await select(uid, false); }
async function selectDraft(uid: string): Promise<void> { await select(uid, true); }

async function createBaseMap(): Promise<void> {
  await select(latestNewDraft.value?.assetUid ?? crypto.randomUUID(), true);
}

async function closeEditor(): Promise<void> {
  await clearSelection();
  await refreshDraftsNow();
}

async function saved(uid: string): Promise<void> {
  await loadBaseMaps();
  await select(uid, false);
}

async function reloadEditor(): Promise<void> {
  await loadBaseMaps();
}

let draftRefreshTimer: ReturnType<typeof setTimeout> | null = null;
function refreshDraftsSoon(): void {
  if (draftRefreshTimer) clearTimeout(draftRefreshTimer);
  // persist 遅延(2000ms)より後に読む。900ms では store 反映前に空振りする（Major-1対応）。
  draftRefreshTimer = setTimeout(() => { void refreshDraftsNow(); }, 2300);
}

// M11-T10: 共通確認 dialog（native confirm 全廃、useResourceDelete へ委譲）
const deletion = useResourceDelete({
  confirmTitle: (title) => t("resource_list.delete_confirm_title", { title }),
  onDelete: async (uid) => {
    if (selectedUid.value === uid) await editor.value?.prepareForDelete();
    await window.baseMaps.deleteUser(uid);
    await window.assetDrafts.remove("base-map", uid);
  },
  onDeleted: async (uid) => {
    if (selectedUid.value === uid) await clearSelection();
    await loadBaseMaps();
  },
  onError: () => { error.value = t("basemap.errors.delete_failed"); },
});
async function requestDeleteBaseMap(item: BaseMapCatalogItem): Promise<void> {
  await deletion.request({ uid: item.uid, title: localizeTitle(item.data.title as any, activeLang.value) || item.mapID });
}

// M11-T10 複製（案A）: reserveCopySlug（check前置+新規UID採番）→ duplicateFrom/slug クエリ付きで new モードを開く
const duplicateFrom = computed(() => (typeof route.query.duplicateFrom === "string" ? route.query.duplicateFrom : ""));
const presetSlug = computed(() => (typeof route.query.slug === "string" ? route.query.slug : ""));
const duplicateSourceItem = computed(() =>
  duplicateFrom.value ? items.value.find((item) => item.uid === duplicateFrom.value) ?? null : null,
);
async function duplicateBaseMap(item: BaseMapCatalogItem): Promise<void> {
  const reserved = await reserveCopySlug(item.mapID, "base-map", "base-map");
  if (!reserved) { error.value = t("resource_list.duplicate_failed"); return; }
  await selectDuplicate(item.uid, reserved);
}

async function toggleAlways(item: BaseMapCatalogItem, always: boolean): Promise<void> {
  try {
    await window.baseMaps.setAlways(item.uid, always);
    item.alwaysVisible = always;
  } catch (cause) {
    console.error("Failed to update always-visible setting", cause);
    error.value = t("basemap.errors.always_failed");
    await loadBaseMaps();
  }
}

onMounted(async () => {
  await loadBaseMaps();
  await nextTick();
  await restoreScroll(masterList.value?.scrollElement ?? null);
});

watch([searchQuery, filterBbox], () => { void loadBaseMaps(); });
onBeforeUnmount(() => {
  if (draftRefreshTimer) clearTimeout(draftRefreshTimer);
});

</script>

<style scoped>
.base-map-master-detail { min-height: 0; }
.base-map-master-detail__master { width: clamp(18rem, 34vw, 30rem); flex: 0 0 clamp(18rem, 34vw, 30rem); min-height: 0; }
.base-map-master-detail__detail { min-height: 0; }
.min-w-0 { min-width: 0; }
.d-grid.place-items-center { place-items: center; }
@media (max-width: 800px) {
  .base-map-master-detail { flex-direction: column; overflow: auto !important; }
  .base-map-master-detail__master { width: 100%; flex: 0 0 42vh; min-height: 18rem; }
  .base-map-master-detail__detail { flex: 0 0 auto; min-height: 32rem; }
}
</style>
