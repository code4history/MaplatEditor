// nov26-m6-t8（#113・HR-19）: 書き出す中身の選択と、地図の書き出し物の目録（export-manifest.json）。
//
// main（electron/）と renderer（src/）の両方が import する唯一の窓口。
// 既定値・正規化・目録の生成と読み取りをここに集め、二重の定義を作らない。
//
// 地図の 3 つの中身の割り当て（タスク設計 §3.1）:
//   json      = maps/{slug}.json・pois/*.geojson・imgs/…（地図の設定と、それが参照する POI・アイコン）
//   tiles     = tiles/{slug}/…・tmbs/{slug}.jpg・512px のサムネイル（サムネイルはタイルから作るもの）
//   originals = originals/{slug}.{ext}（原画像。既定では入れない＝OD-M6-T8-DEFAULT）

export interface MapExportOptions {
  tiles: boolean;
  json: boolean;
  originals: boolean;
}

export interface AppExportOptions {
  includeTiles: boolean;
}

/** 地図の書き出しの既定。現行（t8 より前）と同じ中身＝タイルと JSON。原画像は選んだときだけ */
export const DEFAULT_MAP_EXPORT_OPTIONS: Readonly<MapExportOptions> = Object.freeze({
  tiles: true,
  json: true,
  originals: false,
});

/** アプリの書き出しの既定。タイルを含める */
export const DEFAULT_APP_EXPORT_OPTIONS: Readonly<AppExportOptions> = Object.freeze({
  includeTiles: true,
});

export class InvalidExportOptionsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidExportOptionsError';
  }
}

function boolOr(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/**
 * IPC 越しに来た値を正規化する。欠けたキー・boolean でない値は既定の値で埋める。
 * 3 つとも false は書き出す物が無いので不正（InvalidExportOptionsError）。
 */
export function normalizeMapExportOptions(raw?: unknown): MapExportOptions {
  const source = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
  const normalized: MapExportOptions = {
    tiles: boolOr(source.tiles, DEFAULT_MAP_EXPORT_OPTIONS.tiles),
    json: boolOr(source.json, DEFAULT_MAP_EXPORT_OPTIONS.json),
    originals: boolOr(source.originals, DEFAULT_MAP_EXPORT_OPTIONS.originals),
  };
  if (!normalized.tiles && !normalized.json && !normalized.originals) {
    throw new InvalidExportOptionsError('At least one of tiles/json/originals must be selected');
  }
  return normalized;
}

export function normalizeAppExportOptions(raw?: unknown): AppExportOptions {
  const source = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
  return { includeTiles: boolOr(source.includeTiles, DEFAULT_APP_EXPORT_OPTIONS.includeTiles) };
}

/** 選択が 1 つ以上あるか（画面の「書き出す」を押せるかの判定） */
export function hasAnyMapExportContent(options: MapExportOptions): boolean {
  return options.tiles || options.json || options.originals;
}

// ---------------------------------------------------------------------------
// 目録（T8-MIN-1）
// ---------------------------------------------------------------------------

export const EXPORT_MANIFEST_NAME = 'export-manifest.json';
export const EXPORT_MANIFEST_FORMAT = 'maplat-map-export';
export const EXPORT_MANIFEST_VERSION = 1;

export interface ExportManifest {
  format: typeof EXPORT_MANIFEST_FORMAT;
  version: typeof EXPORT_MANIFEST_VERSION;
  contents: MapExportOptions;
}

/** contents が既定（現行と同じ中身）か。既定なら目録を入れない ∴ 既定の書き出し物は現行と同一 */
export function isDefaultMapExportContents(contents: MapExportOptions): boolean {
  return contents.tiles === DEFAULT_MAP_EXPORT_OPTIONS.tiles
    && contents.json === DEFAULT_MAP_EXPORT_OPTIONS.json
    && contents.originals === DEFAULT_MAP_EXPORT_OPTIONS.originals;
}

/** 目録の本文を作る。contents は「実際に入れた」区分 */
export function buildExportManifest(contents: MapExportOptions): string {
  const manifest: ExportManifest = {
    format: EXPORT_MANIFEST_FORMAT,
    version: EXPORT_MANIFEST_VERSION,
    contents: { tiles: contents.tiles, json: contents.json, originals: contents.originals },
  };
  return JSON.stringify(manifest, null, 2);
}

export class CorruptExportManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CorruptExportManifestError';
  }
}

/**
 * 目録を読む。壊れた JSON・形の違い・未知の version は「目録なし」と同じに扱わず
 * CorruptExportManifestError を投げる（取り込みは 'Corrupt' に写す）。
 */
export function parseExportManifest(text: string): ExportManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new CorruptExportManifestError(`export manifest is not valid JSON: ${(e as Error).message}`);
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new CorruptExportManifestError('export manifest is not an object');
  }
  const record = parsed as Record<string, unknown>;
  if (record.format !== EXPORT_MANIFEST_FORMAT) {
    throw new CorruptExportManifestError(`unknown export manifest format: ${String(record.format)}`);
  }
  if (record.version !== EXPORT_MANIFEST_VERSION) {
    throw new CorruptExportManifestError(`unknown export manifest version: ${String(record.version)}`);
  }
  const contents = record.contents as Record<string, unknown> | undefined;
  if (!contents || typeof contents !== 'object'
      || typeof contents.tiles !== 'boolean'
      || typeof contents.json !== 'boolean'
      || typeof contents.originals !== 'boolean') {
    throw new CorruptExportManifestError('export manifest contents is malformed');
  }
  return {
    format: EXPORT_MANIFEST_FORMAT,
    version: EXPORT_MANIFEST_VERSION,
    contents: { tiles: contents.tiles, json: contents.json, originals: contents.originals },
  };
}
