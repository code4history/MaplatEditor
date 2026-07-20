<template>
  <div class="poi-source-list h-100 d-flex flex-column">
    <ResourceListShell
      ref="shellRef"
      kind="poi-source"
      kind-name-key="resource_list.kind_poi_source"
      search-placeholder-key="poiref.search_placeholder"
      variant="grid"
      :query="query"
      :state="state"
      :total="total"
      :loaded="loaded"
      :new-draft="newDrafts.length > 0"
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
        <ResourceDraftCard
          v-for="draft in newDrafts"
          :key="draft.assetUid"
          :draft="draft"
          :to="`/poisources/new?draftUid=${draft.assetUid}`"
          :fallback-image="noImage"
          :draft-label="t('editor_ui.draft_badge')"
          @delete-draft="removeNewDraft"
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
import { duplicateEditorPath, reserveCopySlug } from "../composables/useResourceDuplicate";
import ResourceListShell from "../components/resource-list/ResourceListShell.vue";
import ResourceGridCard from "../components/resource-list/ResourceGridCard.vue";
import ResourceDraftCard from "../components/resource-list/ResourceDraftCard.vue";
import ImportSlot from "../components/resource-list/ImportSlot.vue";
import DeleteConfirmDialog from "../components/resource-list/DeleteConfirmDialog.vue";
import DiagnosticFeedback from "../components/editor-ui/DiagnosticFeedback.vue";
import EnvelopeEditorModal from "../components/EnvelopeEditorModal.vue";
import { useBboxRangeFilter } from "../composables/useBboxRangeFilter";
import { createPoiSourceListAdapter } from "./resource-adapters/poiSourceListAdapter";
import type { PoiSourceListRow } from "../electron";
import type { ResourceListItemViewModel } from "../components/resource-list/resourceListTypes";

const { t } = useTranslation();
const route = useRoute();
const router = useRouter();
const { bbox, modalOpen, envelopeForModal, apply, clear } = useBboxRangeFilter({ route, router });
const { hasDraft, newDrafts, latestNewDraft, refreshDrafts, removeNewDraft } = useAssetDraftBadges("poi");

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

// --- Create: 遅延作成（M11-T10b）。行は作らずエディタの未作成モードを開く ---
// M11-T10 (人間検証R4): 既存の新規下書きがあれば引き継いで開く（他4種と同じ文法）
function onCreate(): void {
  const pending = latestNewDraft.value;
  void router.push(pending ? `/poisources/new?draftUid=${pending.assetUid}` : "/poisources/new");
}

// --- Import: 遅延作成（M11-T10b）。file picker と importFile はエディタの未作成モードが自動起動する ---
function onImport(): void {
  void router.push("/poisources/new?import=1");
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

// --- Duplicate（遅延作成・設計v1.2）: reserveCopySlug で採番・予約した slug/uid で
// エディタの未作成モードを開き、内容複製と作成はエディタ側が担う（Map/App と同じ文法）。
// 保存まで行は増えない。remote元もローカル複製になる ---
async function duplicateByVm(vm: ResourceListItemViewModel): Promise<void> {
  const reserved = await reserveCopySlug(vm.slug, "poi-source", "poi-source");
  if (!reserved) { deletion.error.value = t("resource_list.duplicate_failed"); return; }
  void router.push(duplicateEditorPath("/poisources/new", vm.uid, reserved));
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
