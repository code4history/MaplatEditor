<script setup lang="ts">
// overlayソースの表示領域(envelopeLngLats)を地図上の矩形描画で指定するモーダル。
// 矩形(bbox)のみ扱う。非矩形の既存値はbboxに近似して表示する。
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useTranslation } from "i18next-vue";
import Map from "ol/Map";
import View from "ol/View";
import Feature from "ol/Feature";
import { Tile as TileLayer, Vector as VectorLayer } from "ol/layer";
import { OSM, Vector as VectorSource } from "ol/source";
import { Draw } from "ol/interaction";
import { createBox } from "ol/interaction/Draw";
import { Style, Stroke, Fill } from "ol/style";
import { fromExtent } from "ol/geom/Polygon";
import { transformExtent } from "ol/proj";
import { bboxToEnvelope, envelopeToBbox } from "../utils/appSourceModel";

const props = defineProps<{
  modelValue: [number, number][] | null;
  // 初期表示中心（envelope未設定時に使用）
  fallbackCenter?: [number, number];
}>();
const emit = defineEmits<{
  (e: "update:modelValue", value: [number, number][] | null): void;
  (e: "close"): void;
}>();

const { t } = useTranslation();
const mapElement = ref<HTMLDivElement | null>(null);
let map: Map | null = null;
let draw: Draw | null = null;
const vectorSource = new VectorSource();
const currentBbox = ref<[number, number, number, number] | null>(null);

const boxStyle = new Style({
  stroke: new Stroke({ color: "#dc3545", width: 2, lineDash: [6, 6] }),
  fill: new Fill({ color: "rgba(220, 53, 69, 0.08)" }),
});

function renderBbox(bbox: [number, number, number, number] | null) {
  vectorSource.clear();
  if (!bbox) return;
  const extent = transformExtent(bbox, "EPSG:4326", "EPSG:3857");
  vectorSource.addFeature(new Feature({ geometry: fromExtent(extent) }));
}

onMounted(() => {
  currentBbox.value = envelopeToBbox(props.modelValue);
  map = new Map({
    target: mapElement.value!,
    layers: [
      new TileLayer({ source: new OSM() }),
      new VectorLayer({ source: vectorSource, style: boxStyle }),
    ],
    view: new View({ center: [0, 0], zoom: 2 }),
  });
  renderBbox(currentBbox.value);
  if (currentBbox.value) {
    const extent = transformExtent(currentBbox.value, "EPSG:4326", "EPSG:3857");
    map.getView().fit(extent, { padding: [40, 40, 40, 40], maxZoom: 16 });
  } else if (props.fallbackCenter) {
    const extent = transformExtent(
      [props.fallbackCenter[0] - 0.05, props.fallbackCenter[1] - 0.05, props.fallbackCenter[0] + 0.05, props.fallbackCenter[1] + 0.05],
      "EPSG:4326",
      "EPSG:3857",
    );
    map.getView().fit(extent, { maxZoom: 14 });
  }
  draw = new Draw({
    source: vectorSource,
    type: "Circle",
    geometryFunction: createBox(),
  });
  draw.on("drawstart", () => {
    vectorSource.clear();
  });
  draw.on("drawend", (event) => {
    const geometry = event.feature.getGeometry();
    if (!geometry) return;
    const extent = transformExtent(geometry.getExtent(), "EPSG:3857", "EPSG:4326");
    currentBbox.value = [
      round6(extent[0]),
      round6(extent[1]),
      round6(extent[2]),
      round6(extent[3]),
    ];
  });
  map.addInteraction(draw);
});

onBeforeUnmount(() => {
  map?.setTarget(undefined);
  map = null;
});

watch(currentBbox, (bbox) => {
  // drawend後のfeatureはそのまま表示に使うため、クリア時のみ再描画
  if (!bbox) vectorSource.clear();
});

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function clearBox() {
  currentBbox.value = null;
  vectorSource.clear();
}

function confirm() {
  emit("update:modelValue", currentBbox.value ? bboxToEnvelope(currentBbox.value) : null);
  emit("close");
}
</script>

<template>
  <div class="modal show d-block envelope-modal" tabindex="-1">
    <div class="modal-dialog modal-xl">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title">{{ t("appedit.envelope_modal_title") }}</h5>
          <button type="button" class="btn-close" @click="emit('close')"></button>
        </div>
        <div class="modal-body">
          <p class="small text-muted mb-2">{{ t("appedit.envelope_modal_help") }}</p>
          <div ref="mapElement" class="envelope-map"></div>
          <div class="small mt-2 font-monospace">
            <template v-if="currentBbox">
              W {{ currentBbox[0] }} / S {{ currentBbox[1] }} / E {{ currentBbox[2] }} / N {{ currentBbox[3] }}
            </template>
            <template v-else>—</template>
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-outline-danger me-auto" @click="clearBox">
            {{ t("appedit.envelope_clear") }}
          </button>
          <button type="button" class="btn btn-secondary" @click="emit('close')">
            {{ t("basemap.modal.cancel") }}
          </button>
          <button type="button" class="btn btn-primary" @click="confirm">
            {{ t("appedit.confirm") }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.envelope-modal {
  background: rgba(0, 0, 0, 0.4);
}
.envelope-map {
  width: 100%;
  height: 55vh;
  border: 1px solid var(--bs-border-color);
}
</style>
