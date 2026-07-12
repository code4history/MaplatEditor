<template>
  <!-- POIデータタブの左カラム (AppEdit 地図選択タブの source-pane と同設計)。
       検索ボックス + リスト行 (行クリックで追加。追加済み行は選択状態表示 + no-op —
       地図選択の addMapSource と同じ挙動で、解除は右カラムの × ボタンから行う) -->
  <div class="poi-source-selector d-flex flex-column">
    <div class="poi-source-toolbar pb-2">
      <input
        v-model="searchInput"
        class="form-control form-control-sm"
        :placeholder="t('poisource.search_placeholder')"
        @input="onSearchInput"
      >
    </div>

    <!-- Loading -->
    <div v-if="loading" class="text-muted text-center py-3">
      {{ t("applist.loading") }}
    </div>

    <!-- Error -->
    <div v-else-if="error" class="alert alert-danger">
      {{ error }}
    </div>

    <!-- Empty -->
    <div v-else-if="items.length === 0" class="text-muted text-center py-3">
      {{ t("applist.no_poi_sources") }}
    </div>

    <!-- Source List (地図選択の source-row と同じ行構成。サムネイルは POI に無いためピン印で代替) -->
    <div v-else class="source-list">
      <button
        v-for="source in items"
        :key="source.uid"
        type="button"
        class="source-row"
        :class="{ 'source-row-selected': isSelected(source.uid) }"
        :title="localizeTitle(source)"
        @click="addSource(source)"
      >
        <span class="source-row-icon" aria-hidden="true">📍</span>
        <span class="min-width-0">
          <span class="d-block text-truncate">{{ localizeTitle(source) }}</span>
          <small class="d-block text-muted text-truncate">
            {{ source.slug }} · {{ source.featureCount }} {{ t("poisource.features") }}
          </small>
        </span>
        <span v-if="isSelected(source.uid)" class="badge bg-success flex-shrink-0">
          {{ t("poiref.added") }}
        </span>
        <span v-else class="badge flex-shrink-0" :class="source.mode === 'local' ? 'bg-primary' : 'bg-info'">
          {{ source.mode === 'local' ? t("poisource.local") : t("poisource.remote") }}
        </span>
      </button>
    </div>

    <!-- Pagination (POI ソース一覧はページング API のため。検索と併用可) -->
    <div v-if="hasPrev || hasNext" class="d-flex align-items-center justify-content-center gap-2 mt-2">
      <button
        class="btn btn-sm btn-outline-secondary"
        :disabled="!hasPrev"
        @click="prevPage"
      >
        &lt;
      </button>
      <span class="text-muted small">{{ t("applist.page", { page: currentPage }) }}</span>
      <button
        class="btn btn-sm btn-outline-secondary"
        :disabled="!hasNext"
        @click="nextPage"
      >
        &gt;
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from "vue";
import { useTranslation } from "i18next-vue";
import i18next from "i18next";
import { usePoiSourceList, type PoiSourceListRow } from "../composables/usePoiSourceList";
import type { SelectedPoiSourceRef } from "../services/registeredPoiSourceCatalog";
import { localizeTitle as resolveLocalizedTitle } from "../utils/langResource";

const { t } = useTranslation();

const props = defineProps<{
  initialSelected?: SelectedPoiSourceRef[];
}>();

const emit = defineEmits<{
  "update:selected": [value: SelectedPoiSourceRef[]];
}>();

const {
  items,
  loading,
  error,
  loadSources,
  search,
  nextPage,
  prevPage,
  currentPage,
  hasNext,
  hasPrev,
} = usePoiSourceList();

const selectedSources = ref<SelectedPoiSourceRef[]>([]);
// 検索ボックス (地図選択タブの検索と同じ操作体系)。POI ソース一覧は全件保持ではなく
// ページング API のため、入力ごとに main 側 query で絞り込む (後着優先は composable の
// loadToken が保証)
const searchInput = ref("");

onMounted(() => {
  if (props.initialSelected) {
    selectedSources.value = [...props.initialSelected];
  }
  loadSources();
});

watch(
  () => props.initialSelected,
  (newVal) => {
    if (newVal) {
      selectedSources.value = [...newVal];
    }
  }
);

function onSearchInput() {
  search(searchInput.value.trim());
}

// LangResource 内部形 {lang: text} → 表示テキスト (現在言語 → ja → en → 任意 → slug)
function localizeTitle(row: PoiSourceListRow): string {
  return resolveLocalizedTitle(row.title, i18next.language) || row.slug;
}

function isSelected(sourceId: string): boolean {
  return selectedSources.value.some((s) => s.sourceId === sourceId);
}

// 行クリック = 追加。追加済みは no-op (地図選択の addMapSource と同じ。解除は右カラムの ×)。
// sourceId は uid 正準 (ADR-0007)。catalogKey は catalog 命名規約 `poi-source:${uid}` に整合
function addSource(source: PoiSourceListRow) {
  if (isSelected(source.uid)) return;
  const ref: SelectedPoiSourceRef = {
    kind: "registered-poi-source",
    sourceId: source.uid,
    catalogKey: `poi-source:${source.uid}`,
    mode: source.mode,
    cachedTitle: localizeTitle(source),
  };
  selectedSources.value.push(ref);
  emit("update:selected", [...selectedSources.value]);
}
</script>

<style scoped>
/* 検索ボックスはスクロールしても常に見えるよう sticky (AppEdit .source-pane-toolbar と同じ)。
   スクロールコンテナは親 (PoiReferenceEditor の .source-pane) 側 */
.poi-source-toolbar {
  position: sticky;
  top: 0;
  z-index: 2;
  background: #fff;
}
.source-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 0;
}
/* AppEdit 地図選択の .source-row と同じ行構成 (48px サムネイル枠 + テキスト)。
   POI にサムネイルは無いためピン印 + 末尾に mode/追加済みバッジを置く */
.source-row {
  display: grid;
  grid-template-columns: 48px 1fr auto;
  align-items: center;
  gap: 8px;
  width: 100%;
  border: 1px solid var(--bs-border-color);
  background: #fff;
  border-radius: 4px;
  padding: 6px;
  text-align: left;
}
.source-row-icon {
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.4rem;
  background: #f8f9fa;
  border: 1px solid var(--bs-border-color);
}
.source-row-selected {
  border-color: #0d6efd;
  background: rgba(13, 110, 253, 0.06);
}
.min-width-0 {
  min-width: 0;
}
</style>
