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
      <template #range>
        <button type="button" class="btn btn-outline-secondary btn-sm" data-testid="poi-source-range-filter" @click="modalOpen = true">
          <i class="bi bi-bounding-box me-1" aria-hidden="true"></i>{{ t("basemap.master_detail.range_filter") }}
        </button>
        <button v-if="bbox" type="button" class="btn btn-outline-secondary btn-sm" data-testid="poi-source-range-clear" @click="clear"><i class="bi bi-x-lg" aria-hidden="true"></i></button>
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
    <EnvelopeEditorModal v-if="modalOpen" :model-value="envelopeForModal" title-key="basemap.coverage_modal_title" help-key="appedit.envelope_modal_help" @update:model-value="apply" @close="modalOpen = false" />

    <!-- 削除確認 dialog -->
    <DeleteConfirmDialog
      :visible="deletion.dialog.visible"
      :title="deletion.dialog.title"
      :references="deletion.dialog.references"
      :references-unavailable="deletion.dialog.refsUnavailable"
      :deleting="deletion.deleting.value"
      @confirm="deletion.confirm"
      @cancel="deletion.cancel"
    />

    <div v-if="deletion.error.value" class="position-fixed bottom-0 start-0 end-0 p-2" style="z-index: 1055;">
      <DiagnosticFeedback scope="operation" dismissible
        :items="[{ key: 'list-op-error', severity: 'danger', message: deletion.error.value }]"
        @dismiss="deletion.error.value = null" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from "vue";
import { onBeforeRouteLeave, useRoute, useRouter } from "vue-router";
import { useTranslation } from "i18next-vue";
import i18next from "i18next";
import noImage from "../assets/img/no_image.png";
import { useInfiniteResourceList } from "../composables/useInfiniteResourceList";
import { useResourceListBackCache } from "../composables/useResourceListBackCache";
import { useAssetDraftBadges } from "../composables/useAssetDraftBadges";
import { useResourceDelete } from "../composables/useResourceDelete";
import { reserveCopySlug } from "../composables/useResourceDuplicate";
import ResourceListShell from "../components/resource-list/ResourceListShell.vue";
import ResourceGridCard from "../components/resource-list/ResourceGridCard.vue";
import ImportSlot from "../components/resource-list/ImportSlot.vue";
import DeleteConfirmDialog from "../components/resource-list/DeleteConfirmDialog.vue";
import DiagnosticFeedback from "../components/editor-ui/DiagnosticFeedback.vue";
import EnvelopeEditorModal from "../components/EnvelopeEditorModal.vue";
import { useBboxRangeFilter } from "../composables/useBboxRangeFilter";
import { createPoiSourceListAdapter } from "./resource-adapters/poiSourceListAdapter";
import type { PoiSourceListRow, PoiSourceSaveResult } from "../electron";
import type { ResourceListItemViewModel } from "../components/resource-list/resourceListTypes";
import { resolveEditorLanguage } from "../utils/editorLanguages";

const { t } = useTranslation();
const route = useRoute();
const router = useRouter();
const { bbox, modalOpen, envelopeForModal, apply, clear } = useBboxRangeFilter({ route, router });
const { hasDraft, refreshDrafts } = useAssetDraftBadges("poi");

const query = computed(() => (typeof route.query.q === "string" ? route.query.q : ""));
const bboxQuery = computed(() => (typeof route.query.bbox === "string" ? route.query.bbox : null));
const adapter = createPoiSourceListAdapter({
  hasDraft,
  selectedUid: () => null,
  featuresLabel: (count) => `${count} ${t("poisource.features")}`,
  localLabel: t("poisource.local"),
  remoteLabel: t("poisource.remote"),
});
const { items, total, loaded, state, batchesLoaded, loadFirst, loadMore, retry, applyDeletion } =
  useInfiniteResourceList<PoiSourceListRow, number>(adapter, { filter: () => ({ q: query.value, bbox: bbox.value }), activeLang: () => i18next.language });
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

watch([query, bbox], () => loadFirst(), { immediate: false });

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

// --- Delete (useResourceDelete: 共通 dialog + 参照一覧 + 実行) ---
const deletion = useResourceDelete({
  confirmTitle: (title) => t("resource_list.delete_confirm_title", { title }),
  references: async (uid) => {
    const refs = await window.poiSources.findReferences(uid);
    return refs.map((r) => ({ kind: r.kind, slug: r.slug, title: "" }));
  },
  onDelete: async (uid) => {
    await window.poiSources.delete(uid);
    await window.assetDrafts.remove("poi", uid);
  },
  onDeleted: async (uid) => { applyDeletion(uid); await refreshDrafts(); },
});

async function onAction(key: string, vm: ResourceListItemViewModel): Promise<void> {
  if (key === "delete") {
    await deletion.request(vm);
  } else if (key === "duplicate") {
    await duplicateByVm(vm);
  }
}

// --- Duplicate（行作成方式・設計v3.2）: POIエディタは行前提（/poisources/:uid）のため、
// reserveCopySlug で採番・予約した slug/uid で createLocal + fc複製の新規行を作ってから遷移する。
// remote元もローカル複製になる ---
async function duplicateByVm(vm: ResourceListItemViewModel): Promise<void> {
  const reserved = await reserveCopySlug(vm.slug, "poi-source", "poi-source");
  if (!reserved) { deletion.error.value = t("resource_list.duplicate_failed"); return; }
  try {
    const source = await window.poiSources.get(vm.uid);
    if (!source) throw new Error(`source not found: ${vm.uid}`);
    const created = await window.poiSources.createLocal({ slug: reserved.slug, title: source.title, lang: source.lang, uid: reserved.uid });
    if (!("result" in created) || created.result !== "Success") throw new Error("createLocal failed");
    const saved = await window.poiSources.save(reserved.uid, { slug: reserved.slug, title: source.title, fc: source.fc });
    if (!("result" in saved) || saved.result !== "Success") throw new Error("fc copy failed");
    await loadFirst();
    router.push(`/poisources/${reserved.uid}?new=1`);
  } catch (e) {
    console.error("Duplicate failed", e);
    deletion.error.value = t("resource_list.duplicate_failed");
  }
}

// --- lifecycle ---
onMounted(async () => {
  await loadFirst();
  await refreshDrafts();
});

onBeforeUnmount(() => {
  backCache.save({ q: query.value, bbox: bboxQuery.value, batches: batchesLoaded.value, anchorUid: firstVisibleUid(), scrollTop: 0 });
});

onBeforeRouteLeave((_to, _from, next) => {
  backCache.save({ q: query.value, bbox: bboxQuery.value, batches: batchesLoaded.value, anchorUid: firstVisibleUid(), scrollTop: 0 });
  next();
});

function updateQuery(q: string): void {
  router.replace({ query: { ...route.query, q: q || undefined } });
}

defineExpose({ shellRef });
</script>
