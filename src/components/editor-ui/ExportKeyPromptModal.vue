<script setup lang="ts">
import { reactive, watch } from 'vue';
import { useTranslation } from 'i18next-vue';

// m6-t6 (§3.2): 書き出し時、鍵が2段（アプリ単位→設定ページ既定公開用）とも解決できない
// provider があるとき、一時的な値の入力を求める。値はどのストアにも書き込まない
// （SettingsService.set を呼ばない・emit で親へ渡すのみ）
const props = defineProps<{
  visible: boolean;
  missingKinds: readonly ('google' | 'mapbox')[];
}>();
const emit = defineEmits<{
  submit: [{ googleApiKey?: string; mapboxToken?: string } | null];
}>();
const { t } = useTranslation();

const values = reactive<{ googleApiKey: string; mapboxToken: string }>({
  googleApiKey: '',
  mapboxToken: '',
});

// モーダルを開き直すたびに空欄へ戻す（保存しない性質を UI 上でも徹底する）
watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      values.googleApiKey = '';
      values.mapboxToken = '';
    }
  },
);

function submit(): void {
  const result: { googleApiKey?: string; mapboxToken?: string } = {};
  if (props.missingKinds.includes('google') && values.googleApiKey) result.googleApiKey = values.googleApiKey;
  if (props.missingKinds.includes('mapbox') && values.mapboxToken) result.mapboxToken = values.mapboxToken;
  emit('submit', result);
}
function cancel(): void {
  emit('submit', null);
}
</script>

<template>
  <div v-if="visible" class="modal show d-block" tabindex="-1" role="dialog" aria-modal="true" data-testid="export-key-prompt-modal">
    <div class="modal-dialog modal-dialog-centered">
      <div class="modal-content">
        <div class="modal-header">
          <h2 class="modal-title fs-5">{{ t('appedit.export_key_prompt_title') }}</h2>
        </div>
        <div class="modal-body">
          <p>{{ t('appedit.export_key_prompt_description') }}</p>
          <div v-if="missingKinds.includes('google')" class="mb-3">
            <label for="exportKeyPromptGoogle" class="form-label">{{ t('appedit.export_key_prompt_label_google') }}</label>
            <input
              id="exportKeyPromptGoogle"
              type="text"
              class="form-control"
              data-testid="export-key-prompt-google"
              v-model="values.googleApiKey"
            />
          </div>
          <div v-if="missingKinds.includes('mapbox')" class="mb-3">
            <label for="exportKeyPromptMapbox" class="form-label">{{ t('appedit.export_key_prompt_label_mapbox') }}</label>
            <input
              id="exportKeyPromptMapbox"
              type="text"
              class="form-control"
              data-testid="export-key-prompt-mapbox"
              v-model="values.mapboxToken"
            />
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-outline-secondary" data-testid="export-key-prompt-cancel" @click="cancel">
            {{ t('common.cancel') }}
          </button>
          <button type="button" class="btn btn-primary" data-testid="export-key-prompt-continue" @click="submit">
            {{ t('appedit.export_key_prompt_continue') }}
          </button>
        </div>
      </div>
    </div>
  </div>
  <div v-if="visible" class="modal-backdrop show"></div>
</template>
