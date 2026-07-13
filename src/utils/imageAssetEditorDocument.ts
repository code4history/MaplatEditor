import type { ImageAssetRow } from "../electron";
import { resolveEditorLanguage, type LangCode } from "./editorLanguages";
import { normalizeLangResource } from "./langResource";

export interface ImageAssetEditDocument {
  uid: string;
  defaultLang: LangCode;
  slug: string;
  title: Record<string, string>;
  sourceName: string | null;
  mime: string | null;
  ext: string | null;
  width: number | null;
  height: number | null;
  byteSize: number | null;
}

export type ImageAssetMetadataDraft = Pick<
  ImageAssetEditDocument,
  "uid" | "defaultLang" | "slug" | "title"
>;

export interface ImageAssetValidation {
  valid: boolean;
  errors: Array<"slug-required" | "slug-invalid" | "title-required" | "source-required">;
}

export function fromImageAssetRow(row: ImageAssetRow): ImageAssetEditDocument {
  const defaultLang = resolveEditorLanguage(row.lang || "ja");
  return {
    uid: row.uid,
    defaultLang,
    slug: row.slug,
    title: normalizeLangResource(row.title, defaultLang),
    sourceName: row.sourceName ?? null,
    mime: row.mime ?? null,
    ext: row.ext ?? null,
    width: row.width ?? null,
    height: row.height ?? null,
    byteSize: row.byteSize ?? null,
  };
}

export function newImageAssetDocument(uid: string, lang: LangCode): ImageAssetEditDocument {
  return {
    uid,
    defaultLang: lang,
    slug: "",
    title: {},
    sourceName: null,
    mime: null,
    ext: null,
    width: null,
    height: null,
    byteSize: null,
  };
}

export function toImageAssetDraft(document: ImageAssetEditDocument): ImageAssetMetadataDraft {
  return {
    uid: document.uid,
    defaultLang: document.defaultLang,
    slug: document.slug,
    title: { ...document.title },
  };
}

export function applyImageAssetDraft(
  document: ImageAssetEditDocument,
  draft: ImageAssetMetadataDraft,
): ImageAssetEditDocument {
  return {
    ...document,
    uid: draft.uid,
    defaultLang: draft.defaultLang,
    slug: draft.slug,
    title: { ...draft.title },
  };
}

export function validateImageAssetDocument(
  document: ImageAssetEditDocument,
  hasVolatileSource: boolean,
): ImageAssetValidation {
  const errors: ImageAssetValidation["errors"] = [];
  if (!document.slug.trim()) errors.push("slug-required");
  else if (!/^[A-Za-z0-9_-]+$/.test(document.slug.trim())) errors.push("slug-invalid");
  if (!document.title[document.defaultLang]?.trim()) errors.push("title-required");
  if (!document.mime && !hasVolatileSource) errors.push("source-required");
  return { valid: errors.length === 0, errors };
}
