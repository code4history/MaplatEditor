<template>
  <div>
    <!-- Loading -->
    <div v-if="loading" class="text-muted text-center py-3">
      {{ t("applist.loading") }}
    </div>

    <!-- Error -->
    <div v-else-if="error" class="alert alert-danger">
      {{ error }}
    </div>

    <!-- Empty -->
    <div v-else-if="items.length === 0" class="text-muted text-center py-3">
      {{ t("applist.no_poi_sources") }}
    </div>

    <!-- Source Grid -->
    <div v-else class="d-flex flex-wrap justify-content-start align-items-start gap-3">
      <div
        v-for="source in items"
        :key="source.sourceId"
        class="poi-source-card"
        :class="{ 'border-primary': isSelected(source.sourceId) }"
        @click="toggleSelect(source)"
      >
        <div class="card-body py-2 px-3">
          <div class="d-flex align-items-center gap-2 mb-1">
            <span class="badge" :class="source.mode === 'local' ? 'bg-primary' : 'bg-info'">
              {{ source.mode === 'local' ? t("poisource.local") : t("poisource.remote") }}
            </span>
            <span
              v-if="isSelected(source.sourceId)"
              class="badge bg-success"
            >
              {{ t("applist.deselect") }}
            </span>
          </div>
          <p class="mb-0 fw-medium" style="font-size: 13px;">{{ source.title }}</p>
          <small class="text-muted">
            {{ source.featureCount !== null ? `${source.featureCount} ${t("poisource.features")}` : '-' }}
          </small>
        </div>
      </div>
    </div>

    <!-- Pagination -->
    <div v-if="items.length > 0" class="d-flex align-items-center justify-content-center gap-2 mt-3">
      <button
        class="btn btn-sm btn-outline-secondary"
        :disabled="!hasPrev"
        @click="prevPage"
      >
        &lt;
      </button>
      <span class="text-muted small">{{ t("applist.page", { page: currentPage }) }}</span>
      <button
        class="btn btn-sm btn-outline-secondary"
        :disabled="!hasNext"
        @click="nextPage"
      >
        &gt;
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from "vue";
import { useTranslation } from "i18next-vue";
import { usePoiSourceList } from "../composables/usePoiSourceList";
import type { SelectedPoiSourceRef, PoiSourceSummary } from "../services/registeredPoiSourceCatalog";

const { t } = useTranslation();

const props = defineProps<{
  initialSelected?: SelectedPoiSourceRef[];
}>();

const emit = defineEmits<{
  "update:selected": [value: SelectedPoiSourceRef[]];
}>();

const {
  items,
  loading,
  error,
  loadSources,
  nextPage,
  prevPage,
  currentPage,
  hasNext,
  hasPrev,
} = usePoiSourceList();

const selectedSources = ref<SelectedPoiSourceRef[]>([]);

onMounted(() => {
  if (props.initialSelected) {
    selectedSources.value = [...props.initialSelected];
  }
  loadSources();
});

watch(
  () => props.initialSelected,
  (newVal) => {
    if (newVal) {
      selectedSources.value = [...newVal];
    }
  }
);

function isSelected(sourceId: string): boolean {
  return selectedSources.value.some((s) => s.sourceId === sourceId);
}

function toggleSelect(source: PoiSourceSummary) {
  if (isSelected(source.sourceId)) {
    selectedSources.value = selectedSources.value.filter(
      (s) => s.sourceId !== source.sourceId
    );
  } else {
    const ref: SelectedPoiSourceRef = {
      kind: "registered-poi-source",
      sourceId: source.sourceId,
      catalogKey: source.catalogKey,
      mode: source.mode,
      cachedTitle: source.title,
    };
    selectedSources.value.push(ref);
  }
  emit("update:selected", [...selectedSources.value]);
}
</script>

<style scoped>
.poi-source-card {
    width: 200px;
    background: #fff;
    box-shadow: 0 2px 5px rgba(0,0,0,0.15);
    border: 2px solid transparent;
    border-radius: 4px;
    cursor: pointer;
    transition: border-color 0.15s, box-shadow 0.15s;
}
.poi-source-card:hover {
    box-shadow: 0 4px 8px rgba(0,0,0,0.2);
}
.poi-source-card.border-primary {
    border-color: #0d6efd;
    box-shadow: 0 0 0 0.2rem rgba(13,110,253,0.25);
}
</style>
