<script setup lang="ts">
// アプリのホームポジション(経緯度)を地図クリックで指定するモーダル。
// fallbackCenterは未設定時に全球表示を避けるための目安の初期中心(厳密性は不要)。
import { onBeforeUnmount, onMounted, ref } from "vue";
import { useTranslation } from "i18next-vue";
import Map from "ol/Map";
import View from "ol/View";
import Feature from "ol/Feature";
import Point from "ol/geom/Point";
import { Vector as VectorLayer } from "ol/layer";
import { Vector as VectorSource } from "ol/source";
import { fromLonLat, toLonLat } from "ol/proj";
import i18next from "i18next";
// @ts-ignore ジオコーディングコントロール(MapEditベースマップ側と同一のバンドル同梱ライブラリ)
import Geocoder from "../libs/ol-geocoder/base";
import { layoutMapOverlayControls, mapOverlayControlDefaults, createBaseMapSwitcher, haloPointStyles } from "../utils/mapOverlayTools";
import type { BaseMapSwitcher } from "../utils/mapOverlayTools";
import { createOverlayBaseMaps } from "../utils/overlayBaseMaps";
import type { OverlayBaseMapItem } from "../utils/overlayBaseMaps";
import ContextHelp from "./editor-ui/ContextHelp.vue";

const props = defineProps<{
  modelValue: [number, number] | null;
  // 初期表示中心（ホームポジション未設定時に使用）
  fallbackCenter?: [number, number];
}>();
const emit = defineEmits<{
  (e: "update:modelValue", value: [number, number] | null): void;
  (e: "close"): void;
}>();

const { t } = useTranslation();
const mapElement = ref<HTMLDivElement | null>(null);
let map: Map | null = null;
// onMounted の await の間に小窓が閉じられたら、閉じた後に Map を作らない
let disposed = false;
const vectorSource = new VectorSource();
const currentPosition = ref<[number, number] | null>(null);
// §5-5: 小窓にもベースマップの切り替えを置く（明るい OSM だけでは古地図の範囲を合わせにくい場合に備える）
const baseMapList = ref<OverlayBaseMapItem[]>([]);
const currentBaseMapID = ref("osm");
let baseMapSwitcher: BaseMapSwitcher | null = null;
const currentBaseMapLabel = (): string =>
  baseMapList.value.find((item) => item.mapID === currentBaseMapID.value)?.label ?? "";

// §5-7: ホーム位置の点は不透明にし、白 1.5px の halo と濃い灰の細線を重ねる
const markerStyle = haloPointStyles("#dc3545", 8, { strokeColor: "#dc3545", strokeWidth: 2 });

function renderMarker(position: [number, number] | null) {
  vectorSource.clear();
  if (!position) return;
  vectorSource.addFeature(new Feature({ geometry: new Point(fromLonLat(position)) }));
}

onMounted(async () => {
  currentPosition.value = props.modelValue ? [...props.modelValue] : null;
  const initialCenter = currentPosition.value || props.fallbackCenter || null;
  const baseMaps = await createOverlayBaseMaps(
    i18next.language,
    currentBaseMapID.value,
    t("mapedit.control_basemap"),
  );
  if (disposed || !mapElement.value) return;
  baseMapList.value = baseMaps.items;
  if (!baseMaps.items.some((item) => item.mapID === currentBaseMapID.value)) {
    currentBaseMapID.value = baseMaps.items[0]?.mapID || "osm";
  }
  baseMaps.group.getLayers?.().forEach((layer: any) => {
    layer.setVisible(layer.get("mapID") === currentBaseMapID.value);
    layer.on("change:visible", () => {
      if (layer.getVisible()) {
        currentBaseMapID.value = layer.get("mapID");
        baseMapSwitcher?.refreshLabel();
      }
    });
  });

  map = new Map({
    target: mapElement.value!,
    layers: [
      baseMaps.group,
      new VectorLayer({ source: vectorSource, style: markerStyle }),
    ],
    view: new View({
      center: initialCenter ? fromLonLat(initialCenter) : [0, 0],
      zoom: initialCenter ? 13 : 2,
    }),
    // §5-3: 小窓も MapEdit・POI と同じ部品の名前を使う
    controls: mapOverlayControlDefaults({
      zoomIn: t("mapedit.control_zoom_in"),
      zoomOut: t("mapedit.control_zoom_out"),
      resetRotation: t("mapedit.control_reset_rotation"),
    }),
  });

  // §5-4: ベースマップの切り替え（右上。今の選択の名前を札に出し、クリックで開く）
  baseMapSwitcher = createBaseMapSwitcher({
    tipLabel: t("mapedit.control_basemap"),
    labelOf: currentBaseMapLabel,
  });
  map.addControl(baseMapSwitcher.control);
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

  // 地図の上に重ねる部品を §4.2 の配置へ並べる（左上の一列・右下の帰属表示）
  layoutMapOverlayControls(mapElement.value, mapElement.value?.querySelector('.map-overlay-tools'), { searchAddress: t("mapedit.control_search_address") });
});

onBeforeUnmount(() => {
  disposed = true;
  map?.setTarget(undefined);
  map = null;
  baseMapSwitcher = null;
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
  <div data-testid="home-position-dialog" class="modal show d-block home-position-modal" tabindex="-1">
    <div class="modal-dialog modal-xl">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title d-flex align-items-center gap-1">{{ t("appedit.home_modal_title") }} <ContextHelp :text="t('appedit.home_modal_help')" :ariaLabel="t('appedit.home_modal_help')" /></h5>
          <button type="button" class="btn-close" @click="emit('close')"></button>
        </div>
        <div class="modal-body">
          <div ref="mapElement" class="home-position-map">
            <!-- 地図の上の道具の余白（帰属表示は layoutMapOverlayControls がここへ置く） -->
            <div class="map-overlay-tools" data-testid="map-overlay-tools-home-position"></div>
          </div>
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
          <button type="button" class="btn btn-outline-secondary" @click="emit('close')">
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
.home-position-modal {
  background: rgba(0, 0, 0, 0.4);
}
.home-position-map {
  position: relative;
  width: 100%;
  height: 55vh;
  border: 1px solid var(--bs-border-color);
}
</style>
