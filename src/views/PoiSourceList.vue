<template>
  <div class="poi-source-list h-100 d-flex flex-column">
    <ResourceListShell
      ref="shellRef"
      kind="poi-source"
      kind-name-key="resource_list.kind_poi_source"
      variant="grid"
      :query="query"
      :state="state"
      :total="total"
      :loaded="loaded"
      @create="onCreate"
      @update:query="updateQuery"
      @retry="retry"
      @load-more="loadMore"
    >
      <template #secondary>
        <ImportSlot kind="poi-source" @import="onImport" />
      </template>

      <div class="d-flex flex-wrap justify-content-start align-items-start gap-4 p-3">
        <ResourceGridCard
          v-for="vm in viewModels"
          :key="vm.uid"
          :item="vm"
          kind="poi-source"
          :to="`/poisources/${vm.uid}`"
          :fallback-image="noImage"
          :draft-label="t('editor_ui.draft_badge')"
          @action="onAction"
        />
      </div>
    </ResourceListShell>

    <!-- 削除確認 dialog -->
    <DeleteConfirmDialog
      :visible="deleteDialog.visible"
      :title="deleteDialog.title"
      :references="deleteDialog.references"
      :references-unavailable="deleteDialog.refsUnavailable"
      :deleting="deleting"
      @confirm="onDeleteConfirm"
      @cancel="deleteDialog.visible = false"
    />

    <div v-if="deleteError" class="position-fixed bottom-0 start-0 end-0 p-2" style="z-index: 1055;">
      <DiagnosticFeedback scope="operation" dismissible
        :items="[{ key: 'delete-error', severity: 'danger', message: deleteError }]"
        @dismiss="deleteError = null" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount } from "vue";
import { onBeforeRouteLeave, useRoute, useRouter } from "vue-router";
import { useTranslation } from "i18next-vue";
import i18next from "i18next";
import noImage from "../assets/img/no_image.png";
import { useInfiniteResourceList } from "../composables/useInfiniteResourceList";
import { useResourceListBackCache } from "../composables/useResourceListBackCache";
import { useAssetDraftBadges } from "../composables/useAssetDraftBadges";
import { useResourceDelete } from "../composables/useResourceDelete";
import ResourceListShell from "../components/resource-list/ResourceListShell.vue";
import ResourceGridCard from "../components/resource-list/ResourceGridCard.vue";
import ImportSlot from "../components/resource-list/ImportSlot.vue";
import DeleteConfirmDialog from "../components/resource-list/DeleteConfirmDialog.vue";
import DiagnosticFeedback from "../components/editor-ui/DiagnosticFeedback.vue";
import { createPoiSourceListAdapter } from "./resource-adapters/poiSourceListAdapter";
import type { PoiSourceListRow, PoiSourceSaveResult } from "../electron";
import type { ResourceListItemViewModel } from "../components/resource-list/resourceListTypes";
import type { DeleteReference } from "../components/resource-list/DeleteConfirmDialog.vue";
import { resolveEditorLanguage } from "../utils/editorLanguages";
// --- Duplicate (slug予約 → エディタ遷移) ---

const { t } = useTranslation();
const route = useRoute();
const router = useRouter();
const { hasDraft, refreshDrafts } = useAssetDraftBadges("poi");

const query = computed(() => (typeof route.query.q === "string" ? route.query.q : ""));
const adapter = createPoiSourceListAdapter({
  hasDraft,
  selectedUid: () => null,
  featuresLabel: (count) => `${count} ${t("poisource.features")}`,
  localLabel: t("poisource.local"),
  remoteLabel: t("poisource.remote"),
});
const { items, total, loaded, state, batchesLoaded, loadFirst, loadMore, retry, applyDeletion } =
  useInfiniteResourceList<PoiSourceListRow, number>(adapter, { filter: () => ({ q: query.value, bbox: null }), activeLang: () => i18next.language });
const viewModels = computed<ResourceListItemViewModel[]>(() => items.value.map((item) => adapter.toViewModel(item, i18next.language)));
const shellRef = ref<InstanceType<typeof ResourceListShell> | null>(null);
const backCache = useResourceListBackCache("poi-source");

function firstVisibleUid(): string | null {
  const root = shellRef.value?.contentRef ?? null;
  if (!root) return null;
  const top = root.getBoundingClientRect().top;
  for (const el of Array.from(root.querySelectorAll<HTMLElement>("[data-resource-uid]"))) {
    if (el.getBoundingClientRect().bottom >= top) return el.dataset.resourceUid ?? null;
  }
  return null;
}

watch(query, () => loadFirst(), { immediate: false });

function suggestSlug(candidate: string): string {
  return candidate
    .replace(/[\s.]+/g, "-")
    .replace(/[^A-Za-z0-9_-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100)
    .toLowerCase() || "poi-source";
}

// --- Create: 空draft 作成 → エディタ遷移 ---
const creating = ref(false);

async function onCreate(): Promise<void> {
  if (creating.value) return;
  creating.value = true;
  try {
    const slug = `poi-${Date.now().toString(36)}`;
    const result: PoiSourceSaveResult = await window.poiSources.createLocal({ slug, title: { ja: slug }, lang: "ja" });
    if (!("result" in result) || result.result !== "Success") throw new Error("Create failed");
    router.push(`/poisources/${("uid" in result ? result.uid : "")}?new=1`);
  } catch (e) {
    console.error("Failed to create POI source", e);
  } finally {
    creating.value = false;
  }
}

// --- Import ---
async function onImport(): Promise<void> {
  try {
    const picked = await window.poiSources.pickImportFile();
    if (!picked) return;
    const slug = suggestSlug(picked.fileName);
    const lang = resolveEditorLanguage(await window.poiSources.detectImportLanguage(picked.filePath, "ja"));
    const result = await window.poiSources.importFile({ slug, title: { [lang]: picked.fileName.replace(/\.[^.]+$/, "") }, filePath: picked.filePath });
    if (!("result" in result) || result.result !== "Success") throw new Error("Import failed");
    router.push(`/poisources/${("uid" in result ? result.uid : "")}?new=1`);
  } catch (e: any) {
    console.error("Import failed", e);
    await (window as any).dialog.showMessageBox({ type: "error", buttons: ["OK"], message: e?.message || t("poisource.errors.pick_failed") });
  }
}

// --- Delete ---
const { deleting, requestDelete } = useResourceDelete({
  onDelete: async (uid) => { await window.poiSources.delete(uid); },
  onDraftRemove: async (uid) => { await window.assetDrafts.remove("poi", uid); },
  onDeleted: async (uid) => { applyDeletion(uid); await refreshDrafts(); },
  onError: (_uid, msg) => { deleteError.value = msg; },
});
const deleteError = ref<string | null>(null);
const deleteDialog = reactive({
  visible: false, title: "", references: [] as DeleteReference[], refsUnavailable: false,
});
let pendingDeleteUid = "";

async function onAction(key: string, vm: ResourceListItemViewModel): Promise<void> {
  if (key === "delete") {
    pendingDeleteUid = vm.uid;
    let references: DeleteReference[] = [];
    let refsUnavailable = false;
    try {
      const refs = await window.poiSources.findReferences(vm.uid);
      references = refs.map((r) => ({ kind: r.kind, slug: r.slug, title: "" }));
    } catch { refsUnavailable = true; }
    deleteDialog.title = `${vm.title} を削除しますか？`;
    deleteDialog.references = references;
    deleteDialog.refsUnavailable = refsUnavailable;
    deleteDialog.visible = true;
  } else if (key === "duplicate") {
    await duplicateByVm(vm);
  }
}
async function onDeleteConfirm(): Promise<void> {
  deleteDialog.visible = false;
  await requestDelete(pendingDeleteUid);
}

// --- Duplicate (slug予約 → エディタ遷移) ---
async function duplicateByVm(vm: ResourceListItemViewModel): Promise<void> {
  const newUid = crypto.randomUUID();
  const tryReserve = async (slug: string): Promise<boolean> => {
    const result = await window.slugReservations.reserve({ slug, assetUid: newUid, assetKind: "poi-source", draftUid: newUid });
    return result.result === "ok";
  };

  const baseSlug = vm.slug || "poi-source";
  const copySlug = (baseSlug.length > 95 ? baseSlug.slice(0, 95) : baseSlug) + "-copy";
  if (await tryReserve(copySlug)) {
    router.push(`/poisources/${vm.uid}?duplicateFrom=${vm.uid}&draftUid=${newUid}&slug=${encodeURIComponent(copySlug)}&new=1`);
    return;
  }
  for (let i = 2; i <= 100; i++) {
    const next = `${baseSlug.slice(0, 90)}-copy${i}`;
    if (await tryReserve(next)) {
      router.push(`/poisources/${vm.uid}?duplicateFrom=${vm.uid}&draftUid=${newUid}&slug=${encodeURIComponent(next)}&new=1`);
      return;
    }
  }
  await (window as any).dialog.showMessageBox({ type: "error", buttons: ["OK"], message: "複製用のslugが確保できませんでした。" });
}

// --- lifecycle ---
onMounted(async () => {
  await loadFirst();
  await refreshDrafts();
});

onBeforeUnmount(() => {
  backCache.save({ q: query.value, bbox: null, batches: batchesLoaded.value, anchorUid: firstVisibleUid(), scrollTop: 0 });
});

onBeforeRouteLeave((_to, _from, next) => {
  backCache.save({ q: query.value, bbox: null, batches: batchesLoaded.value, anchorUid: firstVisibleUid(), scrollTop: 0 });
  next();
});

function updateQuery(q: string): void {
  router.replace({ query: { ...route.query, q: q || undefined } });
}

defineExpose({ shellRef });
</script>