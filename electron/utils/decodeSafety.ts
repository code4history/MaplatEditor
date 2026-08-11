/**
 * decodeSafety.ts
 *
 * M5-T8: **この機械が実際に耐えられる**デコード量を実行時に算出する（設計 §5.2）。
 *
 * なぜ必要か:
 *   jpeg-js の `maxMemoryUsageInMB` はメモリを予約しない単なる閾値であり、いくらでも
 *   上げられる（設計 §3.2）。上げていくと当たる真の天井は **V8 ヒープ**である。
 *   jpeg-js は係数ブロックを `Int32Array(64)` の JS オブジェクトとして数百万個確保し、
 *   そのラッパが V8 ヒープを食う（会計外。`jpegDecodeBudget.V8_HEAP_BYTES_PER_BLOCK`）。
 *   超えると **catch できないプロセス強制終了**になるため、事前に弾く必要がある。
 *
 * 実測（実 Electron main / Electron 39.8.10 / V8 14.2.231.22-electron.0 / arm64。設計 §3.1(b)）:
 *   必要 heap_size_limit (MiB) ≒ 117 + 5.33 × MP （4:4:4）
 *   50 MP: 352 MiB で強制終了 / 416 MiB で成功、110 MP: 672 MiB で強制終了 / 736 MiB で成功
 *
 * **定数を焼き込まない。** `heap_size_limit` を実行時に読むことで、既定ヒープが物理メモリから
 * 算出される小メモリ機でも自動的に正しい枠になる。
 */
import v8 from 'node:v8';
import { V8_HEAP_BYTES_PER_BLOCK } from './jpegDecodeBudget';

/**
 * GC ヘッドルーム。実測の直線 `117 + 5.33 × MP` の**切片**（設計 §3.1(b)）を安全側へ切り上げる。
 * ブロック確保の傾き（5.33 MiB/MP）はブロック保持中の heapUsed の傾き（5.30）と一致しており、
 * 切片はブロック以外の GC 一時領域を表す。
 */
const GC_HEADROOM_MB = 128;

/**
 * `heap_size_limit` のうちデコードへ充ててよい割合。
 *
 * 設計 §3.1 の計測は**他に何も載っていない main** での値であり、実アプリの main は
 * electron-store / nedb / サービス層を抱える。その分と GC の一時オブジェクトを 25% で見込む。
 * この 25% が十分かは E2E（AC7）がアプリ実機の baseline `heapUsed` を記録して検証する。
 */
const DECODE_HEAP_RATIO = 0.75;

/**
 * 最悪ケース 4:4:4 における「1 画素あたりの係数ブロック数」。
 * 成分3つがいずれもフルサンプリングのとき、ブロック数 ≒ 画素数 × 3 / 64 となる。
 * サブサンプリングがあるほどブロック数は減るため、**4:4:4 で安全なら他でも安全**である。
 */
const WORST_CASE_BLOCKS_PER_PIXEL = 3 / 64;

/** 最悪ケース 4:4:4 における jpeg-js 会計の 1 画素あたりバイト数（設計 §3.8 の実効値） */
const WORST_CASE_ACCOUNTED_BYTES_PER_PIXEL = 22;

export interface DecodeSafety {
    /** 実測の V8 ヒープ上限（MiB）。`v8.getHeapStatistics().heap_size_limit` そのもの */
    heapSizeLimitMB: number;
    /** デコーダのブロック確保に許す上限（MiB） */
    maxDecoderHeapMB: number;
    /**
     * 上記から逆算した画素数上限（**十進 MP**。最悪ケース 4:4:4 基準）。
     * 手入力キャップのクランプにも使う（人間指示 2026-08-03: 手入力値にも上限を設ける）。
     */
    maxResolutionMP: number;
    /** 同じく逆算した jpeg-js 会計量の上限（MB = 2^20）。手入力キャップのクランプに使う */
    maxMemoryMB: number;
}

/**
 * この機械の安全枠を算出する。**呼び出しごとに `v8.getHeapStatistics()` を読む**
 * （プロセス起動後に heap_size_limit が変わることは無いが、定数化するとテストが
 * 計測環境を固定してしまうため、読み口を1つに保ったうえで都度読む）。
 */
export function resolveDecodeSafety(): DecodeSafety {
    const heapSizeLimitMB = v8.getHeapStatistics().heap_size_limit / 1024 / 1024;
    const maxDecoderHeapMB = Math.floor(heapSizeLimitMB * DECODE_HEAP_RATIO - GC_HEADROOM_MB);
    const maxBlocks = (maxDecoderHeapMB * 1024 * 1024) / V8_HEAP_BYTES_PER_BLOCK;
    const maxResolutionMP = Math.floor(maxBlocks / WORST_CASE_BLOCKS_PER_PIXEL / 1e6);
    const maxMemoryMB = Math.floor(
        (maxResolutionMP * 1e6 * WORST_CASE_ACCOUNTED_BYTES_PER_PIXEL) / 1024 / 1024,
    );
    return { heapSizeLimitMB, maxDecoderHeapMB, maxResolutionMP, maxMemoryMB };
}
