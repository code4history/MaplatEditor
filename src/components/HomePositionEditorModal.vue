<script setup lang="ts">
// アプリのホームポジション(経緯度)を地図クリックで指定するモーダル。
// fallbackCenterは未設定時に全球表示を避けるための目安の初期中心(厳密性は不要)。
import { onBeforeUnmount, onMounted, ref } from "vue";
import { useTranslation } from "i18next-vue";
import Map from "ol/Map";
import View from "ol/View";
import Feature from "ol/Feature";
import Point from "ol/geom/Point";
import { Tile as TileLayer, Vector as VectorLayer } from "ol/layer";
import { OSM, Vector as VectorSource } from "ol/source";
import { Style, Circle as CircleStyle, Stroke, Fill } from "ol/style";
import { fromLonLat, toLonLat } from "ol/proj";
// @ts-ignore ジオコーディングコントロール(MapEditベースマップ側と同一のバンドル同梱ライブラリ)
import Geocoder from "../libs/ol-geocoder/base";

const props = defineProps<{
  modelValue: [number, number] | null;
  // 初期表示中心（ホームポジション未設定時に使用）
  fallbackCenter?: [number, number];
  // true のとき「推定」ボタンを表示する
  enableEstimate?: boolean;
}>();
const emit = defineEmits<{
  (e: "update:modelValue", value: [number, number] | null): void;
  (e: "estimate"): void;
  (e: "close"): void;
}>();

const { t } = useTranslation();
const mapElement = ref<HTMLDivElement | null>(null);
let map: Map | null = null;
const vectorSource = new VectorSource();
const currentPosition = ref<[number, number] | null>(null);

const markerStyle = new Style({
  image: new CircleStyle({
    radius: 8,
    stroke: new Stroke({ color: "#dc3545", width: 2 }),
    fill: new Fill({ color: "rgba(220, 53, 69, 0.4)" }),
  }),
});

function renderMarker(position: [number, number] | null) {
  vectorSource.clear();
  if (!position) return;
  vectorSource.addFeature(new Feature({ geometry: new Point(fromLonLat(position)) }));
}

onMounted(() => {
  currentPosition.value = props.modelValue ? [...props.modelValue] : null;
  const initialCenter = currentPosition.value || props.fallbackCenter || null;
  map = new Map({
    target: mapElement.value!,
    layers: [
      new TileLayer({ source: new OSM() }),
      new VectorLayer({ source: vectorSource, style: markerStyle }),
    ],
    view: new View({
      center: initialCenter ? fromLonLat(initialCenter) : [0, 0],
      zoom: initialCenter ? 13 : 2,
    }),
  });
  renderMarker(currentPosition.value);
  map.on("singleclick", (event) => {
    const [lng, lat] = toLonLat(event.coordinate);
    currentPosition.value = [round6(lng), round6(lat)];
    renderMarker(currentPosition.value);
  });

  // 住所検索(ジオコーディング)で希望地域へ一気に移動できるようにする。
  // MapEditのベースマップ側と同じ設定・挙動(選択時にビューをfit、ピンは表示しない)
  const geocoder = new Geocoder("nominatim", {
    provider: "osm",
    lang: "en-US",
    placeholder: t("mapedit.control_put_address"),
    limit: 5,
    keepOpen: false,
  });
  geocoder.on("addresschosen", () => {
    if (geocoder.getLayer && geocoder.getLayer()) {
      geocoder.getLayer().getSource().clear();
    }
  });
  map.addControl(geocoder);
});

onBeforeUnmount(() => {
  map?.setTarget(undefined);
  map = null;
});

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function clearPosition() {
  currentPosition.value = null;
  vectorSource.clear();
}

function confirm() {
  emit("update:modelValue", currentPosition.value);
  emit("close");
}
</script>

<template>
  <div class="modal show d-block home-position-modal" tabindex="-1">
    <div class="modal-dialog modal-xl">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title">{{ t("appedit.home_modal_title") }}</h5>
          <button type="button" class="btn-close" @click="emit('close')"></button>
        </div>
        <div class="modal-body">
          <p class="small text-muted mb-2">{{ t("appedit.home_modal_help") }}</p>
          <div ref="mapElement" class="home-position-map"></div>
          <div class="small mt-2 font-monospace">
            <template v-if="currentPosition">
              {{ t("appedit.home_lng") }} {{ currentPosition[0] }} / {{ t("appedit.home_lat") }} {{ currentPosition[1] }}
            </template>
            <template v-else>—</template>
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-outline-danger me-auto" @click="clearPosition">
            {{ t("appedit.home_clear") }}
          </button>
          <button type="button" class="btn btn-secondary" @click="emit('close')">
            {{ t("basemap.modal.cancel") }}
          </button>
          <button
            v-if="enableEstimate"
            type="button"
            class="btn btn-outline-info"
            @click="emit('estimate')"
          >
            {{ t("common.estimate") }}
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
.home-position-modal {
  background: rgba(0, 0, 0, 0.4);
}
.home-position-map {
  width: 100%;
  height: 55vh;
  border: 1px solid var(--bs-border-color);
}
</style>
