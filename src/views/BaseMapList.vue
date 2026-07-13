<template>
  <main class="base-map-master-detail d-flex h-100 overflow-hidden" data-master-detail="base-map">
    <div class="base-map-master-detail__master border-end">
      <BaseMapMasterList
        ref="masterList"
        :items="items"
        :selected-uid="selectedUid"
        :active-lang="activeLang"
        :draft-uids="draftUids"
        :draft-summaries="draftSummaries"
        :loading="loading"
        :error="error"
        @select="selectExisting"
        @select-draft="selectDraft"
        @create="createBaseMap"
        @delete="deleteBaseMap"
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
        @back="closeEditor"
        @saved="saved"
        @reload="reloadEditor"
        @changed="refreshDraftsSoon"
      />
      <div v-else-if="notFound" class="h-100 d-grid place-items-center p-4 text-center">
        <div class="alert alert-warning mb-0">
          <p>{{ t("basemap.master_detail.not_found") }}</p>
          <button type="button" class="btn btn-sm btn-outline-secondary" @click="closeEditor">{{ t("editor_ui.back") }}</button>
        </div>
      </div>
      <div v-else class="h-100 d-grid place-items-center text-muted p-4 text-center">
        <div>
          <i class="bi bi-map fs-1 d-block mb-2" aria-hidden="true"></i>
          {{ t("basemap.master_detail.select_prompt") }}
        </div>
      </div>
    </div>
  </main>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { useTranslation } from "i18next-vue";
import i18next from "i18next";
import BaseMapEdit from "../components/basemap/BaseMapEdit.vue";
import BaseMapMasterList from "../components/basemap/BaseMapMasterList.vue";
import { useAssetDraftBadges } from "../composables/useAssetDraftBadges";
import { useMasterDetailRouteState } from "../composables/useMasterDetailRouteState";
import { resolveEditorLanguage } from "../utils/editorLanguages";
import type { BaseMapCatalogItem } from "../utils/baseMapEditorDocument";
import { localizeTitle } from "../utils/langResource";

const { t } = useTranslation();
const route = useRoute();
const { select, clearSelection, saveScroll, restoreScroll } = useMasterDetailRouteState();
const { draftUids, draftSummaries, refreshDrafts } = useAssetDraftBadges("base-map");

const items = ref<BaseMapCatalogItem[]>([]);
const loading = ref(true);
const error = ref("");
const masterList = ref<InstanceType<typeof BaseMapMasterList> | null>(null);
const editor = ref<InstanceType<typeof BaseMapEdit> | null>(null);
const activeLang = computed(() => resolveEditorLanguage(i18next.language));
const selectedUid = computed(() => typeof route.query.uid === "string" ? route.query.uid : null);
const isNew = computed(() => route.query.new === "1");
const selectedItem = computed(() => items.value.find((item) => item.uid === selectedUid.value) ?? null);
const notFound = computed(() => !!selectedUid.value && !isNew.value && !loading.value && !selectedItem.value);

async function loadBaseMaps(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    items.value = await window.baseMaps.list() as BaseMapCatalogItem[];
    await refreshDrafts();
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
  const pending = draftSummaries.value.filter((draft) => draft.baseRevision === null).at(-1);
  await select(pending?.assetUid ?? crypto.randomUUID(), true);
}

async function closeEditor(): Promise<void> {
  await clearSelection();
  await refreshDrafts();
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
  draftRefreshTimer = setTimeout(() => { void refreshDrafts(); }, 900);
}

async function deleteBaseMap(item: BaseMapCatalogItem): Promise<void> {
  const name = localizeTitle(item.data.title as any, activeLang.value) || item.mapID;
  if (!confirm(t("basemap.delete_confirm", { name }))) return;
  try {
    if (selectedUid.value === item.uid) await editor.value?.prepareForDelete();
    await window.baseMaps.deleteUser(item.uid);
    await window.assetDrafts.remove("base-map", item.uid);
    if (selectedUid.value === item.uid) await clearSelection();
    await loadBaseMaps();
  } catch (cause) {
    console.error("Failed to delete base map", cause);
    error.value = t("basemap.errors.delete_failed");
  }
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
