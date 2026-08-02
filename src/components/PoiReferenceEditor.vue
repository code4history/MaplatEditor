<template>
  <!-- 「POIデータ」タブ本体。AppEdit の地図選択タブ (sources) と同じ2カラム設計:
       左 = 検索付き POI ソース一覧 (ResourceSelectorList)、右 = 選択済み参照のカード列
       (pois 配列の順番どおり = viewer の layer 順)。参照要素は ↑/↓/× + 上書き
       icon/selectedIcon、生 URL/FC 要素は「外部データ」カードとして 表示 + ↑/↓/× のみ
       (編集 UI は作らない — Phase 8 設計コントラクト) -->
  <ResourceSelector>
    <template #list>
      <!-- M3-T6 §5.3: 非参照要素 (object / URL 文字列 / junk) が残る間は追加を無効化する
           相互排他制約 (入口ガード)。全非参照要素の削除で computed が自動再有効化する -->
      <div
        class="source-pane-body"
        :class="{ 'poi-selector-disabled': readOnly || hasNonReferenceEntries }"
        :aria-disabled="readOnly || hasNonReferenceEntries"
      >
        <ResourceSelectorList
          v-model:query="poiSearchQuery"
          :adapter="poiSourceAdapter"
          :placeholder="t('poiref.search_placeholder')"
          :spatial-context="spatialContext"
          @toggle-spatial-context="emit('toggle-spatial-context')"
        >
          <template v-if="hasRangeFilterSlot" #range-filter>
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
      <h5 class="d-flex align-items-center gap-1">
        <span>{{ t(headingKey ?? "poiref.selected_list_app") }}</span>
        <!-- M3-T6 §5.3: 相互排他制約の理由提示 (m12-t11 の (i) ボタン文法) -->
        <ContextHelp
          v-if="hasNonReferenceEntries"
          :text="t('poiref.add_blocked_note')"
          :ariaLabel="t('poiref.add_blocked_note')"
        />
      </h5>
      <!-- M3-T6 §5.4: 変換フィードバック (タブ内 DiagnosticFeedback — AppEdit poi_format_unsupported と同文法) -->
      <DiagnosticFeedback
        v-if="convertFeedback"
        scope="section"
        class="mb-2"
        :items="[{ key: 'inline-convert', severity: convertFeedback.severity, message: convertFeedback.message }]"
      />
      <ResourceEmptyState
        v-if="entries.length === 0"
        icon-class="bi bi-geo-alt"
        :message="t('poiref.empty')"
      />
      <!-- M3-T6 §4.2/§5.4 (v1.2): ペインはレイヤ単位 (viewer 正本 normalize_pois.ts の先頭要素
           判別に対応)。単層 (C4/C5/C7)・indeterminate (C6) = 配列全体で 1 枚のレイヤペイン
           (ヘッダに変換ボタン 1 個)、複層 (C2a/C2b/C3) = 要素ごとに 1 カード。
           変換ボタンは常に「1 レイヤに 1 個」— 一括 + 個別の二重構造は置かない -->
      <div
        v-else
        :class="layerMode === 'multi' ? undefined : 'poiref-layer-pane border rounded p-2 mb-2'"
        :data-testid="layerMode === 'multi' ? undefined : 'poiref-layer-pane'"
      >
        <!-- 単層レイヤペインのヘッダ: レイヤ変換 (配列全体をまとめて 1 FC = 1 ドラフト — §4.4) -->
        <div v-if="layerMode !== 'multi' && hostSlug" class="d-flex align-items-center gap-1 mb-2">
          <button
            type="button"
            class="btn btn-sm btn-outline-primary"
            data-testid="poiref-convert-group"
            :disabled="readOnly || converting || !canConvertLayer"
            @click="convertGroup"
          >{{ t("poiref.convert_group_action", { count: entries.length }) }}</button>
          <!-- 変換不可の理由と整理手順 (§4.4: 生 FC・参照・URL・非 UUID poiUid・junk 含みは disabled) -->
          <ContextHelp
            v-if="!canConvertLayer"
            :text="t('poiref.convert_blocked_note')"
            :ariaLabel="t('poiref.convert_blocked_note')"
          />
        </div>
        <!-- 混在警告 (単層・indeterminate = ペイン上部)。表示可否は共有述語 isMixedLayer のみで
             決まる (mode ゲートなし — §5.4 v1.3。判定は resolver 警告と同一実装 §5.10) -->
        <div
          v-if="layerMode !== 'multi' && isMixedLayer"
          class="small text-warning-emphasis mb-2"
          data-testid="poiref-mixed-warning"
        >{{ t("poiref.mixed_layer_warning") }}</div>
        <div class="selected-list">
        <div
          v-for="(entry, index) in entries"
          :key="entryKey(entry, index)"
          class="selected-source border rounded p-2 mb-2"
          :class="{ 'border-warning bg-warning-subtle': isMissing(entry) }"
        >
          <div class="d-flex align-items-center justify-content-between gap-2">
            <div class="min-width-0">
              <div class="fw-bold text-break">
                <!-- M3-T6 §5.11: バッジ 2 種 (inline 要素 = 地図内定義POI / URL 文字列 = 外部URL参照。
                     junk は inline 側帰属 — 第 3 バッジは増やさない) -->
                <span v-if="poiUidOf(entry) === null" class="badge text-bg-secondary me-1">
                  {{ entryBadgeLabel(entry) }}
                </span>
                {{ entryTitle(entry) }}
              </div>
              <small v-if="poiUidOf(entry) !== null" class="text-muted text-break">
                {{ entrySubLabel(entry) }}
              </small>
              <!-- M3-T6 §5.1: 外部データカードの項目数副行 (FC=feature数 / 旧オブジェクト・生Feature・
                   非UUID poiUid=1 / URL 文字列・junk=非表示)。中身確認 UI はこれ以上追加しない -->
              <small
                v-else-if="entryItemCountLabel(entry) !== null"
                class="text-muted text-break d-block"
                data-testid="poiref-item-count"
              >
                {{ entryItemCountLabel(entry) }}
              </small>
              <div v-if="isMissing(entry)" class="small text-warning-emphasis">
                {{ t("poiref.missing_source") }}
              </div>
              <!-- 混在警告 (複層 = 壊れ要素 (非 FC object) カード内 — §5.4 C3)。
                   表示可否は共有述語 isMixedLayer のみ・位置だけがモードによる表示設計 -->
              <div
                v-if="layerMode === 'multi' && isMixedLayer && entryShapes[index] === 'object'"
                class="small text-warning-emphasis"
                data-testid="poiref-mixed-warning"
              >{{ t("poiref.mixed_layer_warning") }}</div>
              <!-- M3-T6 §4.2/§5.4 (v1.3): 複層モード index>=1 の key (id/properties.id) 欠落
                   生メンバーへの viewer-fatal 注記 (normalize_pois.ts:31-33 throw = POI 全損) -->
              <div
                v-if="showsLayerKeyMissing(entry, index)"
                class="small text-warning-emphasis"
                data-testid="poiref-key-missing"
              >{{ t("poiref.layer_key_missing_warning") }}</div>
            </div>
            <div class="btn-group btn-group-sm flex-shrink-0">
              <!-- M3-T6 §5.4 (v1.2): 複層モードの生 FC カード = 1 レイヤの変換
                   (layerMeta round-trip 保持)。表示条件は「複層モードの生 FC 要素」に限定 -->
              <button
                v-if="layerMode === 'multi' && hostSlug && isRawFcEntry(entry)"
                type="button"
                class="btn btn-outline-primary"
                data-testid="poiref-convert-fc"
                :disabled="readOnly || converting"
                :title="t('poiref.convert_action')"
                @click="convertFcEntry(index)"
              >{{ t("poiref.convert_action") }}</button>
              <!-- M4-T4 §5.5: 裸 URL 要素 (U4) に上書きを付ける。要素を {layer: URL} へ
                   置き換えるだけで acceptsOverride が真になり、上書き編集ブロックが開く -->
              <button
                v-if="showsAddOverride(entry)"
                type="button"
                class="btn btn-outline-primary"
                data-testid="poiref-add-override"
                :disabled="readOnly"
                :title="t('poiref.add_override')"
                @click="addOverrideWrapper(index)"
              >{{ t("poiref.add_override") }}</button>
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
              <!-- M3-T6 §5.5: 非参照要素の × は削除確認へ (参照解除は現行どおり確認なし) -->
              <button
                type="button"
                class="btn btn-outline-danger"
                :disabled="readOnly"
                :title="poiUidOf(entry) === null ? t('poiref.delete') : t('poiref.remove')"
                @click="requestRemove(index)"
              >×</button>
            </div>
          </div>
          <div v-if="acceptsOverride(entry)" class="row g-2 mt-1">
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
            <!-- M18-T1: 表示文脈ごとの hide 上書き (参照単位)。POI ソース自体は変更せず、
                 この地図/アプリで開いたときの既定表示だけを非表示にする。2状態
                 (ON = hide:true をセット / OFF = キーごと削除。false は書かない) -->
            <div class="col-12">
              <div class="form-check" data-testid="poiref-hide-override">
                <input
                  :id="`poiref-hide-${index}`"
                  class="form-check-input"
                  type="checkbox"
                  :checked="hideOverride(entry)"
                  :disabled="readOnly"
                  @change="setHideOverride(index, ($event.target as HTMLInputElement).checked)"
                >
                <label class="form-check-label small" :for="`poiref-hide-${index}`">
                  {{ t("poiref.hide_override") }}
                </label>
                <ContextHelp :text="t('poiref.hide_override_note')" :ariaLabel="t('poiref.hide_override_note')" />
              </div>
            </div>
          </div>
          <!-- 非参照メンバー行の注記 (M12-T11/R1 の (i) ボタン文法。§5.11: バッジ種別で
               inline_note / external_url_note を出し分け) -->
          <div v-else class="mb-0"><ContextHelp :text="t(entryNoteKey(entry))" :ariaLabel="t(entryNoteKey(entry))" /></div>
        </div>
        </div>
      </div>
      <!-- M3-T6 §5.5: 非参照要素の削除確認 (DeleteConfirmDialog 再利用 + body 差し替え。
           inline 要素は index キー・backend 副作用なしのため useResourceDelete (uid 契約) は使わない) -->
      <DeleteConfirmDialog
        :visible="deleteConfirm.visible"
        :title="deleteConfirm.title"
        :references="[]"
        :deleting="false"
        :body="t('poiref.delete_external_body')"
        @confirm="confirmRemove"
        @cancel="deleteConfirm.visible = false"
      />
    </template>
  </ResourceSelector>
</template>

<script setup lang="ts">
// 「POIデータ」タブの本体 (Phase 8 Task 2/5, 43 §2.4)。AppEdit (appData.pois) と
// MapEdit (mapData.pois) の両方から使う。真実の器は呼び出し側の pois 配列 1 つで、
// 本コンポーネントは配列ごと差し替えの update:pois を emit するだけ (履歴記録は呼び出し側:
// AppEdit = recordHistory 明示 / MapEdit = mapData の deep-watch)。
// 参照要素判定・selector との往復は共有 util (utils/poiReferenceUi)。
import { computed, ref, useSlots, watch } from "vue";
import { useTranslation } from "i18next-vue";
import ResourceSelectorList from "./ResourceSelectorList.vue";
import IconRefField from "./IconRefField.vue";
import ResourceSelector from "./ResourceSelector.vue";
import ResourceMasterRow from "./resource-list/ResourceMasterRow.vue";
import ResourceEmptyState from "./resource-list/ResourceEmptyState.vue";
import LangResourceInput from "./LangResourceInput.vue";
import ContextHelp from "./editor-ui/ContextHelp.vue";
import DiagnosticFeedback from "./editor-ui/DiagnosticFeedback.vue";
import DeleteConfirmDialog from "./resource-list/DeleteConfirmDialog.vue";
import type { SelectedPoiSourceRef } from "../services/registeredPoiSourceCatalog";
import { poiUidOf, extractPoiRefs, applyPoiSelection, isNonReferenceObjectEntry } from "../utils/poiReferenceUi";
import {
  poisEntryShape,
  poisLayerMode,
  isPoiLayerRef,
  hasMixedPoisShapes,
  hasPoisLayerKey,
  type PoisEntryShape,
} from "../utils/poisLayerStructure";
import { convertInlineEntriesToDraft, type InlineConvertResult } from "../utils/inlinePoiConvert";
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
  // M3-T6 §5.4: 変換 slug の基底 (map=mapID / app=appID)。未指定時は変換ボタン非表示 (後方互換)
  hostSlug?: string;
  // M3-T6 §5.4: 変換群のドラフト title 基底 (map=title / app=appName)
  hostTitle?: LangResource;
}>();

const emit = defineEmits<{
  "update:pois": [value: unknown[]];
  "select-language": [value: LangCode];
  "toggle-spatial-context": [];
}>();

const { t } = useTranslation();
const slots = useSlots();
// M12-T10 v2.0: host 側が #range-filter slot を提供した場合のみ ResourceRangeFilterButton を使い、
// 未提供時は spatial-toggle を表示（排他）。useSlots() は slot の存在判定に使える。
const hasRangeFilterSlot = computed(() => !!slots["range-filter"] && !!slots["range-filter"]());
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

// --- M3-T6: 相互排他制約・項目数・変換・削除確認 ---

// §5.3: 非参照要素 (object・URL 文字列・junk すべて — §4/§8.1 Minor-1 吸収) が 1 つでも残る間、
// GeoJSON POI ソースの追加を禁止する (入口ガード)。computed のため全削除で自動再有効化
const hasNonReferenceEntries = computed(() => entries.value.some((entry) => poiUidOf(entry) === null));

// §5.1: 項目数 (生 FC = features 数 / 旧オブジェクト・生 Feature・非 UUID poiUid = 1 /
// URL 文字列・junk = null 非表示 — 項目数の概念が成立しないため。v1.1 Minor-2)
function entryItemCount(entry: unknown): number | null {
  if (poiUidOf(entry) !== null) return null;
  // M4-T4: 上書きレイヤの項目数は参照先の中身。URL 参照は静的には数えられないので非表示
  // （裸 URL 文字列と同じ扱い）、FC を包むラッパーは中身の feature 数を出す
  if (isPoiLayerRef(entry)) {
    const layer = (entry as Record<string, unknown>).layer;
    if (typeof layer === "string") return null;
    return Array.isArray((layer as Record<string, unknown>).features)
      ? ((layer as Record<string, unknown>).features as unknown[]).length
      : 0;
  }
  if (!isNonReferenceObjectEntry(entry)) return null;
  const record = entry as Record<string, unknown>;
  if (record.type === "FeatureCollection") {
    return Array.isArray(record.features) ? record.features.length : 0;
  }
  return 1;
}

// §5.1 の表示ラベル (null = 非表示。template の型 narrowing 都合で文字列化までここで行う)
function entryItemCountLabel(entry: unknown): string | null {
  const count = entryItemCount(entry);
  return count === null ? null : t("poiref.external_item_count", { count });
}

// §5.10 (v1.2/v1.3): レイヤ構造判定 — 共有述語 (poisLayerStructure = resolver 混在警告と同一実装)
// の computed 連鎖がペイン構成 (§5.4)・変換可否 (§4.4)・混在警告表示の唯一の判定源。
// 参照要素は "fc" へ写像する (resolver が FC に置換した後の形 = viewer が見る形で判別 — §4.2 前文)
// M4-T4: **上書きレイヤ (ラッパー) も同じ理由で "fc" へ写像する。** ラッパーは viewer が
// isPoiLayerRef 分岐で1レイヤとして受ける形であり (normalize_pois.ts:106-133)、生の POI
// オブジェクト (壊れ要素) ではない。素の poisEntryShape では両者とも "object" になるため、
// 写像しないと [生FC, ラッパー] が「GeoJSON形式とそれ以外の混在」と誤警告され、
// AC2 が消した viewer-fatal 誤警告と同じ種類の誤りがもう1つ残る (E2E で実測)。
const entryShapes = computed<readonly PoisEntryShape[]>(() =>
  entries.value.map((entry) =>
    poiUidOf(entry) !== null || isPoiLayerRef(entry) ? "fc" : poisEntryShape(entry),
  ),
);
const layerMode = computed(() => poisLayerMode(entryShapes.value, entries.value));
const isMixedLayer = computed(() => hasMixedPoisShapes(entryShapes.value));

// §4.4: 単層モードのレイヤ変換可能条件 = 全メンバーが旧 POI オブジェクト / 生 Feature
// (= shape "object" かつ非 UUID poiUid 温存規約の対象外)。生 FC・参照 (= shape "fc")・
// URL 文字列・junk が 1 つでも含まれると不可 (削除で整理されると computed で自動有効化)
const canConvertLayer = computed(
  () =>
    entries.value.length > 0 &&
    entries.value.every(
      (entry, index) =>
        entryShapes.value[index] === "object" && !("poiUid" in (entry as Record<string, unknown>)),
    ),
);

// §5.4 (v1.2): 複層モードの生 FC 要素 (= 1 レイヤ) 判定。参照要素は poiUidOf ≠ null で除外、
// 非 UUID poiUid object は温存規約 (§4.4) により FC 形でも変換対象外。
// v1.1 の isConvertGroupEntry / isConvertibleFcEntry (要素単位の振り分け) は撤去した
function isRawFcEntry(entry: unknown): boolean {
  if (poiUidOf(entry) !== null) return false;
  if (poisEntryShape(entry) !== "fc") return false;
  return !("poiUid" in (entry as Record<string, unknown>));
}

// §4.2/§5.4 (v1.3): 複層モード index>=1 の key (id/properties.id) 欠落生メンバー行の
// viewer-fatal 注記 (normalize_pois.ts:30-33 throw = POI 全損) の表示判定。string は fetch
// 置換後の内容が静的判定不能のため対象外。UI のみで使用 — resolver 警告契約 (AC6-7) は拡張しない
function showsLayerKeyMissing(entry: unknown, index: number): boolean {
  return (
    layerMode.value === "multi" &&
    index >= 1 &&
    poiUidOf(entry) === null &&
    poisEntryShape(entry) !== "string" &&
    // M4-T4: 上書きレイヤ (ラッパー) は viewer が isPoiLayerRef 分岐で受け、key は fetch 後の
    // 中身から決まる。∴ ラッパー自身が id を持たなくても POI 全損にはならない (誤警告の是正)
    !isPoiLayerRef(entry) &&
    !hasPoisLayerKey(entry)
  );
}

// M4-T4: 上書き4種 (title/icon/selectedIcon/hide) を編集できる要素か。
// U1 = 登録 POI ソース参照 ({poiUid}) / U2・U3 = 上書きレイヤ ({layer:…})。
// 同じ setter を共有する (恒久指示「同一扱い処理は共通実装へ徹底」) — 分岐条件だけを広げる
function acceptsOverride(entry: unknown): boolean {
  return poiUidOf(entry) !== null || isPoiLayerRef(entry);
}

// §5.11: バッジ 2 種 (string = 外部URL参照 / それ以外の非参照要素 = 地図内定義POI。
// junk は inline 側帰属 — 第 3 バッジは増やさない)
// M4-T4: 3 分類 — 上書きレイヤ = 外部ファイル参照 / 文字列 = 外部URL参照 / それ以外 = 地図内定義POI
function entryBadgeLabel(entry: unknown): string {
  if (isPoiLayerRef(entry)) return t("poiref.layer_ref");
  return typeof entry === "string" ? t("poiref.external_url") : t("poiref.inline_data");
}

// §5.11: 非参照メンバー行の注記キー (バッジと同じ object vs string の二分で出し分け)
function entryNoteKey(entry: unknown): string {
  if (isPoiLayerRef(entry)) return "poiref.layer_ref_note";
  return typeof entry === "string" ? "poiref.external_url_note" : "poiref.inline_note";
}

// §5.4: 変換フィードバック (成功/失敗) — DiagnosticFeedback で表示 (ref 代入のみ、§9)
const convertFeedback = ref<{ severity: "success" | "warning"; message: string } | null>(null);
const converting = ref(false);

function applyConvertResult(result: InlineConvertResult): void {
  if (result.ok) {
    convertFeedback.value = { severity: "success", message: t("poiref.convert_success", { slug: result.slug }) };
    return;
  }
  const key =
    result.reason === "invalid" ? "poiref.convert_invalid" :
    result.reason === "too-large" ? "poiref.convert_too_large" :
    "poiref.convert_failed"; // slug-exhausted / failed
  convertFeedback.value = { severity: "warning", message: t(key) };
}

// 変換は document を一切変更しない (update:pois を発火しない — 非破壊・可逆。§5.4)。
// 単層モードのレイヤ変換: input = メンバー全件 (= entries そのもの — §4.4 の変換可能条件により
// 全メンバーが旧オブジェクト / 生 Feature に限定済みで、v1.1 の対象フィルタは不要になった)
async function convertGroup(): Promise<void> {
  if (!props.hostSlug || props.readOnly || converting.value) return;
  if (layerMode.value === "multi" || !canConvertLayer.value) return;
  converting.value = true;
  try {
    applyConvertResult(await convertInlineEntriesToDraft({
      input: entries.value,
      hostSlug: props.hostSlug,
      hostTitle: props.hostTitle,
      lang: props.defaultLang,
    }));
  } finally {
    converting.value = false;
  }
}

// §5.4 (v1.2): 複層モードの生 FC カード = 1 レイヤの変換 (layerMeta round-trip 保持)。
// 複層モードガード付きで維持 — 単層・indeterminate ではレイヤ変換 (convertGroup) のみ
async function convertFcEntry(index: number): Promise<void> {
  const entry = entries.value[index];
  if (!props.hostSlug || props.readOnly || converting.value) return;
  if (layerMode.value !== "multi" || !isRawFcEntry(entry)) return;
  converting.value = true;
  try {
    applyConvertResult(await convertInlineEntriesToDraft({
      input: entry,
      hostSlug: props.hostSlug,
      hostTitle: props.hostTitle,
      lang: props.defaultLang,
    }));
  } finally {
    converting.value = false;
  }
}

// §5.5: 非参照要素の削除確認 (index キーの軽量ローカル state。deleting は常に false = 同期 splice)
const deleteConfirm = ref<{ visible: boolean; title: string; index: number }>({
  visible: false,
  title: "",
  index: -1,
});

function requestRemove(index: number): void {
  const entry = entries.value[index];
  if (poiUidOf(entry) !== null) {
    removeAt(index); // 参照解除は現行どおり確認なし
    return;
  }
  const count = entryItemCount(entry);
  // 項目数の併記は §5.1 の表示対象と同一規則 (URL 文字列・junk では entryTitle のみ)
  const title = count !== null
    ? `${entryTitle(entry)}（${t("poiref.external_item_count", { count })}）`
    : entryTitle(entry);
  deleteConfirm.value = {
    visible: true,
    title: t("resource_list.delete_confirm_title", { title }),
    index,
  };
}

function confirmRemove(): void {
  const { index } = deleteConfirm.value;
  deleteConfirm.value = { visible: false, title: "", index: -1 };
  removeAt(index);
}

function addPoiSource(item: PoiSourceListRow): void {
  if (props.readOnly || hasNonReferenceEntries.value || isPoiSelected(item.uid)) return;
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
  // M4-T4: 上書きレイヤは参照先そのものが同一性なので、layer の中身から題名を採る
  // (URL ならその URL、FC なら FC の name/id)。ここを飛ばすと「地図内定義POI」の
  // fallback へ落ち、バッジ (外部ファイル参照) と食い違う (E2E で実測)
  if (isPoiLayerRef(entry)) {
    const layer = (entry as Record<string, unknown>).layer;
    if (typeof layer === "string") return layer;
    entry = layer;
  }
  if (entry && typeof entry === "object" && !Array.isArray(entry)) {
    const record = entry as Record<string, unknown>;
    if (typeof record.name === "string" && record.name) return record.name;
    if (typeof record.id === "string" && record.id) return record.id;
  }
  // §5.11: name/id を持たない非参照 object のタイトル fallback (旧 external_data → inline_data)
  return t("poiref.inline_data");
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

// M4-T4 §5.5: 裸 URL (U4) は上書きを載せる場所を持たないので、上書きを付けるには
// ラッパー ({layer: URL}) へ変える必要がある。この形式変更は**利用者の明示操作**であり、
// 読み込み側の正規化ではない (sp-0006)。∴ ボタンとして提供し、暗黙には行わない。
// 配列要素位置ではラッパーのほうが安全なので (§5.5.1 の位置逆転)、この変換に副作用はない。
function showsAddOverride(entry: unknown): boolean {
  return typeof entry === "string" && entry.trim() !== "";
}

function addOverrideWrapper(index: number): void {
  if (props.readOnly) return;
  const entry = entries.value[index];
  if (!showsAddOverride(entry)) return;
  const next = [...entries.value];
  next[index] = { layer: entry };
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

// M18-T1: hide 上書きの現在値。true のみを ON とみなす
// (設計正本 m18-t3 v1.3 §5.3: hide は true のみ有効。false/未定義はソース既定に従う)
function hideOverride(entry: unknown): boolean {
  return (entry as Record<string, unknown>).hide === true;
}

// M18-T1: hide 上書きの確定。ON = hide:true をセット / OFF = キーごと削除。
// false は書き込まない (書き込み側は2状態のみ。setOverride の空文字→delete と同じ流儀)
function setHideOverride(index: number, checked: boolean): void {
  const current = entries.value[index];
  if (!current || typeof current !== "object" || Array.isArray(current)) return;
  const record = current as Record<string, unknown>;
  if ((record.hide === true) === checked) return;
  const updated: Record<string, unknown> = { ...record };
  if (checked) {
    updated.hide = true;
  } else {
    delete updated.hide;
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
