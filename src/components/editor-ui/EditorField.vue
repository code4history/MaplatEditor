<template>
  <div class="editor-field">
    <label class="editor-field__label form-label fw-semibold mb-0" :for="labelFor">
      {{ label }}
      <span v-if="required" class="editor-field__required text-danger" aria-hidden="true">*</span>
      <span v-if="$slots.help" class="editor-field__help">
        <slot name="help"></slot>
      </span>
    </label>

    <slot></slot>

    <DiagnosticFeedback
      v-if="diagnostics.length"
      scope="field"
      :items="diagnostics"
    />
  </div>
</template>

<script setup lang="ts">
import DiagnosticFeedback from "./DiagnosticFeedback.vue";
import type { DiagnosticItem } from "./editorUiTypes";

withDefaults(defineProps<{
  label: string;
  labelFor?: string;
  required?: boolean;
  diagnostics?: DiagnosticItem[];
}>(), {
  required: false,
  diagnostics: () => [],
});
</script>

<style scoped>
.editor-field {
  display: flex;
  flex-direction: column;
}

.editor-field__label {
  display: inline-flex;
  align-items: center;
  gap: var(--editor-ui-space-1);
}
</style>
