/**
 * jpegDecodeBudget.ts
 *
 * M5-T6: JPEG の SOF ヘッダから、jpeg-js がデコード時に要求する**会計量**を予測する。
 *
 * なぜ必要か:
 *   jpeg-js は上限を超えると `maxMemoryUsageInMB limit exceeded by at least N MB` を投げるが、
 *   この "at least" は**超過が判明した割り当て時点の不足量**でしかなく、総必要量ではない。
 *   実測トリガの画像では、8192 に 328 を足した 8520 にしてもなお次の割り当て（累計 9864.3 MB）で
 *   落ちる。∴ エラー由来の数値を推奨値にすると、利用者は数分かかるデコードを何度も繰り返す。
 *   ヘッダから決定論的に総量を出せば、一度で通る値を提示でき、デコード前に判定もできる。
 *
 * 会計モデル（設計 §3.8。実画像の計装で検証済み）:
 *   必要バイト数 = Σ_i (5 × px_i) + w × h × (N + 4)
 *     px_i = w × h × (h_i · v_i) / (h_max · v_max)   ← 成分 i の実サンプル数
 *     N    = 成分数
 *   実効値: 4:4:4 = 22 B/px、4:2:2 = 17 B/px、4:2:0 = 14.5 B/px
 *   検証: 25552×18400 / 4:4:4 → 9864.3 MB（計装が示した最終累計と完全一致）
 *
 * 単位（取り違え注意・設計 §3.8）:
 *   MB = 2^20 バイト（jpeg-js の会計と同じ）
 *   MP = 1e6 ピクセルの**十進**（jpeg-js の maxResolutionInMP と同じ意味論）
 *
 * 依存: 無し。electron / electron-store を参照しない（素の Node から使える）。
 */

/** 成分あたりの中間バッファ係数（§3.8 の式の 5） */
const BYTES_PER_SAMPLE_PER_COMPONENT = 5;
/** 出力側の係数（RGBA 4 + getData 相当。§3.8 の式の N + 4 のうち 4） */
const OUTPUT_BYTES_PER_PIXEL_BASE = 4;
/** MCU 端数の上振れを吸収するマージン。**メモリ側にだけ乗せる**（§5.3 の表） */
const MEMORY_MARGIN_RATIO = 1.03;

export interface JpegDecodeBudget {
    /** SOF が示す画像幅（ピクセル） */
    width: number;
    /** SOF が示す画像高さ（ピクセル） */
    height: number;
    /** width × height / 1e6（十進 MP。jpeg-js の maxResolutionInMP と同じ意味論） */
    megapixels: number;
    /** 成分数（通常 3） */
    components: number;
    /** デコードに要する会計量（MB = 2^20 バイト・切り上げ） */
    requiredMemoryMB: number;
    /** 設定を勧める値。ceil(requiredMemoryMB × 1.03) — MCU 端数ぶんの余裕 */
    recommendedMemoryMB: number;
    /**
     * 設定を勧める値。ceil(megapixels)。**マージンを乗せない** —
     * 解像度ガードは SOF の実寸（scanLines × samplesPerLine）を直接比較しており
     * MCU 切り上げの影響を受けないため、不確かさが無い（設計 §5.3）。
     */
    recommendedResolutionMP: number;
}

interface SofComponent {
    horizontalSampling: number;
    verticalSampling: number;
}

interface SofFrame {
    width: number;
    height: number;
    components: SofComponent[];
}

/** 長さフィールドを持たないマーカー（TEM / RSTn / SOI / EOI） */
function isStandaloneMarker(marker: number): boolean {
    return marker === 0x01 || marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7);
}

/**
 * SOF マーカーか。0xC0〜0xCF のうち DHT(0xC4) / JPG(0xC8) / DAC(0xCC) を除く。
 * SOF0（baseline）/ SOF1 / SOF2（progressive）はいずれも同じセグメント構造を持つ。
 * 実測トリガの実画像は progressive なので SOF2 を必ず含める。
 */
function isSofMarker(marker: number): boolean {
    if (marker < 0xc0 || marker > 0xcf) return false;
    return marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

/** マーカーを走査して最初の SOF セグメントを読む。読めなければ null */
function findSofFrame(buffer: Buffer): SofFrame | null {
    // SOI で始まらないものは JPEG として扱わない（PNG などはここで落ちる）
    if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;

    let offset = 2;
    while (offset + 1 < buffer.length) {
        // マーカー前のパディング 0xFF を読み飛ばす
        if (buffer[offset] !== 0xff) {
            offset += 1;
            continue;
        }
        const marker = buffer[offset + 1];
        if (marker === 0xff) {
            offset += 1;
            continue;
        }
        if (isStandaloneMarker(marker)) {
            offset += 2;
            continue;
        }
        if (offset + 3 >= buffer.length) return null; // 長さフィールドに届かない
        const segmentLength = buffer.readUInt16BE(offset + 2);
        if (segmentLength < 2) return null; // 壊れている

        if (isSofMarker(marker)) {
            const base = offset + 4;
            // 精度1 + 高さ2 + 幅2 + 成分数1 = 6 バイトが最低限必要
            if (base + 5 >= buffer.length) return null;
            const height = buffer.readUInt16BE(base + 1);
            const width = buffer.readUInt16BE(base + 3);
            const componentCount = buffer[base + 5];
            if (width <= 0 || height <= 0 || componentCount <= 0) return null;
            if (base + 6 + componentCount * 3 > buffer.length) return null;

            const components: SofComponent[] = [];
            for (let i = 0; i < componentCount; i++) {
                const componentOffset = base + 6 + i * 3;
                const sampling = buffer[componentOffset + 1];
                const horizontalSampling = sampling >> 4;
                const verticalSampling = sampling & 0x0f;
                if (horizontalSampling <= 0 || verticalSampling <= 0) return null;
                components.push({ horizontalSampling, verticalSampling });
            }
            return { width, height, components };
        }

        // SOS 以降は entropy-coded data が続きマーカー走査の前提が変わる。
        // SOF は必ず SOS より前にあるため、ここまでに見つからなければ諦める。
        if (marker === 0xda) return null;

        offset += 2 + segmentLength;
    }
    return null;
}

/**
 * JPEG バッファから jpeg-js の会計要求量を予測する。
 *
 * @returns JPEG でない・SOF を読めない場合は `null`（**例外は投げない**）。
 *          呼び出し側は「予測できなかった」として従来どおりデコードを試みる。
 */
export function estimateJpegDecodeBudget(buffer: Buffer): JpegDecodeBudget | null {
    if (!Buffer.isBuffer(buffer)) return null;
    const frame = findSofFrame(buffer);
    if (!frame) return null;

    const { width, height, components } = frame;
    const pixels = width * height;
    const maxHorizontal = Math.max(...components.map((c) => c.horizontalSampling));
    const maxVertical = Math.max(...components.map((c) => c.verticalSampling));

    // Σ_i 5 × px_i（成分ごとの実サンプル数に比例する中間バッファ）
    let componentBytes = 0;
    for (const component of components) {
        const componentPixels =
            (pixels * (component.horizontalSampling * component.verticalSampling)) /
            (maxHorizontal * maxVertical);
        componentBytes += BYTES_PER_SAMPLE_PER_COMPONENT * componentPixels;
    }
    // w × h × (N + 4)（成分出力 + RGBA + getData）
    const outputBytes = pixels * (components.length + OUTPUT_BYTES_PER_PIXEL_BASE);

    const requiredMemoryMB = Math.ceil((componentBytes + outputBytes) / 1024 / 1024);
    const megapixels = pixels / 1e6;

    return {
        width,
        height,
        megapixels,
        components: components.length,
        requiredMemoryMB,
        recommendedMemoryMB: Math.ceil(requiredMemoryMB * MEMORY_MARGIN_RATIO),
        recommendedResolutionMP: Math.ceil(megapixels),
    };
}
