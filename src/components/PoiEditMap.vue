<template>
  <!-- 地図ペイン (Phase 4 Task 6, 仕様 §3.3 POI-132)。base map selector は地図右上のオーバーレイ -->
  <div class="w-100 h-100 position-relative">
    <div id="poiEditMap" class="w-100 h-100"></div>
    <div class="position-absolute top-0 end-0 m-2" style="z-index: 10;">
      <select
        v-model="currentBaseMapID"
        class="form-select form-select-sm shadow-sm"
        :aria-label="t('mapedit.control_basemap')"
        @change="applyBaseMapSelection"
      >
        <option v-for="tms in baseMapList" :key="tms.mapID" :value="tms.mapID">
          {{ baseMapTitle(tms) }}
        </option>
      </select>
    </div>
  </div>
</template>

<script setup lang="ts">
// PoiEdit の地図ペイン (Phase 4 Task 6, 仕様 §3.3/§4)。
// MapEdit の確立済みパターン (MaplatMap ラッパ / setupBaseMaps / ol-contextmenu /
// SVG ピン data URI の Icon / forEachFeatureAtPixel 選択) を単一マップへ移植する。
// 点マーカーのドラッグ移動は marker vector source への OL Modify + Snap で新規に配線し、
// modifyend 1 回 = session.moveFeature 1 commit (=1 Undo、仕様 §5) とする。
// base map の切替は Undo 対象外 (編集内容ではない)。
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useTranslation } from "i18next-vue";
import i18next from "i18next";
// @ts-ignore
import ContextMenu from "../libs/ol-contextmenu/main";
// @ts-ignore
import { MaplatMap } from "@maplat/core/src/map_ex";
// @ts-ignore
import { mapSourceFactory } from "@maplat/core/src/source_ex";
import { defaults as interactionDefaults, Modify, Snap } from "ol/interaction";
import { defaults as controlDefaults } from "ol/control";
import "ol/ol.css";
import { Tile, Group } from "ol/layer";
import { Style, Icon } from "ol/style";
import { transform } from "ol/proj";
import { containsCoordinate } from "ol/extent";
import type VectorSource from "ol/source/Vector";
import type { Point } from "ol/geom";
import { localizeTitle } from "../utils/langResource";
import type { PoiEditSession } from "../composables/usePoiEditSession";

const props = defineProps<{
  session: PoiEditSession;
  readOnly: boolean;
}>();

const { t } = useTranslation();
// session は PoiEdit が一度だけ生成する不変オブジェクト (中の ref がリアクティブ)
const session = props.session;

// MapEdit の初期 view を踏襲 (東京付近、EPSG:3857)
const DEFAULT_CENTER = [15545266.36, 4253560.83];
const DEFAULT_ZOOM = 5;

let map: any = null;
let markerSource: VectorSource | null = null;
let modify: Modify | null = null;
let contextmenu: any = null;

// Modify ドラッグ中は watch 経由の全再描画 (source.clear) がドラッグと競合するため抑制する。
// modifyend で必ず「commit → watch 再描画」か「redrawMarkers()」のどちらかに到達するので
// 取りこぼしはない
let modifyActive = false;
let modifyTarget: { uid: string } | null = null;

const baseMapList = ref<any[]>([]);
const currentBaseMapID = ref("osm");

// --- マーカースタイル (SVG ピン data URI の Icon、anchor [0.5, 1]。選択中は色違い) ---
const pinStyles: Record<string, Style> = {};
const pinStyle = (selected: boolean): Style => {
  const key = selected ? "selected" : "normal";
  if (!pinStyles[key]) {
    const fill = selected ? "#FF5533" : "#3B7CFF";
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="36" viewBox="0 0 26 36">
<path d="M13 1C6.4 1 1 6.4 1 13c0 9 12 22 12 22s12-13 12-22C25 6.4 19.6 1 13 1z" fill="${fill}" stroke="#333333" stroke-width="1.5"/>
<circle cx="13" cy="13" r="4.5" fill="#FFFFFF"/></svg>`;
    pinStyles[key] = new Style({
      image: new Icon({
        src: `data:image/svg+xml,${encodeURIComponent(svg)}`,
        anchor: [0.5, 1],
      }),
    });
  }
  return pinStyles[key];
};

// --- helper ---
const featureUid = (feature: any): string | null => {
  const uid = feature?.get?.("_maplatUid");
  return typeof uid === "string" ? uid : null;
};

// MapEdit の arrayRoundTo(lonlat, 6) 踏襲 (Write Store には入力時精度のまま保存される)
const roundLngLat = (lonlat: number[]): [number, number] => [
  Math.round(lonlat[0] * 1e6) / 1e6,
  Math.round(lonlat[1] * 1e6) / 1e6,
];

const sessionCoords = (uid: string): [number, number] | null => {
  const feature = session.state.value?.features.find(
    (f) => f.properties?._maplatUid === uid,
  );
  const coords = feature?.geometry?.coordinates;
  return Array.isArray(coords) ? [coords[0], coords[1]] : null;
};

// --- マーカー描画 (features は snapshot 差し替えで通知される: usePoiEditSession は shallowRef) ---
const redrawMarkers = (): void => {
  if (!map || !markerSource) return;
  if (modifyActive) return; // ドラッグ確定後の経路で必ず再描画される
  markerSource.clear();
  const state = session.state.value;
  if (!state) return;
  for (const feature of state.features) {
    const uid = feature.properties?._maplatUid;
    const coords = feature.geometry?.coordinates;
    if (typeof uid !== "string" || !Array.isArray(coords)) continue;
    const merc = transform([coords[0], coords[1]], "EPSG:4326", "EPSG:3857");
    map.setMarker(
      merc,
      { _maplatUid: uid },
      pinStyle(uid === session.selectedUid.value),
      "marker",
    );
  }
};

watch(session.state, () => redrawMarkers());

// 選択の変更はスタイル再適用のみ (全再描画しない)。選択 feature が画面外なら pan する
// (Task 8 の一覧クリック選択にもこの watch が効く)
watch(session.selectedUid, (uid) => {
  if (!markerSource) return;
  for (const feature of markerSource.getFeatures()) {
    feature.setStyle(pinStyle(featureUid(feature) === uid));
  }
  if (uid) panToIfOffscreen(uid);
});

// ReadOnly (remote): contextmenu / Modify を無効化 (閲覧の pan/zoom / クリック選択は可)。
// cloneToLocal 遷移などで readOnly が動的に変わっても追随する
watch(
  () => props.readOnly,
  (ro) => {
    modify?.setActive(!ro);
    if (contextmenu) {
      if (ro) contextmenu.disable();
      else contextmenu.enable();
    }
  },
);

// --- クリック選択 (forEachFeatureAtPixel、layerFilter 'marker'、hitTolerance 5) ---
const onMapClick = (evt: any): void => {
  if (!map) return;
  const feature = map.forEachFeatureAtPixel(evt.pixel, (ft: any) => ft, {
    layerFilter: (layer: any) => layer.get("name") === "marker",
    hitTolerance: 5,
  });
  // 空地クリックは選択解除
  session.selectedUid.value = feature ? featureUid(feature) : null;
};

// --- contextmenu (MapEdit createContextMenu の移植: defaultItems:false、open で動的 push) ---
const createContextMenu = () => {
  const menu = new ContextMenu({
    width: 170,
    defaultItems: false,
    items: [],
  });

  menu.on("open", (evt: any) => {
    menu.clear();
    if (props.readOnly) return; // disable() 済みだが防御的に項目を出さない
    const feature = map.forEachFeatureAtPixel(evt.pixel, (ft: any) => ft, {
      layerFilter: (layer: any) => layer.get("name") === "marker",
      hitTolerance: 5,
    });
    const uid = feature ? featureUid(feature) : null;
    if (uid) {
      // feature 上: 「この POI を削除」(=1 Undo)
      session.selectedUid.value = uid;
      menu.push({
        text: t("poiedit.context_delete"),
        callback: () => session.removeFeature(uid),
      });
    } else {
      // 空地: 「POI を追加」(=1 Undo) + 選択
      menu.push({
        text: t("poiedit.context_add"),
        callback: (e: any) => addPoiAt(e.coordinate),
      });
    }
  });

  return menu;
};

const addPoiAt = (coordinate: number[]): void => {
  if (props.readOnly || !Array.isArray(coordinate)) return;
  const lngLat = roundLngLat(transform(coordinate, "EPSG:3857", "EPSG:4326"));
  const uid = session.addFeature(lngLat);
  session.selectedUid.value = uid;
};

// --- ドラッグ移動 (Modify + Snap)。modifystart で対象記録、modifyend で座標が実際に
// 変わった場合のみ moveFeature 1 回 = 1 Undo。ドラッグ中間状態は commit しない ---
const onModifyStart = (evt: any): void => {
  modifyActive = true;
  const feature = evt.features?.item?.(0);
  const uid = feature ? featureUid(feature) : null;
  modifyTarget = uid ? { uid } : null;
};

const onModifyEnd = (evt: any): void => {
  modifyActive = false;
  const target = modifyTarget;
  modifyTarget = null;
  if (target && !props.readOnly) {
    const features: any[] = evt.features?.getArray?.() ?? [];
    const feature = features.find((f) => featureUid(f) === target.uid);
    const merc = (feature?.getGeometry() as Point | undefined)?.getCoordinates();
    const before = sessionCoords(target.uid);
    if (merc && before) {
      const next = roundLngLat(transform(merc, "EPSG:3857", "EPSG:4326"));
      if (next[0] !== before[0] || next[1] !== before[1]) {
        // moveFeature が snapshot を差し替え watch が全再描画する。ドラッグ後の OL feature と
        // session の新座標は一致するので視覚的なジャンプは起きない
        session.moveFeature(target.uid, next);
        return;
      }
    }
  }
  // commit しなかった場合 (座標不変 / 対象不明 / ReadOnly) は canonical 位置へ再描画で戻す
  redrawMarkers();
};

// --- 選択の地図同期 API (Task 8 の一覧から panTo(uid) を呼ぶ) ---
const markerByUid = (uid: string) =>
  markerSource?.getFeatures().find((f) => featureUid(f) === uid);

const panTo = (uid: string): void => {
  const geom = markerByUid(uid)?.getGeometry() as Point | undefined;
  const center = geom?.getCoordinates();
  if (center && map) map.getView().animate({ center, duration: 300 });
};

const panToIfOffscreen = (uid: string): void => {
  if (!map) return;
  const geom = markerByUid(uid)?.getGeometry() as Point | undefined;
  const coords = geom?.getCoordinates();
  if (!coords) return;
  const extent = map.getView().calculateExtent(map.getSize());
  if (!containsCoordinate(extent, coords)) panTo(uid);
};

// --- 初期表示: features があれば全体が入る extent へ fit、無ければ日本付近デフォルト ---
const fitInitialView = (): void => {
  if (!map || !markerSource) return;
  const view = map.getView();
  if (markerSource.getFeatures().length > 0) {
    view.fit(markerSource.getExtent(), { padding: [80, 80, 80, 80], maxZoom: 16 });
  } else {
    view.setCenter(DEFAULT_CENTER.slice());
    view.setZoom(DEFAULT_ZOOM);
  }
};

// --- base map (MapEdit setupBaseMaps の移植) ---
const baseMapTitle = (tms: any): string => {
  const title = tms?.title ?? tms?.mapID ?? "";
  if (typeof title === "object" && title !== null) {
    return localizeTitle(title, i18next.language) || tms.mapID;
  }
  return String(title);
};

// POI ソースは地図単位の表示設定を持たないため、一覧は Always-Visible な base map
// (仕様 §3.3 POI-132) とする。IPC 失敗時は /tms_list.json → ハードコード既定 3 種の順で
// フォールバック (MapEdit と同じ)
const setupBaseMaps = async (): Promise<void> => {
  if (!map) return;

  if (baseMapList.value.length === 0) {
    try {
      const list = await window.baseMaps.list();
      baseMapList.value = list
        .filter((item) => item.alwaysVisible)
        .map((item) => item.data);
    } catch (e) {
      console.error("[PoiEditMap] Failed to fetch base map list via IPC:", e);
    }

    if (baseMapList.value.length === 0) {
      try {
        const response = await fetch("/tms_list.json");
        if (response.ok) {
          const json = await response.json();
          if (Array.isArray(json)) {
            const always = json.filter((tms) => tms.always);
            baseMapList.value = always.length > 0 ? always : json;
          }
        }
      } catch (e) {
        console.log("No tms_list.json found at root or failed to load.", e);
      }
    }

    if (baseMapList.value.length === 0) {
      baseMapList.value = [
        { mapID: "osm", title: "OpenStreetMap", maxZoom: 18 },
        { mapID: "gsi", title: "GSI Maps", maxZoom: 18 },
        { mapID: "gsi_ortho", title: "GSI Ortho", maxZoom: 18 },
      ];
    }
  }

  // default は 'osm' (POI-132)。一覧に無い場合のみ先頭へフォールバック
  if (!baseMapList.value.some((tms) => tms.mapID === currentBaseMapID.value)) {
    currentBaseMapID.value = baseMapList.value.some((tms) => tms.mapID === "osm")
      ? "osm"
      : baseMapList.value[0]?.mapID || "osm";
  }

  const layers = await Promise.all(
    [...baseMapList.value].reverse().map(async (tms) => {
      let source;
      try {
        if (["osm", "gsi", "gsi_ortho"].includes(tms.mapID)) {
          source = await mapSourceFactory(tms.mapID, {});
        } else {
          source = await mapSourceFactory(
            {
              mapID: tms.mapID || "custom",
              url: tms.url,
              attr: tms.attr,
              maptype: "base",
              maxZoom: tms.maxZoom || 18,
              minZoom: tms.minZoom || 0,
            },
            {},
          );
        }
      } catch (e) {
        console.error(`[PoiEditMap] Failed to create source for ${tms.mapID}:`, e);
        return null;
      }
      if (!source) return null;
      return new Tile({
        source,
        properties: { title: tms.title, mapID: tms.mapID, type: "base" },
        visible: tms.mapID === (currentBaseMapID.value || "osm"),
      });
    }),
  );

  const layerGroup = new Group({
    layers: layers.filter((layer) => layer !== null),
  });
  // インデックス 0 (デフォルトベースレイヤー) をグループに置き換え (MapEdit と同じ)
  map.getLayers().setAt(0, layerGroup);
};

// select 切替で背景タイルを差し替える (Undo 対象外: 編集内容ではない)
const applyBaseMapSelection = (): void => {
  if (!map) return;
  const group = map.getLayers().item(0);
  const layers = group?.getLayers?.();
  if (!layers) return;
  layers.forEach((layer: any) => {
    layer.setVisible(layer.get("mapID") === currentBaseMapID.value);
  });
};

onMounted(async () => {
  map = new MaplatMap({
    div: "poiEditMap",
    interactions: interactionDefaults(),
    controls: controlDefaults(),
  });

  contextmenu = createContextMenu();
  map.addControl(contextmenu);
  map.on("click", onMapClick);

  // MaplatMap 組み込みの marker layer / source を編集対象にする
  markerSource = map.getSource("marker") as VectorSource;
  // 点マーカーのドラッグ移動: marker source への Modify を新規配線 (MapEdit のエッジ Modify
  // パターン踏襲 + Icon の描画位置でヒットさせる hitDetection)
  modify = new Modify({
    source: markerSource,
    hitDetection: map.getLayer("marker"),
  });
  modify.on("modifystart", onModifyStart);
  modify.on("modifyend", onModifyEnd);
  map.addInteraction(modify);
  map.addInteraction(new Snap({ source: markerSource }));

  modify.setActive(!props.readOnly);
  if (props.readOnly) contextmenu.disable();

  redrawMarkers();
  fitInitialView();
  await setupBaseMaps();
});

onBeforeUnmount(() => {
  map?.setTarget(undefined);
  map = null;
  markerSource = null;
  modify = null;
  contextmenu = null;
});

defineExpose({ panTo, fitInitialView });
</script>
