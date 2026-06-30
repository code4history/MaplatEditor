<script setup lang="ts">
import type {
  RegisteredMapCatalog,
  RegisteredMapSummary,
} from "../services/registeredMapCatalog";
import type { SelectedRegisteredMapHostState } from "../composables/useRegisteredMapSelector";
import { onMounted } from "vue";
import { useTranslation } from "i18next-vue";
import { useRegisteredMapSelector } from "../composables/useRegisteredMapSelector";

const { t } = useTranslation();

const props = withDefaults(
  defineProps<{
    catalog: RegisteredMapCatalog;
    pageSize?: number;
    initialCatalogKey?: string;
  }>(),
  {
    pageSize: 20,
  },
);

const emit = defineEmits<{
  select: [state: SelectedRegisteredMapHostState];
  deselect: [];
}>();

const selector = useRegisteredMapSelector(props.catalog, {
  pageSize: props.pageSize,
  initialCatalogKey: props.initialCatalogKey,
});

onMounted(async () => {
  await selector.loadMaps();
});

function onSearchInput(event: Event) {
  const target = event.target as HTMLInputElement;
  void selector.search(target.value);
}

function onMapClick(summary: RegisteredMapSummary) {
  const hostState = selector.select(summary);
  emit("select", hostState);
}

function onDeselect() {
  selector.deselect();
  emit("deselect");
}

function onNextPage() {
  void selector.nextPage();
}

function onPrevPage() {
  void selector.prevPage();
}
</script>

<template>
  <div class="selector">
    <div class="mb-3">
      <input
        type="text"
        class="form-control form-control-sm"
        :placeholder="t('applist.search_placeholder')"
        :value="selector.searchQuery.value"
        @input="onSearchInput"
      />
    </div>

    <div v-if="selector.loading.value" class="text-muted text-center py-3">
      {{ t("applist.loading") }}
    </div>

    <div v-else-if="selector.error.value" class="alert alert-danger">
      {{ selector.error.value }}
    </div>

    <div v-else-if="selector.items.value.length === 0" class="text-muted text-center py-3">
      {{ t("applist.no_maps_found") }}
    </div>

    <div v-else class="map-list">
      <div
        v-for="item in selector.items.value"
        :key="item.catalogKey"
        class="map-card card mb-2"
        :class="{ 'border-primary': selector.selectedKey.value === item.catalogKey }"
        role="button"
        @click="onMapClick(item)"
      >
        <div class="card-body py-2 px-3">
          <div class="d-flex align-items-center gap-2">
            <div
              v-if="typeof item.thumbnailUrl === 'string'"
              class="thumbnail"
            >
              <img :src="item.thumbnailUrl" :alt="item.title" />
            </div>
            <div class="flex-grow-1">
              <div class="fw-medium">{{ item.title }}</div>
              <small class="text-muted">
                {{ item.runtimeMapId }}
                <span
                  v-if="item.status !== 'unknown'"
                  class="ms-1"
                  :class="{
                    'text-success': item.status === 'ready',
                    'text-warning': item.status === 'processing',
                    'text-danger': item.status === 'failed',
                  }"
                >
                  {{ item.status === "ready" ? t("applist.status.ready") : item.status === "processing" ? t("applist.status.processing") : t("applist.status.failed") }}
                </span>
              </small>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="d-flex align-items-center justify-content-center gap-2 mt-3">
      <button
        class="btn btn-sm btn-outline-secondary"
        :disabled="!selector.hasPrev.value"
        :aria-label="t('applist.prev_page')"
        @click="onPrevPage"
      >
        &lt;
      </button>
      <span class="text-muted small">{{ t("applist.page", { page: selector.currentPage.value }) }}</span>
      <button
        class="btn btn-sm btn-outline-secondary"
        :disabled="!selector.hasNext.value"
        :aria-label="t('applist.next_page')"
        @click="onNextPage"
      >
        &gt;
      </button>
    </div>

    <div v-if="selector.selectedKey.value" class="text-center mt-3">
      <button class="btn btn-sm btn-outline-danger" @click="onDeselect">
        {{ t("applist.deselect") }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.thumbnail img {
  width: 40px;
  height: 40px;
  object-fit: cover;
  border-radius: 4px;
}

.map-card {
  cursor: pointer;
  transition: border-color 0.15s;
}

.map-card:hover {
  background-color: #f8f9fa;
}

.map-card.border-primary {
  border-width: 2px !important;
}
</style>
