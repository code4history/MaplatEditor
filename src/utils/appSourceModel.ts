import { isProviderKind, resolveBaseMapRuntimeText } from "./baseMapEditorDocument";
import { BASE_MAP_LANG_ATTRS, normalizeLangResource } from "./langResource";
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
  // 種別軸（m6-t1）。エディタ識別子であり viewer が読むのは maptype。
  // 出力からの除去は compose 境界の単一責任（normalize は内部形として data.kind を保持する）。
  "kind",
  // m6-t7: TileJSON 取り込み出自 URL。エディタ専用メタデータ（出自の記録のみ。再取得機能は m6 では作らない）。
  "tileJsonSourceUrl",
  // m6-t8: merc 選択時に付与するベースマップ UID。書き出し時の merc/{uid} 解決専用（§3.7）。
  // normalizeAppSource/composeViewerSource いずれの分岐にも影響しないため kind のような退避は不要。
  "baseMapUid",
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

// ---------------------------------------------------------------------------
// m6-t10: 差分保持ストレージモデル（ADR-0018）と出力文法（ADR-0017）
// ---------------------------------------------------------------------------

// 上書き可能フィールドの宣言テーブル（設計 §3.2）。
// 規則: 「アプリソース編集フォームに操作子があるとき、かつそのときに限り上書き可能」。
// AppSourceEditor.vue の data-testid="app-source-override-<key>" と AC7 で機械照合する。
// マスタに対応物があり、操作子があるもの。
export const APP_SOURCE_OVERRIDABLE_KEYS = [
  "label",
  "title",
  "attr",
  "minZoom",
  "maxZoom",
  "thumbnail",
] as const;

// マスタに対応物が無く、常にアプリ所有のもの（マスタとの比較を行わない点だけが異なる）。
// envelopeLngLats は ADR-0004 の利用範囲、mercator シフトは overlay 専用の位置合わせ。
export const APP_SOURCE_OWNED_KEYS = [
  "envelopeLngLats",
  "mercatorXShift",
  "mercatorYShift",
] as const;

// MaplatCore の sourcesLoader が全ソースへ Object.assign する commonOptions のキー
// （index.ts:364-374）。オブジェクトリテラルのため値が undefined でも own key として
// 実体化し、settingFile 経路（source_ex.ts:188）で設定ファイル側の同名キーを潰す。
// ∴ 設定ファイルへは出力しない（設計 §3.5.3・AC21）。
export const COMMON_OPTION_KEYS = [
  "homePos",
  "defZoom",
  "zoomRestriction",
  "mercMinZoom",
  "mercMaxZoom",
  "enableCache",
  "key",
  "mapboxMap",
  "maplibreMap",
] as const;

// 言語別フィールド（交換形を保つ。ADR-0005）。BASE_MAP_LANG_ATTRS は label を含まないため足す。
const LANG_OBJECT_KEYS: readonly string[] = [...BASE_MAP_LANG_ATTRS, "label"];

const OVERRIDABLE_KEY_SET = new Set<string>(APP_SOURCE_OVERRIDABLE_KEYS);
const OWNED_KEY_SET = new Set<string>(APP_SOURCE_OWNED_KEYS);

// 設定ファイル（maps/<slug>.json）へ出してはならないキー。
const SETTING_FILE_EXCLUDED_KEYS = new Set<string>([
  ...EDITOR_ONLY_KEYS,
  ...COMMON_OPTION_KEYS,
  // ADR-0004: 存在範囲はエディタ専用メタデータ。Viewer へ渡すと Weiwudi の対象範囲が暴発する
  "coverageLngLats",
  // m6-t8: 生成元地図の出自メモ（エディタ専用）
  "sourceMapUid",
  // エディタ内部の builtin 識別子
  "builtinId",
]);

export interface AppSource {
  sourceType: SourceKind;
  // 地図参照 (ADR-0007):
  // - maplat: 登録地図の Asset UID (旧保存形は slug。読込時に main 側で uid へ解決される)
  // - builtin/tms: ベースマップの slug。表示・startFrom 照合に使う
  mapUid: string;
  // m6-t10: ベースマップマスタへの安定参照（ADR-0018）。slug 改名に耐える。
  // 旧保存形は持たないため、resolveAppSource が slug 経由で解決して補う。
  baseMapUid?: string;
  role: SourceRole;
  startFrom?: boolean;
  // 上書き分のみ。未上書きならキーごと不在（歴史的にトップレベルにあるため位置は動かさない）
  label?: Record<string, string>;
  // m6-t10: アプリ側の上書き差分のみ。マスタ値は持たない（ADR-0018）
  overrides?: Record<string, any>;
  title?: string; // Editor表示専用(出力しない)
  mapSlug?: string; // maplatのみ: Editor表示用slug(読込時に解決。Viewer出力しない)
  // 旧保存形（data にマスタ全コピー）を読んだときの生値。resolveAppSource が
  // マスタと突き合わせて overrides へ翻訳する（設計 §3.7）。保存時には残さない。
  legacyData?: Record<string, any>;
}

// ---------------------------------------------------------------------------
// マスタ解決（設計 §3.4）
// ---------------------------------------------------------------------------

export interface BaseMapMasterLike {
  uid: string;
  mapID: string;
  data: Record<string, any>;
}

export interface BaseMapMasterLookup {
  byUid(uid: string): BaseMapMasterLike | undefined;
  bySlug(slug: string): BaseMapMasterLike | undefined;
}

export type ResolvedAppSource =
  | { ok: true; source: AppSource; master: BaseMapMasterLike; merged: Record<string, any> }
  | { ok: false; source: AppSource; reason: "master-missing" };

// 言語別フィールドの同値判定（ADR-0005 の交換形のゆれを吸収する）。
// プレーン文字列と {lang: text} を同じ土俵へ載せてから比較する。
function langEquals(a: unknown, b: unknown, defaultLang: string): boolean {
  const na = normalizeLangResource(a as LangResource | undefined, defaultLang);
  const nb = normalizeLangResource(b as LangResource | undefined, defaultLang);
  const keys = new Set([...Object.keys(na), ...Object.keys(nb)]);
  for (const key of keys) {
    if ((na[key] ?? "") !== (nb[key] ?? "")) return false;
  }
  return true;
}

function valueEquals(key: string, a: unknown, b: unknown, defaultLang: string): boolean {
  if (LANG_OBJECT_KEYS.includes(key)) return langEquals(a, b, defaultLang);
  return JSON.stringify(a) === JSON.stringify(b);
}

// 旧保存形（data にマスタ全コピー）→ 新形（overrides + label）への翻訳（設計 §3.7）。
// - 操作子の無いキーは捨てる（以後マスタから読む）
// - 操作子のあるキーはマスタの現在値と比較し、異なるときだけ上書きとして温存する
// - アプリ所有キーは無条件で温存する
function migrateLegacyData(
  source: AppSource,
  master: BaseMapMasterLike,
): { overrides: Record<string, any>; label?: Record<string, string> } {
  const legacy = source.legacyData ?? {};
  const defaultLang = String(master.data.lang || master.data.defaultLang || "en");
  const overrides: Record<string, any> = { ...(source.overrides || {}) };

  for (const [key, value] of Object.entries(legacy)) {
    if (OWNED_KEY_SET.has(key)) {
      overrides[key] = value;
      continue;
    }
    if (!OVERRIDABLE_KEY_SET.has(key) || key === "label") continue;
    if (value === undefined || value === null || value === "") continue;
    if (valueEquals(key, value, master.data[key], defaultLang)) continue;
    overrides[key] = value;
  }

  // label は歴史的にトップレベルにあるため別扱い（保存位置は動かさない・設計 §3.1）
  let label = source.label;
  const legacyLabel = source.label ?? legacy.label;
  if (legacyLabel === undefined || langEquals(legacyLabel, master.data.label, defaultLang)) {
    label = undefined;
  } else {
    label = legacyLabel as Record<string, string>;
  }
  return { overrides, label };
}

// AppSource + マスタ → 解決済み（マスタ土台 + アプリ上書き）。
// マージ順は MaplatCore の Object.assign(resp, options)（source_ex.ts:188）と同一に揃える。
export function resolveAppSource(
  source: AppSource,
  lookup: BaseMapMasterLookup,
): ResolvedAppSource {
  const master =
    (source.baseMapUid ? lookup.byUid(source.baseMapUid) : undefined) ??
    lookup.bySlug(source.mapUid);
  if (!master) return { ok: false, source, reason: "master-missing" };

  const resolved: AppSource = { ...source, baseMapUid: master.uid };
  if (resolved.legacyData) {
    const { overrides, label } = migrateLegacyData(resolved, master);
    resolved.overrides = overrides;
    if (label === undefined) delete resolved.label;
    else resolved.label = label;
    delete resolved.legacyData;
  }
  resolved.overrides = resolved.overrides ?? {};

  const { mapID: _mapID, ...masterRest } = master.data;
  const effective: Record<string, any> = { ...resolved.overrides };
  if (resolved.label !== undefined) effective.label = resolved.label;
  const merged = { ...masterRest, ...effective };
  return { ok: true, source: resolved, master, merged };
}

export interface MercSourceRef {
  source: AppSource;
  baseMapUid: string;
  dirName: string;
}

// merc ソースの抽出。ディスク上のタイルは merc/{baseMapUid} にある(ADR-0016)ため、
// 書き出し(AppExportService)とプレビュー配信(AppPreviewService)の両方が
// dirName→baseMapUid の対応を必要とする。同一ロジックを重複させないよう一箇所へ共有する。
// m6-t10: 差分保持モデルでは kind も url もアプリ側に無いため、マスタから引く。
// dirName はマスタの現在 slug（旧形の「選択時点 slug」との乖離が構造的に消える。設計 §3.5.4）。
export function extractMercSourceRefs(
  sources: readonly AppSource[],
  lookup: BaseMapMasterLookup,
): MercSourceRef[] {
  const entries: MercSourceRef[] = [];
  for (const source of sources) {
    if (source.sourceType === "maplat") continue;
    const resolved = resolveAppSource(source, lookup);
    if (!resolved.ok) continue;
    if (resolved.master.data.kind !== "merc") continue;
    entries.push({
      source: resolved.source,
      baseMapUid: resolved.master.uid,
      dirName: resolved.master.mapID,
    });
  }
  return entries;
}

// m6-t10: マスタの全コピーをやめ、参照＋空 overrides を返す（ADR-0018）。
// 第2引数の appDefaultLang は Editor 表示用 title の解決にのみ使う（保存値には入らない）。
export function createAppSourceFromBaseMap(
  master: BaseMapMasterLike,
  appDefaultLang: string,
): AppSource {
  const mapID = String(master.mapID || "");
  const data = master.data || {};
  return {
    sourceType: isViewerBuiltin(mapID) ? "builtin" : "tms",
    mapUid: mapID,
    baseMapUid: master.uid,
    role: data.maptype === "overlay" ? "overlay" : "base",
    overrides: {},
    title: resolveBaseMapRuntimeText(data.title, appDefaultLang, data.lang || "en"),
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

// 任意の保存形(レガシー文字列 / 旧AppEdit形(mapID) / 差分保持形) → AppSource
//
// m6-t10: 差分保持形（`overrides` を持つ）は無変換で受け、旧形（`data` にマスタ全コピー）は
// `legacyData` として温存する。マスタとの突き合わせによる翻訳は resolveAppSource が行う
// （本関数は純粋関数のままとし、マスタ比較は行わない。設計 §3.4 / §3.7）。
export function normalizeAppSource(raw: any, defaultLang = "ja"): AppSource {
  if (typeof raw === "string") {
    if (isViewerBuiltin(raw)) {
      return { sourceType: "builtin", mapUid: raw, role: "base", overrides: {} };
    }
    return { sourceType: "tms", mapUid: raw, role: "base", overrides: {} };
  }

  // 差分保持形の判定は `overrides` の有無で行う。createAppSourceFromBaseMap も
  // 移行後の保存も必ず overrides を持つため、旧形と一意に区別できる。
  if (raw && typeof raw === "object" && raw.overrides !== undefined) {
    const kind: SourceKind =
      raw.sourceType === "maplat" || raw.sourceType === "builtin" || raw.sourceType === "tms"
        ? raw.sourceType
        : isViewerBuiltin(String(raw.mapUid || ""))
          ? "builtin"
          : "tms";
    const out: AppSource = {
      sourceType: kind,
      mapUid: String(raw.mapUid || raw.mapID || ""),
      role: raw.role === "overlay" ? "overlay" : kind === "maplat" ? "maplat" : "base",
      startFrom: Boolean(raw.startFrom),
      overrides: { ...(raw.overrides || {}) },
    };
    if (typeof raw.baseMapUid === "string") out.baseMapUid = raw.baseMapUid;
    if (raw.label && typeof raw.label === "object") out.label = { ...raw.label };
    if (typeof raw.title === "string") out.title = raw.title;
    if (typeof raw.mapSlug === "string") out.mapSlug = raw.mapSlug;
    return out;
  }

  const rawData = raw?.data && typeof raw.data === "object" ? raw.data : raw;
  // 種別軸（m6-t1）: kind は EDITOR_ONLY_KEYS に入るため strip 後には存在しない。よって strip 前に退避する。
  const rawKind = raw?.kind ?? rawData?.kind;
  // m6-t8: baseMapUid も EDITOR_ONLY_KEYS に入るため strip 後には存在しない。AppExportService の
  // merc 抽出（§3.11）が sources[].data.baseMapUid を読むため、kind と同じく strip 前に退避し、
  // 内部表現（AppSource.data）には残す。viewer 出力（composeViewerSource）からは除去したままにする。
  const rawBaseMapUid = raw?.baseMapUid ?? rawData?.baseMapUid;
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
      // m6-t10: 旧形の全コピーは legacyData として温存し、resolveAppSource が翻訳する
      legacyData: data,
      ...(typeof rawBaseMapUid === "string" ? { baseMapUid: rawBaseMapUid } : {}),
      title: typeof raw?.title === "string" ? raw.title : undefined,
    };
  }

  const role: SourceRole =
    raw?.role === "overlay" || maptype === "overlay" ? "overlay" : "base";
  const label = pickLabel(raw, data, defaultLang);
  delete data.label;
  delete data.mapID;
  return {
    sourceType: "tms",
    mapUid: mapRef,
    role,
    startFrom: Boolean(raw?.startFrom),
    label,
    // m6-t10: 旧形の全コピーは legacyData として温存し、resolveAppSource が
    // マスタと突き合わせて overrides へ翻訳する（設計 §3.7）。
    // 旧来ここで行っていた kind / baseMapUid の「strip 前退避 → data へ再付着」は
    // 不要になった（overrides に kind は入らず、baseMapUid はトップレベルへ昇格する）。
    legacyData: data,
    ...(typeof rawBaseMapUid === "string" ? { baseMapUid: rawBaseMapUid } : {}),
    title: typeof raw?.title === "string" ? raw.title : undefined,
  };
}

function pruneEmpty(data: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(data).filter(([, value]) => value !== undefined && value !== null && value !== ""),
  );
}

// AppSource → Viewer出力(アプリJSON sources要素)
//
// m6-t10 (ADR-0017): エディタの正式出力は全ソース共通で
//   { mapID, settingFile: "maps/<slug>.json", …上書き分のみ }
// になった。builtin の文字列出力とインライン全定義は廃止した（Viewer は後方互換で読む）。
// maplat だけは従来どおり（もともと settingFile 参照であり本タスクの対象外）。
//
// maplatMapID: maplatソースのViewer向けmapID(=slug)。uid参照の呼び出し側が
// uid→slug解決して渡す (ADR-0007: viewer互換)。未指定時はmapUid値をそのまま使う
// lookup: ベースマップマスタの解決器。ベースマップ由来ソースでは必須
export function composeViewerSource(
  source: AppSource,
  options: {
    settingFilePrefix?: string;
    lang?: string;
    maplatMapID?: string;
    lookup?: BaseMapMasterLookup;
  } = {},
): string | Record<string, unknown> {
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

  // ベースマップ由来ソース（builtin / tms）: ID 参照 + 上書き分のみ（ADR-0017）。
  // **maptype は出さない**。出すと MaplatCore の source_ex.ts:126 が先に成立し、
  // settingFile が読まれずインライン経路へ落ちる。
  const resolved = options.lookup ? resolveAppSource(source, options.lookup) : null;
  if (options.lookup && (!resolved || !resolved.ok)) {
    // マスタ欠落。呼び出し側（Export / Preview）が事前に除外する契約だが、
    // 万一到達した場合は参照だけを出して壊れた出力を作らない（設計 §3.6）。
    return { mapID: source.mapUid };
  }
  const master = resolved && resolved.ok ? resolved.master : null;
  const viewerMapID = master ? master.mapID : source.mapUid;
  const masterData = master ? master.data : {};
  const masterLang = String(masterData.lang || masterData.defaultLang || "en");
  const prefix = options.settingFilePrefix ?? "maps/";

  const out: Record<string, unknown> = {
    mapID: viewerMapID,
    settingFile: `${prefix}${viewerMapID}.json`,
  };

  // 上書き分を載せる。言語別フィールドは MaplatCore のマージがキー単位の全置換であるため、
  // マスタ値とマージした完全な言語オブジェクトを出す（設計 §3.5.5）。
  const overrides: Record<string, any> = { ...(source.overrides || {}) };
  if (source.label !== undefined) overrides.label = source.label;
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined || value === null || value === "") continue;
    if (LANG_OBJECT_KEYS.includes(key)) {
      const merged = {
        ...normalizeLangResource(masterData[key] as LangResource | undefined, masterLang),
        ...normalizeLangResource(value as LangResource, masterLang),
      };
      const compact = compactLangObject(merged, options.lang ?? masterLang);
      if (compact !== undefined) out[key] = compact;
      continue;
    }
    out[key] = value;
  }
  return out;
}

// マスタ → 設定ファイル `maps/<slug>.json` の中身（設計 §3.5）。
// パッケージごとに生成する導出物であり、アプリ間で共有されない。∴ role を焼き込んでよい。
export function composeBaseMapSettingFile(
  master: BaseMapMasterLike,
  role: SourceRole,
  options: { lang?: string } = {},
): Record<string, unknown> {
  const masterData = master.data || {};
  const kind = masterData.kind;
  const masterLang = String(masterData.lang || masterData.defaultLang || "en");
  const data = normalizeRuntimeKeys({ ...masterData }) as Record<string, any>;

  for (const key of Object.keys(data)) {
    if (SETTING_FILE_EXCLUDED_KEYS.has(key)) delete data[key];
  }
  delete data.mapID;

  // 言語別フィールドは ADR-0005 の交換形へ畳む（言語の解決は viewer 側 ui.translate が行う）。
  // 畳み込みの基準は**この設定ファイル自身の既定言語**（= マスタの lang。data.lang として同梱される）
  // であり、アプリの表示言語ではない。options.lang は将来の拡張用に受けるが基準には使わない。
  for (const key of LANG_OBJECT_KEYS) {
    if (data[key] === undefined) continue;
    const compact = compactLangObject(
      normalizeLangResource(data[key] as LangResource, masterLang),
      masterLang,
    );
    if (compact === undefined) delete data[key];
    else data[key] = compact;
  }

  // §3.5.1: 上から順に評価し、最初に成立した行を採る（provider は role より優先）
  const maptype = isProviderKind(kind)
    ? String(masterData.maptype ?? "base")
    : role === "overlay"
      ? "overlay"
      : "base";

  // §3.5.4: kind 別の url。merc はマスタが url を持たない（空文字）ため現在 slug から導出し、
  // provider は url を出さない（source_ex.ts:221-224 が削除するため）。
  if (isProviderKind(kind)) {
    delete data.url;
    delete data.urls;
  } else if (kind === "merc") {
    data.url = `merc/${master.mapID}/{z}/{x}/{y}.png`;
  }

  return pruneEmpty({ ...data, mapID: master.mapID, maptype });
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
