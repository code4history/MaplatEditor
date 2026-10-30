<template>
  <div class="card mt-2" data-testid="iiif-binding-panel">
    <div class="card-header bg-light fw-bold small py-1 d-flex align-items-center justify-content-between">
      <span>{{ t("iiif_metadata.heading") }}</span>
      <span class="fw-normal text-muted">{{ t("iiif_metadata.copy_language", { language: languageLabel }) }}</span>
    </div>
    <div class="card-body py-2">
      <p class="small text-muted mb-2">{{ t("iiif_metadata.help") }}</p>
      <div class="row g-1 mb-1 small text-muted">
        <div class="col-md-4">{{ t("iiif_metadata.field") }}</div>
        <div class="col-md-3">{{ t("iiif_metadata.bind") }}</div>
        <div class="col-md-3">{{ t("iiif_metadata.from") }}</div>
      </div>
      <div v-for="key in keys" :key="key" class="row g-1 align-items-center mb-1">
        <div class="col-md-4 small">{{ labelOf(key) }}</div>
        <div class="col-md-3">
          <div class="form-check mb-0">
            <input
              :id="checkboxId(key)"
              class="form-check-input"
              type="checkbox"
              :data-testid="'iiif-binding-' + key"
              :checked="isBound(key)"
              @change="toggle(key, ($event.target as HTMLInputElement).checked)"
            >
            <label class="form-check-label small" :for="checkboxId(key)">{{ t("iiif_metadata.bind") }}</label>
          </div>
        </div>
        <div class="col-md-3">
          <select
            class="form-select form-select-sm"
            :data-testid="'iiif-binding-from-' + key"
            :value="fromOf(key)"
            :disabled="!isBound(key)"
            @change="changeFrom(key, ($event.target as HTMLSelectElement).value)"
          >
            <option value="manifest">{{ t("iiif_metadata.from_manifest") }}</option>
            <!-- このコマが決まっていない地図では選べない -->
            <option value="canvas" :disabled="!hasCanvas">{{ t("iiif_metadata.from_canvas") }}</option>
          </select>
        </div>
      </div>
      <div class="d-flex flex-wrap gap-1 mt-2">
        <button
          type="button"
          class="btn btn-primary btn-sm"
          data-testid="iiif-copy"
          @click="emit('copy')"
        >{{ t("iiif_metadata.copy") }}</button>
        <button
          type="button"
          class="btn btn-outline-primary btn-sm"
          data-testid="iiif-recopy"
          @click="emit('recopy')"
        >{{ t("iiif_metadata.recopy") }}</button>
      </div>

      <!-- 比べた結果。変わらない行は出さず、既定では IIIF の側が変わった行だけを選んでおく -->
      <div v-if="recopy" class="mt-2" data-testid="iiif-recopy-table">
        <p class="small text-muted mb-1">{{ t("iiif_metadata.recopy_help") }}</p>
        <div class="row g-1 mb-1 small text-muted">
          <div class="col-md-2">{{ t("iiif_metadata.field") }}</div>
          <div class="col-md-3">{{ t("iiif_metadata.recopy_current") }}</div>
          <div class="col-md-3">{{ t("iiif_metadata.recopy_copied") }}</div>
          <div class="col-md-2">{{ t("iiif_metadata.recopy_next") }}</div>
          <div class="col-md-2">{{ t("iiif_metadata.recopy_select") }}</div>
        </div>
        <div
          v-for="row in recopyRows"
          :key="rowId(row)"
          class="row g-1 align-items-center mb-1"
          :data-testid="'iiif-recopy-row-' + row.key + '-' + row.lang"
        >
          <div class="col-md-2 small">{{ labelOf(row.key) }}<span class="text-muted"> ({{ row.lang }})</span></div>
          <div class="col-md-3 small text-break">{{ row.current ?? t("iiif_metadata.recopy_no_value") }}</div>
          <div class="col-md-3 small text-break">{{ row.copied ?? t("iiif_metadata.recopy_no_value") }}</div>
          <div class="col-md-2 small text-break">{{ row.next ?? t("iiif_metadata.recopy_no_value") }}</div>
          <div class="col-md-2">
            <div class="form-check mb-0">
              <input
                :id="pickId(row)"
                class="form-check-input"
                type="checkbox"
                :data-testid="'iiif-recopy-pick-' + row.key + '-' + row.lang"
                :checked="isPicked(row)"
                :disabled="row.next === undefined"
                @change="togglePick(row, ($event.target as HTMLInputElement).checked)"
              >
              <label class="form-check-label small" :for="pickId(row)">{{ t("iiif_metadata.recopy_reason." + row.reason) }}</label>
            </div>
          </div>
        </div>
        <button
          type="button"
          class="btn btn-primary btn-sm mt-1"
          data-testid="iiif-recopy-apply"
          :disabled="pickedRows.length === 0"
          @click="emit('apply-recopied', pickedRows)"
        >{{ t("iiif_metadata.recopy_apply") }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useTranslation } from 'i18next-vue';
// @ts-ignore
import type { IiifBindings, IiifFrom, MaplatIiifSection } from '@maplat/core/src/iiif/manifest';
import {
  iiifBindableKeys,
  setIiifBinding,
  type IiifRecopyPlanSuccess,
  type IiifRecopyRow,
} from '../../utils/iiifMetadataCopy';
import { LANGS_MAP, type LangCode } from '../../utils/editorLanguages';
import { DEPRECATED_EXACT_NAME_KEY } from '../../utils/mapNameUnification';

const props = defineProps<{
  /** 地図の iiif 節（Manifest と、選んだコマ・結び付けを持つ）。 */
  iiif: MaplatIiifSection;
  /** 写す言語（地図の既定の言語）。 */
  lang: string;
  /** 「IIIF から写し直す」で比べた結果（比べていないときは null）。 */
  recopy?: IiifRecopyPlanSuccess | null;
}>();

const emit = defineEmits<{
  'update:bindings': [bindings: IiifBindings];
  copy: [];
  recopy: [];
  'apply-recopied': [selected: Array<{ key: string; lang: string }>];
}>();

const { t } = useTranslation();

// 鍵の一覧は Core の表から引く（Editor に一覧を持たない）。並びも Core の表の順。
// ただし 1.0.0 で廃止した属性は、Editor に欄が無く、結び付けると地図に書き戻してしまうので外す。
const keys = iiifBindableKeys().filter((key) => key !== DEPRECATED_EXACT_NAME_KEY);

// 鍵の見出しは既存の metadata の欄の文言を使う。対応の無い鍵は鍵の名前のまま出す。
const KEY_LABEL_I18N: Record<string, string> = {
  title: 'mapedit.map_title_label',
  attr: 'mapedit.map_copyright',
  dataAttr: 'mapedit.map_gcp_copyright',
  license: 'mapedit.map_image_license',
  dataLicense: 'mapedit.map_gcp_license',
  description: 'mapedit.map_description',
  contributor: 'mapedit.map_owner',
  licenseNote: 'mapedit.map_image_license_note',
  dataLicenseNote: 'mapedit.map_gcp_license_note',
};

const bindings = computed<IiifBindings>(() => props.iiif.bindings ?? {});
const hasCanvas = computed(() => Boolean(props.iiif.canvas));
const languageLabel = computed(() => {
  const labelKey = LANGS_MAP[props.lang as LangCode];
  return labelKey ? t('common.' + labelKey) : props.lang;
});

function labelOf(key: string): string {
  const i18nKey = KEY_LABEL_I18N[key];
  return i18nKey ? t(i18nKey) : key;
}

function checkboxId(key: string): string {
  return 'iiif-binding-check-' + key;
}

function isBound(key: string): boolean {
  return Boolean(bindings.value[key]);
}

function fromOf(key: string): IiifFrom {
  return bindings.value[key]?.from ?? 'manifest';
}

function toggle(key: string, checked: boolean): void {
  update(key, checked ? 'manifest' : null);
}

function changeFrom(key: string, value: string): void {
  update(key, value === 'canvas' ? 'canvas' : 'manifest');
}

function update(key: string, from: IiifFrom | null): void {
  emit('update:bindings', setIiifBinding(bindings.value, key, from));
}

// 比べた結果の一覧。変わらない行は出さない（上書きの対象にしない）。
// ライセンスの注記は Core の表に無い鍵で、ライセンスに付いて動くので一覧に出さない
//（単独では選べない）。
const recopyKeys = new Set(keys);
const recopyRows = computed<IiifRecopyRow[]>(() =>
  props.recopy
    ? props.recopy.rows.filter(
        (row) => row.reason !== 'unchanged' && recopyKeys.has(row.key),
      )
    : [],
);

// 上書きする行の選択。既定は「IIIF の側が変わった」行だけにする
//（人が直した行は外しておき、手で直した値を黙って消さない）。
const picked = ref<string[]>([]);
watch(
  () => props.recopy,
  (plan) => {
    picked.value = (plan ? plan.rows : [])
      .filter((row) => row.reason === 'iiif-changed' && row.next !== undefined && recopyKeys.has(row.key))
      .map(rowId);
  },
);

const pickedRows = computed<Array<{ key: string; lang: string }>>(() =>
  recopyRows.value
    .filter((row) => picked.value.includes(rowId(row)))
    .map((row) => ({ key: row.key, lang: row.lang })),
);

function rowId(row: IiifRecopyRow): string {
  return row.key + '-' + row.lang;
}

function pickId(row: IiifRecopyRow): string {
  return 'iiif-recopy-pick-' + row.key + '-' + row.lang;
}

function isPicked(row: IiifRecopyRow): boolean {
  return picked.value.includes(rowId(row));
}

function togglePick(row: IiifRecopyRow, checked: boolean): void {
  const id = rowId(row);
  picked.value = checked
    ? picked.value.includes(id) ? picked.value : [...picked.value, id]
    : picked.value.filter((item) => item !== id);
}
</script>
