<template>
  <div class="map-list h-100 d-flex flex-column">
    <ResourceListShell
      ref="shellRef"
      kind="map"
      kind-name-key="resource_list.kind_map"
      variant="grid"
      :query="query"
      :state="state"
      :total="total"
      :loaded="loaded"
      :new-draft="newDrafts.length > 0"
      @create="createNewMap"
      @update:query="updateQuery"
      @retry="retry"
      @load-more="loadMore"
    >
      <div class="d-flex flex-wrap justify-content-start align-items-start gap-4 p-3">
        <ResourceGridCard
          v-for="vm in viewModels"
          :key="vm.uid"
          :item="vm"
          kind="map"
          :to="`/mapedit?uid=${vm.uid}`"
          :fallback-image="noImage"
          :draft-label="t('editor_ui.draft_badge')"
          @action="onAction"
        />
        <ResourceDraftCard
          v-for="draft in newDrafts"
          :key="draft.assetUid"
          :draft="draft"
          :to="`/mapedit?draftUid=${draft.assetUid}`"
          :fallback-image="noImage"
          :draft-label="t('editor_ui.draft_badge')"
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
import ResourceListShell from "../components/resource-list/ResourceListShell.vue";
import DeleteConfirmDialog from "../components/resource-list/DeleteConfirmDialog.vue";
import { createMapListAdapter, type MapListRow } from "./resource-adapters/mapListAdapter";
import type { ResourceListItemViewModel } from "../components/resource-list/resourceListTypes";

const { t } = useTranslation();
const route = useRoute();
const router = useRouter();
const { hasDraft, draftSummaries, refreshDrafts } = useAssetDraftBadges("map");
const newDrafts = computed(() => draftSummaries.value.filter((draft) => draft.baseRevision === null));

const query = computed(() => (typeof route.query.q === "string" ? route.query.q : ""));
const selectedUidRef = { value: null as string | null };
const adapter = createMapListAdapter({ hasDraft, selectedUid: () => selectedUidRef.value });
const { items, total, loaded, state, batchesLoaded, loadFirst, loadMore, retry, restore, applyDeletion } = useInfiniteResourceList<MapListRow, number>(
  adapter,
  { filter: () => ({ q: query.value, bbox: null }), activeLang: () => "" },
);
const shellRef = ref<InstanceType<typeof ResourceListShell> | null>(null);
const backCache = useResourceListBackCache("map");

// P6: viewport 先頭の item uid を anchor として返す
function firstVisibleUid(): string | null {
  const root = shellRef.value?.contentRef ?? null;
  if (!root) return null;
  const top = root.getBoundingClientRect().top;
  for (const el of Array.from(root.querySelectorAll<HTMLElement>("[data-resource-uid]"))) {
    if (el.getBoundingClientRect().bottom >= top) return el.dataset.resourceUid ?? null;
  }
  return null;
}
onBeforeRouteLeave(() => {
  const root = shellRef.value?.contentRef ?? null;
  backCache.save({ q: query.value, bbox: null, batches: batchesLoaded.value, anchorUid: firstVisibleUid(), scrollTop: root?.scrollTop ?? 0 });
});
async function restoreOrLoad(): Promise<void> {
  const cached = backCache.load();
  if (cached && cached.q === query.value && cached.batches >= 1) {
    await restore(cached.batches);
    await nextTick();
    const root = shellRef.value?.contentRef ?? null;
    if (root) {
      const anchor = cached.anchorUid
        ? root.querySelector<HTMLElement>(`[data-resource-uid="${CSS.escape(cached.anchorUid)}"]`)
        : null;
      // scrollIntoView は overflow:hidden の body まで祖先ごとスクロールさせ、fixed ヘッダー下に
      // コンテンツ全体が潜り込む(ステート依存被りの真因)ため、root コンテナのみをスクロールする
      if (anchor) root.scrollTop += anchor.getBoundingClientRect().top - root.getBoundingClientRect().top;
      else root.scrollTop = cached.scrollTop;
    }
  } else {
    await loadFirst();
  }
}
const viewModels = computed<ResourceListItemViewModel[]>(() => items.value.map((item) => adapter.toViewModel(item, "")));

function updateQuery(value: string): void {
  void router.replace({ query: { ...route.query, q: value.trim() ? value : undefined } });
}
function createNewMap(): void { void router.push("/mapedit"); }

async function onAction(key: string, vm: ResourceListItemViewModel): Promise<void> {
  if (key === "duplicate") { await duplicateByVm(vm); return; }
  if (key !== "delete") return;
  pendingDeleteUid.value = vm.uid;
  deleteDialogTitle.value = `${vm.title} を削除しますか？`;
  deleteDialogVisible.value = true;
}

// 新規(未保存)下書きの削除。保存済み地図行は存在しないため draft store のみ消す
async function removeNewDraft(draft: import("../types/assetDraft").AssetDraftSummary): Promise<void> {
  const name = draft.label ?? draft.slug ?? t("editor_ui.draft_badge");
  if (!confirm(t("editor_ui.delete_draft_confirm", { name }))) return;
  try {
    await window.assetDrafts.remove("map", draft.assetUid);
    await refreshDrafts();
  } catch (e) {
    console.error("Failed to delete new-map draft", e);
  }
}

// M11-T10: 削除 + 複製
const deleteDialogVisible = ref(false);
const deleteDialogTitle = ref("");
const pendingDeleteUid = ref("");
async function onDeleteConfirm() {
  deleteDialogVisible.value = false;
  try {
    await (window as any).maplist.delete(pendingDeleteUid.value, query.value, 1);
    await window.assetDrafts.remove("map", pendingDeleteUid.value);
    applyDeletion(pendingDeleteUid.value); await refreshDrafts();
  } catch (e: any) { console.error("Delete failed", e); }
}
async function duplicateByVm(vm: ResourceListItemViewModel) {
  const newUid = crypto.randomUUID();
  const tryReserve = async (slug: string) => { const r = await window.slugReservations.reserve({ slug, assetUid: newUid, assetKind: "map", draftUid: newUid }); return r.result === "ok"; };
  const baseSlug = vm.slug || "map";
  const copySlug = (baseSlug.length > 95 ? baseSlug.slice(0, 95) : baseSlug) + "-copy";
  if (await tryReserve(copySlug)) { router.push(`/mapedit?duplicateFrom=${vm.uid}&draftUid=${newUid}&slug=${encodeURIComponent(copySlug)}&new=1`); return; }
  for (let i = 2; i <= 100; i++) {
    const next = `${baseSlug.slice(0, 90)}-copy${i}`;
    if (await tryReserve(next)) { router.push(`/mapedit?duplicateFrom=${vm.uid}&draftUid=${newUid}&slug=${encodeURIComponent(next)}&new=1`); return; }
  }
}

let unsubscribe: (() => void) | null = null;
onMounted(async () => {
  await restoreOrLoad();
  await refreshDrafts();
  unsubscribe = window.maplist.onRefresh(() => { void loadFirst(); void refreshDrafts(); });
});
onBeforeUnmount(() => unsubscribe?.());
// route.q 変更で再取得（filter generation）
watch(query, () => { void loadFirst(); });
</script>
