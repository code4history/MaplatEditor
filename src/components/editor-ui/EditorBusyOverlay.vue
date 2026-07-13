<template>
  <div
    v-if="visible"
    class="editor-busy-overlay"
    data-editor-busy-overlay
    aria-busy="true"
    aria-live="polite"
    role="status"
  >
    <div class="editor-busy-overlay__message rounded bg-white border shadow-sm px-4 py-3">
      <span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>
      {{ label }}
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  visible: boolean;
  label: string;
}>();
</script>

<style scoped>
.editor-busy-overlay {
  position: fixed;
  z-index: 1040;
  inset: 0;
  display: grid;
  place-items: center;
  background: rgb(255 255 255 / 58%);
  cursor: wait;
}

.editor-busy-overlay__message {
  display: flex;
  align-items: center;
  color: var(--bs-body-color);
}
</style>
