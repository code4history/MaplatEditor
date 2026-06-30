<template>
  <div>
    <div v-if="features.features.length === 0" class="text-muted text-center py-3">
      {{ t("poisource.feature_table.no_features") }}
    </div>
    <table v-else class="table table-sm table-bordered">
      <thead>
        <tr>
          <th>{{ t("poisource.feature_table.name") }}</th>
          <th>{{ t("poisource.feature_table.longitude") }}</th>
          <th>{{ t("poisource.feature_table.latitude") }}</th>
          <th v-if="!readOnly">{{ t("poisource.feature_table.actions") }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(feature, index) in localFeatures" :key="feature.id ?? `new-${index}`">
          <td>
            <input
              type="text"
              class="form-control form-control-sm"
              :class="{ 'is-invalid': isNameInvalid(feature) }"
              :value="feature.properties?.name ?? ''"
              :disabled="readOnly"
              @input="onNameChange(index, ($event.target as HTMLInputElement).value)"
            />
          </td>
          <td>
            <input
              type="number"
              class="form-control form-control-sm"
              :class="{ 'is-invalid': !isValidLongitude(feature.geometry?.coordinates?.[0]) }"
              :value="feature.geometry?.coordinates?.[0] ?? 0"
              :disabled="readOnly"
              step="0.000001"
              @input="onLongitudeChange(index, ($event.target as HTMLInputElement).valueAsNumber)"
            />
          </td>
          <td>
            <input
              type="number"
              class="form-control form-control-sm"
              :class="{ 'is-invalid': !isValidLatitude(feature.geometry?.coordinates?.[1]) }"
              :value="feature.geometry?.coordinates?.[1] ?? 0"
              :disabled="readOnly"
              step="0.000001"
              @input="onLatitudeChange(index, ($event.target as HTMLInputElement).valueAsNumber)"
            />
          </td>
          <td v-if="!readOnly">
            <button
              class="btn btn-sm btn-outline-danger"
              @click="removeFeature(index)"
            >
              {{ t("poisource.feature_table.delete") }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>
    <button v-if="!readOnly" class="btn btn-sm btn-outline-primary" @click="addFeature">
      {{ t("poisource.feature_table.add_feature") }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { useTranslation } from "i18next-vue";
import type { PoiFeatureCollection } from "../services/registeredPoiSourceCatalog";

const { t } = useTranslation();

const props = defineProps<{
  features: PoiFeatureCollection;
  readOnly?: boolean;
}>();

const emit = defineEmits<{
  "update:features": [value: PoiFeatureCollection];
}>();

const localFeatures = ref([...props.features.features]);

watch(
  () => props.features,
  (newVal) => {
    localFeatures.value = [...newVal.features];
  },
  { deep: true }
);

function emitChange() {
  emit("update:features", {
    type: "FeatureCollection",
    features: localFeatures.value,
  });
}

function onNameChange(index: number, value: string) {
  const feature = localFeatures.value[index];
  if (!feature.properties) feature.properties = {};
  feature.properties.name = value;
  emitChange();
}

function onLongitudeChange(index: number, value: number) {
  const feature = localFeatures.value[index];
  if (!feature.geometry) {
    feature.geometry = { type: "Point", coordinates: [0, 0] };
  }
  feature.geometry.coordinates[0] = value;
  emitChange();
}

function onLatitudeChange(index: number, value: number) {
  const feature = localFeatures.value[index];
  if (!feature.geometry) {
    feature.geometry = { type: "Point", coordinates: [0, 0] };
  }
  feature.geometry.coordinates[1] = value;
  emitChange();
}

function addFeature() {
  localFeatures.value.push({
    type: "Feature",
    geometry: { type: "Point", coordinates: [0, 0] },
    properties: { name: "" },
  });
  emitChange();
}

function removeFeature(index: number) {
  if (!confirm(t("poisource.feature_table.confirm_delete"))) return;
  localFeatures.value.splice(index, 1);
  emitChange();
}

function isNameInvalid(feature: any): boolean {
  const name = feature.properties?.name;
  return !name || typeof name !== "string" || !name.trim();
}

function isValidLongitude(value: unknown): boolean {
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  return value >= -180 && value <= 180;
}

function isValidLatitude(value: unknown): boolean {
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  return value >= -90 && value <= 90;
}

defineExpose({ localFeatures });
</script>
