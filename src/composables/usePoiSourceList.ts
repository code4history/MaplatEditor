import { ref, type Ref } from "vue";
import type {
  PoiSourceSummary,
  PoiSourceListRequest,
} from "../services/registeredPoiSourceCatalog";

const PAGE_SIZE = 20;

export function usePoiSourceList() {
  const items: Ref<PoiSourceSummary[]> = ref([]);
  const loading: Ref<boolean> = ref(false);
  const error: Ref<string | null> = ref(null);
  const searchQuery: Ref<string> = ref("");
  const currentPage: Ref<number> = ref(1);
  const hasNext: Ref<boolean> = ref(false);
  const hasPrev: Ref<boolean> = ref(false);

  async function loadSources(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const request: PoiSourceListRequest = {
        query: searchQuery.value,
        page: currentPage.value,
        pageSize: PAGE_SIZE,
      };
      const response = await (window as any).poiSources.list(request);
      items.value = response.items;
      currentPage.value = response.page;
      hasNext.value = response.hasNext;
      hasPrev.value = response.hasPrev;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    } finally {
      loading.value = false;
    }
  }

  async function search(query: string): Promise<void> {
    searchQuery.value = query;
    currentPage.value = 1;
    await loadSources();
  }

  async function nextPage(): Promise<void> {
    if (!hasNext.value) return;
    currentPage.value++;
    await loadSources();
  }

  async function prevPage(): Promise<void> {
    if (!hasPrev.value) return;
    currentPage.value = Math.max(1, currentPage.value - 1);
    await loadSources();
  }

  return {
    items,
    loading,
    error,
    searchQuery,
    currentPage,
    hasNext,
    hasPrev,
    loadSources,
    search,
    nextPage,
    prevPage,
  };
}
