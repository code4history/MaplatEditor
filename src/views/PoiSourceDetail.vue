<template>
  <div class="container-fluid p-3">
    <!-- Loading -->
    <div v-if="loading" class="text-muted text-center py-3">
      {{ t("poisource.loading") }}
    </div>

    <!-- Error -->
    <div v-else-if="error" class="alert alert-danger">
      {{ error }}
    </div>

    <!-- Detail -->
    <template v-else-if="document">
      <!-- Back button -->
      <button class="btn btn-sm btn-outline-secondary mb-3" @click="router.push('/poisources')">
        {{ t("poisource.detail.back") }}
      </button>

      <!-- Save error alert -->
      <div v-if="saveError" class="alert alert-danger alert-dismissible">
        {{ saveError }}
        <button type="button" class="btn-close" @click="saveError = null"></button>
      </div>

      <!-- Metadata -->
      <div class="card mb-3">
        <div class="card-body">
          <div class="row mb-2">
            <div class="col-sm-3 fw-bold">{{ t("poisource.detail.title_label") }}</div>
            <div class="col-sm-9">{{ document.summary.title }}</div>
          </div>
          <div class="row mb-2">
            <div class="col-sm-3 fw-bold">{{ t("poisource.detail.mode_label") }}</div>
            <div class="col-sm-9">
              <span class="badge" :class="document.summary.mode === 'local' ? 'bg-primary' : 'bg-info'">
                {{ document.summary.mode === 'local' ? t("poisource.local") : t("poisource.remote") }}
              </span>
            </div>
          </div>
          <div class="row mb-2">
            <div class="col-sm-3 fw-bold">{{ t("poisource.detail.status_label") }}</div>
            <div class="col-sm-9">
              <span
                class="badge"
                :class="{
                  'bg-success': document.summary.status === 'ready',
                  'bg-warning': document.summary.status === 'invalid',
                  'bg-danger': document.summary.status === 'unreachable',
                  'bg-secondary': document.summary.status === 'unknown'
                }"
              >
                {{ t(`poisource.status.${document.summary.status}`) }}
              </span>
            </div>
          </div>
          <div v-if="document.summary.url" class="row mb-2">
            <div class="col-sm-3 fw-bold">{{ t("poisource.detail.url_label") }}</div>
            <div class="col-sm-9">{{ document.summary.url }}</div>
          </div>
          <div class="row mb-2">
            <div class="col-sm-3 fw-bold">{{ t("poisource.detail.feature_count") }}</div>
            <div class="col-sm-9">
              {{ document.summary.featureCount !== null ? document.summary.featureCount : '-' }}
            </div>
          </div>
          <div v-if="document.summary.updatedAt" class="row mb-2">
            <div class="col-sm-3 fw-bold">{{ t("poisource.detail.updated_at") }}</div>
            <div class="col-sm-9">{{ document.summary.updatedAt }}</div>
          </div>
        </div>
      </div>

      <!-- Remote read-only badge -->
      <div v-if="document.summary.readOnly" class="alert alert-info">
        {{ t("poisource.detail.read_only") }}
      </div>

      <!-- Feature Table -->
      <div class="mb-3">
        <h6>{{ t("poisource.features") }}</h6>
        <PoiFeatureTable
          v-model:features="geojson"
          :read-only="document.summary.readOnly"
          @update:features="markDirty"
        />
      </div>

      <!-- Actions -->
      <div class="d-flex gap-2">
        <button
          v-if="!document.summary.readOnly"
          class="btn btn-primary"
          :disabled="!isDirty || hasInvalidFeatures"
          @click="handleSave"
        >
          {{ t("poisource.detail.save") }}
        </button>
        <button
          v-if="document.summary.mode === 'remote'"
          class="btn btn-outline-info"
          @click="handleValidate"
        >
          {{ t("poisource.detail.validate") }}
        </button>
        <button
          class="btn btn-outline-danger"
          @click="handleDelete"
        >
          {{ t("poisource.detail.delete") }}
        </button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useTranslation } from "i18next-vue";
import { usePoiSourceDetail } from "../composables/usePoiSourceDetail";
import PoiFeatureTable from "../components/PoiFeatureTable.vue";

const { t } = useTranslation();
const route = useRoute();
const router = useRouter();
const sourceId = route.params.sourceId as string;

const {
  document,
  geojson,
  loading,
  error,
  saveError,
  isDirty,
  loadDetail,
  save,
  deleteSource,
  validateRemote,
  markDirty,
} = usePoiSourceDetail();

const hasInvalidFeatures = computed(() => {
  return geojson.value.features.some((f) => {
    // name は LangResource: 内部形 {lang: text} / 交換形 string の双方を許容 (ADR-0005)
    const name = f.properties?.name;
    const nameOk =
      typeof name === "string"
        ? name.trim() !== ""
        : !!name &&
          typeof name === "object" &&
          Object.values(name).some((t) => typeof t === "string" && t.trim() !== "");
    if (!nameOk) return true;
    const coords = f.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length !== 2) return true;
    const [lon, lat] = coords;
    if (typeof lon !== "number" || typeof lat !== "number") return true;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return true;
    if (lon < -180 || lon > 180) return true;
    if (lat < -90 || lat > 90) return true;
    return false;
  });
});

onMounted(() => {
  loadDetail(sourceId);
});

async function handleSave() {
  await save(sourceId);
}

async function handleDelete() {
  if (!confirm(t("poisource.feature_table.confirm_delete"))) return;
  const ok = await deleteSource(sourceId);
  if (ok) {
    router.push("/poisources");
  }
}

async function handleValidate() {
  await validateRemote(sourceId);
}
</script>
