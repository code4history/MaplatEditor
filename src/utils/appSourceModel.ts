import { resolveBaseMapRuntimeText } from "./baseMapEditorDocument";
import type { LangResource } from "./langResource";

// アプリ設定のソース(sources)モデル共有ロジック。
// renderer(AppEdit)とelectron main(AppPreviewService/AppExportService)の両方から使う。
// Viewer(@maplat/core)仕様: sources要素が文字列 "osm"|"gsi"|"gsi_ortho" のときだけ
// ビルトイン定義が解決されるため、ビルトインは必ず素の文字列で出力する。

export type SourceRole = "maplat" | "base" | "overlay";
export type SourceKind = "maplat" | "builtin" | "tms";

export const VIEWER_BUILTIN_IDS = ["osm", "gsi", "gsi_ortho"] as const;

export function isViewerBuiltin(mapID: string): boolean {
  return (VIEWER_BUILTIN_IDS as readonly string[]).includes(mapID);
}

export function isViewerBasemapSource(source: AppSource): boolean {
  return source.sourceType === "builtin" || (source.sourceType === "tms" && source.role !== "overlay");
}

export function hasViewerBasemapSource(sources: readonly AppSource[]): boolean {
  return sources.some((source) => isViewerBasemapSource(source));
}

// Editor管理用キー: Viewer向け出力(アプリJSON/プレビュー)に含めてはならない
const EDITOR_ONLY_KEYS = new Set([
  "always",
  "scope",
  "sortOrder",
  "sort_order",
  "sourceType",
  "role",
  "startFrom",
  "previewDisabled",
  "previewDisabledReason",
  "_id",
  "status",
  // uid正準の内部参照/表示用slugはEditor管理 (ADR-0007)。Viewer出力のmapIDは
  // composeViewerSourceが解決済みslug(または埋め込みid)で明示的に出力する
  "mapUid",
  "mapSlug",
]);

// core側 normalizeArg はsnake_case等の旧キーを例外送出で拒否するため、
// Viewerへ渡す前に必ずcamelCaseへ正規化する。
export const runtimeKeyMap: Record<string, string> = {
  max_zoom: "maxZoom",
  min_zoom: "minZoom",
  envelope_lnglats: "envelopeLngLats",
  envelopLngLats: "envelopeLngLats",
  coverage_lnglats: "coverageLngLats",
  image_extention: "imageExtension",
  image_extension: "imageExtension",
  imageExtention: "imageExtension",
  map_id: "mapID",
  sourceID: "mapID",
  source_id: "mapID",
  merc_max_zoom: "mercMaxZoom",
  merc_min_zoom: "mercMinZoom",
  zoom_restriction: "zoomRestriction",
  enable_cache: "enableCache",
  default_zoom: "defaultZoom",
  start_from: "startFrom",
  home_position: "homePosition",
  fake_radius: "fakeRadius",
  fake_center: "fakeCenter",
  fake_gps: "fakeGps",
  app_name: "appName",
  setting_file: "settingFile",
  merc_zoom: "mercZoom",
  mapbox_token: "mapboxToken",
  translate_ui: "translateUI",
  restore_session: "restoreSession",
  no_rotate: "noRotate",
  poi_template: "poiTemplate",
  poi_style: "poiStyle",
  icon_template: "iconTemplate",
  default_center: "defaultCenter",
  default_rotation: "defaultRotation",
  selected_icon: "selectedIcon",
  namespace_id: "namespaceID",
  mercator_x_shift: "mercatorXShift",
  mercator_y_shift: "mercatorYShift",
  state_url: "stateUrl",
  enable_share: "enableShare",
  mobile_if: "mobileIF",
  pwa_manifest: "pwaManifest",
  pwa_worker: "pwaWorker",
  pwa_scope: "pwaScope",
  presentation_mode: "presentationMode",
};

export function normalizeRuntimeKeys<T>(value: T): T {
  if (Array.isArray(value)) return value.map(item => normalizeRuntimeKeys(item)) as T;
  if (!value || typeof value !== "object") return value;
  return Object.entries(value as Record<string, any>).reduce((acc, [key, item]) => {
    const normalizedKey = runtimeKeyMap[key] || key;
    acc[normalizedKey] = normalizeRuntimeKeys(item);
    return acc;
  }, {} as Record<string, any>) as T;
}

export function stripEditorKeys(data: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(data).filter(([key]) => !EDITOR_ONLY_KEYS.has(key)));
}

export interface AppSource {
  sourceType: SourceKind;
  // 地図参照 (ADR-0007):
  // - maplat: 登録地図の Asset UID (旧保存形は slug。読込時に main 側で uid へ解決される)
  // - builtin/tms: 登録地図ではないためuid解決対象外。ビルトインID/TMS地図IDをそのまま埋め込み保持
  mapUid: string;
  role: SourceRole;
  startFrom?: boolean;
  label?: Record<string, string>;
  data?: Record<string, any>; // tmsのみ: Viewerに渡る設定(camelCase)
  title?: string; // Editor表示専用(出力しない)
  mapSlug?: string; // maplatのみ: Editor表示用slug(読込時に解決。Viewer出力しない)
}

export function createAppSourceFromBaseMap(
  master: Record<string, any>,
  appDefaultLang: string,
): AppSource {
  const mapID = String(master.mapID || "");
  // rendererからはVue reactive Proxyが渡るため、JSON文書としてplain objectへ剥がす。
  // structuredCloneはProxyをcloneできず、AppのBase Map選択がDataCloneErrorになる。
  const cloned = JSON.parse(JSON.stringify(master));
  const labelSource = cloned.label ?? cloned.title;
  const label = typeof labelSource === "string"
    ? { [cloned.lang || "en"]: labelSource }
    : { ...(labelSource || {}) };
  delete cloned.mapID;
  delete cloned.label;
  cloned.defaultLang = appDefaultLang;
  if (isViewerBuiltin(mapID)) {
    return {
      sourceType: "builtin",
      mapUid: mapID,
      role: "base",
      label,
      data: cloned,
      title: resolveBaseMapRuntimeText(master.title, appDefaultLang, master.lang || "en"),
    };
  }
  return {
    sourceType: "tms",
    mapUid: mapID,
    role: cloned.maptype === "overlay" ? "overlay" : "base",
    label,
    data: cloned,
    title: resolveBaseMapRuntimeText(master.title, appDefaultLang, master.lang || "en"),
  };
}

export function resolveBaseMapSelectorText(
  master: Record<string, any>,
  activeLang: string,
): string {
  const defaultLang = master.defaultLang || master.lang || "en";
  return (
    resolveBaseMapRuntimeText(master.label, activeLang, defaultLang) ||
    resolveBaseMapRuntimeText(master.title, activeLang, defaultLang) ||
    String(master.mapID || "")
  );
}

export function compactLangObject(
  value?: Record<string, string> | string,
  defaultLang?: string,
): Record<string, string> | string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value.trim() ? value : undefined;
  const entries = Object.entries(value).filter(([, text]) => typeof text === "string" && text.trim() !== "");
  if (entries.length === 0) return undefined;
  // デフォルト言語のみの場合はプレーン文字列に畳み込む(交換形、ADR-0005)
  if (defaultLang && entries.length === 1 && entries[0][0] === defaultLang) {
    return entries[0][1];
  }
  return Object.fromEntries(entries);
}

function isBaseLikeMaptype(maptype: unknown): boolean {
  return maptype === undefined || maptype === null || maptype === "" || maptype === "base";
}

function pickLabel(
  raw: any,
  data: Record<string, any>,
  defaultLang: string,
): Record<string, string> | undefined {
  const candidate = raw?.label ?? data?.label;
  if (candidate === undefined || candidate === null) return undefined;
  if (typeof candidate === "string") return { [defaultLang]: candidate };
  return { ...candidate };
}

// 任意の保存形(レガシー文字列 / 旧AppEdit形(mapID) / 新形(mapUid)) → AppSource
export function normalizeAppSource(raw: any, defaultLang = "ja"): AppSource {
  if (typeof raw === "string") {
    if (isViewerBuiltin(raw)) {
      return { sourceType: "builtin", mapUid: raw, role: "base" };
    }
    return { sourceType: "tms", mapUid: raw, role: "base", data: {} };
  }

  const rawData = raw?.data && typeof raw.data === "object" ? raw.data : raw;
  const data = stripEditorKeys(normalizeRuntimeKeys({ ...(rawData || {}) })) as Record<string, any>;
  // 新形は mapUid、旧保存形は mapID(slug) を参照キーとして受容する (ADR-0007)
  const mapRef = raw?.mapUid || raw?.mapID || data.mapID || "";
  const builtinRef = typeof data.builtinId === "string" ? data.builtinId : "";
  const maptype = raw?.maptype ?? data.maptype;

  const isMaplat =
    raw?.sourceType === "maplat" ||
    maptype === "maplat" ||
    Boolean(raw?.noload) ||
    Boolean(data.noload);

  if (isMaplat) {
    return {
      sourceType: "maplat",
      mapUid: mapRef,
      role: "maplat",
      startFrom: Boolean(raw?.startFrom),
      label: pickLabel(raw, data, defaultLang),
      title: typeof raw?.title === "string" ? raw.title : undefined,
      mapSlug: typeof raw?.mapSlug === "string" ? raw.mapSlug : undefined,
    };
  }

  if (isBaseLikeMaptype(maptype) && isViewerBuiltin(builtinRef || mapRef)) {
    return {
      sourceType: "builtin",
      // asset_registry のグローバルslug衝突で builtin slug が suffix されても、
      // Viewer には既知の builtin ID (osm/gsi/gsi_ortho) を渡す。
      mapUid: builtinRef || mapRef,
      role: "base",
      startFrom: Boolean(raw?.startFrom),
      label: pickLabel(raw, data, defaultLang),
      data: raw?.data && typeof raw.data === "object" ? structuredClone(raw.data) : undefined,
      title: typeof raw?.title === "string" ? raw.title : undefined,
    };
  }

  const role: SourceRole =
    raw?.role === "overlay" || maptype === "overlay" ? "overlay" : "base";
  const label = pickLabel(raw, data, defaultLang);
  delete data.label;
  delete data.mapID;
  delete data.maptype;
  return {
    sourceType: "tms",
    mapUid: mapRef,
    role,
    startFrom: Boolean(raw?.startFrom),
    label,
    data,
    title: typeof raw?.title === "string" ? raw.title : undefined,
  };
}

function pruneEmpty(data: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(data).filter(([, value]) => value !== undefined && value !== null && value !== ""),
  );
}

// AppSource → Viewer出力(アプリJSON sources要素)
// builtin=文字列 / maplat={mapID,label(+settingFile)} / tms=data展開+maptype
// maplatMapID: maplatソースのViewer向けmapID(=slug)。uid参照の呼び出し側が
// uid→slug解決して渡す (ADR-0007: viewer互換)。未指定時はmapUid値をそのまま使う
export function composeViewerSource(
  source: AppSource,
  options: { settingFilePrefix?: string; lang?: string; maplatMapID?: string } = {},
): string | Record<string, unknown> {
  if (source.sourceType === "builtin") return source.mapUid;

  if (source.sourceType === "maplat") {
    const viewerMapID = options.maplatMapID ?? source.mapUid;
    const out: Record<string, unknown> = { mapID: viewerMapID };
    const label = compactLangObject(source.label, options.lang);
    if (label) out.label = label;
    if (options.settingFilePrefix !== undefined) {
      out.maptype = "maplat";
      out.settingFile = `${options.settingFilePrefix}${viewerMapID}.json`;
    }
    return out;
  }

  const data = pruneEmpty(stripEditorKeys(normalizeRuntimeKeys({ ...(source.data || {}) })));
  delete data.label;
  // 存在範囲(coverageLngLats)はEditor内の検索/ピッカー用メタデータであり、Viewerへは渡さない。
  // Viewerに渡る範囲は利用範囲(envelopeLngLats)のみ(ユーザー明示設定、既定は空)。
  // 広域の存在範囲をenvelopeとして渡すとWeiwudi(SWタイルキャッシュ)の対象範囲が暴発する(ADR-0004)
  delete data.coverageLngLats;
  const defaultLang = String(data.defaultLang || data.lang || "en");
  const runtimeLang = options.lang ?? defaultLang;
  if (data.title !== undefined) {
    data.title = resolveBaseMapRuntimeText(data.title as LangResource, runtimeLang, defaultLang);
  }
  if (data.attr !== undefined) {
    data.attr = resolveBaseMapRuntimeText(data.attr as LangResource, runtimeLang, defaultLang);
  }
  delete data.defaultLang;
  delete data.lang;
  const out: Record<string, unknown> = {
    ...data,
    mapID: source.mapUid,
    maptype: source.role === "overlay" ? "overlay" : "base",
  };
  const label = compactLangObject(source.label, options.lang);
  if (label) out.label = label;
  return out;
}

// bbox [w,s,e,n] → envelopeLngLats 4隅 [[w,s],[e,s],[e,n],[w,n]]
export function bboxToEnvelope(bbox: [number, number, number, number]): [number, number][] {
  const [west, south, east, north] = bbox;
  return [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
  ];
}

// envelopeLngLats(非矩形含む) → bbox [w,s,e,n]（近似）
export function envelopeToBbox(
  lngLats?: [number, number][] | null,
): [number, number, number, number] | null {
  if (!Array.isArray(lngLats) || lngLats.length === 0) return null;
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const point of lngLats) {
    if (!Array.isArray(point) || point.length < 2) return null;
    const [lng, lat] = point;
    if (typeof lng !== "number" || typeof lat !== "number" || Number.isNaN(lng) || Number.isNaN(lat)) return null;
    west = Math.min(west, lng);
    east = Math.max(east, lng);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  return [west, south, east, north];
}
