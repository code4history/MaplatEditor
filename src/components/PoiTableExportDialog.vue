<script setup lang="ts">
import { ref, watch } from 'vue';
import { useTranslation } from 'i18next-vue';

// POI の書き出し形式 (CSV・JSON) の選択。選んだ形式を submit で親へ渡す (キャンセルは null)。
const props = defineProps<{ visible: boolean }>();
const emit = defineEmits<{ submit: ['csv' | 'json' | null] }>();
const { t } = useTranslation();

const format = ref<'csv' | 'json'>('csv');
watch(
  () => props.visible,
  (visible) => {
    if (visible) format.value = 'csv';
  },
);
</script>

<template>
  <div v-if="visible" class="modal show d-block" tabindex="-1" role="dialog" aria-modal="true" data-testid="poi-export-table-dialog">
    <div class="modal-dialog modal-dialog-centered">
      <div class="modal-content">
        <div class="modal-header">
          <h2 class="modal-title fs-5">{{ t('poiio.export_title') }}</h2>
        </div>
        <div class="modal-body">
          <p>{{ t('poiio.export_description') }}</p>
          <div class="form-check mb-2">
            <input id="poiExportFormatCsv" v-model="format" class="form-check-input" type="radio" value="csv" data-testid="poi-export-format-csv" />
            <label class="form-check-label" for="poiExportFormatCsv">
              <strong>{{ t('poiio.format_csv') }}</strong>
              <div class="small text-muted">{{ t('poiio.format_csv_desc') }}</div>
            </label>
          </div>
          <div class="form-check">
            <input id="poiExportFormatJson" v-model="format" class="form-check-input" type="radio" value="json" data-testid="poi-export-format-json" />
            <label class="form-check-label" for="poiExportFormatJson">
              <strong>{{ t('poiio.format_json') }}</strong>
              <div class="small text-muted">{{ t('poiio.format_json_desc') }}</div>
            </label>
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-outline-secondary" data-testid="poi-export-table-cancel" @click="emit('submit', null)">
            {{ t('common.cancel') }}
          </button>
          <button type="button" class="btn btn-primary" data-testid="poi-export-table-confirm" @click="emit('submit', format)">
            {{ t('poiio.export_confirm') }}
          </button>
        </div>
      </div>
    </div>
  </div>
  <div v-if="visible" class="modal-backdrop show"></div>
</template>
