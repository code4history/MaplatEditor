// 多言語リソース(LangResource)の表現仕様 (ADR-0005):
// - 内部/DB保存形: 常にオブジェクト {lang: text}。空文字エントリは持たない
// - 交換形(エクスポート/インポート): デフォルト言語のみの場合はプレーン文字列に
//   畳み込む(人間が編集しやすい簡便形)。インポート/ロードは両形式を受容する
// renderer(MapEdit)とelectron main(保存/マイグレーション/エクスポート)の両方から使う。

export type LangResource = string | Record<string, string>;

// MapEditの言語別編集対象フィールド(MapEdit.vue langAttrと一致させること)
export const MAP_LANG_ATTRS = [
  "title",
  "label",
  "officialTitle",
  "author",
  "era",
  "createdAt",
  "contributor",
  "mapper",
  "attr",
  "dataAttr",
  "licenseNote",
  "dataLicenseNote",
  "description",
] as const;

// ベースマップ文書の言語別フィールドの正本 (m6-t2)。
// title/attr は既存、dataAttr/licenseNote/dataLicenseNote は本タスクで新設。
// label を含めない: label は compactLangObject を使う別経路 (appSourceModel) であり、
// fromBaseMapCatalogItem でも label || title のフォールバックを持つ特別扱いだから。
export const BASE_MAP_LANG_ATTRS = [
  "title",
  "attr",
  "dataAttr",
  "licenseNote",
  "dataLicenseNote",
] as const;

// 任意の入力(プレーン文字列/オブジェクト/空)→ 内部形(オブジェクト、空エントリ除去)
// プレーン文字列はデフォルト言語の値とみなす
export function normalizeLangResource(
  value: LangResource | null | undefined,
  defaultLang: string,
): Record<string, string> {
  if (value === null || value === undefined) return {};
  if (typeof value === "string") {
    return value.trim() !== "" ? { [defaultLang]: value } : {};
  }
  if (typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      ([, text]) => typeof text === "string" && text.trim() !== "",
    ),
  );
}

// 内部形 → 交換形。デフォルト言語のみ→プレーン文字列 / 複数言語→オブジェクト / 空→undefined
export function compactLangResource(
  value: LangResource | null | undefined,
  defaultLang: string,
): LangResource | undefined {
  const normalized = normalizeLangResource(value, defaultLang);
  const langs = Object.keys(normalized);
  if (langs.length === 0) return undefined;
  if (langs.length === 1 && langs[0] === defaultLang) return normalized[defaultLang];
  return normalized;
}

// 地図ドキュメントの全言語別フィールドを内部形に正規化する(非破壊)
export function normalizeMapLangFields<T extends Record<string, any>>(document: T): T {
  const defaultLang = typeof document.lang === "string" && document.lang ? document.lang : "ja";
  const out: Record<string, any> = { ...document };
  for (const attr of MAP_LANG_ATTRS) {
    if (!(attr in out)) continue;
    out[attr] = normalizeLangResource(out[attr], defaultLang);
  }
  return out as T;
}

// 地図ドキュメントの全言語別フィールドを交換形に畳み込む(非破壊)。空フィールドは削除
export function compactMapLangFields<T extends Record<string, any>>(document: T): T {
  const defaultLang = typeof document.lang === "string" && document.lang ? document.lang : "ja";
  const out: Record<string, any> = { ...document };
  for (const attr of MAP_LANG_ATTRS) {
    if (!(attr in out)) continue;
    const compacted = compactLangResource(out[attr], defaultLang);
    if (compacted === undefined) delete out[attr];
    else out[attr] = compacted;
  }
  return out as T;
}

// LangResource (内部形 {lang: text} / 交換形の文字列) → 表示テキストへの解決。
// 優先順位: 現在言語 → 言語の basename (en-US→en) → ja → en → 任意の非空値。
// 該当が無ければ空文字を返す (呼び出し側で slug 等へのフォールバックを行うこと)。
// POI source の一覧 / selector で共有する表示解決ロジック。
export function localizeTitle(
  title: LangResource | null | undefined,
  lang: string,
): string {
  if (typeof title === "string") return title;
  if (title && typeof title === "object") {
    const picked =
      title[lang] ||
      title[lang?.split("-")[0]] ||
      title.ja ||
      title.en ||
      Object.values(title).find((v) => typeof v === "string" && v !== "");
    if (picked) return picked;
  }
  return "";
}
