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

    <DeleteConfirmDialog
      :visible="deleteDialogVisible" :title="deleteDialogTitle"
      :deleting="false" @confirm="onDeleteConfirm" @cancel="deleteDialogVisible = false"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { onBeforeRouteLeave, useRoute, useRouter } from "vue-router";
import { useTranslation } from "i18next-vue";
import noImage from "../assets/img/no_image.png";
import { useAssetDraftBadges } from "../composables/useAssetDraftBadges";
import { useInfiniteResourceList } from "../composables/useInfiniteResourceList";
import { useResourceListBackCache } from "../composables/useResourceListBackCache";
import { checkSlugAvailability } from "../composables/useSlugAvailability";
import ResourceListShell from "../components/resource-list/ResourceListShell.vue";
import ResourceGridCard from "../components/resource-list/ResourceGridCard.vue";
import ResourceDraftCard from "../components/resource-list/ResourceDraftCard.vue";
import DeleteConfirmDialog from "../components/resource-list/DeleteConfirmDialog.vue";
import { createAppListAdapter, type AppListRow } from "./resource-adapters/appListAdapter";
import type { ResourceListItemViewModel } from "../components/resource-list/resourceListTypes";
import type { AssetDraftSummary } from "../types/assetDraft";

const { t } = useTranslation();
const route = useRoute();
const router = useRouter();
const { hasDraft, draftSummaries, refreshDrafts } = useAssetDraftBadges("app");
const newDrafts = computed(() => draftSummaries.value.filter((draft) => draft.baseRevision === null));
const query = computed(() => (typeof route.query.q === "string" ? route.query.q : ""));
const selectedUidRef = { value: null as string | null };
const adapter = createAppListAdapter({ hasDraft, selectedUid: () => selectedUidRef.value });
const { items, total, loaded, state, batchesLoaded, loadFirst, loadMore, retry, restore, applyDeletion } = useInfiniteResourceList<AppListRow, number>(adapter, { filter: () => ({ q: query.value, bbox: null }), activeLang: () => "" });
const shellRef = ref<InstanceType<typeof ResourceListShell> | null>(null);
const backCache = useResourceListBackCache("app");
function firstVisibleUid() { const r = shellRef.value?.contentRef; if (!r) return null; const t = r.getBoundingClientRect().top; for (const e of Array.from(r.querySelectorAll<HTMLElement>("[data-resource-uid]"))) { if (e.getBoundingClientRect().bottom >= t) return e.dataset.resourceUid ?? null; } return null; }
onBeforeRouteLeave(() => { const r = shellRef.value?.contentRef; backCache.save({ q: query.value, bbox: null, batches: batchesLoaded.value, anchorUid: firstVisibleUid(), scrollTop: r?.scrollTop ?? 0 }); });
async function restoreOrLoad() { const c = backCache.load(); if (c && c.q === query.value && c.batches >= 1) { await restore(c.batches); await nextTick(); const r = shellRef.value?.contentRef; if (r) { const a = c.anchorUid ? r.querySelector<HTMLElement>(`[data-resource-uid="${CSS.escape(c.anchorUid)}"]`) : null; if (a) r.scrollTop += a.getBoundingClientRect().top - r.getBoundingClientRect().top; else r.scrollTop = c.scrollTop; } } else { await loadFirst(); } }
const viewModels = computed<ResourceListItemViewModel[]>(() => items.value.map((item) => adapter.toViewModel(item, "")));
function updateQuery(value: string): void { void router.replace({ query: { ...route.query, q: value.trim() ? value : undefined } }); }
function createNewApp(): void { void router.push("/appedit"); }

async function onAction(key: string, vm: ResourceListItemViewModel): Promise<void> {
  if (key === "duplicate") { await duplicateByVm(vm); return; }
  if (key !== "delete") return;
  pendingDeleteUid.value = vm.uid;
  deleteDialogTitle.value = `${vm.title} を削除しますか？`;
  deleteDialogVisible.value = true;
}
async function removeNewDraft(draft: AssetDraftSummary): Promise<void> {
  const name = draft.label ?? draft.slug ?? t("editor_ui.draft_badge");
  if (!confirm(t("editor_ui.delete_draft_confirm", { name }))) return;
  try { await window.assetDrafts.remove("app", draft.assetUid); await refreshDrafts(); } catch (e) { console.error("Failed to delete new-app draft", e); }
}

// M11-T10: 削除 + 複製
const deleteDialogVisible = ref(false);
const deleteDialogTitle = ref("");
const pendingDeleteUid = ref("");
async function onDeleteConfirm() {
  deleteDialogVisible.value = false;
  try {
    await window.applist.delete(pendingDeleteUid.value, query.value, 1);
    await window.assetDrafts.remove("app", pendingDeleteUid.value);
    applyDeletion(pendingDeleteUid.value); await refreshDrafts();
  } catch (e: any) { console.error("Delete failed", e); }
}
async function duplicateByVm(vm: ResourceListItemViewModel) {
  const copySlug = (vm.slug || "app").length > 95 ? (vm.slug || "app").slice(0, 95) + "-copy" : (vm.slug || "app") + "-copy";
  const newUid = crypto.randomUUID();
  if (await checkSlugAvailability({ slug: copySlug, excludeUid: newUid })) { router.push(`/appedit?duplicateFrom=${vm.uid}&draftUid=${newUid}&slug=${encodeURIComponent(copySlug)}&new=1`); return; }
  for (let i = 2; i <= 100; i++) {
    const next = `${(vm.slug || "app").slice(0, 90)}-copy${i}`;
    if (await checkSlugAvailability({ slug: next, excludeUid: newUid })) { router.push(`/appedit?duplicateFrom=${vm.uid}&draftUid=${newUid}&slug=${encodeURIComponent(next)}&new=1`); return; }
  }
}

let unsubscribe: (() => void) | null = null;
onMounted(async () => { await restoreOrLoad(); await refreshDrafts(); unsubscribe = window.applist.onRefresh(() => { void loadFirst(); void refreshDrafts(); }); });
onBeforeUnmount(() => unsubscribe?.());
watch(query, () => { void loadFirst(); });
</script>