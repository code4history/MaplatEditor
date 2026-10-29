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
      <button
        type="button"
        class="btn btn-primary btn-sm mt-2"
        data-testid="iiif-copy"
        @click="emit('copy')"
      >{{ t("iiif_metadata.copy") }}</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useTranslation } from 'i18next-vue';
// @ts-ignore
import type { IiifBindings, IiifFrom, MaplatIiifSection } from '@maplat/core/src/iiif/manifest';
import { iiifBindableKeys, setIiifBinding } from '../../utils/iiifMetadataCopy';
import { LANGS_MAP, type LangCode } from '../../utils/editorLanguages';

const props = defineProps<{
  /** 地図の iiif 節（Manifest と、選んだコマ・結び付けを持つ）。 */
  iiif: MaplatIiifSection;
  /** 写す言語（地図の既定の言語）。 */
  lang: string;
}>();

const emit = defineEmits<{
  'update:bindings': [bindings: IiifBindings];
  copy: [];
}>();

const { t } = useTranslation();

// 鍵の一覧は Core の表から引く（Editor に一覧を持たない）。並びも Core の表の順。
const keys = iiifBindableKeys();

// 鍵の見出しは既存の metadata の欄の文言を使う。対応の無い鍵は鍵の名前のまま出す。
const KEY_LABEL_I18N: Record<string, string> = {
  title: 'mapedit.map_title_label',
  attr: 'mapedit.map_copyright',
  dataAttr: 'mapedit.map_gcp_copyright',
  license: 'mapedit.map_image_license',
  dataLicense: 'mapedit.map_gcp_license',
  description: 'mapedit.map_description',
  contributor: 'mapedit.map_owner',
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
</script>
