<template>
  <div class="app-list h-100 d-flex flex-column">
    <ResourceListShell
      ref="shellRef"
      kind="app"
      kind-name-key="resource_list.kind_app"
      variant="grid"
      :query="query"
      :state="state"
      :total="total"
      :loaded="loaded"
      :new-draft="newDrafts.length > 0"
      @create="createNewApp"
      @update:query="updateQuery"
      @retry="retry"
      @load-more="loadMore"
    >
      <template #range>
        <button type="button" class="btn btn-outline-secondary btn-sm" data-testid="app-range-filter" @click="modalOpen = true">
          <i class="bi bi-bounding-box me-1" aria-hidden="true"></i>{{ t("basemap.master_detail.range_filter") }}
        </button>
        <button v-if="bbox" type="button" class="btn btn-outline-secondary btn-sm" data-testid="app-range-clear" @click="clear">
          <i class="bi bi-x-lg" aria-hidden="true"></i>
        </button>
      </template>

      <div class="d-flex flex-wrap justify-content-start align-items-start gap-4 p-3">
        <ResourceGridCard
          v-for="vm in viewModels" :key="vm.uid" :item="vm" kind="app"
          :to="`/appedit?uid=${vm.uid}`" :fallback-image="noImage" :draft-label="t('editor_ui.draft_badge')"
          @action="onAction"
        />
        <ResourceDraftCard
          v-for="draft in newDrafts" :key="draft.assetUid" :draft="draft"
          :to="`/appedit?draftUid=${draft.assetUid}`" :fallback-image="noImage" :draft-label="t('editor_ui.draft_badge')"
          @delete-draft="removeNewDraft"
        />
      </div>
    </ResourceListShell>
    <EnvelopeEditorModal v-if="modalOpen" :model-value="envelopeForModal" title-key="basemap.coverage_modal_title" help-key="appedit.envelope_modal_help" @update:model-value="apply" @close="modalOpen = false" />

    <DeleteConfirmDialog
      :visible="deletion.dialog.visible" :title="deletion.dialog.title"
      :deleting="deletion.deleting.value" @confirm="deletion.confirm" @cancel="deletion.cancel"
    />
    <div v-if="deletion.error.value" class="position-fixed bottom-0 start-0 end-0 p-2" style="z-index: 1055;">
      <DiagnosticFeedback scope="operation" dismissible
        :items="[{ key: 'list-op-error', severity: 'danger', message: deletion.error.value }]"
        @dismiss="deletion.error.value = null" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { onBeforeRouteLeave, useRoute, useRouter } from "vue-router";
import { useTranslation } from "i18next-vue";
import noImage from "../assets/img/no_image.png";
import { useAssetDraftBadges } from "../composables/useAssetDraftBadges";
import { useInfiniteResourceList } from "../composables/useInfiniteResourceList";
import { useResourceDelete } from "../composables/useResourceDelete";
import { duplicateEditorPath, reserveCopySlug } from "../composables/useResourceDuplicate";
import { useResourceListBackCache } from "../composables/useResourceListBackCache";
import ResourceListShell from "../components/resource-list/ResourceListShell.vue";
import ResourceGridCard from "../components/resource-list/ResourceGridCard.vue";
import ResourceDraftCard from "../components/resource-list/ResourceDraftCard.vue";
import DeleteConfirmDialog from "../components/resource-list/DeleteConfirmDialog.vue";
import DiagnosticFeedback from "../components/editor-ui/DiagnosticFeedback.vue";
import EnvelopeEditorModal from "../components/EnvelopeEditorModal.vue";
import { useBboxRangeFilter } from "../composables/useBboxRangeFilter";
import { createAppListAdapter, type AppListRow } from "./resource-adapters/appListAdapter";
import type { ResourceListItemViewModel } from "../components/resource-list/resourceListTypes";

const { t } = useTranslation();
const route = useRoute();
const router = useRouter();
const { hasDraft, newDrafts, latestNewDraft, refreshDrafts, removeNewDraft } = useAssetDraftBadges("app");
const { bbox, modalOpen, envelopeForModal, apply, clear } = useBboxRangeFilter({ route, router });
const query = computed(() => (typeof route.query.q === "string" ? route.query.q : ""));
const bboxQuery = computed(() => (typeof route.query.bbox === "string" ? route.query.bbox : null));
const selectedUidRef = { value: null as string | null };
const adapter = createAppListAdapter({ hasDraft, selectedUid: () => selectedUidRef.value });
const { items, total, loaded, state, batchesLoaded, loadFirst, loadMore, retry, restore, applyDeletion } = useInfiniteResourceList<AppListRow, number>(adapter, { filter: () => ({ q: query.value, bbox: bbox.value }), activeLang: () => "" });
const shellRef = ref<InstanceType<typeof ResourceListShell> | null>(null);
const backCache = useResourceListBackCache("app");
function firstVisibleUid() { const r = shellRef.value?.contentRef; if (!r) return null; const t = r.getBoundingClientRect().top; for (const e of Array.from(r.querySelectorAll<HTMLElement>("[data-resource-uid]"))) { if (e.getBoundingClientRect().bottom >= t) return e.dataset.resourceUid ?? null; } return null; }
onBeforeRouteLeave(() => { const r = shellRef.value?.contentRef; backCache.save({ q: query.value, bbox: bboxQuery.value, batches: batchesLoaded.value, anchorUid: firstVisibleUid(), scrollTop: r?.scrollTop ?? 0 }); });
async function restoreOrLoad() { const c = backCache.load(); if (c && c.q === query.value && c.bbox === bboxQuery.value && c.batches >= 1) { await restore(c.batches); await nextTick(); const r = shellRef.value?.contentRef; if (r) { const a = c.anchorUid ? r.querySelector<HTMLElement>(`[data-resource-uid="${CSS.escape(c.anchorUid)}"]`) : null; if (a) r.scrollTop += a.getBoundingClientRect().top - r.getBoundingClientRect().top; else r.scrollTop = c.scrollTop; } } else { await loadFirst(); } }
const viewModels = computed<ResourceListItemViewModel[]>(() => items.value.map((item) => adapter.toViewModel(item, "")));
function updateQuery(value: string): void { void router.replace({ query: { ...route.query, q: value.trim() ? value : undefined } }); }
// M11-T10 (人間検証R4): 既存の新規下書きがあれば引き継いで開く(master-detail と同じ文法)
function createNewApp(): void {
  const pending = latestNewDraft.value;
  void router.push(pending ? `/appedit?draftUid=${pending.assetUid}` : "/appedit");
}

async function onAction(key: string, vm: ResourceListItemViewModel): Promise<void> {
  if (key === "duplicate") { await duplicateByVm(vm); return; }
  if (key !== "delete") return;
  await deletion.request(vm);
}

// M11-T10: 削除 (useResourceDelete) + 複製 (reserveCopySlug) — 共通 composable に委譲
const deletion = useResourceDelete({
  confirmTitle: (title) => t("resource_list.delete_confirm_title", { title }),
  onDelete: async (uid) => {
    await window.applist.delete(uid, query.value, 1);
    await window.assetDrafts.remove("app", uid);
  },
  onDeleted: async (uid) => { applyDeletion(uid); await refreshDrafts(); },
});
async function duplicateByVm(vm: ResourceListItemViewModel) {
  const reserved = await reserveCopySlug(vm.slug, "app", "app");
  if (!reserved) { deletion.error.value = t("resource_list.duplicate_failed"); return; }
  void router.push(duplicateEditorPath("/appedit", vm.uid, reserved));
}

let unsubscribe: (() => void) | null = null;
onMounted(() => {
  unsubscribe = window.applist.onRefresh(() => { void loadFirst(); void refreshDrafts(); });
  void (async () => {
    await restoreOrLoad();
    await refreshDrafts();
  })();
});
onBeforeUnmount(() => unsubscribe?.());
watch([query, bbox], () => { void loadFirst(); });
</script>