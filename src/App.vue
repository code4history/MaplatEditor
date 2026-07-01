<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import Header from "./components/Header.vue";
import ProgressModal from "./components/ProgressModal.vue";

const modalVisible = ref(false);
const modalText = ref('');
const modalPercent = ref(0);
const modalProgressText = ref('');
const modalEnableClose = ref(false);
let removeTaskProgressListener: (() => void) | null = null;

onMounted(() => {
  removeTaskProgressListener = window.appEvents.onTaskProgress((progress) => {
    modalText.value = progress.text;
    modalPercent.value = progress.percent ?? 0;
    modalProgressText.value = progress.progress ?? '';
    modalEnableClose.value = modalPercent.value >= 100;
    modalVisible.value = true;
  });
});

onUnmounted(() => {
  removeTaskProgressListener?.();
});
</script>

<template>
  <Header />
  <div class="main-content">
    <router-view />
  </div>
  <ProgressModal
    :visible="modalVisible"
    :text="modalText"
    :percent="modalPercent"
    :progress-text="modalProgressText"
    :enable-close="modalEnableClose"
    @close="modalVisible = false"
  />
</template>

<style>
/* Global styles or minimal reset */
#app {
  font-family: Avenir, Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  color: #2c3e50;
}
.main-content {
  margin-top: 56px; /* Navbar height */
  height: calc(100vh - 56px);
  overflow-y: auto;
  padding: 0; /* Remove padding here so scrollbar is at the edge */
  width: 100%;
}
</style>

<style>
/* Global reset to prevent body scroll */
html, body {
  height: 100%;
  margin: 0;
  overflow: hidden;
}
</style>
