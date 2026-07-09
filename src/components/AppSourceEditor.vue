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
import {
  bboxToEnvelope,
  envelopeToBbox,
  type AppSource,
} from "../utils/appSourceModel";

const props = defineProps<{
  source: AppSource & { thumbnail?: string };
  currentLang: string;
  fallbackCenter?: [number, number];
  // アプリ提供範囲(参考)。利用範囲ピッカーの薄緑ガイド+スナップ対象
  appCoverageLngLats?: [number, number][] | null;
}>();
const emit = defineEmits<{ (e: "change"): void }>();

const { t } = useTranslation();
const showEnvelopeModal = ref(false);
const uploadError = ref<string | null>(null);

const data = computed(() => {
  if (!props.source.data) props.source.data = {};
  return props.source.data as Record<string, any>;
});

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
  } else if (typeof value === "string" && props.currentLang !== "ja") {
    data.value[key] = { ja: value, [props.currentLang]: text };
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
  // tmsソースのmapUidはTMS地図ID(サムネイルはtmbs/{id}_menu.jpg命名、Task 7でuid化)
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
    <!-- builtin: 設定不可の説明のみ -->
    <p v-if="source.sourceType === 'builtin'" class="small text-muted mb-0 mt-2">
      {{ t("appedit.builtin_source_note") }}
    </p>

    <!-- tms: ピンポイント設定 -->
    <div v-else-if="source.sourceType === 'tms'" class="row g-2 mt-1">
      <div class="col-md-4">
        <label class="form-label small mb-0">{{ t("appedit.source_title") }}</label>
        <input :value="langText('title')" type="text" class="form-control form-control-sm" @input="setLangText('title', ($event.target as HTMLInputElement).value)">
      </div>
      <div class="col-md-4">
        <label class="form-label small mb-0">{{ t("appedit.source_attr") }}</label>
        <input :value="langText('attr')" type="text" class="form-control form-control-sm" @input="setLangText('attr', ($event.target as HTMLInputElement).value)">
      </div>
      <div class="col-md-2">
        <label class="form-label small mb-0">{{ t("appedit.min_zoom") }}</label>
        <input :value="data.minZoom ?? ''" type="number" min="0" max="25" class="form-control form-control-sm" @change="setNumber('minZoom', ($event.target as HTMLInputElement).value)">
      </div>
      <div class="col-md-2">
        <label class="form-label small mb-0">{{ t("appedit.max_zoom") }}</label>
        <input :value="data.maxZoom ?? ''" type="number" min="1" max="25" class="form-control form-control-sm" @change="setNumber('maxZoom', ($event.target as HTMLInputElement).value)">
      </div>
      <div class="col-md-8">
        <label class="form-label small mb-0">{{ t("appedit.source_url") }}</label>
        <input v-model="data.url" type="text" class="form-control form-control-sm font-monospace" @input="emit('change')">
      </div>
      <div class="col-md-4">
        <label class="form-label small mb-0">{{ t("appedit.thumbnail") }}</label>
        <div class="d-flex align-items-center gap-2">
          <button type="button" class="btn btn-sm btn-outline-secondary" @click="uploadThumbnail">
            {{ t("appedit.upload") }}
          </button>
          <small class="text-muted">{{ t("appedit.thumbnail_note") }}</small>
        </div>
        <div v-if="uploadError" class="text-danger small">{{ uploadError }}</div>
      </div>

      <!-- overlay専用設定 -->
      <template v-if="source.role === 'overlay'">
        <div class="col-md-3">
          <label class="form-label small mb-0">{{ t("appedit.mercator_x_shift") }}</label>
          <input :value="data.mercatorXShift ?? ''" type="number" step="0.01" class="form-control form-control-sm" @change="setNumber('mercatorXShift', ($event.target as HTMLInputElement).value)">
        </div>
        <div class="col-md-3">
          <label class="form-label small mb-0">{{ t("appedit.mercator_y_shift") }}</label>
          <input :value="data.mercatorYShift ?? ''" type="number" step="0.01" class="form-control form-control-sm" @change="setNumber('mercatorYShift', ($event.target as HTMLInputElement).value)">
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
              @change="setBboxPart(index, ($event.target as HTMLInputElement).value)"
            >
          </div>
          <button type="button" class="btn btn-sm btn-outline-primary" @click="showEnvelopeModal = true">
            {{ t("appedit.envelope_pick") }}
          </button>
          <button v-if="bbox" type="button" class="btn btn-sm btn-outline-danger" @click="clearEnvelope">
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
