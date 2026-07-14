<template>
  <main class="asset-master-detail d-flex h-100 overflow-hidden" data-master-detail="image-asset">
    <div class="asset-master-detail__master border-end">
      <AssetMasterList
        ref="masterList"
        :selected-uid="selectedUid"
        :query="query"
        :active-lang="activeLang"
        :draft-uids="effectiveDraftUids"
        :draft-summaries="draftSummaries"
        @update:query="updateQuery"
        @loaded="onLoaded"
        @select="selectExisting"
        @select-draft="selectDraft"
        @create="createAsset"
        @delete="deleteAsset"
        @scroll="saveScroll"
      />
    </div>
    <div class="asset-master-detail__detail flex-grow-1 min-w-0">
      <AssetEdit
        v-if="selectedUid && (selectedItem || isNew)"
        ref="editor"
        :uid="selectedUid"
        :is-new="isNew"
        :item="selectedItem"
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
          <p>{{ t("assetlist.master_detail.not_found") }}</p>
          <button type="button" class="btn btn-sm btn-outline-secondary" @click="closeEditor">{{ t("editor_ui.back") }}</button>
        </div>
      </div>
      <div v-else class="h-100 d-grid place-items-center text-muted p-4 text-center">
        <div><i class="bi bi-images fs-1 d-block mb-2" aria-hidden="true"></i>{{ t("assetlist.master_detail.select_prompt") }}</div>
      </div>
    </div>
  </main>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useTranslation } from "i18next-vue";
import i18next from "i18next";
import AssetEdit from "../components/assets/AssetEdit.vue";
import AssetMasterList from "../components/assets/AssetMasterList.vue";
import { useAssetDraftBadges } from "../composables/useAssetDraftBadges";
import { useMasterDetailRouteState } from "../composables/useMasterDetailRouteState";
import type { ImageAssetReference, ImageAssetRow } from "../electron";
import { resolveEditorLanguage } from "../utils/editorLanguages";
import { localizeTitle } from "../utils/langResource";

const { t } = useTranslation();
const route = useRoute();
const router = useRouter();
const { select, clearSelection, saveScroll, restoreScroll } = useMasterDetailRouteState();
const { draftUids, draftSummaries, refreshDrafts } = useAssetDraftBadges("image-asset");

const items = ref<ImageAssetRow[]>([]);
const selectedCache = ref<ImageAssetRow | null>(null);
const listReady = ref(false);
const selectedResolved = ref(false);
const masterList = ref<InstanceType<typeof AssetMasterList> | null>(null);
const editor = ref<InstanceType<typeof AssetEdit> | null>(null);
const activeLang = computed(() => resolveEditorLanguage(i18next.language));
const selectedUid = computed(() => typeof route.query.uid === "string" ? route.query.uid : null);
const isNew = computed(() => route.query.new === "1");
const query = computed(() => typeof route.query.q === "string" ? route.query.q : "");
const selectedItem = computed(() =>
  items.value.find((item) => item.uid === selectedUid.value) ??
  (selectedCache.value?.uid === selectedUid.value ? selectedCache.value : null),
);
const notFound = computed(() => !!selectedUid.value && !isNew.value && listReady.value && selectedResolved.value && !selectedItem.value);

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

let selectionToken = 0;
async function resolveSelected(): Promise<void> {
  const token = ++selectionToken;
  selectedResolved.value = false;
  const uid = selectedUid.value;
  if (!uid || isNew.value) {
    selectedCache.value = null;
    selectedResolved.value = true;
    return;
  }
  const listed = items.value.find((item) => item.uid === uid);
  if (listed) {
    selectedCache.value = listed;
    selectedResolved.value = true;
    return;
  }
  const row = await window.imageAssets.get(uid).catch(() => null);
  if (token !== selectionToken) return;
  selectedCache.value = row;
  selectedResolved.value = true;
}

function onLoaded(rows: ImageAssetRow[]): void {
  items.value = rows;
  listReady.value = true;
  void resolveSelected();
}

async function updateQuery(value: string): Promise<void> {
  await router.replace({ query: { ...route.query, q: value || undefined } });
}
async function selectExisting(uid: string): Promise<void> { await select(uid, false); }
async function selectDraft(uid: string): Promise<void> { await select(uid, true); }

async function createAsset(): Promise<void> {
  const pending = draftSummaries.value.filter((draft) => draft.baseRevision === null).at(-1);
  await select(pending?.assetUid ?? crypto.randomUUID(), true);
}
async function closeEditor(): Promise<void> {
  await clearSelection();
  await refreshDraftsNow();
}
async function saved(uid: string): Promise<void> {
  await masterList.value?.reload();
  await refreshDraftsNow();
  await select(uid, false);
}
async function reloadEditor(): Promise<void> { await masterList.value?.reload(); }

let draftRefreshTimer: ReturnType<typeof setTimeout> | null = null;
function refreshDraftsSoon(): void {
  if (draftRefreshTimer) clearTimeout(draftRefreshTimer);
  draftRefreshTimer = setTimeout(() => { void refreshDraftsNow(); }, 2300);
}

async function deleteAsset(row: ImageAssetRow): Promise<void> {
  const title = localizeTitle(row.title, activeLang.value) || row.slug;
  let references: ImageAssetReference[] = [];
  let referencesUnavailable = false;
  try {
    references = (await window.imageAssets.findReferences(row.uid)).poiSources;
  } catch (cause) {
    console.error("Failed to resolve image asset references", cause);
    referencesUnavailable = true;
  }
  let message = t("assetlist.delete_confirm", { name: title });
  if (referencesUnavailable) {
    message += `\n\n${t("assetlist.errors.references_unavailable")}`;
  } else if (references.length) {
    message += `\n\n${t("assetlist.delete_referenced", { num: references.length })}\n${references
      .map((reference) => `- ${reference.slug}: ${localizeTitle(reference.title, activeLang.value) || reference.slug}`)
      .join("\n")}`;
  }
  if (!confirm(message)) return;
  try {
    if (selectedUid.value === row.uid) await editor.value?.prepareForDelete();
    await window.imageAssets.delete(row.uid);
    await window.assetDrafts.remove("image-asset", row.uid);
    if (selectedUid.value === row.uid) await clearSelection();
    await masterList.value?.reload();
    await refreshDraftsNow();
  } catch (cause) {
    console.error("Failed to delete image asset", cause);
    alert(t("assetlist.delete_error"));
  }
}

onMounted(async () => {
  await Promise.all([masterList.value?.reload(), refreshDrafts()]);
  await nextTick();
  await restoreScroll(masterList.value?.scrollElement ?? null);
});

watch([selectedUid, isNew], () => { void resolveSelected(); });
onBeforeUnmount(() => {
  if (draftRefreshTimer) clearTimeout(draftRefreshTimer);
});
</script>

<style scoped>
.asset-master-detail { min-height: 0; }
.asset-master-detail__master { width: clamp(18rem, 34vw, 30rem); flex: 0 0 clamp(18rem, 34vw, 30rem); min-height: 0; }
.asset-master-detail__detail { min-height: 0; }
.min-w-0 { min-width: 0; }
.d-grid.place-items-center { place-items: center; }
@media (max-width: 800px) {
  .asset-master-detail { flex-direction: column; overflow: auto !important; }
  .asset-master-detail__master { width: 100%; flex: 0 0 42vh; min-height: 18rem; }
  .asset-master-detail__detail { flex: 0 0 auto; min-height: 32rem; }
}
</style>
