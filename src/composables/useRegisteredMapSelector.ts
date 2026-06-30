import { ref, type Ref } from "vue";
import type {
  RegisteredMapCatalog,
  RegisteredMapCatalogKey,
  RegisteredMapListRequest,
  RegisteredMapStatus,
  RegisteredMapSummary,
  SelectedRegisteredMapRef,
} from "../services/registeredMapCatalog";

export interface SelectedRegisteredMapHostState {
  ref: Readonly<SelectedRegisteredMapRef>;
  title: string;
  status: RegisteredMapStatus;
}

export function useRegisteredMapSelector(
  catalog: RegisteredMapCatalog,
  options?: { pageSize?: number; initialCatalogKey?: RegisteredMapCatalogKey },
) {
  const pageSize = options?.pageSize ?? 20;

  const items: Ref<RegisteredMapSummary[]> = ref([]);
  const loading: Ref<boolean> = ref(false);
  const error: Ref<string | null> = ref(null);
  const selectedKey: Ref<RegisteredMapCatalogKey | null> = ref(options?.initialCatalogKey ?? null);
  const searchQuery: Ref<string> = ref("");
  const currentPage: Ref<number> = ref(1);
  const hasNext: Ref<boolean> = ref(false);
  const hasPrev: Ref<boolean> = ref(false);

  async function loadMaps(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const request: RegisteredMapListRequest = {
        query: searchQuery.value,
        page: currentPage.value,
        pageSize,
      };
      const response = await catalog.listMaps(request);
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
    await loadMaps();
  }

  async function nextPage(): Promise<void> {
    if (!hasNext.value) return;
    currentPage.value++;
    await loadMaps();
  }

  async function prevPage(): Promise<void> {
    currentPage.value = Math.max(1, currentPage.value - 1);
    await loadMaps();
  }

  function select(summary: RegisteredMapSummary): SelectedRegisteredMapHostState {
    const ref: SelectedRegisteredMapRef = {
      kind: "registered-map",
      runtimeMapId: summary.runtimeMapId,
      catalogKey: summary.catalogKey,
    };
    selectedKey.value = summary.catalogKey;
    return {
      ref,
      title: summary.title,
      status: summary.status,
    };
  }

  function deselect(): void {
    selectedKey.value = null;
  }

  return {
    items,
    loading,
    error,
    selectedKey,
    searchQuery,
    currentPage,
    hasNext,
    hasPrev,
    loadMaps,
    search,
    nextPage,
    prevPage,
    select,
    deselect,
  };
}
