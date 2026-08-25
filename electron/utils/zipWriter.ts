// t1: Node 標準 zlib のみで実装するストリーミング ZIP 書き出し（ZIP64 対応・依存追加なし）。
//
// 背景（設計書 §1・§4.3）: adm-zip は zip 全体を「原本 + 圧縮後 + 連結後」の 3 重でメモリに
// 保持するため、2.14 GiB のアプリ搬出では最後の Buffer.alloc(totalSize) が RangeError で失敗し、
// しかもその例外が zlib の非同期継続から投げられるため誰にも捕まらず IPC が孤児化していた。
// 本実装は 1 エントリずつ読み・圧縮し・書き捨てるため、ピークメモリは
// O(最大エントリのサイズ) + O(エントリ数 × 約 100B) に収まる。
//
// 出力互換性（設計書 §4.3.4）: エントリ名は '/' 区切り・ディレクトリエントリを作らない・
// UTF-8 名前（general purpose flag 0x0800）— いずれも既存 adm-zip 出力と同一。
// ZIP64 の飽和規則・EOCD64 定数は adm-zip 0.6.0 の headers/mainHeader.js と同一規則。
import fs from 'fs-extra';
import { createReadStream, createWriteStream } from 'node:fs';
import zlib from 'node:zlib';

export type ZipSourceEntry = {
  /** zip 内のエントリ名。'/' 区切り・先頭 './' なし・ディレクトリエントリは作らない */
  entryName: string;
  /** 追加元のローカル絶対パス */
  localPath: string;
};

export type ZipWriteOptions = {
  /** 1 エントリ書き終えるたびに呼ばれる。index は 0 起点、total は entries.length */
  onEntry?: (index: number, total: number) => void | Promise<void>;
  /**
   * このバイト数を超えるファイルは deflate せず STORE で**ストリームコピー**する。
   * 既定 8 MiB。目的は「巨大な 1 ファイルを丸ごとメモリへ載せない」こと
   */
  storeThresholdBytes?: number;
};

// t1/AC3(b) の単体検査のために export する central directory レコード型（設計書 §4.3.1）
export type CentralRecord = {
  entryName: string;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  method: 0 | 8;
  dosTime: number;
  dosDate: number;
  localHeaderOffset: number;
};

const LIMIT_32 = 0xffffffff;
const LIMIT_16 = 0xffff;
const DEFAULT_STORE_THRESHOLD = 8 * 1024 * 1024;

// st.mtime から DOS 日時へ。1980 未満は 1980-01-01 00:00:00 に丸める（設計書 §4.3.2 step 4）
function toDosDateTime(mtime: Date): { dosTime: number; dosDate: number } {
  const d = mtime.getFullYear() < 1980 ? new Date(1980, 0, 1, 0, 0, 0) : mtime;
  const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { dosTime, dosDate };
}

/**
 * Central directory header 1 件分のバイト列（zip64 拡張フィールドの付与を含む）。
 *
 * zip64 拡張（0x0001）の規則（設計書 §4.3.2 step 8。読み手は順序前提で解析するため確定仕様）:
 * - 値が 0xFFFFFFFF 以上のフィールドは 32bit 側を 0xFFFFFFFF に飽和させ、64bit 真値を拡張へ入れる
 * - 拡張には**飽和したフィールドのみ**を uncompressedSize → compressedSize → localHeaderOffset の
 *   固定順で並べる（diskStart は常に 0 ∴ 飽和しない）
 * - 拡張を付けたエントリの versionNeeded は 45（付けなければ 20）
 *
 * writeZipStreaming はファイル単体 ≥ 0xFFFFFFFF バイトを fail-fast するため size 系が飽和する
 * ことは無いが、エンコーダは一般形で書く（4GB 境界が dead path にならないよう単体検査可能にする）。
 */
export function encodeCentralDirectoryHeader(rec: CentralRecord): Buffer {
  const nameBytes = Buffer.from(rec.entryName, 'utf8');
  const zip64Values: number[] = [];
  const uncompressedSaturated = rec.uncompressedSize >= LIMIT_32;
  const compressedSaturated = rec.compressedSize >= LIMIT_32;
  const offsetSaturated = rec.localHeaderOffset >= LIMIT_32;
  if (uncompressedSaturated) zip64Values.push(rec.uncompressedSize);
  if (compressedSaturated) zip64Values.push(rec.compressedSize);
  if (offsetSaturated) zip64Values.push(rec.localHeaderOffset);
  const extraLen = zip64Values.length > 0 ? 4 + 8 * zip64Values.length : 0;

  const buf = Buffer.alloc(46 + nameBytes.length + extraLen);
  buf.writeUInt32LE(0x02014b50, 0); // central directory header 署名
  buf.writeUInt16LE(0x031e, 4); // version made by: UNIX / spec 3.0（adm-zip と同じ扱い）
  buf.writeUInt16LE(zip64Values.length > 0 ? 45 : 20, 6); // version needed to extract
  buf.writeUInt16LE(0x0800, 8); // general purpose flags: UTF-8 名前
  buf.writeUInt16LE(rec.method, 10);
  buf.writeUInt16LE(rec.dosTime, 12);
  buf.writeUInt16LE(rec.dosDate, 14);
  buf.writeUInt32LE(rec.crc >>> 0, 16);
  buf.writeUInt32LE(compressedSaturated ? LIMIT_32 : rec.compressedSize, 20);
  buf.writeUInt32LE(uncompressedSaturated ? LIMIT_32 : rec.uncompressedSize, 24);
  buf.writeUInt16LE(nameBytes.length, 28);
  buf.writeUInt16LE(extraLen, 30);
  buf.writeUInt16LE(0, 32); // comment length
  buf.writeUInt16LE(0, 34); // disk number start
  buf.writeUInt16LE(0, 36); // internal file attributes
  buf.writeUInt32LE((0o644 << 16) >>> 0, 38); // external file attributes: 通常ファイル 0o644
  buf.writeUInt32LE(offsetSaturated ? LIMIT_32 : rec.localHeaderOffset, 42);
  nameBytes.copy(buf, 46);
  if (extraLen > 0) {
    let off = 46 + nameBytes.length;
    buf.writeUInt16LE(0x0001, off); // zip64 extended information extra field
    buf.writeUInt16LE(8 * zip64Values.length, off + 2);
    off += 4;
    for (const value of zip64Values) {
      buf.writeBigUInt64LE(BigInt(value), off);
      off += 8;
    }
  }
  return buf;
}

/**
 * EOCD（必要なら Zip64 EOCD record + locator を前置）のバイト列。
 *
 * 設計書 §4.3.2 step 10 の確定値:
 * - needZip64 = entryCount >= 0xFFFF || centralDirSize >= 0xFFFFFFFF || centralDirOffset >= 0xFFFFFFFF
 *   （APPNOTE 4.4.21/4.4.22/4.4.24: 値がちょうど 0xFFFF / 0xFFFFFFFF のときも当該フィールドでは
 *   表現できず zip64 が必須 ∴ `>=`。encodeCentralDirectoryHeader の飽和判定とも同じ規則。
 *   adm-zip 0.6.0 mainHeader.js は `>` だがこれは APPNOTE からの逸脱 ∴ 追随しない — 実装レビュー v1 MIN-1）
 * - Zip64 EOCD record の size フィールド = 44（= レコード総長 56 − 12）
 * - Zip64 EOCD record の version made by / version needed = 45
 * - Zip64 EOCD locator の total number of disks = 1
 * - 通常 EOCD の該当フィールドは 0xFFFF / 0xFFFFFFFF で飽和
 */
export function encodeEndRecords(params: {
  entryCount: number;
  centralDirSize: number;
  centralDirOffset: number;
}): Buffer {
  const { entryCount, centralDirSize, centralDirOffset } = params;
  const needZip64 =
    entryCount >= LIMIT_16 || centralDirSize >= LIMIT_32 || centralDirOffset >= LIMIT_32;

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // EOCD 署名
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // central directory start disk
  eocd.writeUInt16LE(Math.min(entryCount, LIMIT_16), 8); // entries on this disk
  eocd.writeUInt16LE(Math.min(entryCount, LIMIT_16), 10); // total entries
  eocd.writeUInt32LE(Math.min(centralDirSize, LIMIT_32), 12);
  eocd.writeUInt32LE(Math.min(centralDirOffset, LIMIT_32), 16);
  eocd.writeUInt16LE(0, 20); // comment length
  if (!needZip64) return eocd;

  const zip64 = Buffer.alloc(56 + 20);
  // Zip64 end of central directory record（56 バイト）
  zip64.writeUInt32LE(0x06064b50, 0);
  zip64.writeBigUInt64LE(44n, 4); // size of zip64 EOCD record（= 56 − 12）
  zip64.writeUInt16LE(45, 12); // version made by
  zip64.writeUInt16LE(45, 14); // version needed to extract
  zip64.writeUInt32LE(0, 16); // this disk number
  zip64.writeUInt32LE(0, 20); // disk with central directory start
  zip64.writeBigUInt64LE(BigInt(entryCount), 24); // entries on this disk
  zip64.writeBigUInt64LE(BigInt(entryCount), 32); // total entries
  zip64.writeBigUInt64LE(BigInt(centralDirSize), 40);
  zip64.writeBigUInt64LE(BigInt(centralDirOffset), 48);
  // Zip64 end of central directory locator（20 バイト）
  zip64.writeUInt32LE(0x07064b50, 56);
  zip64.writeUInt32LE(0, 60); // disk with zip64 EOCD record
  zip64.writeBigUInt64LE(BigInt(centralDirOffset + centralDirSize), 64); // zip64 EOCD の位置
  zip64.writeUInt32LE(1, 72); // total number of disks
  return Buffer.concat([zip64, eocd]);
}

// Local file header（30 バイト + 名前）。設計書 §4.3.2 step 4:
// versionNeeded 20 固定（fail-fast により local 側の zip64 は発生しない）、flags 0x0800、
// サイズは事前確定 ∴ data descriptor（bit 3）は使わない、extra は常に 0
function encodeLocalFileHeader(rec: CentralRecord): Buffer {
  const nameBytes = Buffer.from(rec.entryName, 'utf8');
  const buf = Buffer.alloc(30 + nameBytes.length);
  buf.writeUInt32LE(0x04034b50, 0);
  buf.writeUInt16LE(20, 4); // version needed to extract
  buf.writeUInt16LE(0x0800, 6); // UTF-8 名前
  buf.writeUInt16LE(rec.method, 8);
  buf.writeUInt16LE(rec.dosTime, 10);
  buf.writeUInt16LE(rec.dosDate, 12);
  buf.writeUInt32LE(rec.crc >>> 0, 14);
  buf.writeUInt32LE(rec.compressedSize, 18);
  buf.writeUInt32LE(rec.uncompressedSize, 22);
  buf.writeUInt16LE(nameBytes.length, 26);
  buf.writeUInt16LE(0, 28); // extra length
  nameBytes.copy(buf, 30);
  return buf;
}

/**
 * entries を targetPath へ 1 本の zip として**逐次**書き出す。
 * ピークメモリは O(最大エントリのサイズ) + O(エントリ数 × 約 100B)。
 * 失敗時は必ず reject し、書きかけの targetPath を削除する。
 */
export async function writeZipStreaming(
  targetPath: string,
  entries: ZipSourceEntry[],
  options?: ZipWriteOptions,
): Promise<void> {
  const storeThreshold = options?.storeThresholdBytes ?? DEFAULT_STORE_THRESHOLD;
  const out = createWriteStream(targetPath);
  let streamError: Error | null = null;
  out.on('error', (e) => {
    streamError = e instanceof Error ? e : new Error(String(e));
  });
  let offset = 0;

  // stream.write() の戻り値が false のときは 'drain' を待つ（背圧を守る。設計書 §4.3.2）
  const write = async (buf: Buffer): Promise<void> => {
    if (streamError) throw streamError;
    const ok = out.write(buf);
    offset += buf.length;
    if (!ok) {
      await new Promise<void>((resolve, reject) => {
        const onDrain = () => {
          cleanup();
          resolve();
        };
        const onError = (e: Error) => {
          cleanup();
          reject(e);
        };
        const cleanup = () => {
          out.off('drain', onDrain);
          out.off('error', onError);
        };
        out.on('drain', onDrain);
        out.on('error', onError);
      });
    }
  };

  try {
    const centralRecords: CentralRecord[] = [];
    for (let i = 0; i < entries.length; i++) {
      const { entryName, localPath } = entries[i];
      const st = await fs.stat(localPath);
      // 設計書 §4.3.2 step 1: local header 側の zip64（両サイズ 8B 必須規則）を実装しないための
      // fail-fast。実データの最大ファイルは MB 級（レビュー I-2 実測）∴ 実害なし
      if (st.size >= LIMIT_32) {
        throw new Error(
          `zipWriter: ファイル単体 ${LIMIT_32} バイト（4GiB−1）以上は本実装の対象外です: ` +
            `${entryName} (${st.size} バイト)`,
        );
      }
      const { dosTime, dosDate } = toDosDateTime(st.mtime);
      const localHeaderOffset = offset;

      if (st.size > storeThreshold) {
        // STORE ストリーム経路（設計書 §4.3.2 step 2）: CRC を先に確定させるため 2 パス読み出し。
        // このコストは「稀な巨大ファイル」専用であることで許容する
        let crc = 0;
        for await (const chunk of createReadStream(localPath)) {
          crc = zlib.crc32(chunk as Buffer, crc);
        }
        const rec: CentralRecord = {
          entryName,
          crc,
          compressedSize: st.size,
          uncompressedSize: st.size,
          method: 0,
          dosTime,
          dosDate,
          localHeaderOffset,
        };
        await write(encodeLocalFileHeader(rec));
        let copied = 0;
        for await (const chunk of createReadStream(localPath)) {
          copied += (chunk as Buffer).length;
          await write(chunk as Buffer);
        }
        if (copied !== st.size) {
          // 2 パスの間にファイルが変わると zip が壊れる。黙って通さず明示エラーにする
          throw new Error(
            `zipWriter: 書き出し中にファイルサイズが変化しました: ${entryName} ` +
              `(stat ${st.size} バイト / 実読 ${copied} バイト)`,
          );
        }
        centralRecords.push(rec);
      } else {
        // 既定経路（設計書 §4.3.2 step 3）: 読み込み → CRC → deflateRaw。
        // 圧縮で膨らむ場合（圧縮済みタイル PNG/JPEG 等）は STORE へフォールバックする
        const raw = await fs.readFile(localPath);
        const crc = zlib.crc32(raw);
        const deflated = zlib.deflateRawSync(raw);
        const useDeflate = deflated.length < raw.length;
        const payload = useDeflate ? deflated : raw;
        const rec: CentralRecord = {
          entryName,
          crc,
          compressedSize: payload.length,
          uncompressedSize: raw.length,
          method: useDeflate ? 8 : 0,
          dosTime,
          dosDate,
          localHeaderOffset,
        };
        await write(encodeLocalFileHeader(rec));
        await write(payload);
        centralRecords.push(rec);
      }
      // この await が同時にイベントループの譲りにもなる（設計書 §4.3.2 step 7）
      if (options?.onEntry) await options.onEntry(i, entries.length);
    }

    const centralDirOffset = offset;
    for (const rec of centralRecords) {
      await write(encodeCentralDirectoryHeader(rec));
    }
    const centralDirSize = offset - centralDirOffset;
    await write(
      encodeEndRecords({ entryCount: centralRecords.length, centralDirSize, centralDirOffset }),
    );

    await new Promise<void>((resolve, reject) => {
      out.on('finish', resolve);
      out.on('error', reject);
      out.end();
    });
    if (streamError) throw streamError;
  } catch (e) {
    out.destroy();
    // 失敗時は書きかけの targetPath を残さない（設計書 §4.3.1 の契約）
    await fs.remove(targetPath).catch(() => undefined);
    throw e;
  }
}
