<script setup lang="ts">
// 経緯度範囲(利用範囲/存在範囲)を地図上の矩形描画で指定するモーダル。
// 矩形(bbox)のみ扱う。非矩形の既存値はbboxに近似して表示する。
// coverageLngLats(地図の存在範囲)は薄青、appCoverageLngLats(アプリ提供範囲)は薄緑で表示。
// 描画はどちらの境界にもスナップし、確定値は存在範囲の内側に自動クロップされる
// (アプリ提供範囲は目安であり、はみ出し可)(ADR-0004)。
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useTranslation } from "i18next-vue";
import Map from "ol/Map";
import View from "ol/View";
import Feature from "ol/Feature";
import { Tile as TileLayer, Vector as VectorLayer } from "ol/layer";
import { OSM, XYZ, Vector as VectorSource } from "ol/source";
import { Draw, Snap } from "ol/interaction";
import { createBox } from "ol/interaction/Draw";
import { Style, Stroke, Fill } from "ol/style";
import { fromExtent } from "ol/geom/Polygon";
import { transformExtent } from "ol/proj";
// @ts-ignore ジオコーディングコントロール(MapEditベースマップ側と同一のバンドル同梱ライブラリ)
import Geocoder from "../libs/ol-geocoder/base";
import { bboxToEnvelope, envelopeToBbox } from "../utils/appSourceModel";

const props = defineProps<{
  modelValue: [number, number][] | null;
  // 初期表示中心（範囲未設定時に使用）
  fallbackCenter?: [number, number];
  // 存在範囲(薄青表示 + スナップ + 描画クロップの境界)。未指定なら自由描画
  coverageLngLats?: [number, number][] | null;
  // アプリ提供範囲(薄緑表示 + スナップのみ。クロップはしない)
  appCoverageLngLats?: [number, number][] | null;
  // モーダルの文言(翻訳キー)。未指定なら利用範囲(envelope)用の既定文言
  titleKey?: string;
  helpKey?: string;
  // 対象ベースマップのタイルをOSMの上に重ねて表示する(URLテンプレート定義済みの場合)。
  // タイルが実在する範囲を目視しながら正確に範囲指定できるようにするため
  overlayTms?: { url: string; minZoom?: number; maxZoom?: number } | null;
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
const appCoverageSource = new VectorSource();
const currentBbox = ref<[number, number, number, number] | null>(null);

const boxStyle = new Style({
  stroke: new Stroke({ color: "#dc3545", width: 2, lineDash: [6, 6] }),
  fill: new Fill({ color: "rgba(220, 53, 69, 0.08)" }),
});

// 存在範囲: 薄い青のポリゴン
const coverageStyle = new Style({
  stroke: new Stroke({ color: "#0d6efd", width: 1 }),
  fill: new Fill({ color: "rgba(13, 110, 253, 0.08)" }),
});

// アプリ提供範囲: 薄い緑のポリゴン
const appCoverageStyle = new Style({
  stroke: new Stroke({ color: "#198754", width: 1 }),
  fill: new Fill({ color: "rgba(25, 135, 84, 0.08)" }),
});

function coverageBbox(): [number, number, number, number] | null {
  return envelopeToBbox(props.coverageLngLats ?? null);
}

function appCoverageBbox(): [number, number, number, number] | null {
  return envelopeToBbox(props.appCoverageLngLats ?? null);
}

function renderBbox(bbox: [number, number, number, number] | null) {
  vectorSource.clear();
  if (!bbox) return;
  const extent = transformExtent(bbox, "EPSG:4326", "EPSG:3857");
  vectorSource.addFeature(new Feature({ geometry: fromExtent(extent) }));
}

onMounted(() => {
  currentBbox.value = envelopeToBbox(props.modelValue);
  // 対象タイルのオーバーレイ(OSMの上、ガイド/描画レイヤの下)。
  // タイルが無い場所は404で透過し、下のOSMが見える=タイル実在範囲がそのまま視認できる。
  // 注意: XYZソースのminZoom(タイルグリッド最小ズーム)は絶対に設定しないこと。
  // 広域表示時にそのズームのタイルで全域を敷き詰めようとして(例: z15なら約10億枚)
  // レンダラーがフリーズ→クラッシュする。低ズームは404の透過に任せ、
  // 無駄なリクエストはレイヤ側のminZoom(表示ズーム閾値)で抑える。
  // 定義不備で失敗してもモーダル自体は使えるように、失敗時はオーバーレイなしで続行する
  let overlayLayers: TileLayer<XYZ>[] = [];
  try {
    if (props.overlayTms?.url) {
      const tmsMinZoom = props.overlayTms.minZoom ?? 0;
      // 提供域全域を一望して囲めるよう、minZoomの4段下のズームからオーバーレイを表示する
      // (それより下ではz=minZoomタイルの列挙がviewport比256倍を超えて危険なため描画しない)
      const overlayGateZoom = Math.max(0, tmsMinZoom - 4);
      overlayLayers = [
        new TileLayer({
          // レイヤminZoom(「viewズーム > minZoom で表示」の排他的閾値)で描画をゲートする。
          // このゲートがあることで、下のグリッドminZoomは高々4段階のアップスケール
          // (タイル列挙はviewport比≤256倍、実フェッチは提供域内+キャッシュされる404のみ)に収まる
          ...(overlayGateZoom > 0 ? { minZoom: overlayGateZoom } : {}),
          source: new XYZ({
            url: props.overlayTms.url,
            maxZoom: props.overlayTms.maxZoom ?? 18,
            // グリッドminZoom: minZoom未満のviewでもz=minZoomのタイルを拡大表示する。
            // レイヤゲートなしで設定すると広域表示時に全域分のタイル列挙
            // (z15なら約10億枚)でレンダラーがクラッシュするため、必ず上のゲートとセットで使う
            ...(tmsMinZoom > 0 ? { minZoom: tmsMinZoom } : {}),
          }),
        }),
      ];
    }
  } catch (e) {
    console.error("Failed to create overlay tile layer:", e);
  }
  map = new Map({
    target: mapElement.value!,
    layers: [
      new TileLayer({ source: new OSM() }),
      ...overlayLayers,
      new VectorLayer({ source: appCoverageSource, style: appCoverageStyle }),
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
  const appCoverage = appCoverageBbox();
  if (appCoverage) {
    const extent = transformExtent(appCoverage, "EPSG:4326", "EPSG:3857");
    appCoverageSource.addFeature(new Feature({ geometry: fromExtent(extent) }));
  }
  renderBbox(currentBbox.value);
  // 既存データが退化した範囲(空/一点)でもモーダルの初期化を止めない
  try {
    const fitTarget = currentBbox.value || coverage || appCoverage;
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
  } catch (e) {
    console.error("Failed to fit initial extent:", e);
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
  // 存在範囲/アプリ提供範囲の辺・頂点へポインタをスナップさせる(Drawより後に追加)
  if (coverage) map.addInteraction(new Snap({ source: coverageSource }));
  if (appCoverage) map.addInteraction(new Snap({ source: appCoverageSource }));

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

  // モーダル挿入直後はレイアウト確定前でOpenLayersがサイズ0を掴むことがあるため、
  // 描画フレーム後にサイズを再計測する(モーダル内地図の定番対策)
  requestAnimationFrame(() => map?.updateSize());
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
  <!-- 親がモーダル(ベースマップ編集等)でも確実に前面へ出るよう、body直下へテレポートし
       z-indexをBootstrapモーダル既定(1055)より上げる。親のスタッキング文脈の影響も受けない -->
  <Teleport to="body">
  <div class="modal show d-block envelope-modal" tabindex="-1">
    <div class="modal-dialog modal-xl">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title">{{ t(titleKey || "appedit.envelope_modal_title") }}</h5>
          <button type="button" class="btn-close" @click="emit('close')"></button>
        </div>
        <div class="modal-body">
          <p class="small text-muted mb-2">
            {{ t(helpKey || (coverageLngLats || appCoverageLngLats ? "appedit.envelope_modal_help_with_coverage" : "appedit.envelope_modal_help")) }}
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
  </Teleport>
</template>

<style scoped>
.envelope-modal {
  background: rgba(0, 0, 0, 0.4);
  z-index: 1080;
}
.envelope-map {
  width: 100%;
  height: 55vh;
  border: 1px solid var(--bs-border-color);
}
</style>
