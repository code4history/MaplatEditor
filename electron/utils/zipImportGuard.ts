// nov26-m6-t3（#98・#116）: ZIP の取り込みの共通の検査と、読み取りの例外の判定。
//
// - assertZipImportSize: adm-zip は 2 GiB 超の zip を読めない（ERR_FS_FILE_TOO_LARGE。oct26-m4-t1 で実測）。
//   new AdmZip の **前に** 呼び、決定的なエラー（ZipImportError 'too-large'）にする。
//   地図（DataUploadService.extractZip）と POI 単体（PoiPackageService.importPoiZip）の両方が使う。
// - assertZipImportable: 大きさに加え、ZIP の末尾（EOCD・ZIP64 EOCD）の件数と中央ディレクトリの大きさを
//   new AdmZip の前に検査する（件数を細工した ZIP で new AdmZip がメモリを使い切るため）。
//   new AdmZip を呼ぶ取り込みの 4 か所がすべてこれを通す。
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
import { open as openFile, type FileHandle } from 'fs/promises';

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

// ---- 中央ディレクトリの件数・大きさの検査（new AdmZip の前） ----
//
// adm-zip は EOCD（ZIP64 なら ZIP64 EOCD）の件数を信じて、その数だけ entry の物を作る。
// 件数を細工した ZIP（数十 MB で 100 万件）を渡すと、new AdmZip の中でメモリが尽きて
// main が異常終了する。∴ ファイルの末尾だけを読み、件数と中央ディレクトリの大きさを上限と照らす。
//
// 上限の根拠（2026-11 実測）:
// - 実物: 公開サンプルの地図（盛岡 3 枚）のタイルは最大 553 件で、地図 ZIP は JSON・サムネイルを足して
//   約 560 件。アプリの書き出しは 17〜19 件。POI パッケージは 512 件が上限（POI_PACKAGE_MAX_ENTRIES）
// - adm-zip の実測: 件数だけのメモリは 1 件あたり約 9 KB（600 件でヒープ 11 MB・5 万件で 459 MB・
//   15 万件で 1.3 GB）。100 万件は 4 GB のヒープでもメモリ切れで落ちる
// - maxEntries: 50,000。実物の最大（約 560 件）の約 90 倍で、正当な地図 ZIP の理論上の最大
//   約 12,216 件（MAP_ARCHIVE_LIMITS の根拠）の約 4 倍。開いた後の MAP_ARCHIVE_LIMITS.maxEntries と同じ値に
//   揃える（それより多い ZIP は開いた直後に拒まれるので、開く前に拒んでも失うものが無い）
// - maxCentralDirectoryBytes: 16 MiB。実物は 1 件あたり最大 83〜91 バイトで、5 万件 × 91 ≒ 4.3 MiB の
//   約 4 倍（実物の最大 約 560 件 × 91 ≒ 50 KB の 300 倍超）。名前を長くして件数の上限をすり抜ける ZIP を止める
export type ZipCentralDirectoryLimits = {
  maxEntries: number;
  maxCentralDirectoryBytes: number;
};

export const ZIP_CENTRAL_DIRECTORY_LIMITS: Readonly<ZipCentralDirectoryLimits> = {
  maxEntries: 50_000,
  maxCentralDirectoryBytes: 16 * 1024 * 1024,
};

const EOCD_SIG = 0x06054b50;
const EOCD_SIZE = 22;
const ZIP64_LOCATOR_SIG = 0x07064b50;
const ZIP64_LOCATOR_SIZE = 20;
const ZIP64_EOCD_SIG = 0x06064b50;
const ZIP64_EOCD_MIN_SIZE = 56;
// 中央ディレクトリの 1 件の固定部（名前・extra・コメントを除く）
const CENTRAL_HEADER_MIN_SIZE = 46;
// EOCD は末尾 22 バイト＋コメント（最大 65,535 バイト）の範囲にある
const EOCD_SEARCH_BYTES = EOCD_SIZE + 0xffff;
// ZIP64 EOCD の可変部（extensible data）の上限。正当な書き手は使わない
const ZIP64_EXTENSIBLE_MAX = 0xffff;

export type ZipCentralDirectoryInfo = {
  entries: number;
  centralDirectoryBytes: number;
  centralDirectoryOffset: number;
  zip64: boolean;
};

async function readAt(handle: FileHandle, position: number, length: number): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  let read = 0;
  while (read < length) {
    const { bytesRead } = await handle.read(buffer, read, length - read, position + read);
    if (bytesRead === 0) break;
    read += bytesRead;
  }
  return read === length ? buffer : buffer.subarray(0, read);
}

function corrupt(label: string, reason: string): ZipImportError {
  return new ZipImportError('corrupt', `${label} has a broken end of central directory: ${reason}`);
}

function toSafeNumber(value: bigint, label: string, field: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw corrupt(label, `${field} is out of range`);
  return Number(value);
}

// ZIP の末尾（EOCD・ZIP64 EOCD）だけを読み、中央ディレクトリの件数・大きさ・位置を返す。
// 壊れた／矛盾した値は ZipImportError('corrupt')。ファイル全体はメモリに読まない。
export async function readZipCentralDirectoryInfo(
  zipPath: string,
  label: string,
): Promise<ZipCentralDirectoryInfo> {
  const handle = await openFile(zipPath, 'r');
  try {
    const fileSize = (await handle.stat()).size;
    if (fileSize < EOCD_SIZE) throw corrupt(label, 'file is too short');

    // adm-zip と同じく、末尾から前へ向かって最初に見つかった EOCD の署名を使う
    const tailLength = Math.min(fileSize, EOCD_SEARCH_BYTES + ZIP64_LOCATOR_SIZE);
    const tailStart = fileSize - tailLength;
    const tail = await readAt(handle, tailStart, tailLength);
    let eocdAt = -1;
    const searchFloor = Math.max(0, tail.length - EOCD_SEARCH_BYTES);
    for (let i = tail.length - EOCD_SIZE; i >= searchFloor; i--) {
      if (tail[i] === 0x50 && tail.readUInt32LE(i) === EOCD_SIG) {
        eocdAt = i;
        break;
      }
    }
    if (eocdAt < 0) throw corrupt(label, 'signature not found');
    const eocdOffset = tailStart + eocdAt;
    const commentLength = tail.readUInt16LE(eocdAt + 20);
    if (eocdOffset + EOCD_SIZE + commentLength > fileSize) throw corrupt(label, 'comment overruns the file');

    const diskNumber = tail.readUInt16LE(eocdAt + 4);
    const cdDisk = tail.readUInt16LE(eocdAt + 6);
    const entriesOnDisk = tail.readUInt16LE(eocdAt + 8);
    const entriesTotal = tail.readUInt16LE(eocdAt + 10);
    let centralDirectoryBytes = tail.readUInt32LE(eocdAt + 12);
    let centralDirectoryOffset = tail.readUInt32LE(eocdAt + 16);
    let entries = Math.max(entriesOnDisk, entriesTotal);
    // 中央ディレクトリが始まれる最後の位置（EOCD の直前。ZIP64 なら ZIP64 EOCD の直前）
    let directoryEnd = eocdOffset;
    let zip64 = false;

    const locatorAt = eocdAt - ZIP64_LOCATOR_SIZE;
    if (locatorAt >= 0 && tail.readUInt32LE(locatorAt) === ZIP64_LOCATOR_SIG) {
      zip64 = true;
      const locatorOffset = tailStart + locatorAt;
      const zip64Disk = tail.readUInt32LE(locatorAt + 4);
      const recordOffset = toSafeNumber(tail.readBigUInt64LE(locatorAt + 8), label, 'ZIP64 record offset');
      const totalDisks = tail.readUInt32LE(locatorAt + 16);
      if (zip64Disk !== 0 || totalDisks > 1) throw corrupt(label, 'multi-disk ZIP64 is not supported');
      if (recordOffset + ZIP64_EOCD_MIN_SIZE > locatorOffset) throw corrupt(label, 'ZIP64 record is out of range');
      const record = await readAt(handle, recordOffset, ZIP64_EOCD_MIN_SIZE);
      if (record.length < ZIP64_EOCD_MIN_SIZE || record.readUInt32LE(0) !== ZIP64_EOCD_SIG) {
        throw corrupt(label, 'ZIP64 record signature not found');
      }
      // 記録の大きさ（先頭 12 バイトを除く）。記録は locator の直前で終わる（間に何も挟まない）
      const recordSize = toSafeNumber(record.readBigUInt64LE(4), label, 'ZIP64 record size');
      if (recordSize < ZIP64_EOCD_MIN_SIZE - 12 || recordOffset + 12 + recordSize !== locatorOffset) {
        throw corrupt(label, 'ZIP64 record size is inconsistent');
      }
      const extensibleBytes = recordSize - (ZIP64_EOCD_MIN_SIZE - 12);
      if (extensibleBytes > ZIP64_EXTENSIBLE_MAX) throw corrupt(label, 'ZIP64 extensible data is too large');
      if (extensibleBytes > 0) {
        // adm-zip は locator から前へ ZIP64 EOCD の署名を探すので、可変部に署名があると別の値を読む
        const extensible = await readAt(handle, recordOffset + ZIP64_EOCD_MIN_SIZE, extensibleBytes);
        if (extensible.length !== extensibleBytes) throw corrupt(label, 'ZIP64 record is truncated');
        for (let i = 0; i + 4 <= extensible.length; i++) {
          if (extensible[i] === 0x50 && extensible.readUInt32LE(i) === ZIP64_EOCD_SIG) {
            throw corrupt(label, 'ZIP64 extensible data contains a record signature');
          }
        }
      }
      const disk64 = record.readUInt32LE(16);
      const cdDisk64 = record.readUInt32LE(20);
      if (disk64 !== 0 || cdDisk64 !== 0) throw corrupt(label, 'multi-disk ZIP64 is not supported');
      const entriesOnDisk64 = toSafeNumber(record.readBigUInt64LE(24), label, 'ZIP64 entry count');
      const entriesTotal64 = toSafeNumber(record.readBigUInt64LE(32), label, 'ZIP64 entry count');
      entries = Math.max(entriesOnDisk64, entriesTotal64);
      centralDirectoryBytes = toSafeNumber(record.readBigUInt64LE(40), label, 'ZIP64 directory size');
      centralDirectoryOffset = toSafeNumber(record.readBigUInt64LE(48), label, 'ZIP64 directory offset');
      directoryEnd = recordOffset;
    } else if (diskNumber !== 0 || cdDisk !== 0) {
      throw corrupt(label, 'multi-disk ZIP is not supported');
    }

    if (centralDirectoryOffset + centralDirectoryBytes > directoryEnd) {
      throw corrupt(label, 'central directory overruns the end record');
    }
    // 1 件は少なくとも 46 バイト。件数に見合わない小さな中央ディレクトリは矛盾
    if (entries * CENTRAL_HEADER_MIN_SIZE > centralDirectoryBytes) {
      throw corrupt(label, `${entries} entries do not fit in ${centralDirectoryBytes} bytes`);
    }
    return { entries, centralDirectoryBytes, centralDirectoryOffset, zip64 };
  } finally {
    await handle.close();
  }
}

// new AdmZip の前に呼ぶ。件数か中央ディレクトリの大きさが上限を超えたら
// ZipImportError('too-many-entries')、末尾の記録が壊れていたら ZipImportError('corrupt')。
export async function assertZipCentralDirectory(
  zipPath: string,
  label: string,
  limits: Readonly<ZipCentralDirectoryLimits> = ZIP_CENTRAL_DIRECTORY_LIMITS,
): Promise<ZipCentralDirectoryInfo> {
  const info = await readZipCentralDirectoryInfo(zipPath, label);
  if (info.entries > limits.maxEntries) {
    throw new ZipImportError(
      'too-many-entries',
      `${label} has too many entries: ${info.entries} exceeds ${limits.maxEntries}`,
    );
  }
  if (info.centralDirectoryBytes > limits.maxCentralDirectoryBytes) {
    throw new ZipImportError(
      'too-many-entries',
      `${label} has too large a central directory: ${info.centralDirectoryBytes} bytes exceeds ` +
        `${limits.maxCentralDirectoryBytes}`,
    );
  }
  return info;
}

// ZIP の取り込みの入口。new AdmZip を呼ぶ **すべての** 取り込み経路がこれを通す
// （DataUploadService.extractZip・restoreManagedPois、PoiPackageService.importPoiZip・
// importManagedPoiDocuments）。大きさ（2 GiB）→ 末尾の記録（件数・中央ディレクトリ）の順に見る。
// 読んだ大きさを返す。
export async function assertZipImportable(zipPath: string, label: string): Promise<number> {
  const size = await assertZipImportSize(zipPath, label);
  await assertZipCentralDirectory(zipPath, label);
  return size;
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
