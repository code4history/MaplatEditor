// m19-t5: 512px サムネイルの符号化・復号の**唯一の実装**（タスク設計 v1.0 §4.2）。
//
// 【設計の要点】この関数群は「512px かどうか」を**判定しない**。**宛先パスの拡張子だけで
// 符号化器を選ぶ。** 512px の宛先は必ず thumb512PathFor から来る（＝拡張子は THUMB_512_EXT が
// 決める）ため、THUMB_512_EXT を変えれば符号化器も自動的に切り替わる。
// 「512px か否か」の判定を持たせると、それが THUMB_512_EXT と並ぶ**第 2 の変化点**になる。
//
// 【なぜ Jimp では足りないか】jimp@1.6.1 の依存は @jimp/js-{bmp,gif,jpeg,png,tiff} のみで、
// webp コーデックを持たない（実測: `Unsupported MIME type: image/webp`）。
// ∴ webp の encode/decode だけを @jsquash/webp（Apache-2.0・WASM）へ委ね、
// それ以外の形式は従来どおり Jimp に委譲する。
//
// 【@jimp/wasm-webp を採らない理由】Jimp 公式プラグインだが Node では必ず落ちる。
// 内部が encode のたびに無引数 `initEncoder()` を呼び、@jsquash 側の `init()` が
// `fetch(new URL('*.wasm', import.meta.url))` を実行する。Node/undici は file: を解決できない
// （実測: `TypeError: fetch failed / Error: not implemented... yet...`）。外から wasm を先に
// init しても毎回上書きされるため回避できない。∴ @jsquash を直接使い、wasm は自分で読む。
import fs from 'fs-extra';
import { createRequire } from 'node:module';
import { Jimp } from 'jimp';

/**
 * 512px webp の符号化オプション。**品質値の宣言はここ 1 箇所のみ**（タスク設計 §3.3）。
 *
 * 採用値は lossy q=85（335 件で 116.05 MiB -> 37.98 MiB / -67.3%）。
 * 地図の 512px は現行すでに JPEG であり、lossy 化は画質方針の変更ではない。
 * **可逆（lossless）へ切り替える場合はこの 1 定数を `{ lossless: 1 }` へ変えるだけでよい。**
 */
export const THUMB_512_WEBP_QUALITY: Record<string, number> = { quality: 85 };

const WEBP_EXT = 'webp';

/** 拡張子（小文字・ドットなし）。拡張子が無ければ空文字。 */
function extensionOf(filePath: string): string {
  const base = filePath.slice(Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\')) + 1);
  const dot = base.lastIndexOf('.');
  return dot < 0 ? '' : base.slice(dot + 1).toLowerCase();
}

/** 宛先/入力の拡張子が webp か。**この関数だけが符号化器の分岐条件を持つ。** */
function isWebpPath(filePath: string): boolean {
  return extensionOf(filePath) === WEBP_EXT;
}

/** 生のピクセル（RGBA 連続）と寸法。Jimp の bitmap と @jsquash の ImageData の共通形。 */
type RawImage = { data: Uint8Array; width: number; height: number };

const requireFromHere = createRequire(import.meta.url);

// wasm の初期化は 1 プロセスにつき 1 回。init は @jsquash 側のモジュール変数を書くため、
// 並行呼び出しで二重初期化しないよう Promise をメモ化する。
let encoderReady: Promise<void> | null = null;
let decoderReady: Promise<void> | null = null;

// SIMD 版を先に試し、SIMD 非対応環境では WebAssembly.compile が失敗するので非 SIMD 版へ落とす。
// @jsquash の init() は自身が wasm-feature-detect で選んだ glue を読むが、両ビルドは同一 C 源から
// 生成された ABI 互換の実体であり、compile が通る側の wasm を渡せば整合する（実測）。
// wasm-feature-detect を我々からも import する形は採らない（pnpm の isolated node_modules では
// 直接解決できず、また @jsquash の判定と二重化して食い違い得るため）。
const ENCODER_WASM_CANDIDATES = [
  '@jsquash/webp/codec/enc/webp_enc_simd.wasm',
  '@jsquash/webp/codec/enc/webp_enc.wasm',
];

async function ensureEncoder(): Promise<void> {
  if (!encoderReady) {
    encoderReady = (async () => {
      const { init } = await import('@jsquash/webp/encode.js');
      let lastError: unknown = null;
      for (const specifier of ENCODER_WASM_CANDIDATES) {
        try {
          const wasm = await WebAssembly.compile(await fs.readFile(requireFromHere.resolve(specifier)));
          await (init as unknown as (m: WebAssembly.Module) => Promise<unknown>)(wasm);
          return;
        } catch (e) {
          lastError = e;
        }
      }
      throw lastError instanceof Error
        ? lastError
        : new Error(`webp encoder init failed: ${String(lastError)}`);
    })().catch((e) => {
      encoderReady = null; // 次回の呼び出しで再試行できるようにする
      throw e;
    });
  }
  await encoderReady;
}

async function ensureDecoder(): Promise<void> {
  if (!decoderReady) {
    decoderReady = (async () => {
      const { init } = await import('@jsquash/webp/decode.js');
      const wasm = await WebAssembly.compile(
        await fs.readFile(requireFromHere.resolve('@jsquash/webp/codec/dec/webp_dec.wasm')),
      );
      await (init as unknown as (m: WebAssembly.Module) => Promise<unknown>)(wasm);
    })().catch((e) => {
      decoderReady = null;
      throw e;
    });
  }
  await decoderReady;
}

/** Buffer/Uint8Array を、その内容だけを持つ ArrayBuffer へ写す（byteOffset のズレを持ち込まない）。 */
function toArrayBuffer(view: Uint8Array): ArrayBuffer {
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
}

async function encodeWebp(raw: RawImage): Promise<Buffer> {
  await ensureEncoder();
  const encode = (await import('@jsquash/webp/encode.js')).default;
  const data = new Uint8ClampedArray(raw.data.buffer, raw.data.byteOffset, raw.data.byteLength);
  const encoded = await encode({ data, width: raw.width, height: raw.height } as ImageData, THUMB_512_WEBP_QUALITY);
  return Buffer.from(encoded);
}

async function decodeWebp(absSrc: string): Promise<RawImage> {
  await ensureDecoder();
  const decode = (await import('@jsquash/webp/decode.js')).default;
  const decoded = await decode(toArrayBuffer(await fs.readFile(absSrc)));
  return { data: new Uint8Array(decoded.data.buffer), width: decoded.width, height: decoded.height };
}

/** 画像（Jimp インスタンス）が持つ生のピクセルを取り出す。 */
function rawOf(image: { bitmap: { data: Uint8Array; width: number; height: number } }): RawImage {
  return { data: image.bitmap.data, width: image.bitmap.width, height: image.bitmap.height };
}

/**
 * 画像を宛先へ書く。**宛先の拡張子が webp なら wasm 符号化器、それ以外は Jimp へ委譲する。**
 * 512px かどうかは見ない（§4.2 規則 C）。52px・タイル・PWA アイコンの経路が同じ関数を通っても
 * 拡張子が変わらない限り挙動は不変である。
 *
 * ディレクトリは呼び出し元が用意する（Jimp の write と同じ前提を保つ）。
 */
export async function writeImageByExt(
  image: { bitmap: { data: Uint8Array; width: number; height: number }; write: (dest: `${string}.${string}`) => Promise<unknown> },
  absDest: string,
): Promise<void> {
  if (isWebpPath(absDest)) {
    await fs.writeFile(absDest, await encodeWebp(rawOf(image)));
    return;
  }
  await image.write(absDest as `${string}.${string}`);
}

/**
 * 画像の寸法を読む。webp は wasm decode、それ以外は Jimp。
 * 読めない/存在しない場合は null（呼び出し元は「判定不能」として扱う）。
 */
export async function readImageMeta(absSrc: string): Promise<{ width: number; height: number } | null> {
  try {
    if (isWebpPath(absSrc)) {
      const raw = await decodeWebp(absSrc);
      return { width: raw.width, height: raw.height };
    }
    const image = await Jimp.read(absSrc);
    return { width: image.bitmap.width, height: image.bitmap.height };
  } catch {
    return null;
  }
}

/**
 * 画像を読み直して別の形式で書く。読みは readImageMeta と、書きは writeImageByExt と同じ規則に従う。
 * 既存データの移行（M1）と取り込み（C7）が使う。
 *
 * 失敗は例外として送出する（呼び出し元が warnings へ落として次へ進むか、マーカーを書かないかを決める）。
 */
export async function transcodeImage(absSrc: string, absDest: string): Promise<void> {
  const raw = isWebpPath(absSrc)
    ? await decodeWebp(absSrc)
    : rawOf(await Jimp.read(absSrc));
  if (isWebpPath(absDest)) {
    await fs.writeFile(absDest, await encodeWebp(raw));
    return;
  }
  await Jimp.fromBitmap({ data: Buffer.from(raw.data), width: raw.width, height: raw.height })
    .write(absDest as `${string}.${string}`);
}
