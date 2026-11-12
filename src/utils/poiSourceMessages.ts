// PoiSourceSaveResult の Error コード / 検証 issue code → i18n キーの共有写像 (Phase 4 Task 5)。
// Phase 3 で PoiSourceList.vue 内にあった写像を PoiEdit.vue と共用するため移設した (挙動不変)。
// i18next には依存せず、t() は呼び出し側から受け取る (useRevisionedAssetSave と同じ方針)。
import type { PoiSourceErrorCode, PoiValidationIssue } from "../electron";

// poiGeoJson.ts の検証 code → i18n key の写像。非 Point (geometry-not-point) は POI-104 専用文言。
// unsupported-scheme / payload-too-large は PoiSourceService の remote fetch (POI-121) が返す
export const ISSUE_CODE_KEYS: Record<string, string> = {
  "geometry-not-point": "poisource.errors.non_point",
  "not-feature-collection": "poisource.errors.not_feature_collection",
  "coord-range": "poisource.errors.coord_range",
  "name-required": "poisource.errors.name_required",
  "display-id-duplicate": "poisource.errors.display_id_duplicate",
  "display-id-charset": "poisource.errors.display_id_charset",
  "display-id-assigned": "poisource.errors.display_id_assigned",
  "no-content": "poisource.errors.no_content",
  "scale-feature-count": "poisource.errors.scale_feature_count",
  "scale-byte-size": "poisource.errors.scale_byte_size",
  "unsupported-scheme": "poisource.errors.unsupported_scheme",
  "payload-too-large": "poisource.errors.payload_too_large",
  // M11-T9: Content Mode 検証 (人間検証Round1: i18n未登録で生コード表示だった)
  "content-mode-url-format": "poisource.errors.content_mode_url_format",
  "content-mode-html-missing-content": "poisource.errors.content_mode_html_missing_content",
  // directgo（リンクの形）の値が不正（href が無い・拒否される URL・blank が真偽値でない）
  "content-mode-link-format": "poisource.errors.content_mode_link_format",
  // directgo が空白だけ・{ href: "" }（link 以外の形。ビューアでは値ありとして扱われる）
  "directgo-blank-like": "poisource.errors.directgo_blank_like",
  // CSV の取り込み（解析と合流が出す code）
  "missing-columns": "poiio.issues.missing_columns",
  "incomplete-coordinate-columns": "poiio.issues.incomplete_coordinate_columns",
  "duplicate-column": "poiio.issues.duplicate_column",
  "encoding-unsupported": "poiio.issues.encoding_unsupported",
  "not-text": "poiio.issues.not_text",
  "csv-unterminated-quote": "poiio.issues.csv_unterminated_quote",
  "file-too-large": "poiio.issues.file_too_large",
  "too-many-rows": "poiio.issues.too_many_rows",
  "column-count": "poiio.issues.column_count",
  "coord-format": "poiio.issues.coord_format",
  "file-duplicate-id": "poiio.issues.file_duplicate_id",
  "cell-too-large": "poiio.issues.cell_too_large",
  "coord-missing": "poiio.issues.coord_missing",
  "id-exhausted": "poiio.issues.id_exhausted",
  "id-renamed": "poiio.issues.id_renamed",
  "ignored-columns": "poiio.issues.ignored_columns",
  "pixel-coordinates-ignored": "poiio.issues.pixel_coordinates_ignored",
  "image-dropped": "poiio.issues.image_dropped",
  "quote-prefix-stripped": "poiio.issues.quote_prefix_stripped",
  "coordinate-partial": "poiio.issues.coordinate_partial",
  // KML の取り込み
  "kml-not-xml": "poiio.issues.kml_not_xml",
  "kml-too-large": "poiio.issues.kml_too_large",
  "kml-too-deep": "poiio.issues.kml_too_deep",
  "kml-doctype-forbidden": "poiio.issues.kml_doctype_forbidden",
  "kml-no-placemarks": "poiio.issues.kml_no_placemarks",
  "kml-bad-coordinates": "poiio.issues.kml_bad_coordinates",
  "kml-non-point-skipped": "poiio.issues.kml_non_point_skipped",
  "kml-description-html-flattened": "poiio.issues.kml_description_html_flattened",
  "kml-description-image-dropped": "poiio.issues.kml_description_image_dropped",
  "kml-id-ignored": "poiio.issues.kml_id_ignored",
  "kml-extended-data-conflict": "poiio.issues.kml_extended_data_conflict",
  "kml-undefined-entity": "poiio.issues.kml_undefined_entity",
};

// PoiSourceSaveResult の Error variant (electron.d.ts) の code → i18n key。
// invalid-request は「引数不正」だが利用者向けには検証エラーと同じ文言を出す (Phase 3 踏襲)
export const ERROR_CODE_KEYS: Record<PoiSourceErrorCode, string> = {
  network: "poisource.errors.network",
  "http-status": "poisource.errors.http_status",
  parse: "poisource.errors.parse",
  "not-found": "poisource.errors.not_found",
  "invalid-request": "poisource.errors.invalid",
  internal: "poisource.errors.internal",
  // nov26-m6-t3 (#98・#116): ZIP の取り込みの失敗は固定文（adm-zip の原文を出さない）
  "zip-too-large": "poisource.errors.zip_too_large",
  "zip-corrupt": "poisource.errors.zip_corrupt",
  "zip-too-many-entries": "poisource.errors.zip_too_many_entries",
};

// 検証 issue を人間可読に。既知 code は専用文言、未知は code/message をそのまま出す
export function issueMessage(
  issue: PoiValidationIssue,
  t: (key: string) => string,
): string {
  const key = ISSUE_CODE_KEYS[issue.code];
  // 既知 code は文言優先だが、message (例: display-id-assigned の採番数) があれば併記する
  const base = key
    ? issue.message
      ? `${t(key)} (${issue.message})`
      : t(key)
    : issue.message || issue.code || t("poisource.errors.invalid");
  return issue.featureId ? `${issue.featureId}: ${base}` : base;
}
