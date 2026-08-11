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
        @delete="requestDeleteAsset"
        @duplicate="duplicateAsset"
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
      <div v-else-if="notFound" class="h-100">
        <!-- M12-T11 (R3/C47): alert から ResourceEmptyState 寄せ（アイコン+文言+戻るボタン） -->
        <ResourceEmptyState icon-class="bi bi-images" :message="t('assetlist.master_detail.not_found')">
          <template #actions>
            <button type="button" class="btn btn-sm btn-outline-secondary" @click="closeEditor">{{ t("editor_ui.back") }}</button>
          </template>
        </ResourceEmptyState>
      </div>
      <div v-else class="h-100">
        <ResourceEmptyState
          icon-class="bi bi-images"
          :message="t('assetlist.master_detail.select_prompt')"
        />
      </div>
    </div>

    <!-- M11-T10: 共通削除確認 dialog（参照情報つき） -->
    <DeleteConfirmDialog
      :visible="deletion.dialog.visible" :title="deletion.dialog.title"
      :references="deletion.dialog.references" :references-unavailable="deletion.dialog.refsUnavailable"
      :deleting="deletion.deleting.value" @confirm="deletion.confirm" @cancel="deletion.cancel"
    />
    <!-- M12-T11 (R3/C49-C50): 削除/複製失敗は DF operation フローティングバナーで表示（他一覧と同文法） -->
    <div v-if="deletion.error.value" class="position-fixed bottom-0 start-0 end-0 p-2" style="z-index: 1055;">
      <DiagnosticFeedback scope="operation" dismissible
        :items="[{ key: 'list-op-error', severity: 'danger', message: deletion.error.value }]"
        @dismiss="deletion.error.value = null" />
    </div>
  </main>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import DeleteConfirmDialog from "../components/resource-list/DeleteConfirmDialog.vue";
import DiagnosticFeedback from "../components/editor-ui/DiagnosticFeedback.vue";
import ResourceEmptyState from "../components/resource-list/ResourceEmptyState.vue";
import { useTranslation } from "i18next-vue";
import i18next from "i18next";
import AssetEdit from "../components/assets/AssetEdit.vue";
import AssetMasterList from "../components/assets/AssetMasterList.vue";
import { useAssetDraftBadges } from "../composables/useAssetDraftBadges";
import { useMasterDetailRouteState } from "../composables/useMasterDetailRouteState";
import { useResourceDelete } from "../composables/useResourceDelete";
import { reserveCopySlug } from "../composables/useResourceDuplicate";
import type { ImageAssetReference, ImageAssetRow } from "../electron";
import { resolveEditorLanguage } from "../utils/editorLanguages";
import { localizeTitle } from "../utils/langResource";

const { t } = useTranslation();
const route = useRoute();
const router = useRouter();
const { select, selectDuplicate, clearSelection, saveScroll, restoreScroll } = useMasterDetailRouteState();
const { draftUids, draftSummaries, latestNewDraft, refreshDrafts } = useAssetDraftBadges("image-asset");

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
  await select(latestNewDraft.value?.assetUid ?? crypto.randomUUID(), true);
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

// M11-T10: 共通確認 dialog（native confirm 全廃、useResourceDelete へ委譲）+ 参照情報表示
const deletion = useResourceDelete({
  confirmTitle: (title) => t("resource_list.delete_confirm_title", { title }),
  references: async (uid) => {
    const references: ImageAssetReference[] = (await window.imageAssets.findReferences(uid)).poiSources;
    return references.map((reference) => ({
      kind: "poi-source", slug: reference.slug, title: localizeTitle(reference.title, activeLang.value) || reference.slug,
    }));
  },
  onDelete: async (uid) => {
    if (selectedUid.value === uid) await editor.value?.prepareForDelete();
    await window.imageAssets.delete(uid);
    await window.assetDrafts.remove("image-asset", uid);
  },
  onDeleted: async (uid) => {
    if (selectedUid.value === uid) await clearSelection();
    await masterList.value?.reload();
    await refreshDraftsNow();
  },
  // M12-T11 (R3/C49): native alert() を廃止。error ref は DF operation バナーで表示（他一覧と同文法）
});
async function requestDeleteAsset(row: ImageAssetRow): Promise<void> {
  await deletion.request({ uid: row.uid, title: localizeTitle(row.title, activeLang.value) || row.slug });
}

// M11-T10 複製（案A）: reserveCopySlug（check前置+新規UID採番）→ duplicateFrom/slug クエリ付きで new モードを開く
const duplicateFrom = computed(() => (typeof route.query.duplicateFrom === "string" ? route.query.duplicateFrom : ""));
const presetSlug = computed(() => (typeof route.query.slug === "string" ? route.query.slug : ""));
const duplicateSourceItem = computed(() =>
  duplicateFrom.value ? items.value.find((row) => row.uid === duplicateFrom.value) ?? null : null,
);
async function duplicateAsset(row: ImageAssetRow): Promise<void> {
  const reserved = await reserveCopySlug(row.slug, "image-asset", "asset");
  if (!reserved) { deletion.error.value = t("resource_list.duplicate_failed"); return; }  // M12-T11 (R3/C50): native alert() 廃止
  await selectDuplicate(row.uid, reserved);
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
