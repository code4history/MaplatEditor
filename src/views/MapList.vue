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
        <router-link
          v-for="draft in newDrafts"
          :key="draft.assetUid"
          :to="`/mapedit?draftUid=${draft.assetUid}`"
          class="resource-grid-card text-decoration-none text-dark"
        >
          <div class="resource-grid-card__thumb bg-white"><img :src="noImage" :alt="t('editor_ui.draft_badge')"></div>
          <div class="text-center mt-2"><span class="badge bg-warning text-dark">{{ t('editor_ui.draft_badge') }}</span></div>
        </router-link>
      </div>
    </ResourceListShell>
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
import ResourceGridCard from "../components/resource-list/ResourceGridCard.vue";
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
      if (anchor) anchor.scrollIntoView({ block: "start" });
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
  if (key !== "delete") return;
  if (!confirm(t("maplist.delete_confirm", { name: vm.title }))) return;
  try {
    await (window as any).maplist.delete(vm.uid, query.value, 1); // backend 側の削除・参照処理は無改変
    await window.assetDrafts.remove("map", vm.uid);
    await applyDeletion(vm.uid); // D9: UID除去 + 最終page再取得 dedupe
    await refreshDrafts();
  } catch (e) {
    console.error("Failed to delete map", e);
    alert(t("maplist.delete_error"));
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
