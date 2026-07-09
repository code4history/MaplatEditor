import { ref, type Ref } from "vue";
import type { PoiSourceSummary } from "../services/registeredPoiSourceCatalog";

// window.poiSources.list の行 (electron.d.ts PoiSourceListRow と同形)
interface PoiSourceListRow {
  uid: string;
  slug: string;
  title: Record<string, string>;
  mode: "local" | "remote";
  url: string | null;
  featureCount: number;
  revision: number;
  updatedAt: string;
}

const PAGE_SIZE = 20;

// LangResource 内部形 {lang: text} → 一覧表示用テキスト (Phase 3 で画面ごと再構築されるまでの暫定)
function titleToText(title: Record<string, string>, fallback: string): string {
  if (title && typeof title === "object") {
    if (typeof title.ja === "string" && title.ja) return title.ja;
    const first = Object.values(title).find((t) => typeof t === "string" && t !== "");
    if (first) return first;
  }
  return fallback;
}

// Write Store backend (poisource:* v2, uid/slug契約) の行を旧 view model へ写像する薄い読替え。
// 画面群は Phase 3 で全面再構築されるため、ここは最小のコンパイル維持 shim に留める
function rowToSummary(row: PoiSourceListRow): PoiSourceSummary {
  return {
    catalogKey: `poi-source:${row.uid}`,
    sourceId: row.uid,
    title: titleToText(row.title, row.slug),
    mode: row.mode,
    featureCount: row.featureCount,
    url: row.url ?? undefined,
    status: "ready",
    readOnly: row.mode === "remote",
    updatedAt: row.updatedAt,
    validation: { status: "ready" },
  };
}

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
      const response = await window.poiSources.list({
        query: searchQuery.value,
        page: currentPage.value,
        pageSize: PAGE_SIZE,
      });
      items.value = response.items.map(rowToSummary);
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
