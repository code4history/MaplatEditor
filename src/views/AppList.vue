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
          v-for="vm in viewModels"
          :key="vm.uid"
          :item="vm"
          kind="app"
          :to="`/appedit?uid=${vm.uid}`"
          :fallback-image="noImage"
          :draft-label="t('editor_ui.draft_badge')"
          @action="onAction"
        />
        <ResourceDraftCard
          v-for="draft in newDrafts"
          :key="draft.assetUid"
          :draft="draft"
          :to="`/appedit?draftUid=${draft.assetUid}`"
          :fallback-image="noImage"
          :draft-label="t('editor_ui.draft_badge')"
          @delete-draft="removeNewDraft"
        />
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
import ResourceDraftCard from "../components/resource-list/ResourceDraftCard.vue";
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
const { items, total, loaded, state, batchesLoaded, loadFirst, loadMore, retry, restore, applyDeletion } = useInfiniteResourceList<AppListRow, number>(
  adapter,
  { filter: () => ({ q: query.value, bbox: null }), activeLang: () => "" },
);
const shellRef = ref<InstanceType<typeof ResourceListShell> | null>(null);
const backCache = useResourceListBackCache("app");

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
function createNewApp(): void { void router.push("/appedit"); }

async function onAction(key: string, vm: ResourceListItemViewModel): Promise<void> {
  if (key !== "delete") return;
  if (!confirm(t("applist.delete_confirm", { name: vm.title }))) return;
  try {
    await window.applist.delete(vm.uid, query.value, 1); // backend 側の削除・参照処理は無改変
    await window.assetDrafts.remove("app", vm.uid);
    await applyDeletion(vm.uid); // D9: UID除去 + 最終page再取得 dedupe
    await refreshDrafts();
  } catch (e) {
    console.error("Failed to delete app", e);
    alert(t("applist.delete_error"));
  }
}

// 新規(未保存)下書きの削除。保存済みアプリ行は存在しないため draft store のみ消す
async function removeNewDraft(draft: AssetDraftSummary): Promise<void> {
  const name = draft.label ?? draft.slug ?? t("editor_ui.draft_badge");
  if (!confirm(t("editor_ui.delete_draft_confirm", { name }))) return;
  try {
    await window.assetDrafts.remove("app", draft.assetUid);
    await refreshDrafts();
  } catch (e) {
    console.error("Failed to delete new-app draft", e);
  }
}

let unsubscribe: (() => void) | null = null;
onMounted(async () => {
  await restoreOrLoad();
  await refreshDrafts();
  unsubscribe = window.applist.onRefresh(() => { void loadFirst(); void refreshDrafts(); });
});
onBeforeUnmount(() => unsubscribe?.());
// route.q 変更で再取得（filter generation）
watch(query, () => { void loadFirst(); });
</script>
