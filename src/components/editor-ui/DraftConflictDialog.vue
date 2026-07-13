<script setup lang="ts">
import { useTranslation } from 'i18next-vue';

defineProps<{ visible: boolean }>();
const emit = defineEmits<{ discard: []; apply: [] }>();
const { t } = useTranslation();
</script>

<template>
  <div v-if="visible" class="modal show d-block" tabindex="-1" role="dialog" aria-modal="true">
    <div class="modal-dialog modal-dialog-centered">
      <div class="modal-content">
        <div class="modal-header">
          <h2 class="modal-title fs-5">{{ t('editor_ui.draft_conflict.title') }}</h2>
        </div>
        <div class="modal-body">{{ t('editor_ui.draft_conflict.message') }}</div>
        <div class="modal-footer">
          <button type="button" class="btn btn-outline-secondary" @click="emit('discard')">
            {{ t('editor_ui.draft_conflict.discard') }}
          </button>
          <button type="button" class="btn btn-primary" @click="emit('apply')">
            {{ t('editor_ui.draft_conflict.apply') }}
          </button>
        </div>
      </div>
    </div>
  </div>
  <div v-if="visible" class="modal-backdrop show"></div>
</template>
