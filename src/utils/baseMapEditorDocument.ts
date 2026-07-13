import type { LangCode } from "./editorLanguages";
import { normalizeLangResource, type LangResource } from "./langResource";

export interface BaseMapCatalogItemLike {
  uid: string;
  mapID: string;
  scope: "builtin" | "user";
  revision: number;
  data: Record<string, unknown>;
}

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
}

export interface BaseMapValidation {
  valid: boolean;
  errors: Array<"slug-required" | "title-required" | "url-required" | "zoom-range">;
}

export interface BaseMapSavePayload {
  uid?: string;
  slug: string;
  expectedRevision?: number;
  tms: {
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
  };
}

export function validateBaseMapDocument(document: BaseMapEditDocument): BaseMapValidation {
  const errors: BaseMapValidation["errors"] = [];
  if (!document.slug.trim()) errors.push("slug-required");
  if (!document.title[document.defaultLang]?.trim()) errors.push("title-required");
  if (!document.url.trim()) errors.push("url-required");
  if (document.minZoom !== null && document.maxZoom !== null && document.minZoom > document.maxZoom) {
    errors.push("zoom-range");
  }
  return { valid: errors.length === 0, errors };
}

export function toBaseMapSavePayload(
  document: BaseMapEditDocument,
  revision: number | null,
): BaseMapSavePayload {
  return {
    ...(revision !== null && document.scope === "user" && document.uid ? { uid: document.uid } : {}),
    slug: document.slug,
    ...(revision === null ? {} : { expectedRevision: revision }),
    tms: {
      lang: document.defaultLang,
      title: { ...document.title },
      label: { ...document.label },
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
