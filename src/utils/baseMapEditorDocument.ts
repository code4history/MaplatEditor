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
}

export interface BaseMapValidation {
  valid: boolean;
  errors: Array<
    | "slug-required"
    | "slug-invalid"
    | "title-required"
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
  };
}

const nullableNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

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
  };
}

export function validateBaseMapDocument(document: BaseMapEditDocument): BaseMapValidation {
  const errors: BaseMapValidation["errors"] = [];
  if (!document.slug.trim()) errors.push("slug-required");
  else if (!/^[A-Za-z0-9_-]+$/.test(document.slug.trim())) errors.push("slug-invalid");
  if (!document.title[document.defaultLang]?.trim()) errors.push("title-required");
  if (!document.url.trim()) errors.push("url-required");
  else if (!(document.url.includes("{z}") && document.url.includes("{x}") && (document.url.includes("{y}") || document.url.includes("{-y}")))) {
    errors.push("url-invalid");
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
