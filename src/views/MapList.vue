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
      <template #secondary>
        <ImportSlot kind="map" @import="onImportMap" />
      </template>

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
import ImportSlot from "../components/resource-list/ImportSlot.vue";
import DeleteConfirmDialog from "../components/resource-list/DeleteConfirmDialog.vue";
import DiagnosticFeedback from "../components/editor-ui/DiagnosticFeedback.vue";
import { createMapListAdapter, type MapListRow } from "./resource-adapters/mapListAdapter";
import type { ResourceListItemViewModel } from "../components/resource-list/resourceListTypes";

const { t } = useTranslation();
const route = useRoute();
const router = useRouter();
const { hasDraft, newDrafts, latestNewDraft, refreshDrafts, removeNewDraft } = useAssetDraftBadges("map");

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
// M11-T10 (人間検証R4): 既存の新規下書きがあれば引き継いで開く(master-detail と同じ文法)
function createNewMap(): void {
  const pending = latestNewDraft.value;
  void router.push(pending ? `/mapedit?draftUid=${pending.assetUid}` : "/mapedit");
}
// M11-T10 (AC11): インポート導線 — MapEdit の新規モードで既存 importMap フローを自動起動
function onImportMap(): void { void router.push("/mapedit?new=1&import=1"); }

async function onAction(key: string, vm: ResourceListItemViewModel): Promise<void> {
  if (key === "duplicate") { await duplicateByVm(vm); return; }
  if (key !== "delete") return;
  await deletion.request(vm);
}

// M11-T10: 削除 (useResourceDelete) + 複製 (reserveCopySlug) — 共通 composable に委譲
const deletion = useResourceDelete({
  confirmTitle: (title) => t("resource_list.delete_confirm_title", { title }),
  onDelete: async (uid) => {
    await (window as any).maplist.delete(uid, query.value, 1);
    await window.assetDrafts.remove("map", uid);
  },
  onDeleted: async (uid) => { applyDeletion(uid); await refreshDrafts(); },
});
async function duplicateByVm(vm: ResourceListItemViewModel) {
  const reserved = await reserveCopySlug(vm.slug, "map", "map");
  if (!reserved) { deletion.error.value = t("resource_list.duplicate_failed"); return; }
  void router.push(duplicateEditorPath("/mapedit", vm.uid, reserved));
}

let unsubscribe: (() => void) | null = null;
onMounted(() => {
  // m11-t12: refresh イベントは restoreOrLoad() 中に発行される可能性があるため、
  // リスナー登録を先に行い、イベントを取りこぼさないようにする。
  unsubscribe = window.maplist.onRefresh(() => { void loadFirst(); void refreshDrafts(); });
  void (async () => {
    await restoreOrLoad();
    await refreshDrafts();
  })();
});
onBeforeUnmount(() => unsubscribe?.());
// route.q 変更で再取得（filter generation）
watch(query, () => { void loadFirst(); });
</script>
