<script setup lang="ts">
// 経緯度範囲(利用範囲/存在範囲)を地図上の矩形描画で指定するモーダル。
// 矩形(bbox)のみ扱う。非矩形の既存値はbboxに近似して表示する。
// coverageLngLats(存在範囲)が渡された場合は薄色ポリゴンで表示し、
// 描画した矩形は存在範囲の内側に自動クロップする(ADR-0004)。
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
  // 初期表示中心（範囲未設定時に使用）
  fallbackCenter?: [number, number];
  // 存在範囲(薄色表示 + 描画クロップの境界)。未指定なら自由描画
  coverageLngLats?: [number, number][] | null;
  // モーダルの文言(翻訳キー)。未指定なら利用範囲(envelope)用の既定文言
  titleKey?: string;
  helpKey?: string;
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
const coverageSource = new VectorSource();
const currentBbox = ref<[number, number, number, number] | null>(null);

const boxStyle = new Style({
  stroke: new Stroke({ color: "#dc3545", width: 2, lineDash: [6, 6] }),
  fill: new Fill({ color: "rgba(220, 53, 69, 0.08)" }),
});

// 存在範囲: 別色(青系)の薄いポリゴン
const coverageStyle = new Style({
  stroke: new Stroke({ color: "#0d6efd", width: 1 }),
  fill: new Fill({ color: "rgba(13, 110, 253, 0.08)" }),
});

function coverageBbox(): [number, number, number, number] | null {
  return envelopeToBbox(props.coverageLngLats ?? null);
}

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
      new VectorLayer({ source: coverageSource, style: coverageStyle }),
      new VectorLayer({ source: vectorSource, style: boxStyle }),
    ],
    view: new View({ center: [0, 0], zoom: 2 }),
  });
  const coverage = coverageBbox();
  if (coverage) {
    const extent = transformExtent(coverage, "EPSG:4326", "EPSG:3857");
    coverageSource.addFeature(new Feature({ geometry: fromExtent(extent) }));
  }
  renderBbox(currentBbox.value);
  const fitTarget = currentBbox.value || coverage;
  if (fitTarget) {
    const extent = transformExtent(fitTarget, "EPSG:4326", "EPSG:3857");
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
    const cropped = cropToCoverage([
      round6(extent[0]),
      round6(extent[1]),
      round6(extent[2]),
      round6(extent[3]),
    ]);
    currentBbox.value = cropped;
    // クロップ結果を正として矩形を描き直す
    renderBbox(cropped);
  });
  map.addInteraction(draw);
});

// 存在範囲の内側へ頂点をクロップ。交差しない場合はnull(選択なし)
function cropToCoverage(bbox: [number, number, number, number]): [number, number, number, number] | null {
  const coverage = coverageBbox();
  if (!coverage) return bbox;
  const west = Math.max(bbox[0], coverage[0]);
  const south = Math.max(bbox[1], coverage[1]);
  const east = Math.min(bbox[2], coverage[2]);
  const north = Math.min(bbox[3], coverage[3]);
  if (west >= east || south >= north) return null;
  return [round6(west), round6(south), round6(east), round6(north)];
}

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
          <h5 class="modal-title">{{ t(titleKey || "appedit.envelope_modal_title") }}</h5>
          <button type="button" class="btn-close" @click="emit('close')"></button>
        </div>
        <div class="modal-body">
          <p class="small text-muted mb-2">
            {{ t(helpKey || (coverageLngLats ? "appedit.envelope_modal_help_with_coverage" : "appedit.envelope_modal_help")) }}
          </p>
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
