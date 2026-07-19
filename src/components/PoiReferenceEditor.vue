<template>
  <!-- 「POIデータ」タブ本体。AppEdit の地図選択タブ (sources) と同じ2カラム設計:
       左 = 検索付き POI ソース一覧 (ResourceSelectorList)、右 = 選択済み参照のカード列
       (pois 配列の順番どおり = viewer の layer 順)。参照要素は ↑/↓/× + 上書き
       icon/selectedIcon、生 URL/FC 要素は「外部データ」カードとして 表示 + ↑/↓/× のみ
       (編集 UI は作らない — Phase 8 設計コントラクト) -->
  <ResourceSelector>
    <template #list>
      <div
        class="source-pane-body"
        :class="{ 'poi-selector-disabled': readOnly }"
        :aria-disabled="readOnly"
      >
        <ResourceSelectorList
          v-model:query="poiSearchQuery"
          :adapter="poiSourceAdapter"
          :placeholder="t('poiref.search_placeholder')"
          :spatial-context="spatialContext"
          @toggle-spatial-context="emit('toggle-spatial-context')"
        >
          <template #range-filter>
            <slot name="range-filter"></slot>
          </template>
          <template #item="{ item }">
            <ResourceMasterRow
              :item="asResourceListRowFromPoiSource(item)"
              kind="poi-source"
              variant="selector"
              :disabled="readOnly"
              @select="addPoiSource(item)"
            />
          </template>
        </ResourceSelectorList>
      </div>
    </template>

    <template #selected>
      <h5>{{ t(headingKey ?? "poiref.selected_list_app") }}</h5>
      <div v-if="entries.length === 0" class="text-muted py-3">{{ t("poiref.empty") }}</div>
      <div v-else class="selected-list">
        <div
          v-for="(entry, index) in entries"
          :key="entryKey(entry, index)"
          class="selected-source border rounded p-2 mb-2"
          :class="{ 'border-warning bg-warning-subtle': isMissing(entry) }"
        >
          <div class="d-flex align-items-center justify-content-between gap-2">
            <div class="min-width-0">
              <div class="fw-bold text-break">
                <span v-if="poiUidOf(entry) === null" class="badge text-bg-secondary me-1">
                  {{ t("poiref.external_data") }}
                </span>
                {{ entryTitle(entry) }}
              </div>
              <small v-if="poiUidOf(entry) !== null" class="text-muted text-break">
                {{ entrySubLabel(entry) }}
              </small>
              <div v-if="isMissing(entry)" class="small text-warning-emphasis">
                {{ t("poiref.missing_source") }}
              </div>
            </div>
            <div class="btn-group btn-group-sm flex-shrink-0">
              <button
                type="button"
                class="btn btn-outline-secondary"
                :disabled="readOnly || index === 0"
                :title="t('poiref.move_up')"
                @click="move(index, -1)"
              >↑</button>
              <button
                type="button"
                class="btn btn-outline-secondary"
                :disabled="readOnly || index === entries.length - 1"
                :title="t('poiref.move_down')"
                @click="move(index, 1)"
              >↓</button>
              <button
                type="button"
                class="btn btn-outline-danger"
                :disabled="readOnly"
                :title="poiUidOf(entry) === null ? t('poiref.delete') : t('poiref.remove')"
                @click="removeAt(index)"
              >×</button>
            </div>
          </div>
          <div v-if="poiUidOf(entry) !== null" class="row g-2 mt-1">
            <div class="col-12">
              <label class="form-label small mb-0">{{ t("poiref.override_title") }}</label>
              <LangResourceInput
                :model-value="titleOverride(entry)"
                :disabled="readOnly"
                :active-lang="activeLang"
                :default-lang="defaultLang"
                :language-options="languageOptions"
                @select-language="emit('select-language', $event)"
                @update:model-value="setTitleOverride(index, $event)"
              />
            </div>
            <div class="col-md-6">
              <IconRefField
                ref="iconFieldRefs"
                :label="t('poiref.icon_override')"
                :model-value="overrideValue(entry, 'icon')"
                :read-only="readOnly"
                @update:model-value="setOverride(index, 'icon', $event)"
              />
            </div>
            <div class="col-md-6">
              <IconRefField
                ref="selectedIconFieldRefs"
                :label="t('poiref.selected_icon_override')"
                :model-value="overrideValue(entry, 'selectedIcon')"
                :read-only="readOnly"
                @update:model-value="setOverride(index, 'selectedIcon', $event)"
              />
            </div>
          </div>
          <div v-else class="form-text small mb-0">{{ t("poiref.external_note") }}</div>
        </div>
      </div>
    </template>
  </ResourceSelector>
</template>

<script setup lang="ts">
// 「POIデータ」タブの本体 (Phase 8 Task 2/5, 43 §2.4)。AppEdit (appData.pois) と
// MapEdit (mapData.pois) の両方から使う。真実の器は呼び出し側の pois 配列 1 つで、
// 本コンポーネントは配列ごと差し替えの update:pois を emit するだけ (履歴記録は呼び出し側:
// AppEdit = recordHistory 明示 / MapEdit = mapData の deep-watch)。
// 参照要素判定・selector との往復は共有 util (utils/poiReferenceUi)。
import { computed, ref, watch } from "vue";
import { useTranslation } from "i18next-vue";
import ResourceSelectorList from "./ResourceSelectorList.vue";
import IconRefField from "./IconRefField.vue";
import ResourceSelector from "./ResourceSelector.vue";
import ResourceMasterRow from "./resource-list/ResourceMasterRow.vue";
import LangResourceInput from "./LangResourceInput.vue";
import type { SelectedPoiSourceRef } from "../services/registeredPoiSourceCatalog";
import { poiUidOf, extractPoiRefs, applyPoiSelection } from "../utils/poiReferenceUi";
import { localizeTitle, type LangResource } from "../utils/langResource";
import type { LangCode } from "../utils/editorLanguages";
import type { PoiSourceListRow } from "../electron";
import type { ResourceListItemViewModel, SelectorSpatialContextView } from "./resource-list/resourceListTypes";
import { createPoiSourceListAdapter } from "../views/resource-adapters/poiSourceListAdapter";

const props = defineProps<{
  pois?: unknown[];
  readOnly?: boolean;
  activeLang: LangCode;
  defaultLang: LangCode;
  languageOptions: readonly { code: LangCode; nativeName: string }[];
  // 右カラム見出しの i18n キー。App=「このアプリのPOIデータ一覧」/ Map=「この地図のPOIデータ一覧」
  headingKey?: string;
  spatialContext?: SelectorSpatialContextView;
}>();

const emit = defineEmits<{
  "update:pois": [value: unknown[]];
  "select-language": [value: LangCode];
  "toggle-spatial-context": [];
}>();

const { t } = useTranslation();
const poiSearchQuery = ref("");
const poiSourceAdapter = createPoiSourceListAdapter({
  hasDraft: () => false,
  selectedUid: () => null,
  featuresLabel: (count) => `${count} ${t("poisource.features")}`,
  localLabel: t("poisource.local"),
  remoteLabel: t("poisource.remote"),
});

const entries = computed<unknown[]>(() => (Array.isArray(props.pois) ? props.pois : []));

// selector の選択集合は pois 配列から復元 (書き戻し由来の変化は selector 側 prop watch が吸収)
const selectedRefs = computed<SelectedPoiSourceRef[]>(() => extractPoiRefs(entries.value));
const isPoiSelected = (uid: string) => selectedRefs.value.some((item) => item.sourceId === uid);
const poiSourceTitle = (item: PoiSourceListRow) => localizeTitle(item.title, props.activeLang) || item.slug;

// M12-T10 v2.0: selector 左ペインの行を ResourceMasterRow へ統一。
// HM6: 追加済み（isPoiSelected）=selected=true（青）。readOnly は disabled。
function asResourceListRowFromPoiSource(item: PoiSourceListRow): ResourceListItemViewModel {
  const added = isPoiSelected(item.uid);
  return {
    uid: item.uid,
    slug: item.slug,
    title: poiSourceTitle(item),
    thumbnailUrl: null,
    metadata: [],
    badges: [],
    selected: added,
    hasDraft: false,
    actions: [],
  };
}

function addPoiSource(item: PoiSourceListRow): void {
  if (props.readOnly || isPoiSelected(item.uid)) return;
  onSelectionChange([...selectedRefs.value, {
    kind: "registered-poi-source",
    sourceId: item.uid,
    catalogKey: item.uid,
    mode: item.mode,
    cachedTitle: item.title,
  }]);
}

// 参照は uid ベースの key で並べ替え時の要素同一性を保つ (MINOR-2: key に index を含めると
// 並べ替えのたびに IconRefField が remount され、未確定入力が失われる)。同一 uid の重複参照
// (旧データであり得る) は「その uid が配列内で何番目の出現か」(occurrence) を併記して key の
// 衝突を避ける — occurrence は uid 自体の相対順が変わらない限り並べ替えでも安定する。
// 生要素 (uid なし) は同一性を判定する術がないため位置 key のまま (index)
function entryKey(entry: unknown, index: number): string {
  const uid = poiUidOf(entry);
  if (!uid) return `raw:${index}`;
  let occurrence = 0;
  for (let i = 0; i < index; i++) {
    if (poiUidOf(entries.value[i]) === uid) occurrence++;
  }
  return `ref:${uid}#${occurrence}`;
}

// 行タイトル: 参照 = 上書き title (D1、あれば localizeTitle 解決) → cachedTitle → uid、
// 外部データ = URL 文字列 or FC の name/id
function entryTitle(entry: unknown): string {
  const uid = poiUidOf(entry);
  if (uid) {
    const record = entry as Record<string, unknown>;
    const overridden = localizeTitle(record.title as LangResource | undefined, props.activeLang);
    if (overridden) return overridden;
    return localizeTitle(record.cachedTitle as LangResource | undefined, props.activeLang) || uid;
  }
  if (typeof entry === "string") return entry;
  if (entry && typeof entry === "object" && !Array.isArray(entry)) {
    const record = entry as Record<string, unknown>;
    if (typeof record.name === "string" && record.name) return record.name;
    if (typeof record.id === "string" && record.id) return record.id;
  }
  return t("poiref.external_data");
}

// カード副行 (地図選択の sourceIdLabel = slug表示 に対応)。参照要素の slug は pois 配列に
// 保存されない (永続形は {poiUid, cachedTitle} 最小) ため、表示専用に poiSources.get で
// 遅延解決してキャッシュする。解決前/失敗 (削除済みソース等) は uid をそのまま出す
const slugByUid = ref<Record<string, string>>({});

// not-found 確定の参照 uid 集合 (D4)。poiSources.get は IPC 成功 + 見つからない時に null を
// 返す (PoiSourceService.get) — これで削除済みソースと判定し、カードを警告表示にする。
// IPC 一時失敗 (reject) は unknown のまま = 警告にしない (ベストエフォート表示)
const missingByUid = ref<Record<string, boolean>>({});

watch(
  selectedRefs,
  (refs) => {
    for (const item of refs) {
      const uid = item.sourceId;
      if (uid in slugByUid.value) continue;
      slugByUid.value[uid] = ""; // 取得中マーカー (再要求防止)
      window.poiSources
        .get(uid)
        .then((detail) => {
          if (detail?.slug) slugByUid.value[uid] = detail.slug;
          missingByUid.value[uid] = detail == null; // null = not-found 確定 (削除済み)
        })
        .catch(() => {
          // 解決失敗 (IPC 一時失敗) は uid フォールバック表示のまま (not-found 扱いにしない)
        });
    }
  },
  { immediate: true },
);

function isMissing(entry: unknown): boolean {
  const uid = poiUidOf(entry);
  return uid !== null && missingByUid.value[uid] === true;
}

function entrySubLabel(entry: unknown): string {
  const uid = poiUidOf(entry);
  if (!uid) return "";
  return slugByUid.value[uid] || uid;
}

// 上書きタイトル (D1) の現在値。LangResource (string | {lang: text}) 以外は未設定扱い
function titleOverride(entry: unknown): string | Record<string, string> | undefined {
  const value = (entry as Record<string, unknown>).title;
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, string>;
  }
  return undefined;
}

// 上書きタイトルの確定 (LangResourceInput の update:modelValue = blur 確定時のみ)。
// 空 (空文字/空 object/空白のみ) は上書き解除 = title キーごと削除 (setOverride と同じ流儀)
function setTitleOverride(
  index: number,
  raw: string | Record<string, string> | undefined,
): void {
  const current = entries.value[index];
  if (!current || typeof current !== "object" || Array.isArray(current)) return;
  const record = current as Record<string, unknown>;
  const cleared =
    raw === undefined ||
    (typeof raw === "string" && raw.trim() === "") ||
    (typeof raw === "object" && Object.keys(raw).length === 0);
  const value = cleared ? undefined : raw;
  if (JSON.stringify(record.title ?? null) === JSON.stringify(value ?? null)) return;
  const updated: Record<string, unknown> = { ...record };
  if (value === undefined) {
    delete updated.title;
  } else {
    updated.title = value;
  }
  const next = [...entries.value];
  next[index] = updated;
  emit("update:pois", next);
}

function overrideValue(entry: unknown, key: "icon" | "selectedIcon"): string {
  const value = (entry as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
}

function move(index: number, delta: number): void {
  const target = index + delta;
  if (target < 0 || target >= entries.value.length) return;
  const next = [...entries.value];
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item);
  emit("update:pois", next);
}

function removeAt(index: number): void {
  const next = [...entries.value];
  next.splice(index, 1);
  emit("update:pois", next);
}

// 上書き icon/selectedIcon の確定 (IconRefField の update:modelValue)。
// 空 (クリア/空白のみ) はキーごと削除し、参照要素の最小形 {poiUid, cachedTitle} に戻す
function setOverride(index: number, key: "icon" | "selectedIcon", raw: string): void {
  const current = entries.value[index];
  if (!current || typeof current !== "object" || Array.isArray(current)) return;
  const value = raw.trim();
  const record = current as Record<string, unknown>;
  if ((record[key] ?? "") === value || (!value && record[key] === undefined)) return;
  const updated: Record<string, unknown> = { ...record };
  if (value) {
    updated[key] = value;
  } else {
    delete updated[key];
  }
  const next = [...entries.value];
  next[index] = updated;
  emit("update:pois", next);
}

// selector の選択変更 (行クリックによる追加) を pois 配列へ反映。
// 既存参照の相対順と上書きキーは applyPoiSelection が温存する
function onSelectionChange(refs: SelectedPoiSourceRef[]): void {
  emit("update:pois", applyPoiSelection(entries.value, refs));
}

// picker 表示中かどうか (Phase 8 品質レビュー MAJOR-1: MapEdit がグローバルキー
// (undo/redo/menu:undo/redo) を picker 表示中は抑止するために参照する)。参照行数ぶんの
// IconRefField (icon/selectedIcon 上書き、行ごとに2個 = 2N) を v-for 内の template ref で
// 配列収集し、いずれか1つでも picker 表示中なら true とする
const iconFieldRefs = ref<InstanceType<typeof IconRefField>[]>([]);
const selectedIconFieldRefs = ref<InstanceType<typeof IconRefField>[]>([]);
const pickerOpen = computed(
  () =>
    iconFieldRefs.value.some((field) => field?.pickerOpen) ||
    selectedIconFieldRefs.value.some((field) => field?.pickerOpen),
);

defineExpose({ pickerOpen });
</script>

<style scoped>
/* 2カラムグリッドは ResourceSelector が提供 */
.source-pane-body {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: auto;
}
.min-width-0 {
  min-width: 0;
}
/* readOnly 中は selector 操作を止める */
.poi-selector-disabled {
  pointer-events: none;
  opacity: 0.5;
}
</style>
