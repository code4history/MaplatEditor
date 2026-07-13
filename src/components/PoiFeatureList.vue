<template>
  <!-- feature 一覧 (Phase 4 Task 8, 仕様 §3.3 POI-127/128)。
       フィルタ (表示 ID / name / desc、全言語 lowercase 部分一致) + 自前の固定行高 windowing。
       行クリック / 新規作成は emit のみで、選択書き込み・pan・addFeature は PoiEdit が担う -->
  <div class="poi-feature-list d-flex flex-column">
    <div class="d-flex align-items-center gap-1 px-2 py-1 border-top border-bottom flex-shrink-0">
      <input
        v-model="filterText"
        type="search"
        class="form-control form-control-sm"
        :placeholder="t('poiedit.filter_placeholder')"
        :aria-label="t('poiedit.filter_placeholder')"
      />
      <!-- feature 数とフィルタ後件数 (例 "12 / 244") -->
      <span class="text-muted small text-nowrap">
        {{ t("poiedit.feature_count", { filtered: filteredRows.length, total: allRows.length }) }}
      </span>
      <!-- 新規作成 (地図中央に配置 + フォームフォーカスは PoiEdit の mapSession 経由)。
           ReadOnly では非表示 -->
      <button
        v-if="!readOnly"
        type="button"
        class="btn btn-sm btn-outline-primary text-nowrap"
        @click="emit('create')"
      >
        {{ t("poiedit.add_poi") }}
      </button>
    </div>
    <!-- windowing スクロールコンテナ: 可視範囲 + overscan の行だけ DOM 化し、
         上下は spacer div で全体高さを確保する (数千 feature でも DOM が肥大しない) -->
    <div ref="scroller" class="flex-grow-1 overflow-auto" @scroll="onScroll">
      <div :style="{ height: `${topSpacerHeight}px` }"></div>
      <div
        v-for="row in visibleRows"
        :key="row.uid"
        class="poi-feature-row d-flex align-items-center gap-2 px-2"
        :class="{ 'poi-feature-row-selected': row.uid === session.selectedUid.value }"
        role="button"
        @click="emit('select', row.uid)"
      >
        <span class="poi-feature-row-id text-truncate">{{ row.displayId }}</span>
        <span class="flex-grow-1 text-truncate">{{ row.name }}</span>
        <span class="poi-feature-row-coords text-muted text-nowrap">{{ row.coords }}</span>
      </div>
      <div :style="{ height: `${bottomSpacerHeight}px` }"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
// POI feature 一覧 (Phase 4 Task 8, 仕様 §3.3)。
// - フィルタ: 表示 ID / name / desc を対象に全言語の値 (LangResource は string と
//   Record 双方) を lowercase 部分一致。表示のみで session 状態には影響しない。
// - windowing: 依存追加なしの自前実装。固定行高 ROW_HEIGHT、scrollTop から可視 slice +
//   OVERSCAN 行を v-for し、上下 spacer div で総高さを確保する。
// - 選択同期 (POI-127/128): selectedUid の外部変化 (地図クリック等) で該当行を
//   ハイライトし、可視範囲外のときのみ scroll-to-selected (フィルタで非表示なら何もしない)。
// - 行クリック (選択 + pan) と新規作成 (地図中央 addFeature + フォームフォーカス) の実行
//   責務は PoiEdit 側に置き、本コンポーネントは emit するだけ。
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useTranslation } from "i18next-vue";
import { localizeTitle } from "../utils/langResource";
import type { PoiEditSession } from "../composables/usePoiEditSession";
import type { LangCode } from "../utils/editorLanguages";

const props = defineProps<{
  session: PoiEditSession;
  readOnly: boolean;
  activeLang: LangCode;
}>();

const emit = defineEmits<{
  (e: "select", uid: string): void;
  (e: "create"): void;
}>();

const { t } = useTranslation();
// session は PoiEdit が一度だけ生成する不変オブジェクト (中の ref がリアクティブ)
const session = props.session;

// 固定行高 (px)。CSS の .poi-feature-row height と一致させること
const ROW_HEIGHT = 32;
// 可視範囲の上下に余分にレンダリングする行数 (スクロール中の空白防止)
const OVERSCAN = 10;

const filterText = ref("");

interface FeatureRow {
  uid: string;
  displayId: string;
  /** 現在言語で解決した name (localizeTitle) */
  name: string;
  /** 座標概略 (lon, lat 4 桁) */
  coords: string;
  /** フィルタ対象 (表示 ID + name/desc の全言語値) の lowercase 連結 */
  searchText: string;
}

// LangResource (交換形 string / 内部形 Record) の全言語値を配列で返す
const langValues = (value: unknown): string[] => {
  if (typeof value === "string") return [value];
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return Object.values(value as Record<string, unknown>).filter(
      (v): v is string => typeof v === "string",
    );
  }
  return [];
};

const coordSummary = (coords: unknown): string => {
  if (!Array.isArray(coords) || coords.length < 2) return "";
  const [lon, lat] = coords as number[];
  if (typeof lon !== "number" || typeof lat !== "number") return "";
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return "";
  return `${lon.toFixed(4)}, ${lat.toFixed(4)}`;
};

// snapshot (shallowRef 差し替え) と表示言語の変化でのみ再構築される
const allRows = computed<FeatureRow[]>(() => {
  const state = session.state.value;
  if (!state) return [];
  const lang = props.activeLang;
  return state.features.flatMap((feature) => {
    const uid = feature.properties?._maplatUid;
    if (typeof uid !== "string") return [];
    const displayId = typeof feature.id === "string" ? feature.id : String(feature.id ?? "");
    const name = localizeTitle(
      feature.properties?.name as string | Record<string, string> | undefined,
      lang,
    );
    const searchText = [
      displayId,
      ...langValues(feature.properties?.name),
      ...langValues(feature.properties?.desc),
    ]
      .join("\n")
      .toLowerCase();
    return [
      {
        uid,
        displayId,
        name,
        coords: coordSummary(feature.geometry?.coordinates),
        searchText,
      },
    ];
  });
});

// フィルタは表示のみ (session 状態に影響しない)
const filteredRows = computed<FeatureRow[]>(() => {
  const query = filterText.value.trim().toLowerCase();
  if (query === "") return allRows.value;
  return allRows.value.filter((row) => row.searchText.includes(query));
});

// --- windowing (scrollTop + viewport 高さ → 可視 index 範囲) ---
const scroller = ref<HTMLElement | null>(null);
const scrollTop = ref(0);
const viewportHeight = ref(0);
let resizeObserver: ResizeObserver | null = null;

const onScroll = (): void => {
  scrollTop.value = scroller.value?.scrollTop ?? 0;
};

const startIndex = computed(() =>
  Math.max(0, Math.floor(scrollTop.value / ROW_HEIGHT) - OVERSCAN),
);
const endIndex = computed(() =>
  Math.min(
    filteredRows.value.length,
    Math.ceil((scrollTop.value + viewportHeight.value) / ROW_HEIGHT) + OVERSCAN,
  ),
);
const visibleRows = computed(() =>
  filteredRows.value.slice(startIndex.value, endIndex.value),
);
const topSpacerHeight = computed(() => startIndex.value * ROW_HEIGHT);
const bottomSpacerHeight = computed(
  () => (filteredRows.value.length - endIndex.value) * ROW_HEIGHT,
);

// --- scroll-to-selected (POI-128): 可視範囲外のときのみスクロール。
// フィルタで非表示 (filteredRows に無い) の場合はスクロールしない ---
const scrollToSelected = (uid: string): void => {
  const el = scroller.value;
  if (!el) return;
  const index = filteredRows.value.findIndex((row) => row.uid === uid);
  if (index < 0) return;
  const rowTop = index * ROW_HEIGHT;
  const rowBottom = rowTop + ROW_HEIGHT;
  const viewTop = el.scrollTop;
  const viewBottom = viewTop + el.clientHeight;
  if (rowTop < viewTop) {
    el.scrollTop = rowTop;
  } else if (rowBottom > viewBottom) {
    el.scrollTop = rowBottom - el.clientHeight;
  } else {
    return; // 可視範囲内: スクロールしない
  }
  // scroll イベントを待たず windowing を即時追随させる
  scrollTop.value = el.scrollTop;
};

// 地図クリック等の外部変化にも追随 (行クリック時は既に可視なので no-op)
watch(session.selectedUid, (uid) => {
  if (uid) scrollToSelected(uid);
});

onMounted(() => {
  viewportHeight.value = scroller.value?.clientHeight ?? 0;
  resizeObserver = new ResizeObserver(() => {
    viewportHeight.value = scroller.value?.clientHeight ?? 0;
  });
  if (scroller.value) resizeObserver.observe(scroller.value);
  // マウント時に選択済みなら初期位置を合わせる (ソース再読込後など)
  const uid = session.selectedUid.value;
  if (uid) scrollToSelected(uid);
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
});
</script>

<style scoped>
.poi-feature-list {
  font-size: 0.8125rem;
  min-height: 0;
}

/* 固定行高 (script 側 ROW_HEIGHT と一致させること) */
.poi-feature-row {
  height: 32px;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
}

.poi-feature-row:hover {
  background-color: rgba(0, 0, 0, 0.05);
}

.poi-feature-row-selected,
.poi-feature-row-selected:hover {
  background-color: #cfe2ff;
}

.poi-feature-row-id {
  flex: 0 0 auto;
  max-width: 7em;
  font-family: var(--bs-font-monospace);
}

.poi-feature-row-coords {
  font-size: 0.75rem;
}
</style>
