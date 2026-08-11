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
