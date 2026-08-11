// m19-t5: scripts/ 側の webp 対応画像入出力（オフライン用）。
//
// 製品コードの唯一の実装は `electron/utils/thumbnail512Codec.ts` である。本ファイルは
// **同じ規則（入力/宛先の拡張子だけで符号化器を選ぶ）を、TS を import できない .mjs スクリプト用に
// 用意したもの**であり、判断（512px か否か等）は一切持たない。
//
// なぜ必要か: jimp@1.6.1 は webp を encode も decode もできない。512px 資産を webp 化した結果、
// ビルトインアイコンの寸法・単色判定を行う既存 smoke が Jimp.read で読めなくなるため。
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';

const requireFromHere = createRequire(import.meta.url);

/** 512px webp の符号化オプション。thumbnail512Codec.ts の THUMB_512_WEBP_QUALITY と同値に保つ。 */
export const WEBP_QUALITY = { quality: 85 };

function isWebpPath(filePath) {
  return /\.webp$/i.test(filePath);
}

let encoderReady = null;
let decoderReady = null;

// SIMD 版を先に試し、SIMD 非対応環境では WebAssembly.compile が失敗するので非 SIMD 版へ落とす。
async function ensureEncoder() {
  if (!encoderReady) {
    encoderReady = (async () => {
      const { init } = await import('@jsquash/webp/encode.js');
      let lastError = null;
      for (const specifier of [
        '@jsquash/webp/codec/enc/webp_enc_simd.wasm',
        '@jsquash/webp/codec/enc/webp_enc.wasm',
      ]) {
        try {
          await init(await WebAssembly.compile(await fs.readFile(requireFromHere.resolve(specifier))));
          return;
        } catch (e) {
          lastError = e;
        }
      }
      throw lastError ?? new Error('webp encoder init failed');
    })().catch((e) => { encoderReady = null; throw e; });
  }
  await encoderReady;
}

async function ensureDecoder() {
  if (!decoderReady) {
    decoderReady = (async () => {
      const { init } = await import('@jsquash/webp/decode.js');
      await init(await WebAssembly.compile(
        await fs.readFile(requireFromHere.resolve('@jsquash/webp/codec/dec/webp_dec.wasm')),
      ));
    })().catch((e) => { decoderReady = null; throw e; });
  }
  await decoderReady;
}

/**
 * 画像を RGBA として読む。webp は wasm decode、それ以外は Jimp。
 * 返値は `{ width, height, data }`（data は RGBA 連続の Uint8Array）と、
 * 既存 smoke の書き味に合わせた `getPixelColor(x, y)`（0xRRGGBBAA の数値）を持つ。
 */
export async function readImageRGBA(filePath) {
  let width;
  let height;
  let data;
  if (isWebpPath(filePath)) {
    await ensureDecoder();
    const decode = (await import('@jsquash/webp/decode.js')).default;
    const buf = await fs.readFile(filePath);
    const decoded = await decode(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    ({ width, height } = decoded);
    data = new Uint8Array(decoded.data.buffer);
  } else {
    const { Jimp } = await import('jimp');
    const image = await Jimp.read(filePath);
    ({ width, height } = image.bitmap);
    data = image.bitmap.data;
  }
  return {
    width,
    height,
    data,
    getPixelColor(x, y) {
      const i = (y * width + x) * 4;
      return ((data[i] << 24) >>> 0) + (data[i + 1] << 16) + (data[i + 2] << 8) + data[i + 3];
    },
  };
}

/** 画像を書く。宛先が webp なら wasm 符号化器、それ以外は Jimp へ委譲する。 */
export async function writeImageByExt(filePath, { data, width, height }) {
  if (!isWebpPath(filePath)) {
    const { Jimp } = await import('jimp');
    await Jimp.fromBitmap({ data: Buffer.from(data), width, height }).write(filePath);
    return;
  }
  await ensureEncoder();
  const encode = (await import('@jsquash/webp/encode.js')).default;
  const rgba = new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength);
  await fs.writeFile(filePath, Buffer.from(await encode({ data: rgba, width, height }, WEBP_QUALITY)));
}

/** 画像ファイルを読み直して別形式で書く（拡張子が符号化器を決める）。 */
export async function transcodeImage(srcPath, destPath) {
  await writeImageByExt(destPath, await readImageRGBA(srcPath));
}
