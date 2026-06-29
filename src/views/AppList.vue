<template>
  <div id="applist" class="container main" role="main">
    <h2 class="mb-3">Edit App</h2>

    <DesktopRegisteredMapSelector
      :catalog="catalog"
      @select="onSelect"
      @deselect="onDeselect"
    />

    <div v-if="host.state.value" class="card mt-3">
      <div class="card-body">
        <h5 class="card-title">Selected Map</h5>
        <p class="mb-1"><strong>Title:</strong> {{ host.state.value.title }}</p>
        <p class="mb-1"><strong>Status:</strong> {{ host.state.value.status }}</p>
        <p class="mb-0"><strong>Map ID:</strong> {{ host.state.value.ref.runtimeMapId }}</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { createDesktopRegisteredMapCatalog } from "../services/registeredMapCatalog";
import { useAppSourceHost } from "../composables/useAppSourceHost";
import type { SelectedRegisteredMapHostState } from "../composables/useRegisteredMapSelector";
import DesktopRegisteredMapSelector from "../components/DesktopRegisteredMapSelector.vue";

const catalog = createDesktopRegisteredMapCatalog();
const host = useAppSourceHost();

function onSelect(state: SelectedRegisteredMapHostState) {
  host.selectMap(state);
}

function onDeselect() {
  host.clearMap();
}
</script>
