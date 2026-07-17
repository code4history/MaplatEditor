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
// 標準ピン Icon / forEachFeatureAtPixel 選択) を単一マップへ移植する。
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
// @ts-ignore 住所検索コントロール(MapEditベースマップ側と同一のバンドル同梱ライブラリ)
import Geocoder from "../libs/ol-geocoder/base";
import { transform } from "ol/proj";
import { containsCoordinate } from "ol/extent";
import type VectorSource from "ol/source/Vector";
import type { Point } from "ol/geom";
import { localizeTitle } from "../utils/langResource";
import { listIconSets, parseIconRef } from "../utils/iconRefs";
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

// --- 標準マーカースタイル (Phase 8 Task 4, ユーザー決定 2026-07-11「ビューア標準に整合」) ---
// ビューア (MaplatCore) と同じ defaultpin.png / defaultpin_selected.png を使う
// (public/icons/builtin/ へコピー済み。旧・インライン SVG ピン生成器は廃止)。
// anchor はビューアと同じ [0.5, 1] — MaplatCore/src/map_ex.ts で確認済み:
// markerDefaultStyle (defaultpin.png) と setMarker の文字列 src 経路がともに
// anchor: [0.5, 1.0] (fraction) で描画している。
const pinStyles: Record<string, Style> = {};
const pinStyle = (selected: boolean): Style => {
  const key = selected ? "selected" : "normal";
  if (!pinStyles[key]) {
    pinStyles[key] = new Style({
      image: new Icon({
        src: selected
          ? "icons/builtin/defaultpin-selected.png"
          : "icons/builtin/defaultpin.png",
        anchor: [0.5, 1],
      }),
    });
  }
  return pinStyles[key];
};

// --- 設定アイコンの反映 (Phase 8 Task 1, 仕様 §7 の icon 参照文法) ---
// feature の properties.icon / (選択中は) properties.selectedIcon を parseIconRef で解決して
// OL Icon の src に使う。解決できない場合 (未設定 / 未登録 setId / 不明 asset / asset 解決中)
// は上の標準ピンへフォールバックする。
//
// asset (UUID) の file:// URL 解決は IPC (imageAssets.getFilePath) で非同期。
// src キャッシュ (uid → url | null) + in-flight ガードで重複要求を防ぎ、解決後に
// coalesce した redrawMarkers() 1 回で反映する。失敗は null をキャッシュして再要求しない。
const assetSrcCache = new Map<string, string | null>();
const assetInFlight = new Set<string>();

// 解決完了の再描画は microtask で 1 回に coalesce する。modifyActive 中は redrawMarkers 側の
// ガードで no-op になるが、modifyend が必ず redrawMarkers() か watch 経由の全再描画に到達する
// ため取りこぼしはない (= ドラッグ確定後に最新キャッシュで描き直される)
let iconRedrawQueued = false;
const scheduleIconRedraw = (): void => {
  if (iconRedrawQueued) return;
  iconRedrawQueued = true;
  queueMicrotask(() => {
    iconRedrawQueued = false;
    redrawMarkers();
  });
};

const requestAssetSrc = (uid: string): void => {
  if (assetSrcCache.has(uid) || assetInFlight.has(uid)) return;
  assetInFlight.add(uid);
  window.imageAssets
    .getFilePath(uid)
    .then((url) => {
      assetSrcCache.set(uid, typeof url === "string" && url ? url : null);
      if (assetSrcCache.get(uid)) scheduleIconRedraw();
    })
    .catch(() => {
      assetSrcCache.set(uid, null);
    })
    .finally(() => {
      assetInFlight.delete(uid);
    });
};

// icon 参照 → Icon src。同期解決できない場合は null (標準ピンで描画)。
const iconRefToSrc = (
  refString: string,
): { src: string; pinShaped: boolean } | null => {
  const ref = parseIconRef(refString);
  if (ref.kind === "iconset") {
    // 登録済み setId + 既知 iconId のみ解決。未登録/未知は標準ピンへフォールバック
    const set = listIconSets().find((s) => s.setId === ref.setId);
    if (!set || !set.iconIds.includes(ref.iconId)) return null;
    // builtin の実体はピン形画像 (public/icons/builtin/*.{png,svg})
    return { src: set.previewUrl(ref.iconId), pinShaped: ref.setId === "builtin" };
  }
  if (ref.kind === "url") {
    return { src: ref.url, pinShaped: false };
  }
  // asset: キャッシュ済みなら即時、未解決なら非同期要求して今回は標準ピン
  const cached = assetSrcCache.get(ref.uid);
  if (cached) return { src: cached, pinShaped: false };
  if (!assetSrcCache.has(ref.uid)) requestAssetSrc(ref.uid);
  return null; // 解決中 or 解決失敗 (null キャッシュ)
};

// --- icon 画像の読み込み失敗フォールバック (Phase 8 品質レビュー MAJOR-3) ---
// url/asset 由来の icon src (previewUrl 以外) は 404 や破損ファイルの可能性があり、
// OL の Icon はロード失敗時に例外を投げず単に描画されないだけなので、放置すると
// 「アイコン指定はあるのに地図上に何も見えない」状態になってしまう。requestAssetSrc と
// 同じ非同期パターン (キャッシュ Map + inFlight Set + 解決後 scheduleIconRedraw) で
// new Image() による事前読み込みチェックを行い、成功/失敗を確定させる。
// チェック未完了 (pending) の間と、失敗が確定した後は標準ピンへフォールバックする。
//
// builtin (previewUrl) はアプリに同梱される同一オリジンの静的アセット (public/icons/builtin/*.{png,svg})
// であり実運用で 404 し得ないため、このチェックの対象外とする (下の iconRefStyle で
// resolved.pinShaped = true の場合はチェックをスキップしてそのまま描画する)
const iconLoadOkCache = new Map<string, boolean>(); // true=読み込み成功確認済み, false=失敗確定
const iconLoadInFlight = new Set<string>();

const requestIconLoadCheck = (src: string): void => {
  if (iconLoadOkCache.has(src) || iconLoadInFlight.has(src)) return;
  iconLoadInFlight.add(src);
  const probe = new Image();
  probe.onload = () => {
    iconLoadOkCache.set(src, true);
    iconLoadInFlight.delete(src);
    scheduleIconRedraw();
  };
  probe.onerror = () => {
    iconLoadOkCache.set(src, false);
    iconLoadInFlight.delete(src);
    scheduleIconRedraw();
  };
  probe.src = src;
};

// Style/Icon インスタンスは src キーの cache で共有 (3000 feature でも Icon を使い回す)。
// anchor: ピン形 (builtin) は先端が座標を指す [0.5, 1]、任意画像 (url/asset) は形状不明の
// ため画像中心 [0.5, 0.5] が自然。サイズ正規化 (scale) は img 読み込み前に寸法が分からず
// Icon 生成時に決められないため行わない (既定スケール)。
const iconStyleCache = new Map<string, Style>();
const iconRefStyle = (refString: string): Style | null => {
  const resolved = iconRefToSrc(refString);
  if (!resolved) return null;
  if (!resolved.pinShaped) {
    // builtin 以外 (url/asset) は事前読み込みチェックを経てから描画する。未チェック/pending
    // 中は標準ピンで描画し (asset 解決中と同じ扱い)、失敗確定なら標準ピンへ固定フォールバックする
    if (iconLoadOkCache.get(resolved.src) !== true) {
      requestIconLoadCheck(resolved.src);
      return null;
    }
  }
  const key = `${resolved.pinShaped ? "pin" : "img"}|${resolved.src}`;
  let style = iconStyleCache.get(key);
  if (!style) {
    style = new Style({
      image: new Icon({
        src: resolved.src,
        anchor: resolved.pinShaped ? [0.5, 1] : [0.5, 0.5],
      }),
    });
    iconStyleCache.set(key, style);
  }
  return style;
};

// feature のスタイル決定: 通常時は icon (無ければ青ピン)、選択中は selectedIcon
// (無ければ赤ピン)。viewer と同じ「icon ⇄ selectedIcon 切替」の意味論
const markerStyle = (properties: any, selected: boolean): Style => {
  const raw = selected ? properties?.selectedIcon : properties?.icon;
  if (typeof raw === "string" && raw.trim() !== "") {
    const style = iconRefStyle(raw.trim());
    if (style) return style;
  }
  return pinStyle(selected);
};

// --- helper ---
const featureUid = (feature: any): string | null => {
  const uid = feature?.get?.("_maplatUid");
  return typeof uid === "string" ? uid : null;
};

// 経度を [-180, 180] へ正規化 (地図を横に何周も pan した状態でのドラッグ/追加/中央取得が
// 域外経度を持ち込まないようにする)
const wrapLon = (lon: number): number => ((((lon + 180) % 360) + 360) % 360) - 180;

// MapEdit の arrayRoundTo(lonlat, 6) 踏襲 (Write Store には入力時精度のまま保存される)
const roundLngLat = (lonlat: number[]): [number, number] => [
  Math.round(wrapLon(lonlat[0]) * 1e6) / 1e6,
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
      markerStyle(feature.properties, uid === session.selectedUid.value),
      "marker",
    );
  }
};

watch(session.state, () => redrawMarkers());

// 選択の変更はスタイル再適用のみ (全再描画しない)。選択 feature が画面外なら pan する
// (Task 8 の一覧クリック選択にもこの watch が効く)
watch(session.selectedUid, (uid) => {
  if (!markerSource) return;
  // icon/selectedIcon の解決に session 側 properties が要るため uid → properties の
  // 索引を 1 回だけ作る (feature ごとの find は 3000 件で O(n^2) になるため)
  const propsByUid = new Map<string, any>();
  for (const f of session.state.value?.features ?? []) {
    const fuid = f.properties?._maplatUid;
    if (typeof fuid === "string") propsByUid.set(fuid, f.properties);
  }
  for (const feature of markerSource.getFeatures()) {
    const fuid = featureUid(feature);
    feature.setStyle(
      markerStyle(fuid ? propsByUid.get(fuid) : undefined, fuid === uid),
    );
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
      // 「実際に変わった」判定は session 現値も同じ wrap + 6桁丸めで比較する
      // (7桁以上の精度を持つインポート由来 feature を掴んで離しただけの偽 commit 防止)
      const prev = roundLngLat(before);
      if (next[0] !== prev[0] || next[1] !== prev[1]) {
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

// 現在の地図中心 (lngLat)。一覧の「新規作成」が地図中央へ addFeature するために使う (Task 8)
const getCenterLngLat = (): [number, number] | null => {
  const center = map?.getView?.()?.getCenter?.();
  if (!Array.isArray(center)) return null;
  return roundLngLat(transform(center, "EPSG:3857", "EPSG:4326"));
};

// コンテナ高さの変化 (raw ペイン開閉、Phase 5) を OL へ通知する。OL は window resize しか
// 自動追随しないため、レイアウト変更側 (PoiEdit) が明示的に呼ぶ
const updateSize = (): void => {
  map?.updateSize?.();
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

  // 住所検索コントロール(MapEditのベースマップ側と同じ設定・挙動)。
  // 選択時にビューを fit、ピンは表示しない。
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
  markerSource = null;
  modify = null;
  contextmenu = null;
});

defineExpose({ panTo, fitInitialView, getCenterLngLat, updateSize });
</script>
