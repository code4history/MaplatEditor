<script setup lang="ts">
// アプリ内ソースのrole別ピンポイント設定フォーム。
// - maplat: labelのみ（他はmap.json側で設定する想定）
// - builtin(osm/gsi/gsi_ortho): 設定項目なし（Viewer内蔵定義を使用）
// - tms base/overlay: label/title/attr/url/zoom/サムネイル/利用範囲(envelopeLngLats)、
//   overlayはさらにmercatorシフト。利用範囲は存在範囲(coverageLngLats)を
//   薄色ガイドにした地図ポップアップで指定し、存在範囲内へクロップされる
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
  createAppSourceFromBaseMap,
  type AppSource,
} from "../utils/appSourceModel";
import { isProviderKind } from "../utils/baseMapEditorDocument";

const props = defineProps<{
  source: AppSource & { thumbnail?: string };
  currentLang: LangCode;
  defaultLang: LangCode;
  languageOptions: readonly { code: LangCode; nativeName: string }[];
  translationMode?: boolean;
  fallbackCenter?: [number, number];
  // アプリ提供範囲(参考)。利用範囲ピッカーの薄緑ガイド+スナップ対象
  appCoverageLngLats?: [number, number][] | null;
}>();
const emit = defineEmits<{
  (e: "change"): void;
  (e: "select-language", language: LangCode): void;
}>();

const { t } = useTranslation();
const showEnvelopeModal = ref(false);
const uploadError = ref<string | null>(null);

const data = computed(() => {
  if (!props.source.data) props.source.data = {};
  return props.source.data as Record<string, any>;
});

// m6-t9 §3.1: provider kind (google/mapbox/maplibre) は API キー+maptype からタイル URL を
// 内部構築するため、生の url 入力欄を出す意味がない（m6-t6 H-A と同型の汚染経路にもなり得る）
const isProvider = computed(() => isProviderKind(data.value.kind));

// m6-t9 §3.2: マスタから再取得。新規 IPC は追加せず window.baseMaps.list() を再利用する
// （refreshRegisteredPresets と同型のパターン）
const refetchError = ref<string | null>(null);
async function refetchFromMaster() {
  refetchError.value = null;
  const catalog = await window.baseMaps.list();
  // AppSource.mapUid の実体は mapID（slug）であり uid（UUID）ではない（appSourceModel.ts:114-116,163,172）
  const item = catalog.find((entry) => entry.mapID === props.source.mapUid);
  if (!item) {
    refetchError.value = t("appedit.refetch_master_not_found");
    return;
  }
  const rebuilt = createAppSourceFromBaseMap(
    { mapID: item.mapID, ...(item.data || {}) },
    props.defaultLang,
  );
  props.source.data = rebuilt.data ?? {};
  if (rebuilt.label) props.source.label = rebuilt.label;
  if (rebuilt.title !== undefined) props.source.title = rebuilt.title;
  emit("change");
}

// title/attr は文字列または言語オブジェクトの両形式があるため現在言語で読み書きする
function langText(key: "title" | "attr") {
  const value = data.value[key];
  if (typeof value === "string") return value;
  return value?.[props.currentLang] || "";
}

function setLangText(key: "title" | "attr", text: string) {
  const value = data.value[key];
  if (value && typeof value === "object") {
    value[props.currentLang] = text;
  } else if (typeof value === "string" && props.currentLang !== props.defaultLang) {
    data.value[key] = { [props.defaultLang]: value, [props.currentLang]: text };
  } else {
    data.value[key] = { [props.currentLang]: text };
  }
  emit("change");
}

function setNumber(key: string, raw: string) {
  const value = raw === "" ? undefined : Number(raw);
  if (value === undefined || Number.isNaN(value)) {
    delete data.value[key];
  } else {
    data.value[key] = value;
  }
  emit("change");
}

const bbox = computed(() => envelopeToBbox(data.value.envelopeLngLats));

function setBboxPart(index: number, raw: string) {
  const current: [number, number, number, number] = bbox.value ? [...bbox.value] as any : [0, 0, 0, 0];
  const value = Number(raw);
  if (Number.isNaN(value)) return;
  current[index] = value;
  data.value.envelopeLngLats = bboxToEnvelope(current);
  emit("change");
}

function clearEnvelope() {
  delete data.value.envelopeLngLats;
  emit("change");
}

function onEnvelopeUpdate(value: [number, number][] | null) {
  if (value) {
    data.value.envelopeLngLats = value;
  } else {
    delete data.value.envelopeLngLats;
  }
  emit("change");
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
  data.value.thumbnail = result.path;
  (props.source as any).thumbnail = result.fileUrl;
  emit("change");
}
</script>

<template>
  <div>
    <!-- builtin: 設定不可の説明のみ (M12-T11/R1: 注記は (i) ボタンの Popover へ) -->
    <div v-if="source.sourceType === 'builtin'" class="mb-0 mt-2">
      <ContextHelp :text="t('appedit.builtin_source_note')" :ariaLabel="t('appedit.builtin_source_note')" />
    </div>

    <!-- tms: ピンポイント設定 -->
    <div v-else-if="source.sourceType === 'tms'" class="row g-2 mt-1">
      <div class="col-md-4">
        <div class="form-label small mb-0 d-flex align-items-center gap-1">{{ t("appedit.source_title") }} <LangValueChips :model-value="data.title" :active-lang="currentLang" :default-lang="defaultLang" :language-options="languageOptions" @select-language="emit('select-language', $event)" /></div>
        <input :value="langText('title')" type="text" class="form-control form-control-sm" data-testid="app-source-title" @input="setLangText('title', ($event.target as HTMLInputElement).value)">
      </div>
      <div class="col-md-4">
        <div class="form-label small mb-0 d-flex align-items-center gap-1">{{ t("appedit.source_attr") }} <LangValueChips :model-value="data.attr" :active-lang="currentLang" :default-lang="defaultLang" :language-options="languageOptions" @select-language="emit('select-language', $event)" /></div>
        <input :value="langText('attr')" type="text" class="form-control form-control-sm" data-testid="app-source-attr" @input="setLangText('attr', ($event.target as HTMLInputElement).value)">
      </div>
      <div class="col-md-2">
        <label class="form-label small mb-0">{{ t("appedit.min_zoom") }}</label>
        <input :value="data.minZoom ?? ''" type="number" min="0" max="25" class="form-control form-control-sm" :disabled="translationMode" @change="setNumber('minZoom', ($event.target as HTMLInputElement).value)">
      </div>
      <div class="col-md-2">
        <label class="form-label small mb-0">{{ t("appedit.max_zoom") }}</label>
        <input :value="data.maxZoom ?? ''" type="number" min="1" max="25" class="form-control form-control-sm" :disabled="translationMode" @change="setNumber('maxZoom', ($event.target as HTMLInputElement).value)">
      </div>
      <!-- m6-t9 §3.1: provider kind (google/mapbox/maplibre) は API キー+maptype から内部的に
           タイル URL を構築するため、生の url 入力欄は出さない（builtin と同様に説明のみ） -->
      <div v-if="!isProvider" class="col-md-8" data-testid="app-source-url-field">
        <label class="form-label small mb-0">{{ t("appedit.source_url") }}</label>
        <input v-model="data.url" type="text" class="form-control form-control-sm font-monospace" :disabled="translationMode" data-testid="app-source-url" @input="emit('change')">
      </div>
      <div v-else class="col-md-8 d-flex align-items-end" data-testid="app-source-url-provider-note">
        <ContextHelp :text="t('appedit.provider_source_note')" :ariaLabel="t('appedit.provider_source_note')" />
      </div>
      <div class="col-md-4">
        <label class="form-label small mb-0 d-flex align-items-center gap-1">{{ t("appedit.thumbnail") }} <ContextHelp :text="t('appedit.thumbnail_note')" :ariaLabel="t('appedit.thumbnail_note')" /></label>
        <div class="d-flex align-items-center gap-2">
          <button type="button" class="btn btn-sm btn-outline-secondary" :disabled="translationMode" @click="uploadThumbnail">
            {{ t("appedit.upload") }}
          </button>
          <!-- m6-t9 §3.2: マスタから再取得。登録済みマスタ由来（mapUid 非空）の tms ソースに限る -->
          <button
            v-if="source.mapUid"
            type="button"
            class="btn btn-sm btn-outline-secondary"
            :disabled="translationMode"
            data-testid="app-source-refetch-from-master"
            @click="refetchFromMaster"
          >
            {{ t("appedit.refetch_from_master") }}
          </button>
        </div>
        <!-- M12-T11 (R3/C33): inline text-danger から DF field へ -->
        <DiagnosticFeedback v-if="uploadError" scope="field" :items="[{ key: 'thumbnail-upload', severity: 'danger', message: uploadError }]" />
        <DiagnosticFeedback v-if="refetchError" scope="operation" data-testid="app-source-refetch-error" :items="[{ key: 'refetch-not-found', severity: 'danger', message: refetchError }]" />
      </div>

      <!-- overlay専用設定 -->
      <template v-if="source.role === 'overlay'">
        <div class="col-md-3">
          <label class="form-label small mb-0">{{ t("appedit.mercator_x_shift") }}</label>
          <input :value="data.mercatorXShift ?? ''" type="number" step="0.01" class="form-control form-control-sm" :disabled="translationMode" @change="setNumber('mercatorXShift', ($event.target as HTMLInputElement).value)">
        </div>
        <div class="col-md-3">
          <label class="form-label small mb-0">{{ t("appedit.mercator_y_shift") }}</label>
          <input :value="data.mercatorYShift ?? ''" type="number" step="0.01" class="form-control form-control-sm" :disabled="translationMode" @change="setNumber('mercatorYShift', ($event.target as HTMLInputElement).value)">
        </div>
      </template>

      <!-- 利用範囲(envelopeLngLats): base/overlay共通。既定は空で、設定時のみViewerへ渡る(ADR-0004) -->
      <div class="col-12">
        <label class="form-label small mb-0">{{ t("appedit.envelope") }}</label>
        <div class="d-flex align-items-center gap-2 flex-wrap">
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
      :model-value="data.envelopeLngLats ?? null"
      :coverage-lng-lats="data.coverageLngLats ?? null"
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
