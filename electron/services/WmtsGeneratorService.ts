import { Jimp } from 'jimp';
// @ts-ignore
import Tin from '@maplat/tin';
import fs from 'fs-extra';
import path from 'path';
import { BrowserWindow } from 'electron';
import SettingsService from './SettingsService';
import { ProgressReporter } from '../utils/ProgressReporter';
import { resolveRuntimeOriginal } from './MapOriginalImageService';
import { mercatorBboxToWgs84 } from '../utils/webMercator';
import { estimateJpegDecodeBudget } from '../utils/jpegDecodeBudget';
import { resolveDecodeSafety, type DecodeSafety } from '../utils/decodeSafety';

const MERC_MAX = 20037508.342789244;
const TIN_V2_OPTIONS = { useV2Algorithm: true };

interface PixelColor { r: number; g: number; b: number; a: number; }

// m6-t8: TileJSON 3.0.0 出力の型（tiles は生成時点で自己参照の相対パス1本。
// 書き出し時に AppExportService 側でディレクトリ名入りへ差し替える。設計 §3.4）
export interface TileJsonDocument {
    tilejson: '3.0.0';
    tiles: [string];
    minzoom: number;
    maxzoom: number;
    bounds: [number, number, number, number];
}

// m6-t8 §3.4: タイル範囲（最大ズームでの west/east/north/south タイル index）から
// TileJSON の bounds（経緯度 [west, south, east, north]）を導出する。
// メルカトル座標への変換は既存 mercatorBboxToWgs84（electron/utils/webMercator.ts）を
// そのまま再利用し、新規の逆変換ロジックは書かない（design review M-1）。
export function computeMercTileBounds(
    tileXw: number,
    tileXe: number,
    tileYn: number,
    tileYs: number,
    maxZoom: number,
): [number, number, number, number] {
    const tilesPerSide = Math.pow(2, maxZoom);
    const unit = (2 * MERC_MAX) / tilesPerSide;
    const mercXWest = tileXw * unit - MERC_MAX;
    const mercXEast = (tileXe + 1) * unit - MERC_MAX;
    const mercYNorth = MERC_MAX - tileYn * unit;
    const mercYSouth = MERC_MAX - (tileYs + 1) * unit;
    return mercatorBboxToWgs84([mercXWest, mercYSouth, mercXEast, mercYNorth]);
}

// m6-t8 §3.4: merc/{targetBaseMapUid}/tilejson.json として書き出す TileJSON 文書を組み立てる
export function buildMercTileJson(
    tileXw: number,
    tileXe: number,
    tileYn: number,
    tileYs: number,
    minZoom: number,
    maxZoom: number,
): TileJsonDocument {
    return {
        tilejson: '3.0.0',
        tiles: ['{z}/{x}/{y}.png'],
        minzoom: minZoom,
        maxzoom: maxZoom,
        bounds: computeMercTileBounds(tileXw, tileXe, tileYn, tileYs, maxZoom),
    };
}

// 実装レビュー M-2: 大きな地図画像（スキャン地図の大半）で jpeg-js の既定
// maxMemoryUsageInMB=512 を超えて生成が必ず失敗していた欠陥への対応。
// MapUploadService.ts の imageCutter() と同じ会計モデル（jpegDecodeBudget/decodeSafety）を
// 適用し、SOF ヘッダからの予測値と機械の安全キャップを突き合わせてから Jimp.fromBuffer へ渡す。
// Jimp.read(path, options) はローカルパス経路で options を捨てるため使えない
// （@jimp/core の read 実装。MapUploadService.ts:281-284 参照）。
export interface MercDecodeError {
    err: string;
    errorCode: 'jpeg_machine_limit' | 'jpeg_memory_limit' | 'jpeg_resolution_limit';
    configuredMB?: number;
    configuredMP?: number;
    prediction?: { requiredMemoryMB: number; recommendedMemoryMB: number } | { megapixels: number; recommendedResolutionMP: number };
    machine?: { requiredHeapMB: number; availableHeapMB: number; megapixels: number };
}

export interface MercDecodeOptions {
    maxMemoryUsageInMB: number;
    maxResolutionInMP: number;
}

/**
 * バッファの SOF ヘッダから jpeg-js の会計要求量を予測し、機械の安全キャップ・設定キャップと
 * 突き合わせて Jimp.fromBuffer へ渡す実効値を決定する（純粋関数・実デコード不要）。
 * JPEG でない/SOF を解析できない場合は機械の安全枠をそのまま使う（PNG は無害。§3.8）。
 */
export function resolveMercDecodeOptions(
    buffer: Buffer,
    caps: { maxMemoryUsageInMB: number | null; maxResolutionInMP: number | null },
    safety: DecodeSafety,
): MercDecodeOptions | MercDecodeError {
    const budget = estimateJpegDecodeBudget(buffer);
    if (!budget) {
        return { maxMemoryUsageInMB: safety.maxMemoryMB, maxResolutionInMP: safety.maxResolutionMP };
    }
    // この機械では構造的に扱えない（V8 ヒープが会計外で尽きプロセス強制終了になる領域）。
    // 会計ガードの調整では直せないため、確認を出さずここで止める（MapUploadService と同型）
    if (budget.decoderHeapMB > safety.maxDecoderHeapMB) {
        return {
            err: `jpeg decode machine limit: required heap ${budget.decoderHeapMB}MiB > available ${safety.maxDecoderHeapMB}MiB`,
            errorCode: 'jpeg_machine_limit',
            machine: { requiredHeapMB: budget.decoderHeapMB, availableHeapMB: safety.maxDecoderHeapMB, megapixels: budget.megapixels },
        };
    }
    if (caps.maxMemoryUsageInMB !== null && budget.recommendedMemoryMB > caps.maxMemoryUsageInMB) {
        return {
            err: `jpeg decode memory limit: required ${budget.requiredMemoryMB}MB > configured cap ${caps.maxMemoryUsageInMB}MB`,
            errorCode: 'jpeg_memory_limit',
            configuredMB: caps.maxMemoryUsageInMB,
            prediction: { requiredMemoryMB: budget.requiredMemoryMB, recommendedMemoryMB: budget.recommendedMemoryMB },
        };
    }
    if (caps.maxResolutionInMP !== null && budget.recommendedResolutionMP > caps.maxResolutionInMP) {
        return {
            err: `jpeg decode resolution limit: ${budget.megapixels}MP > configured cap ${caps.maxResolutionInMP}MP`,
            errorCode: 'jpeg_resolution_limit',
            configuredMP: caps.maxResolutionInMP,
            prediction: { megapixels: budget.megapixels, recommendedResolutionMP: budget.recommendedResolutionMP },
        };
    }
    return { maxMemoryUsageInMB: budget.recommendedMemoryMB, maxResolutionInMP: budget.recommendedResolutionMP };
}

// M12-T22: 本クラスへのUI導線はM11-T3で撤去されていたが、m6-t8でMapEdit.vueの
// 新規「メルカトルタイル」タブから到達可能になった（M12-T22が転用予定としていた
// M4-(2)に対応）。ロジック・i18nキー（wmtsgenerate.* 全5キー、public/locales/*/
// translation.json）は削除しない（§3.4参照）。
// 詳細: docs/superpowers/state/nayuta-state.json m12.tasks[t22] / m4.human_direction_2026_07_25
class WmtsGeneratorService {
    private get folders() {
        const saveFolder = SettingsService.get('saveFolder') as string;
        return {
            originalFolder: path.join(saveFolder, 'originals'),
            mercFolder:     path.join(saveFolder, 'merc'),
        };
    }

    async generate(
        win: BrowserWindow,
        uid: string,
        mapID: string,
        width: number,
        height: number,
        tinSerial: any,
        extKey: string,
        hash: string,
        targetBaseMapUid: string
    ): Promise<{ hash: string; tileJson?: TileJsonDocument; err?: any; errorCode?: MercDecodeError['errorCode']; configuredMB?: number; configuredMP?: number; prediction?: MercDecodeError['prediction']; machine?: MercDecodeError['machine'] }> {
        try {
            const tin = new Tin(TIN_V2_OPTIONS);
            tin.setCompiled(tinSerial);

            extKey = extKey || 'jpg';
            const { mercFolder } = this.folders;
            // M13-T2 (§5.4): originals の runtime read は canonical(uid キー)-first、
            // canonical 不在時のみ一意な legacy(slug キー) fallback で解決する
            const resolved = await resolveRuntimeOriginal(uid, mapID, extKey);
            if (!resolved) {
                // タスク設計レビュー v1 Minor 6: strict_error キーの流用をやめ、専用の非 i18n
                // 診断文字列を確定する。renderer 側 wmtsGenerate() は arg.err を
                // console.error するだけで、表示は既存の汎用 merc.error_generation（m6-t8）
                return { hash, err: new Error(`originals.unresolved: failed to resolve runtime original for uid=${uid} slug=${mapID}`) };
            }
            const imagePath = resolved.path;
            // m6-t8 (ADR-0016): タイルの所有者は元地図ではなく出力先ベースマップの UID
            const tileRoot  = path.join(mercFolder, targetBaseMapUid);

            // 実装レビュー M-2: デコードもタイル化も始める前に判定する（MapUploadService.imageCutter
            // と同じ順序）。ここで戻る経路はタイル生成に一切着手していないため後始末は不要
            const imageBufferSource = await fs.readFile(imagePath);
            const decodeOptions = resolveMercDecodeOptions(
                imageBufferSource,
                SettingsService.getJpegDecodeCaps(),
                resolveDecodeSafety(),
            );
            if ('errorCode' in decodeOptions) {
                return { hash, ...decodeOptions };
            }

            // --- 原版と同じ: 4隅を変換して zoom 計算 ---
            const lt = tin.transform([0,     0      ], false, true) as number[];
            const rt = tin.transform([width, 0      ], false, true) as number[];
            const rb = tin.transform([width, height ], false, true) as number[];
            const lb = tin.transform([0,     height ], false, true) as number[];

            const pixelLongest = Math.sqrt(Math.pow(width,  2) + Math.pow(height, 2));
            const ltrbLong     = Math.sqrt(Math.pow(lt[0] - rb[0], 2) + Math.pow(lt[1] - rb[1], 2));
            const rtlbLong     = Math.sqrt(Math.pow(rt[0] - lb[0], 2) + Math.pow(rt[1] - lb[1], 2));

            const wwRate  = MERC_MAX * 2 / 256;
            const mapRate = Math.min(ltrbLong / pixelLongest, rtlbLong / pixelLongest);
            const maxZoom = Math.ceil(Math.log2(wwRate / mapRate));
            const minSide = Math.min(width, height);
            const deltaZoom = Math.ceil(Math.log2(minSide / 256));
            const minZoom = maxZoom - deltaZoom;

            // --- 原版と同じ: 全辺ピクセルを変換してタイル範囲を決定 ---
            const edgeValues: number[][] = [lt, lb, rt, rb];
            for (let px = 1; px < width; px++) {
                edgeValues.push(tin.transform([px, 0     ], false, true) as number[]);
                edgeValues.push(tin.transform([px, height], false, true) as number[]);
            }
            for (let py = 1; py < height; py++) {
                edgeValues.push(tin.transform([0,     py], false, true) as number[]);
                edgeValues.push(tin.transform([width, py], false, true) as number[]);
            }
            const txs = edgeValues.map(item => item[0]);
            const tys = edgeValues.map(item => item[1]);

            const pixelXw = (Math.min(...txs) + MERC_MAX) / (2 * MERC_MAX) * 256 * Math.pow(2, maxZoom);
            const pixelXe = (Math.max(...txs) + MERC_MAX) / (2 * MERC_MAX) * 256 * Math.pow(2, maxZoom);
            const pixelYn = (MERC_MAX - Math.max(...tys)) / (2 * MERC_MAX) * 256 * Math.pow(2, maxZoom);
            const pixelYs = (MERC_MAX - Math.min(...tys)) / (2 * MERC_MAX) * 256 * Math.pow(2, maxZoom);

            const tileXw = Math.floor(pixelXw / 256);
            const tileXe = Math.floor(pixelXe / 256);
            const tileYn = Math.floor(pixelYn / 256);
            const tileYs = Math.floor(pixelYs / 256);

            // --- 原版と同じ: processArray 構築 ---
            const processArray: [number, number, number][] = [];
            for (let z = maxZoom; z >= minZoom; z--) {
                const txw = Math.floor(tileXw / Math.pow(2, maxZoom - z));
                const txe = Math.floor(tileXe / Math.pow(2, maxZoom - z));
                const tyn = Math.floor(tileYn / Math.pow(2, maxZoom - z));
                const tys_ = Math.floor(tileYs / Math.pow(2, maxZoom - z));
                for (let x = txw; x <= txe; x++) {
                    for (let y = tyn; y <= tys_; y++) {
                        processArray.push([z, x, y]);
                    }
                }
            }

            // --- プログレス ---
            // 実装レビュー M-1: 進捗イベントのテキストキーは modalProgress() 経由でモーダル本文を
            // 上書きするため、ADR-0015（UIから "WMTS" を排除）に従い merc.* を使う
            // （呼び出し元は m6-t8 の新規 merc タブのみ。wmtsgenerate.generating_tile は
            // もう参照されない）
            const reporter = new ProgressReporter(
                'mapedit:taskProgress',
                processArray.length,
                'merc.generating_tile',
                ''
            );
            reporter.setWindow(win);
            reporter.update(0);

            // --- 画像読み込み（raw buffer を maxZoomTileLoop に渡す）---
            // 実装レビュー M-2: Jimp.read(path, options) はローカルパス経路で options を捨てる
            // （@jimp/core）ため、事前に読んだ buffer を fromBuffer へ渡し、decodeOptions
            // （SOFヘッダ予測+安全キャップ突き合わせ済み）を確実に効かせる
            const imageJimp = await Jimp.fromBuffer(imageBufferSource, {
                'image/jpeg': decodeOptions,
            });
            const imageBuffer = imageJimp.bitmap.data as Buffer;

            for (let i = 0; i < processArray.length; i++) {
                const [z, x, y] = processArray[i];
                if (z === maxZoom) {
                    await this.maxZoomTileLoop(tin, z, x, y, imageBuffer, width, height, tileRoot);
                } else {
                    await this.upperZoomTileLoop(z, x, y, tileRoot);
                }
                // 原版と同じ: UI スレッドを解放するための短い待機
                await new Promise(s => setTimeout(s, 1));
                reporter.update(i + 1);
            }

            // m6-t8 §3.4: 生成時点で tilejson.json を書く（tiles は自己参照の相対パス。
            // 書き出し時のディレクトリ名はまだ定まっていないため、後で AppExportService 側が差し替える）
            const tileJson = buildMercTileJson(tileXw, tileXe, tileYn, tileYs, minZoom, maxZoom);
            await fs.outputJson(path.join(tileRoot, 'tilejson.json'), tileJson);

            return { hash, tileJson };
        } catch (err: any) {
            console.error('[WmtsGeneratorService] generate error', err);
            return { hash, err };
        }
    }

    // 原版 wmts_generator.js maxZoomTileLoop を忠実移植
    private async maxZoomTileLoop(
        tin: any,
        z: number,
        x: number,
        y: number,
        imageBuffer: Buffer,
        width: number,
        height: number,
        tileRoot: string
    ): Promise<void> {
        const unitPerPixel = (2 * MERC_MAX) / (256 * Math.pow(2, z));
        const startPixelX = x * 256;
        const startPixelY = y * 256;

        const tileJimp = new Jimp({ width: 256, height: 256 });
        const tileData = tileJimp.bitmap.data;

        const range = [-1, 0, 1, 2];
        let pos = 0;

        for (let py = 0; py < 256; py++) {
            const my = MERC_MAX - ((py + startPixelY) * unitPerPixel);
            for (let px = 0; px < 256; px++) {
                const mx = (px + startPixelX) * unitPerPixel - MERC_MAX;
                let xy: number[];
                try {
                    xy = tin.transform([mx, my], true, true);
                } catch (_e) {
                    xy = null as any;
                }

                if (!xy) {
                    tileData[pos] = tileData[pos+1] = tileData[pos+2] = tileData[pos+3] = 0;
                    pos += 4;
                    continue;
                }

                const rangeX = range.map(i => i + ~~xy[0]);
                const rangeY = range.map(i => i + ~~xy[1]);

                let r = 0, g = 0, b = 0, a = 0;
                for (const ry of rangeY) {
                    const weightY = this.getWeight(ry, xy[1]);
                    for (const rx of rangeX) {
                        const weight = weightY * this.getWeight(rx, xy[0]);
                        if (weight === 0) continue;
                        const color = this.rgba(imageBuffer, width, height, rx, ry);
                        r += color.r * weight;
                        g += color.g * weight;
                        b += color.b * weight;
                        a += color.a * weight;
                    }
                }

                tileData[pos]   = ~~r;
                tileData[pos+1] = ~~g;
                tileData[pos+2] = ~~b;
                tileData[pos+3] = ~~a;
                pos += 4;
            }
        }

        tileJimp.bitmap.data = tileData;

        const tileFolder = path.join(tileRoot, `${z}`, `${x}`);
        const tileFile   = path.join(tileFolder, `${y}.png`);
        await fs.ensureDir(tileFolder);
        await tileJimp.write(tileFile as any);
    }

    // 原版 wmts_generator.js upperZoomTileLoop を忠実移植
    // 256x256 キャンバスに 128x128 にリサイズした 4 つの子タイルを合成
    private async upperZoomTileLoop(
        z: number,
        x: number,
        y: number,
        tileRoot: string
    ): Promise<void> {
        const downZoom = z + 1;
        const tileJimp = new Jimp({ width: 256, height: 256 });

        for (let dx = 0; dx < 2; dx++) {
            const ux = x * 2 + dx;
            const ox = dx * 128;
            for (let dy = 0; dy < 2; dy++) {
                const uy = y * 2 + dy;
                const oy = dy * 128;
                const upImage = path.join(tileRoot, `${downZoom}`, `${ux}`, `${uy}.png`);
                try {
                    const child = await Jimp.read(upImage);
                    child.resize({ w: 128, h: 128 });
                    tileJimp.composite(child, ox, oy);
                } catch (_e) { /* 子タイルが存在しない場合は透明のまま */ }
            }
        }

        const tileFolder = path.join(tileRoot, `${z}`, `${x}`);
        const tileFile   = path.join(tileFolder, `${y}.png`);
        await fs.ensureDir(tileFolder);
        await tileJimp.write(tileFile as any);
    }

    // 原版と同じ bicubic weight 関数 (a = -1)
    private getWeight(t1: number, t2: number): number {
        const a = -1;
        const d = Math.abs(t1 - t2);
        if (d < 1) {
            return (a + 2) * Math.pow(d, 3) - (a + 3) * Math.pow(d, 2) + 1;
        } else if (d < 2) {
            return a * Math.pow(d, 3) - 5 * a * Math.pow(d, 2) + 8 * a * d - 4 * a;
        }
        return 0;
    }

    // 原版と同じ rgba アクセス（境界外は黒透明）
    private rgba(pixels: Buffer, w: number, h: number, x: number, y: number): PixelColor {
        if (x < 0 || y < 0 || x >= w || y >= h) {
            return { r: 0, g: 0, b: 0, a: 0 };
        }
        const p = ((w * y) + x) * 4;
        return { r: pixels[p], g: pixels[p+1], b: pixels[p+2], a: pixels[p+3] };
    }
}

export default new WmtsGeneratorService();
