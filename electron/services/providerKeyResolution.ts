/**
 * m6-t6: Google / Mapbox の API キー3段解決（設計書 §2/§3.1/§3.2）。
 *
 * - プレビュー: エディタ用キー → (アプリ単位 → 設定ページ既定公開用) → undefined
 * - パブリッシュ: アプリ単位 → 設定ページ既定公開用 → undefined（オンザフライは呼び出し側で ?? overrideKeys）
 *
 * AppPreviewService.ts / AppExportService.ts の両方から import する（同一扱い処理の共通実装化）。
 * electron パッケージへ依存しない純粋関数のみを置き、smoke から直接 import できるようにする
 * （providerGlCdn.ts と同じ方針）。
 */

export type ProviderKeyKind = "google" | "mapbox";

/** SettingsService 互換の最小インタフェース（テスト時は plain object で代替できる） */
export type SettingsLike = {
  get(key: string): unknown;
};

/** document.httpSettings 互換の最小インタフェース */
export type HttpSettingsLike = {
  googleApiKey?: unknown;
  mapboxToken?: unknown;
} | null | undefined;

const EDITOR_KEY_SETTING: Record<ProviderKeyKind, string> = {
  google: "editorGoogleApiKey",
  mapbox: "editorMapboxToken",
};

const DEFAULT_PUBLISH_KEY_SETTING: Record<ProviderKeyKind, string> = {
  google: "defaultPublishGoogleApiKey",
  mapbox: "defaultPublishMapboxToken",
};

/** 空文字・undefined・null はすべて「未設定」として扱う */
function asNonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** パブリッシュ（書き出し）の2段: アプリ単位キー → 設定ページ既定公開用キー */
export function resolvePublishKey(
  kind: ProviderKeyKind,
  httpSettings: HttpSettingsLike,
  settings: SettingsLike,
): string | undefined {
  const appKey =
    kind === "google" ? httpSettings?.googleApiKey : httpSettings?.mapboxToken;
  return (
    asNonEmpty(appKey) ??
    asNonEmpty(settings.get(DEFAULT_PUBLISH_KEY_SETTING[kind]))
  );
}

/** プレビューの3段: エディタ用キー → (アプリ単位 → 設定ページ既定公開用) */
export function resolvePreviewKey(
  kind: ProviderKeyKind,
  httpSettings: HttpSettingsLike,
  settings: SettingsLike,
): string | undefined {
  return (
    asNonEmpty(settings.get(EDITOR_KEY_SETTING[kind])) ??
    resolvePublishKey(kind, httpSettings, settings)
  );
}

/** 除外・診断の警告キー（preview/export 共通。warnings チャネルは補間パラメータを持たない） */
export const PROVIDER_KEY_MISSING_WARNING: Record<ProviderKeyKind, string> = {
  google: "appedit.warn_provider_google_key_missing",
  mapbox: "appedit.warn_provider_mapbox_key_missing",
};

/**
 * startFrom 解決（設計 §3.1/§3.2・v1.3 M5 是正）。preview の entries と export の sources は
 * 形が異なるため、呼び出し側が {startFrom, mapUid, mapSlug, viewerMapID} の候補配列へ写像してから渡す。
 *
 * 3段: (1) startFrom フラグ付きソース (2) mapUid/mapSlug が document.startFrom と一致 (3) viewerMapID が
 * document.startFrom と一致（旧形 slug 救済）。全て外れれば undefined（除外ソースは呼び出し側の配列に
 * そもそも含まれないため、除外ソースを指す startFrom は自動的に undefined になる）。
 */
export type StartFromCandidate = {
  startFrom: boolean;
  mapUid: string;
  mapSlug: string | undefined;
  viewerMapID: string;
};

export function resolveStartFromViewerMapID(
  candidates: readonly StartFromCandidate[],
  documentStartFrom: string | undefined,
): string | undefined {
  return (
    candidates.find((c) => c.startFrom)?.viewerMapID ??
    candidates.find(
      (c) => c.mapUid === documentStartFrom || c.mapSlug === documentStartFrom,
    )?.viewerMapID ??
    candidates.find((c) => c.viewerMapID === documentStartFrom)?.viewerMapID
  );
}
