import { Jimp } from 'jimp';
// @ts-ignore
import Tin from '@maplat/tin';
import fs from 'fs-extra';
import path from 'path';
import { BrowserWindow } from 'electron';
import SettingsService from './SettingsService';
import { ProgressReporter } from '../utils/ProgressReporter';

const MERC_MAX = 20037508.342789244;

interface PixelColor { r: number; g: number; b: number; a: number; }

class WmtsGeneratorService {
    private get folders() {
        const saveFolder = SettingsService.get('saveFolder') as string;
        return {
            originalFolder: path.join(saveFolder, 'originals'),
            wmtsFolder:     path.join(saveFolder, 'wmts'),
        };
    }

    async generate(
        win: BrowserWindow,
        mapID: string,
        width: number,
        height: number,
        tinSerial: any,
        extKey: string,
        hash: string
    ): Promise<{ hash: string; err?: any }> {
        try {
            const tin = new Tin({});
            tin.setCompiled(tinSerial);

            extKey = extKey || 'jpg';
            const { originalFolder, wmtsFolder } = this.folders;
            const imagePath = path.join(originalFolder, `${mapID}.${extKey}`);
            const tileRoot  = path.join(wmtsFolder, mapID);

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
            const reporter = new ProgressReporter(
                'mapedit:taskProgress',
                processArray.length,
                'wmtsgenerate.generating_tile',
                ''
            );
            reporter.setWindow(win);
            reporter.update(0);

            // --- 画像読み込み（raw buffer を maxZoomTileLoop に渡す）---
            const imageJimp = await Jimp.read(imagePath);
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

            return { hash };
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
