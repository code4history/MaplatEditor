import type { LangCode } from "./editorLanguages";
import {
  BASE_MAP_LANG_ATTRS,
  normalizeLangResource,
  type LangResource,
} from "./langResource";

export interface BaseMapCatalogItemLike {
  uid: string;
  mapID: string;
  scope: "builtin" | "user";
  revision: number;
  data: Record<string, unknown>;
}

export interface BaseMapCatalogItem extends BaseMapCatalogItemLike {
  thumbnailUrl?: string | null;
  alwaysVisible: boolean;
  alwaysLocked: boolean;
}

// 種別軸（m6-t1）。ビューア（MaplatCore source_ex.ts）の maptype 語彙に対応するエディタ側識別子。
// "tms" は従来のタイルURL地図（既定）。provider（google/mapbox/maplibre）は m6-t4/t5、merc は m6-t8 が担当。
export type BaseMapKind = "tms" | "google" | "mapbox" | "maplibre" | "merc";

// Google プリセット値（m6-t4）。kind === "google" のときのみ意味を持つ。
export type GoogleMapType = "google_roadmap" | "google_satellite" | "google_hybrid" | "google_terrain";

export interface BaseMapEditDocument {
  uid: string;
  scope: "builtin" | "user";
  defaultLang: LangCode;
  slug: string;
  title: Record<string, string>;
  label: Record<string, string>;
  attr: Record<string, string>;
  // m6-t2: ベースマップの 2×2 (dataAttr / license / dataLicense) と自由記述2欄 (licenseNote / dataLicenseNote)。
  // license / dataLicense の既定は空文字 (§4.1)。他は多言語オブジェクト (内部形)。
  dataAttr: Record<string, string>;
  license: string;
  dataLicense: string;
  licenseNote: Record<string, string>;
  dataLicenseNote: Record<string, string>;
  url: string;
  minZoom: number | null;
  maxZoom: number | null;
  thumbnail: string;
  coverageLngLats: [number, number][] | null;
  // m6-t7: TileJSON URL からの取り込みで埋まった場合の出自 URL。null = 未取り込み（手動作成/tiles編集）。
  // EDITOR_ONLY_KEYS 経由で viewer 出力からは除去される（appSourceModel.ts §3.3）。再取得機能は m6 では作らない。
  tileJsonSourceUrl: string | null;
  // 種別軸（m6-t1）。null = 未選択（新規作成直後のみ）。data に保持し AppSource.sourceType 軸は拡張しない。
  kind: BaseMapKind | null;
  // Google プリセット値（m6-t4）。kind === "google" のときのみ非 null。
  maptype: GoogleMapType | null;
  // m6-t5: mapbox / maplibre の style URL（他 kind では null）
  style: string | null;
}

export interface BaseMapValidation {
  valid: boolean;
  errors: Array<
    | "kind-required" // 新設（m6-t1）。kind 未選択（null）
    | "provider-incomplete" // 新設（m6-t1）。t4/t5 で google=maptype-required・mapbox/maplibre=style 系へ置換済み（型互換のため残置）
    | "maptype-required" // 新設（m6-t4）。kind === "google" で maptype 未選択
    | "style-required" // m6-t5: mapbox/maplibre で style 空
    | "style-mapbox-scheme-forbidden" // m6-t5: maplibre で mapbox://
    | "style-url-invalid" // m6-t5: 許可外 URL
    | "slug-required"
    | "slug-invalid"
    | "title-required"
    | "attr-required"
    | "url-required"
    | "url-invalid"
    | "min-zoom-invalid"
    | "max-zoom-invalid"
    | "zoom-range"
  >;
}

export interface BaseMapSavePayload {
  uid?: string;
  slug: string;
  expectedRevision?: number;
  // 新規作成の明示合図 (M11-T7/§7.2b)。true=uid を事前採番 preset として採用
  create?: boolean;
  tms: {
    // 種別軸（m6-t1）。保存時は document.kind ?? "tms" で必ず既知5値のいずれか。
    kind: BaseMapKind;
    lang: LangCode;
    title: Record<string, string>;
    label: Record<string, string>;
    attr: Record<string, string>;
    dataAttr: Record<string, string>;
    license: string;
    dataLicense: string;
    licenseNote: Record<string, string>;
    dataLicenseNote: Record<string, string>;
    url: string;
    minZoom: number | null;
    maxZoom: number | null;
    thumbnail: string;
    coverageLngLats: [number, number][] | null;
    // m6-t7: TileJSON 取り込み出自 URL。無条件出力（coverageLngLats と同型。EDITOR_ONLY_KEYS で strip）
    tileJsonSourceUrl: string | null;
    // m6-t4: kind === "google" のときのみ出力 / m6-t5: mapbox/maplibre のとき viewer 向け maptype + style
    maptype?: string;
    style?: string;
  };
}

const nullableNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

// kind の読み込み時正規化（ADR-0005 と同型）。既知5値のみ保持し、
// 欠落・未知値・型不一致は "tms" へ落とす（前方互換: 将来の kind を古いビルドが開いても壊れない）。
// m6-t4: BaseMapEdit の登録済み判定でも使うため export する。
export const normalizeKind = (value: unknown): BaseMapKind =>
  value === "tms" || value === "google" || value === "mapbox" || value === "maplibre" || value === "merc"
    ? value
    : "tms";

const GOOGLE_MAPTYPES: readonly GoogleMapType[] = [
  "google_roadmap",
  "google_satellite",
  "google_hybrid",
  "google_terrain",
];

export const normalizeGoogleMaptype = (
  value: unknown,
  kind: BaseMapKind | null,
): GoogleMapType | null => {
  if (kind !== "google") return null;
  return GOOGLE_MAPTYPES.includes(value as GoogleMapType) ? (value as GoogleMapType) : null;
};

// m6-t5 v1.3: provider 種別の原子述語（google/mapbox/maplibre）。MapEdit 背景除外・
// appSourceModel の maptype 判定など、同一扱いは本述語へ一元化する（恒久指示）
export const PROVIDER_BASE_MAP_KINDS = ["google", "mapbox", "maplibre"] as const;
export function isProviderKind(value: unknown): boolean {
  return (PROVIDER_BASE_MAP_KINDS as readonly unknown[]).includes(value);
}

// m6-t6: 「キー(API キー/アクセストークン)が要る」種別の原子述語（google/mapbox の2種）。
// isProviderKind（3種・provider 判定）とも providerGlCdn.ts の sourceKind（GL CDN 要否・
// mapbox/maplibre の2種）とも異なる第3の述語であり、意図的に別定義とする（maplibre は
// スタイル自体にキーを含められるため GL は要るがエディタ管理のキーは要らない）
export const PROVIDER_KEY_REQUIRED_KINDS = ["google", "mapbox"] as const;
export function requiresProviderKey(value: unknown): boolean {
  return (PROVIDER_KEY_REQUIRED_KINDS as readonly unknown[]).includes(value);
}

// m6-t5 v1.3: MapEdit 背景選択から除外する判定。kind（editor 軸）を優先し、
// 欠落時は maptype（viewer 軸）を見る（旧保存形の保険）
export function isProviderBaseMapData(
  data: { kind?: unknown; maptype?: unknown } | null | undefined,
): boolean {
  return isProviderKind(data?.kind ?? data?.maptype);
}

/** m6-t5: mapbox:// または mapbox: スキーム */
export function isMapboxScheme(style: string): boolean {
  const s = style.trim().toLowerCase();
  return s.startsWith("mapbox://") || s.startsWith("mapbox:");
}

/** m6-t5: kind に応じた style URL 許可 */
export function isAllowedStyleUrl(style: string, kind: "mapbox" | "maplibre"): boolean {
  const s = style.trim();
  if (!s) return false;
  if (kind === "mapbox") {
    if (isMapboxScheme(s)) return true;
    try {
      const u = new URL(s);
      return u.protocol === "https:";
    } catch {
      return false;
    }
  }
  // maplibre: https only
  try {
    const u = new URL(s);
    return u.protocol === "https:";
  } catch {
    return false;
  }
}

const normalizeStyle = (value: unknown, kind: BaseMapKind | null): string | null => {
  if (kind !== "mapbox" && kind !== "maplibre") return null;
  return typeof value === "string" ? value : null;
};

const coverage = (value: unknown): [number, number][] | null => {
  if (!Array.isArray(value)) return null;
  const points = value.filter(
    (point): point is [number, number] =>
      Array.isArray(point) &&
      point.length >= 2 &&
      Number.isFinite(point[0]) &&
      Number.isFinite(point[1]),
  );
  return points.length === value.length ? points.map(([lng, lat]) => [lng, lat]) : null;
};

export function fromBaseMapCatalogItem(item: BaseMapCatalogItemLike): BaseMapEditDocument {
  const data = item.data ?? {};
  const defaultLang = (typeof data.lang === "string" && data.lang ? data.lang : item.scope === "builtin" ? "en" : "ja") as LangCode;
  const title = normalizeLangResource(data.title as LangResource | undefined, defaultLang);
  const label = normalizeLangResource(data.label as LangResource | undefined, defaultLang);
  // m6-t2: BASE_MAP_LANG_ATTRS のうち title を除く4件 (attr/dataAttr/licenseNote/dataLicenseNote) を
  // 共通ループで内部形へ正規化する。label は上で特別扱い済み。
  const lang: Record<string, Record<string, string>> = {};
  for (const attr of BASE_MAP_LANG_ATTRS) {
    if (attr === "title") continue;
    lang[attr] = normalizeLangResource(data[attr] as LangResource | undefined, defaultLang);
  }
  // license / dataLicense は ASCII 語彙の単一文字列。非文字列は空文字へ落とす (§4.1)
  const license = typeof data.license === "string" ? data.license : "";
  const dataLicense = typeof data.dataLicense === "string" ? data.dataLicense : "";
  const kind = normalizeKind(data.kind);
  return {
    uid: item.uid,
    scope: item.scope,
    defaultLang,
    slug: item.mapID,
    title,
    label: Object.keys(label).length > 0 ? label : { ...title },
    attr: lang.attr ?? {},
    dataAttr: lang.dataAttr ?? {},
    licenseNote: lang.licenseNote ?? {},
    dataLicenseNote: lang.dataLicenseNote ?? {},
    license,
    dataLicense,
    url: typeof data.url === "string" ? data.url : "",
    minZoom: nullableNumber(data.minZoom),
    maxZoom: nullableNumber(data.maxZoom),
    thumbnail: typeof data.thumbnail === "string" ? data.thumbnail : "",
    coverageLngLats: coverage(data.coverageLngLats),
    tileJsonSourceUrl: typeof data.tileJsonSourceUrl === "string" ? data.tileJsonSourceUrl : null,
    kind,
    maptype: normalizeGoogleMaptype(data.maptype, kind),
    style: normalizeStyle(data.style, kind),
  };
}

export function newBaseMapDocument(uid: string, lang: LangCode): BaseMapEditDocument {
  return {
    uid,
    scope: "user",
    defaultLang: lang,
    slug: "",
    title: {},
    label: {},
    attr: {},
    dataAttr: {},
    // m6-t2: license / dataLicense の既定は空文字 (§4.1)。All right reserved を既定にしない。
    license: "",
    dataLicense: "",
    licenseNote: {},
    dataLicenseNote: {},
    url: "",
    minZoom: null,
    maxZoom: null,
    thumbnail: "",
    coverageLngLats: null,
    tileJsonSourceUrl: null,
    kind: null,
    maptype: null,
    style: null,
  };
}

export function validateBaseMapDocument(document: BaseMapEditDocument): BaseMapValidation {
  const errors: BaseMapValidation["errors"] = [];
  const kind = document.kind;
  // kind 未選択 → kind-required（フォーム本体は出ない）
  if (kind === null) {
    errors.push("kind-required");
  } else if (kind === "google") {
    // m6-t4: Google の必須項目は maptype（4プリセットから選択）。
    if (!document.maptype) errors.push("maptype-required");
  } else if (kind === "mapbox" || kind === "maplibre") {
    // m6-t5: style 必須。maplibre は mapbox:// 禁止・https のみ。
    const style = (document.style ?? "").trim();
    if (!style) {
      errors.push("style-required");
    } else if (kind === "maplibre" && isMapboxScheme(style)) {
      errors.push("style-mapbox-scheme-forbidden");
    } else if (!isAllowedStyleUrl(style, kind)) {
      errors.push("style-url-invalid");
    }
  }
  if (!document.slug.trim()) errors.push("slug-required");
  else if (!/^[A-Za-z0-9_-]+$/.test(document.slug.trim())) errors.push("slug-invalid");
  if (!document.title[document.defaultLang]?.trim()) errors.push("title-required");
  // m6-t2 (レビュー M2): 地図画像帰属 (attr) を必須化。地図側と同様、既定言語の値が空なら error。
  // kind に関わらず attr は必須（m6-t1 の kind チェックとは独立）
  if (!document.attr[document.defaultLang]?.trim()) errors.push("attr-required");
  // url 必須は kind === "tms" のみ（merc は m6-t8 が導出、provider は不要。現行の tms 挙動と完全一致）
  if (kind === "tms") {
    if (!document.url.trim()) errors.push("url-required");
    else if (!(document.url.includes("{z}") && document.url.includes("{x}") && (document.url.includes("{y}") || document.url.includes("{-y}")))) {
      errors.push("url-invalid");
    }
  }
  if (document.minZoom !== null && (!Number.isInteger(document.minZoom) || document.minZoom < 0 || document.minZoom > 25)) {
    errors.push("min-zoom-invalid");
  }
  if (document.maxZoom !== null && (!Number.isInteger(document.maxZoom) || document.maxZoom < 1 || document.maxZoom > 25)) {
    errors.push("max-zoom-invalid");
  }
  if (document.minZoom !== null && document.maxZoom !== null && document.minZoom > document.maxZoom) {
    errors.push("zoom-range");
  }
  return { valid: errors.length === 0, errors };
}

export function toBaseMapSavePayload(
  document: BaseMapEditDocument,
  revision: number | null,
): BaseMapSavePayload {
  const hasExplicitLabel = Object.values(document.label).some((value) => value.trim() !== "");
  return {
    ...(revision !== null && document.scope === "user" && document.uid ? { uid: document.uid } : {}),
    slug: document.slug,
    ...(revision === null ? {} : { expectedRevision: revision }),
    tms: {
      // 種別軸（m6-t1）。null は保存時 "tms" へ正規化（save は kind-required で null 到達を阻止済み）。
      // saveUserBaseMap が { ...tms, mapID: slug } を data_json に書くため、ここに載せれば永続化される。
      kind: document.kind ?? "tms",
      lang: document.defaultLang,
      title: { ...document.title },
      label: hasExplicitLabel ? { ...document.label } : { ...document.title },
      attr: { ...document.attr },
      // m6-t2: 5フィールドを常に出力する (空でも出す。attr と同じ形)
      dataAttr: { ...document.dataAttr },
      license: document.license,
      dataLicense: document.dataLicense,
      licenseNote: { ...document.licenseNote },
      dataLicenseNote: { ...document.dataLicenseNote },
      url: document.url,
      minZoom: document.minZoom,
      maxZoom: document.maxZoom,
      thumbnail: document.thumbnail,
      coverageLngLats: document.coverageLngLats?.map(([lng, lat]) => [lng, lat]) ?? null,
      tileJsonSourceUrl: document.tileJsonSourceUrl,
      // m6-t4: kind === "google" のときのみ maptype を出力
      ...(document.kind === "google" && document.maptype ? { maptype: document.maptype } : {}),
      // m6-t5: mapbox/maplibre は viewer 向け maptype + style を data に載せる（AC23-b: 単一 spread）
      ...(document.kind === "mapbox" || document.kind === "maplibre"
        ? { maptype: document.kind, style: document.style ?? "" }
        : {}),
    },
  };
}

export function resolveBaseMapRuntimeText(
  value: LangResource | null | undefined,
  activeLang: string,
  defaultLang: string,
): string {
  if (typeof value === "string") return value;
  if (!value) return "";
  return (
    value[activeLang] ||
    value[activeLang.split("-")[0]] ||
    value[defaultLang] ||
    value[defaultLang.split("-")[0]] ||
    value.ja ||
    value.en ||
    Object.values(value).find((text) => typeof text === "string" && text !== "") ||
    ""
  );
}

// ベースマップ文書の言語別フィールドを、言語解決済みのテキスト値へ展開する汎用関数 (m6-t2)。
// BASE_MAP_LANG_ATTRS の各キーを resolveBaseMapRuntimeText で解決して返す。
export function resolveBaseMapLangTexts(
  data: Record<string, unknown>,
  activeLang: string,
): Record<(typeof BASE_MAP_LANG_ATTRS)[number], string> {
  const defaultLang = (data.defaultLang as string) || (data.lang as string) || "en";
  const out = {} as Record<(typeof BASE_MAP_LANG_ATTRS)[number], string>;
  for (const key of BASE_MAP_LANG_ATTRS) {
    out[key] = resolveBaseMapRuntimeText(data[key] as LangResource | undefined, activeLang, defaultLang);
  }
  return out;
}

// resolveBaseMapLayerMetadata は resolveBaseMapLangTexts の薄いラッパー。
// 戻り値は従来どおり { title: string; attr: string } の2キーちょうど
// (m11-t4-master-detail-smoke.mjs:280 の deepEqual がこの形を見張る)。
export function resolveBaseMapLayerMetadata(
  data: { title?: LangResource; attr?: LangResource; lang?: string; defaultLang?: string },
  activeLang: string,
): { title: string; attr: string } {
  const { title, attr } = resolveBaseMapLangTexts(data as Record<string, unknown>, activeLang);
  return { title, attr };
}
