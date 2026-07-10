import { ref, type Ref } from "vue";

// PoiSourceListResult / PoiSourceListRow は electron.d.ts でグローバル宣言済み (window.poiSources)。
// API の返り値から行型を導出して契約ドリフトを vue-tsc に検出させる
type PoiSourceListResult = Awaited<ReturnType<Window["poiSources"]["list"]>>;
export type PoiSourceListRow = PoiSourceListResult["items"][number];

const PAGE_SIZE = 20;

// POI ソース一覧 (Phase 3, ADR-0007)。window.poiSources.list の行 (PoiSourceListRow) を
// そのまま保持し、view 側でローカライズ/表示する。MapList/AppList の list パターンに整合。
export function usePoiSourceList() {
  const items: Ref<PoiSourceListRow[]> = ref([]);
  const loading: Ref<boolean> = ref(false);
  const error: Ref<string | null> = ref(null);
  const searchQuery: Ref<string> = ref("");
  const currentPage: Ref<number> = ref(1);
  const hasNext: Ref<boolean> = ref(false);
  const hasPrev: Ref<boolean> = ref(false);
  const total: Ref<number> = ref(0);

  async function loadSources(page: number = currentPage.value): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const response = await window.poiSources.list({
        query: searchQuery.value,
        page,
        pageSize: PAGE_SIZE,
      });
      items.value = response.items;
      currentPage.value = response.page;
      hasNext.value = response.hasNext;
      hasPrev.value = response.hasPrev;
      total.value = response.total;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
      items.value = [];
    } finally {
      loading.value = false;
    }
  }

  async function search(query: string): Promise<void> {
    searchQuery.value = query;
    await loadSources(1);
  }

  async function nextPage(): Promise<void> {
    if (!hasNext.value) return;
    await loadSources(currentPage.value + 1);
  }

  async function prevPage(): Promise<void> {
    if (!hasPrev.value) return;
    await loadSources(Math.max(1, currentPage.value - 1));
  }

  return {
    items,
    loading,
    error,
    searchQuery,
    currentPage,
    hasNext,
    hasPrev,
    total,
    loadSources,
    search,
    nextPage,
    prevPage,
  };
}
