<template>
  <!-- 確認用の読み取り専用の欄。写した書誌（Manifest とこのコマ）を全件、別の見出しで出す。 -->
  <div v-if="visible" class="card mt-2" data-testid="iiif-metadata-table">
    <div class="card-header bg-light fw-bold small py-1">{{ t("iiif_metadata.readonly_heading") }}</div>
    <div class="card-body py-2">
      <div
        v-for="group in groups"
        :key="group.from"
        class="mb-2"
        :data-testid="'iiif-metadata-' + group.from"
      >
        <div class="fw-bold small mb-1">{{ t(group.headingKey) }}</div>
        <!-- 行が無い見出しにも、そこに項目が無いことを出す -->
        <p v-if="group.rows.length === 0" class="small text-muted mb-0">{{ t("iiif_metadata.empty") }}</p>
        <div v-else>
          <div
            v-for="(row, index) in group.rows"
            :key="group.from + '-' + index"
            class="row g-1 mb-1"
            data-testid="iiif-metadata-row"
          >
            <!-- 項目名も値も文字として出す。値は洗浄済みの HTML から文字だけを取り出す -->
            <div class="col-md-4 small fw-bold text-break">{{ labelText(row) }}</div>
            <div class="col-md-8 small text-break">{{ valueText(row) }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useTranslation } from 'i18next-vue';
// @ts-ignore
import type { IiifMetadataEntry } from '@maplat/core/src/iiif/manifest';
import type { Localized } from '@maplat/core/common';

const props = defineProps<{
  /** 写した書誌の全件（地図の iiif.copiedMetadata）。配列のときだけ欄を出す。 */
  metadata?: IiifMetadataEntry[];
  /** 値の言語（地図の既定の言語）。無ければ値の最初の言語を使う。 */
  lang: string;
}>();

const { t } = useTranslation();

const visible = computed(() => Array.isArray(props.metadata));
const entries = computed<IiifMetadataEntry[]>(() =>
  Array.isArray(props.metadata) ? props.metadata : [],
);

const groups = computed(() => [
  {
    from: 'manifest',
    headingKey: 'iiif_metadata.manifest_heading',
    rows: entries.value.filter((entry) => entry.from === 'manifest'),
  },
  {
    from: 'canvas',
    headingKey: 'iiif_metadata.canvas_heading',
    rows: entries.value.filter((entry) => entry.from === 'canvas'),
  },
]);

/** 言語つきの値から、地図の言語（無ければ最初の言語）の文字を選ぶ。 */
function pick(value: Localized | undefined): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  const chosen = value[props.lang];
  if (typeof chosen === 'string') return chosen;
  const first = Object.values(value)[0];
  return typeof first === 'string' ? first : '';
}

/** 項目名は Core が文字にしてくれているので、そのまま出す。 */
function labelText(row: IiifMetadataEntry): string {
  return pick(row.label);
}

/** 値は洗浄済みの HTML。表示の直前に、文字だけを取り出す（HTML の印を画面に出さない）。 */
function valueText(row: IiifMetadataEntry): string {
  return htmlToText(pick(row.value));
}

function htmlToText(html: string): string {
  if (html === '') return '';
  return new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '';
}
</script>
