<template>
  <div id="applist" class="container main" role="main">
    <h2 class="mb-3">{{ t("applist.title") }}</h2>

    <DesktopRegisteredMapSelector
      :catalog="catalog"
      @select="onSelect"
      @deselect="onDeselect"
    />

    <div v-if="host.state.value" class="card mt-3">
      <div class="card-body">
        <h5 class="card-title">{{ t("applist.selected_map") }}</h5>
        <p class="mb-1"><strong>{{ t("applist.selected_title") }}</strong> {{ host.state.value.title }}</p>
        <p class="mb-1"><strong>{{ t("applist.selected_status") }}</strong> {{ host.state.value.status }}</p>
        <p class="mb-0"><strong>{{ t("applist.selected_map_id") }}</strong> {{ host.state.value.ref.runtimeMapId }}</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useTranslation } from "i18next-vue";
import { createDesktopRegisteredMapCatalog } from "../services/registeredMapCatalog";
import { useAppSourceHost } from "../composables/useAppSourceHost";
import type { SelectedRegisteredMapHostState } from "../composables/useRegisteredMapSelector";
import DesktopRegisteredMapSelector from "../components/DesktopRegisteredMapSelector.vue";

const { t } = useTranslation();
const catalog = createDesktopRegisteredMapCatalog();
const host = useAppSourceHost();

function onSelect(state: SelectedRegisteredMapHostState) {
  host.selectMap(state);
}

function onDeselect() {
  host.clearMap();
}
</script>
