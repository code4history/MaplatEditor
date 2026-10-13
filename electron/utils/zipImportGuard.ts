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

export type ZipImportErrorKind = 'too-large' | 'corrupt' | 'duplicate-entry';

export class ZipImportError extends Error {
  constructor(public readonly kind: ZipImportErrorKind, message: string) {
    super(message);
    this.name = 'ZipImportError';
  }
}

// new AdmZip の前に呼ぶ。超えたら ZipImportError('too-large')。
// fs.stat の失敗（ENOENT 等）はそのまま投げる（壊れた ZIP ではない）。
export async function assertZipImportSize(zipPath: string, label: string): Promise<void> {
  const size = (await fs.stat(zipPath)).size;
  if (size > ZIP_IMPORT_MAX_BYTES) {
    throw new ZipImportError(
      'too-large',
      `${label} is too large to import: ${size} bytes exceeds the 2 GiB limit ` +
        '(>2 GiB streaming import is not yet supported)',
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
const DUPLICATE_ENTRY = /^Duplicate .* entry$/;

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
  if (typeof code === 'string' && (code.startsWith('Z_') || code.startsWith('ERR_ZLIB'))) {
    return new ZipImportError('corrupt', message);
  }
  return null;
}
