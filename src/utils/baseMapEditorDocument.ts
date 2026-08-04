import type { LangCode } from "./editorLanguages";
import { normalizeLangResource, type LangResource } from "./langResource";

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

export interface BaseMapEditDocument {
  uid: string;
  scope: "builtin" | "user";
  defaultLang: LangCode;
  slug: string;
  title: Record<string, string>;
  label: Record<string, string>;
  attr: Record<string, string>;
  url: string;
  minZoom: number | null;
  maxZoom: number | null;
  thumbnail: string;
  coverageLngLats: [number, number][] | null;
  // 種別軸（m6-t1）。null = 未選択（新規作成直後のみ）。data に保持し AppSource.sourceType 軸は拡張しない。
  kind: BaseMapKind | null;
}

export interface BaseMapValidation {
  valid: boolean;
  errors: Array<
    | "kind-required" // 新設（m6-t1）。kind 未選択（null）
    | "provider-incomplete" // 新設（m6-t1）。google/mapbox/maplibre で必須項目未実装（t1 では保存不可）
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
    // 種別軸（m6-t1）。保存時は document.kind ?? "tms" で必ず既知5値のいずれか。
    kind: BaseMapKind;
    lang: LangCode;
    title: Record<string, string>;
    label: Record<string, string>;
    attr: Record<string, string>;
    url: string;
    minZoom: number | null;
    maxZoom: number | null;
    thumbnail: string;
    coverageLngLats: [number, number][] | null;
  };
}

const nullableNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

// kind の読み込み時正規化（ADR-0005 と同型）。既知5値のみ保持し、
// 欠落・未知値・型不一致は "tms" へ落とす（前方互換: 将来の kind を古いビルドが開いても壊れない）。
const normalizeKind = (value: unknown): BaseMapKind =>
  value === "tms" || value === "google" || value === "mapbox" || value === "maplibre" || value === "merc"
    ? value
    : "tms";

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
  return {
    uid: item.uid,
    scope: item.scope,
    defaultLang,
    slug: item.mapID,
    title,
    label: Object.keys(label).length > 0 ? label : { ...title },
    attr: normalizeLangResource(data.attr as LangResource | undefined, defaultLang),
    url: typeof data.url === "string" ? data.url : "",
    minZoom: nullableNumber(data.minZoom),
    maxZoom: nullableNumber(data.maxZoom),
    thumbnail: typeof data.thumbnail === "string" ? data.thumbnail : "",
    coverageLngLats: coverage(data.coverageLngLats),
    kind: normalizeKind(data.kind),
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
    url: "",
    minZoom: null,
    maxZoom: null,
    thumbnail: "",
    coverageLngLats: null,
    kind: null,
  };
}

export function validateBaseMapDocument(document: BaseMapEditDocument): BaseMapValidation {
  const errors: BaseMapValidation["errors"] = [];
  const kind = document.kind;
  // kind 未選択 → kind-required（フォーム本体は出ない）
  if (kind === null) {
    errors.push("kind-required");
  } else if (kind === "google" || kind === "mapbox" || kind === "maplibre") {
    // t1: provider の必須項目（google のプリセット / mapbox・maplibre の style）は m6-t4/t5 で未実装。
    // m6-t5 が style 欄を付けた時点で mapbox/maplibre は style-required へ置き換わる。
    errors.push("provider-incomplete");
  }
  if (!document.slug.trim()) errors.push("slug-required");
  else if (!/^[A-Za-z0-9_-]+$/.test(document.slug.trim())) errors.push("slug-invalid");
  if (!document.title[document.defaultLang]?.trim()) errors.push("title-required");
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

export function resolveBaseMapLayerMetadata(
  data: { title?: LangResource; attr?: LangResource; lang?: string; defaultLang?: string },
  activeLang: string,
): { title: string; attr: string } {
  const defaultLang = data.defaultLang || data.lang || "en";
  return {
    title: resolveBaseMapRuntimeText(data.title, activeLang, defaultLang),
    attr: resolveBaseMapRuntimeText(data.attr, activeLang, defaultLang),
  };
}
