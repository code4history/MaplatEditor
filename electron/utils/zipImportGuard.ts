// nov26-m6-t3（#98・#116）: ZIP の取り込みの共通の検査と、読み取りの例外の判定。
//
// - assertZipImportSize: adm-zip は 2 GiB 超の zip を読めない（ERR_FS_FILE_TOO_LARGE。oct26-m4-t1 で実測）。
//   new AdmZip の **前に** 呼び、決定的なエラー（ZipImportError 'too-large'）にする。
//   地図（DataUploadService.extractZip）と POI 単体（PoiPackageService.importPoiZip）の両方が使う。
// - classifyZipReadError: 「ZIP が壊れている」ことを示す例外だけを判定し、利用者向けのコードへ写す材料にする。
//   adm-zip の例外は util/errors.js の E() により必ず 'ADM-ZIP: ' で始まる。圧縮データの破損は
//   zlib.inflateRawSync が Node の zlib の例外（code が 'Z_' で始まる、または ERR_ZLIB 系）として投げる。
//   重複名は PoiPackageService.zipEntryInfos が `Duplicate <kind> entry` へ写したもの。
//   利用者の操作による失敗（ENOENT・権限等）は判定しない（null）。「壊れた ZIP」と誤って出さない（設計 R1）。
//
// 利用者に見せる文言は i18n の固定文で、例外の原文（ファイルのパスや adm-zip の `{0}` を含みうる）は
// 呼び出し側が console.error／main のログへだけ出す。
//
// このモジュールは electron を import しない（smoke の vite バンドルでスタブを要さない）。
import fs from 'fs-extra';

export const ZIP_IMPORT_MAX_BYTES = 2 * 1024 * 1024 * 1024;

// 地図 ZIP を展開する前の上限。どれも宣言サイズで判定する（宣言が書かれる量の上限であることは
// src/utils/poiPackage.ts の assertArchiveStructure が保証する）。
//
// - maxEntries: 受け付ける原画像の上限から求めた正当な最大 約 12,216 件の 4 倍を切り上げ
// - maxDeclaredBytes: 正当な ZIP の最大（2 GiB × タイル主体の比 1.37 ≒ 2.74 GiB）の 4 倍を切り上げ
// - maxRatio: 実データの最大 19.85（JSON だけの ZIP）の 4 倍を切り上げ。
//   宣言の総量が ratioFloorBytes 以上のときだけ見る（小さな ZIP が膨らんでも守るものが無い）
// - maxEntryBytes: adm-zip は 1 entry を 1 回の writeSync で書くので、2 GiB 以上は書けない
export type MapArchiveLimits = {
  maxEntries: number;
  maxDeclaredBytes: number;
  ratioFloorBytes: number;
  maxRatio: number;
  maxEntryBytes: number;
};

export const MAP_ARCHIVE_LIMITS: Readonly<MapArchiveLimits> = {
  maxEntries: 50_000,
  maxDeclaredBytes: 12 * 1024 ** 3,
  ratioFloorBytes: 1 * 1024 ** 3,
  maxRatio: 80,
  maxEntryBytes: 2 * 1024 ** 3 - 1,
};

export type ZipImportErrorKind =
  | 'too-large'
  | 'corrupt'
  | 'duplicate-entry'
  | 'too-many-entries'
  | 'expands-too-large';

export class ZipImportError extends Error {
  constructor(public readonly kind: ZipImportErrorKind, message: string) {
    super(message);
    this.name = 'ZipImportError';
  }
}

// new AdmZip の前に呼ぶ。超えたら ZipImportError('too-large')。読んだ大きさを返す。
// fs.stat の失敗（ENOENT 等）はそのまま投げる（壊れた ZIP ではない）。
export async function assertZipImportSize(zipPath: string, label: string): Promise<number> {
  const size = (await fs.stat(zipPath)).size;
  if (size > ZIP_IMPORT_MAX_BYTES) {
    throw new ZipImportError(
      'too-large',
      `${label} is too large to import: ${size} bytes exceeds the 2 GiB limit ` +
        '(>2 GiB streaming import is not yet supported)',
    );
  }
  return size;
}

// 地図 ZIP の展開の前に呼ぶ。超えたら ZipImportError（'too-many-entries' か 'expands-too-large'）。
export function assertMapArchiveLimits(
  entries: readonly { size: number }[],
  archiveBytes: number,
  limits: Readonly<MapArchiveLimits> = MAP_ARCHIVE_LIMITS,
): void {
  if (entries.length > limits.maxEntries) {
    throw new ZipImportError(
      'too-many-entries',
      `Map package has too many entries: ${entries.length} exceeds ${limits.maxEntries}`,
    );
  }
  let declaredBytes = 0;
  for (const entry of entries) {
    if (entry.size > limits.maxEntryBytes) {
      throw new ZipImportError(
        'expands-too-large',
        `Map package entry is too large: ${entry.size} bytes exceeds ${limits.maxEntryBytes}`,
      );
    }
    declaredBytes += entry.size;
  }
  if (declaredBytes > limits.maxDeclaredBytes) {
    throw new ZipImportError(
      'expands-too-large',
      `Map package expands too large: ${declaredBytes} bytes exceeds ${limits.maxDeclaredBytes}`,
    );
  }
  if (
    declaredBytes >= limits.ratioFloorBytes &&
    archiveBytes > 0 &&
    declaredBytes / archiveBytes > limits.maxRatio
  ) {
    throw new ZipImportError(
      'expands-too-large',
      `Map package expands too much: ${declaredBytes} bytes from ${archiveBytes} bytes`,
    );
  }
}

const ADM_ZIP_PREFIX = 'ADM-ZIP: ';
// adm-zip の例外のうち、ZIP の中身ではなくファイルシステムの状態による失敗。壊れた ZIP と判定しない
const ADM_ZIP_NOT_CORRUPT = [
  /^ADM-ZIP: File not found/,
  /^ADM-ZIP: There is a file in the way/,
  /^ADM-ZIP: Target file already exists/,
];
const DUPLICATE_ENTRY = /^Duplicate .* entry(?:: .*)?$/s;

export function classifyZipReadError(error: unknown): ZipImportError | null {
  if (error instanceof ZipImportError) return error;
  if (!(error instanceof Error)) return null;
  const message = error.message ?? '';
  if (DUPLICATE_ENTRY.test(message)) return new ZipImportError('duplicate-entry', message);
  if (message.startsWith(ADM_ZIP_PREFIX)) {
    if (ADM_ZIP_NOT_CORRUPT.some((re) => re.test(message))) return null;
    return new ZipImportError('corrupt', message);
  }
  const code = (error as { code?: unknown }).code;
  // ERR_BUFFER_TOO_LARGE は、展開後サイズを小さく偽った DEFLATED の entry で zlib が投げる
  if (
    typeof code === 'string' &&
    (code.startsWith('Z_') || code.startsWith('ERR_ZLIB') || code === 'ERR_BUFFER_TOO_LARGE')
  ) {
    return new ZipImportError('corrupt', message);
  }
  return null;
}
