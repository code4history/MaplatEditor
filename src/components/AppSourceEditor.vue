<script setup lang="ts">
// アプリ内ソースのrole別ピンポイント設定フォーム。
// - maplat: 設定項目なし（map.json 側で設定する想定）
// - builtin(osm/gsi/gsi_ortho) / tms: 同一のフォーム
//
// m6-t10 (ADR-0018): 保持するのは「マスタ値からの上書き差分」だけである。
// 未上書きのフィールドは入力欄が空で、placeholder にマスタの実効値を薄く出す。
// 上書き中のフィールドにだけ解除ボタン（マスタに戻す）を出す。
//
// m6-t10 (ADR-0017): builtin の文字列出力を廃止したため、builtin への上書きも
// viewer へ届くようになった。∴ tms と別扱いする理由が無くなり、フォームを共通化した。
//
// 上書き可能フィールドの正本は appSourceModel の APP_SOURCE_OVERRIDABLE_KEYS /
// APP_SOURCE_OWNED_KEYS。各操作子に data-testid="app-source-override-<key>" を付け、
// smoke（AC7）が宣言テーブルとの一致を機械照合する。
import { computed, ref } from "vue";
import { useTranslation } from "i18next-vue";
import EnvelopeEditorModal from "./EnvelopeEditorModal.vue";
import LangValueChips from "./editor-ui/LangValueChips.vue";
import ContextHelp from "./editor-ui/ContextHelp.vue";
import DiagnosticFeedback from "./editor-ui/DiagnosticFeedback.vue";
import type { LangCode } from "../utils/editorLanguages";
import {
  bboxToEnvelope,
  envelopeToBbox,
  type AppSource,
} from "../utils/appSourceModel";
import { resolveBaseMapRuntimeText } from "../utils/baseMapEditorDocument";
import type { LangResource } from "../utils/langResource";

const props = defineProps<{
  source: AppSource & { thumbnail?: string };
  currentLang: LangCode;
  defaultLang: LangCode;
  languageOptions: readonly { code: LangCode; nativeName: string }[];
  translationMode?: boolean;
  fallbackCenter?: [number, number];
  // アプリ提供範囲(参考)。利用範囲ピッカーの薄緑ガイド+スナップ対象
  appCoverageLngLats?: [number, number][] | null;
  // m6-t10: マスタの生 data。**プレースホルダ（上書きしなかった場合に効く値）専用**であり、
  // マージ結果ではない。null = マスタ欠落（§3.6 で欠落表示になる）
  masterData?: Record<string, any> | null;
}>();
const emit = defineEmits<{
  (e: "change"): void;
  (e: "select-language", language: LangCode): void;
}>();

const { t } = useTranslation();
const showEnvelopeModal = ref(false);
const uploadError = ref<string | null>(null);

const overrides = computed(() => {
  if (!props.source.overrides) props.source.overrides = {};
  return props.source.overrides as Record<string, any>;
});

const masterMissing = computed(() => props.masterData === null);
const master = computed(() => props.masterData ?? {});
const masterLang = computed(() => String(master.value.lang || master.value.defaultLang || "en"));

// マスタ側の実効値（プレースホルダ表示用）。言語別フィールドは現在言語で解決する。
function masterText(key: string): string {
  return resolveBaseMapRuntimeText(
    master.value[key] as LangResource | undefined,
    props.currentLang,
    masterLang.value,
  );
}
function masterNumber(key: string): string {
  const value = master.value[key];
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

// ---- 上書きの読み書き（label だけは歴史的にトップレベル。設計 §3.1）----
function readOverride(key: string): any {
  return key === "label" ? props.source.label : overrides.value[key];
}
function writeOverride(key: string, value: any) {
  if (key === "label") props.source.label = value;
  else overrides.value[key] = value;
  emit("change");
}
function clearOverride(key: string) {
  if (key === "label") delete (props.source as any).label;
  else delete overrides.value[key];
  emit("change");
}
function isOverridden(key: string): boolean {
  const value = readOverride(key);
  return value !== undefined && value !== null && value !== "";
}

// 言語別フィールド（label/title/attr）は現在言語で読み書きする。
// 保存は編集した言語のみ（設計 §3.5.5）。出力側でマスタとマージされる。
function langText(key: "label" | "title" | "attr"): string {
  const value = readOverride(key);
  if (typeof value === "string") return value;
  return value?.[props.currentLang] || "";
}
function setLangText(key: "label" | "title" | "attr", text: string) {
  const current = readOverride(key);
  const next: Record<string, string> =
    current && typeof current === "object"
      ? { ...current }
      : typeof current === "string"
        ? { [props.defaultLang]: current }
        : {};
  if (text === "") delete next[props.currentLang];
  else next[props.currentLang] = text;
  // 全言語が空になったら上書きごと解除する（空文字の上書きに意味が無いため。設計 §3.8-2）
  if (Object.keys(next).length === 0) clearOverride(key);
  else writeOverride(key, next);
}

function setNumber(key: string, raw: string) {
  const value = raw === "" ? undefined : Number(raw);
  if (value === undefined || Number.isNaN(value)) clearOverride(key);
  else writeOverride(key, value);
}

const bbox = computed(() => envelopeToBbox(overrides.value.envelopeLngLats));

function setBboxPart(index: number, raw: string) {
  const current: [number, number, number, number] = bbox.value ? [...bbox.value] as any : [0, 0, 0, 0];
  const value = Number(raw);
  if (Number.isNaN(value)) return;
  current[index] = value;
  writeOverride("envelopeLngLats", bboxToEnvelope(current));
}

function clearEnvelope() {
  clearOverride("envelopeLngLats");
}

function onEnvelopeUpdate(value: [number, number][] | null) {
  if (value) writeOverride("envelopeLngLats", value);
  else clearOverride("envelopeLngLats");
}

async function uploadThumbnail() {
  uploadError.value = null;
  // tmsソースのmapUidはTMS地図ID(登録地図のuidとは別体系。サムネイルはtmbs/{id}_menu.jpg命名のまま)
  const result = await window.appAssets.uploadTmsThumbnail(props.source.mapUid);
  if (result.err === "Canceled") return;
  if (result.err) {
    uploadError.value = t("appedit.error_invalid_image");
    return;
  }
  // m6-t10: アプリ専用アセットのアップロードは thumbnail の上書きとして保存する
  // （round4 M-5 が「二分原則で機械的にマスタ側へ倒れる」と指摘した問題は、
  //   差分保持モデルでは「ユーザーが操作子を使った ＝ 上書き」として自然に解ける）
  writeOverride("thumbnail", result.path);
  (props.source as any).thumbnail = result.fileUrl;
}
</script>

<template>
  <div>
    <!-- maplat: 設定項目なし（map.json 側で設定する） -->
    <div v-if="source.sourceType === 'maplat'" />

    <!-- m6-t10 §3.6: マスタが引けないソース。削除以外の操作を無効化する -->
    <DiagnosticFeedback
      v-else-if="masterMissing"
      scope="field"
      :items="[{ key: 'base-map-master-missing', severity: 'danger', message: t('appedit.error_missing_base_map_master') }]"
    />

    <!-- builtin / tms: 共通のピンポイント設定 -->
    <div v-else class="row g-2 mt-1">
      <div class="col-md-4">
        <div class="form-label small mb-0 d-flex align-items-center gap-1">
          {{ t("appedit.source_label") }}
          <LangValueChips :model-value="source.label" :active-lang="currentLang" :default-lang="defaultLang" :language-options="languageOptions" @select-language="emit('select-language', $event)" />
          <button v-if="isOverridden('label')" type="button" class="btn btn-sm btn-link p-0 small" :disabled="translationMode" @click="clearOverride('label')">
            {{ t("appedit.override_reset") }}
          </button>
        </div>
        <input :value="langText('label')" type="text" class="form-control form-control-sm" :placeholder="masterText('label')" data-testid="app-source-override-label" @input="setLangText('label', ($event.target as HTMLInputElement).value)">
      </div>
      <div class="col-md-4">
        <div class="form-label small mb-0 d-flex align-items-center gap-1">
          {{ t("appedit.source_title") }}
          <LangValueChips :model-value="overrides.title" :active-lang="currentLang" :default-lang="defaultLang" :language-options="languageOptions" @select-language="emit('select-language', $event)" />
          <button v-if="isOverridden('title')" type="button" class="btn btn-sm btn-link p-0 small" :disabled="translationMode" @click="clearOverride('title')">
            {{ t("appedit.override_reset") }}
          </button>
        </div>
        <input :value="langText('title')" type="text" class="form-control form-control-sm" :placeholder="masterText('title')" data-testid="app-source-override-title" @input="setLangText('title', ($event.target as HTMLInputElement).value)">
      </div>
      <div class="col-md-4">
        <div class="form-label small mb-0 d-flex align-items-center gap-1">
          {{ t("appedit.source_attr") }}
          <LangValueChips :model-value="overrides.attr" :active-lang="currentLang" :default-lang="defaultLang" :language-options="languageOptions" @select-language="emit('select-language', $event)" />
          <button v-if="isOverridden('attr')" type="button" class="btn btn-sm btn-link p-0 small" :disabled="translationMode" @click="clearOverride('attr')">
            {{ t("appedit.override_reset") }}
          </button>
        </div>
        <input :value="langText('attr')" type="text" class="form-control form-control-sm" :placeholder="masterText('attr')" data-testid="app-source-override-attr" @input="setLangText('attr', ($event.target as HTMLInputElement).value)">
      </div>
      <div class="col-md-2">
        <label class="form-label small mb-0">{{ t("appedit.min_zoom") }}</label>
        <input :value="overrides.minZoom ?? ''" type="number" min="0" max="25" class="form-control form-control-sm" :placeholder="masterNumber('minZoom')" :disabled="translationMode" data-testid="app-source-override-minZoom" @change="setNumber('minZoom', ($event.target as HTMLInputElement).value)">
      </div>
      <div class="col-md-2">
        <label class="form-label small mb-0">{{ t("appedit.max_zoom") }}</label>
        <input :value="overrides.maxZoom ?? ''" type="number" min="1" max="25" class="form-control form-control-sm" :placeholder="masterNumber('maxZoom')" :disabled="translationMode" data-testid="app-source-override-maxZoom" @change="setNumber('maxZoom', ($event.target as HTMLInputElement).value)">
      </div>
      <!-- m6-t10 §3.3: url の上書き欄は撤去した。ベースマップの同一性そのものを変える操作であり、
           マスタ側で別のベースマップを作るべきもの。provider では m6-t9 §3.1 で既に非表示だった -->
      <div class="col-md-8 d-flex align-items-end" data-testid="app-source-url-note">
        <ContextHelp :text="t('appedit.source_url_master_note')" :ariaLabel="t('appedit.source_url_master_note')" />
      </div>
      <div class="col-md-4">
        <label class="form-label small mb-0 d-flex align-items-center gap-1">
          {{ t("appedit.thumbnail") }}
          <ContextHelp :text="t('appedit.thumbnail_note')" :ariaLabel="t('appedit.thumbnail_note')" />
        </label>
        <div class="d-flex align-items-center gap-2">
          <button type="button" class="btn btn-sm btn-outline-secondary" :disabled="translationMode" data-testid="app-source-override-thumbnail" @click="uploadThumbnail">
            {{ t("appedit.upload") }}
          </button>
          <button v-if="isOverridden('thumbnail')" type="button" class="btn btn-sm btn-outline-danger" :disabled="translationMode" @click="clearOverride('thumbnail')">
            {{ t("appedit.override_reset") }}
          </button>
        </div>
        <DiagnosticFeedback v-if="uploadError" scope="field" :items="[{ key: 'thumbnail-upload', severity: 'danger', message: uploadError }]" />
      </div>

      <!-- overlay専用設定（マスタに対応物が無く、常にアプリ所有） -->
      <template v-if="source.role === 'overlay'">
        <div class="col-md-3">
          <label class="form-label small mb-0">{{ t("appedit.mercator_x_shift") }}</label>
          <input :value="overrides.mercatorXShift ?? ''" type="number" step="0.01" class="form-control form-control-sm" :disabled="translationMode" data-testid="app-source-override-mercatorXShift" @change="setNumber('mercatorXShift', ($event.target as HTMLInputElement).value)">
        </div>
        <div class="col-md-3">
          <label class="form-label small mb-0">{{ t("appedit.mercator_y_shift") }}</label>
          <input :value="overrides.mercatorYShift ?? ''" type="number" step="0.01" class="form-control form-control-sm" :disabled="translationMode" data-testid="app-source-override-mercatorYShift" @change="setNumber('mercatorYShift', ($event.target as HTMLInputElement).value)">
        </div>
      </template>

      <!-- 利用範囲(envelopeLngLats): base/overlay共通。既定は空で、設定時のみViewerへ渡る(ADR-0004)。
           m6-t10 §3.8-4: プレースホルダにマスタの存在範囲(coverageLngLats)は出さない。
           存在範囲と利用範囲は別概念であり、未設定時に効くのは「範囲指定なし」であって存在範囲ではない -->
      <div class="col-12">
        <label class="form-label small mb-0">{{ t("appedit.envelope") }}</label>
        <div class="d-flex align-items-center gap-2 flex-wrap" data-testid="app-source-override-envelopeLngLats">
          <div v-for="(labelKey, index) in ['envelope_west', 'envelope_south', 'envelope_east', 'envelope_north']" :key="labelKey" class="envelope-input">
            <span class="small text-muted">{{ t(`appedit.${labelKey}`) }}</span>
            <input
              :value="bbox ? bbox[index] : ''"
              type="number"
              step="0.000001"
              class="form-control form-control-sm"
              :disabled="translationMode"
              @change="setBboxPart(index, ($event.target as HTMLInputElement).value)"
            >
          </div>
          <button type="button" class="btn btn-sm btn-outline-primary" :disabled="translationMode" @click="showEnvelopeModal = true">
            {{ t("appedit.envelope_pick") }}
          </button>
          <button v-if="bbox" type="button" class="btn btn-sm btn-outline-danger" :disabled="translationMode" @click="clearEnvelope">
            {{ t("appedit.envelope_clear") }}
          </button>
        </div>
      </div>
    </div>

    <EnvelopeEditorModal
      v-if="showEnvelopeModal"
      :model-value="overrides.envelopeLngLats ?? null"
      :coverage-lng-lats="master.coverageLngLats ?? null"
      :app-coverage-lng-lats="appCoverageLngLats ?? null"
      :fallback-center="fallbackCenter"
      @update:model-value="onEnvelopeUpdate"
      @close="showEnvelopeModal = false"
    />
  </div>
</template>

<style scoped>
.envelope-input {
  display: flex;
  align-items: center;
  gap: 4px;
}
.envelope-input input {
  width: 8.5rem;
}
</style>
