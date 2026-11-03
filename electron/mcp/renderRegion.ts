// maps.render_region: draws a rectangle of a map image from its saved tiles, optionally with a coordinate
// grid and marks, so a client can look at a part of the map at a known scale and read positions off it.
//
// The work is bounded before it starts (output size, tile count, grid density, marks: see limits.ts). Reading
// a tile is I/O and the facade looks at the abort signal before each one; decoding, compositing, scaling and
// drawing are CPU work that cannot be interrupted, so between those steps the event loop is given a turn and
// the signal is looked at again.
import { Jimp, loadFont, measureText } from 'jimp';
import { SANS_10_BLACK } from 'jimp/fonts';
import type * as ReadFacade from './readFacade';
import type { McpLimits } from './limits';
import { TILE_SIZE, tileMaxZoom } from '../utils/tilePyramid';

type Picture = InstanceType<typeof Jimp>;
type Font = Awaited<ReturnType<typeof loadFont>>;
type Rgba = readonly [number, number, number, number];

/** Grid lines: a half transparent colour, one output pixel wide. */
export const GRID_RGBA: Rgba = [230, 0, 120, 170];
/** Marks: an opaque cross, 7 output pixels across. */
export const MARK_RGBA: Rgba = [255, 0, 0, 255];
const LABEL_BOX_RGBA: Rgba = [255, 255, 255, 255];
const MARK_ARM = 3;

export interface RegionMark {
  x: number;
  y: number;
  label?: string;
}

export interface RegionRequest {
  /** The rectangle in image pixels: x0 <= x < x1, y0 <= y < y1. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Output pixels per image pixel. */
  scale: number;
  /** Image pixels between grid lines; no grid when absent. */
  gridStep?: number;
  marks: RegionMark[];
  format: 'png' | 'jpeg';
}

export interface RegionInfo {
  origin: [number, number];
  scale: number;
  width: number;
  height: number;
  zoom: number;
  grid_step?: number;
  [key: string]: unknown;
}

export interface RegionPicture {
  bytes: Buffer;
  mimeType: 'image/png' | 'image/jpeg';
  info: RegionInfo;
}

/** A request that cannot be drawn. invalidParams: the input itself is out of range (else: the result is). */
export class RegionRejected extends Error {
  constructor(message: string, readonly invalidParams: boolean) {
    super(message);
    this.name = 'RegionRejected';
  }
}

function checkAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new Error('aborted');
}

/** Gives the event loop a turn (so the request time limit can fire), then looks at the signal. */
async function giveWay(signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  checkAborted(signal);
}

let fontLoad: Promise<Font | null> | null = null;

/** The label font, loaded once. Without it the grid and marks are drawn without text. */
function labelFont(): Promise<Font | null> {
  fontLoad ??= loadFont(SANS_10_BLACK).catch((error: unknown) => {
    console.log('[mcp] maps.render_region: labels are left out, the font did not load:', error);
    fontLoad = null;
    return null;
  });
  return fontLoad;
}

/** Paints one pixel with colour over what is there (source-over). */
function blendPixel(picture: Picture, x: number, y: number, [r, g, b, a]: Rgba): void {
  const { width, height, data } = picture.bitmap;
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const i = (y * width + x) * 4;
  const sa = a / 255;
  const da = data[i + 3] / 255;
  const oa = sa + da * (1 - sa);
  if (oa <= 0) return;
  data[i] = Math.round((r * sa + data[i] * da * (1 - sa)) / oa);
  data[i + 1] = Math.round((g * sa + data[i + 1] * da * (1 - sa)) / oa);
  data[i + 2] = Math.round((b * sa + data[i + 2] * da * (1 - sa)) / oa);
  data[i + 3] = Math.round(oa * 255);
}

function fillRect(picture: Picture, x: number, y: number, w: number, h: number, colour: Rgba): void {
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) blendPixel(picture, xx, yy, colour);
}

/** Text on a small light box, so it can be read on any part of the map. */
function drawLabel(picture: Picture, font: Font | null, x: number, y: number, text: string): void {
  if (!font || text === '') return;
  const w = measureText(font, text) + 4;
  const h = font.common.lineHeight;
  fillRect(picture, x, y, w, h, LABEL_BOX_RGBA);
  picture.print({ font, x: x + 2, y, text });
}

/** Image coordinates that are multiples of step, from `from` (included) to `to` (left out). */
function multiples(from: number, to: number, step: number): number[] {
  const out: number[] = [];
  for (let v = Math.ceil(from / step) * step; v < to; v += step) out.push(v);
  return out;
}

/**
 * Checks the request against the map size and the limits, reads the tiles and draws the picture. Resolves to
 * null when the map has no saved tiles. Throws RegionRejected (out of range, or the encoded picture is too
 * large), the facade's error for an unknown map, and "aborted" once the signal is aborted.
 */
export async function renderRegion(
  facade: typeof ReadFacade,
  mapRef: string,
  request: RegionRequest,
  limits: Readonly<McpLimits>,
  signal: AbortSignal,
): Promise<RegionPicture | null> {
  const { x0, y0, x1, y1, scale, gridStep, marks, format } = request;
  if (!(x0 < x1) || !(y0 < y1)) throw new RegionRejected('region is empty: x0 must be less than x1 and y0 less than y1', true);
  const outW = (x1 - x0) * scale;
  const outH = (y1 - y0) * scale;
  const max = limits.maxRegionOutputPx;
  if (outW > max || outH > max) {
    throw new RegionRejected(`region too large: ${outW}x${outH} output pixels (max ${max}x${max} output pixels)`, true);
  }
  if (gridStep !== undefined && gridStep * scale < limits.minGridStepOutputPx) {
    throw new RegionRejected(`grid_step too small: grid_step x scale must be at least ${limits.minGridStepOutputPx} output pixels`, true);
  }

  checkAborted(signal);
  const map = await facade.readMapForEdit(mapRef);
  checkAborted(signal);
  const width = Number(map?.width);
  const height = Number(map?.height);
  if (!(width > 0) || !(height > 0)) return null;
  if (x1 > width || y1 > height) {
    throw new RegionRejected(`region outside the image (${width}x${height}): x1 and y1 must be at most the image width and height`, true);
  }

  // One output pixel covers 1/scale image pixels: the zoom level whose pixels are closest without being coarser.
  const maxZoom = tileMaxZoom(width, height);
  const zoom = Math.min(maxZoom, Math.max(0, maxZoom - Math.floor(Math.log2(1 / scale))));
  const factor = Math.pow(2, maxZoom - zoom);
  const lx0 = Math.floor(x0 / factor);
  const ly0 = Math.floor(y0 / factor);
  const lx1 = Math.max(lx0 + 1, Math.ceil(x1 / factor));
  const ly1 = Math.max(ly0 + 1, Math.ceil(y1 / factor));
  const range = {
    x0: Math.floor(lx0 / TILE_SIZE),
    y0: Math.floor(ly0 / TILE_SIZE),
    x1: Math.floor((lx1 - 1) / TILE_SIZE),
    y1: Math.floor((ly1 - 1) / TILE_SIZE),
  };
  const tileCount = (range.x1 - range.x0 + 1) * (range.y1 - range.y0 + 1);
  if (tileCount > limits.maxRegionTiles) {
    throw new RegionRejected(`region too large: ${tileCount} tiles (max ${limits.maxRegionTiles} tiles)`, true);
  }

  const read = await facade.readTilesForRegion(typeof map.uid === 'string' ? map.uid : mapRef, zoom, range, signal, {
    maxTiles: limits.maxRegionTiles,
    maxTileBytes: limits.maxTileBytes,
  });
  if (!read) return null;
  checkAborted(signal);

  // Tiles side by side on a canvas that starts at the first tile; missing tiles stay background.
  const background = format === 'jpeg' ? 0xffffffff : 0x00000000;
  const canvas = new Jimp({
    width: (range.x1 - range.x0 + 1) * TILE_SIZE,
    height: (range.y1 - range.y0 + 1) * TILE_SIZE,
    color: background,
  });
  for (let row = 0; row < read.tiles.length; row++) {
    for (let col = 0; col < read.tiles[row].length; col++) {
      const tile = read.tiles[row][col];
      if (!tile) continue;
      let image: Picture;
      try {
        image = (await Jimp.fromBuffer(tile.bytes)) as unknown as Picture;
      } catch {
        console.log('[mcp] maps.render_region: a tile could not be decoded');
        continue;
      }
      if (image.width <= TILE_SIZE && image.height <= TILE_SIZE) {
        canvas.composite(image, (read.range.x0 - range.x0 + col) * TILE_SIZE, (read.range.y0 - range.y0 + row) * TILE_SIZE);
      }
      await giveWay(signal);
    }
  }

  const cropX = lx0 - range.x0 * TILE_SIZE;
  const cropY = ly0 - range.y0 * TILE_SIZE;
  canvas.crop({ x: cropX, y: cropY, w: lx1 - lx0, h: ly1 - ly0 });
  await giveWay(signal);
  canvas.resize({ w: outW, h: outH });
  await giveWay(signal);
  const picture = canvas as unknown as Picture;

  const font = gridStep !== undefined || marks.some((m) => m.label) ? await labelFont() : null;
  checkAborted(signal);
  if (gridStep !== undefined) {
    const xs = multiples(x0, x1, gridStep);
    const ys = multiples(y0, y1, gridStep);
    for (const gx of xs) {
      const ox = Math.round((gx - x0) * scale);
      for (let y = 0; y < outH; y++) blendPixel(picture, ox, y, GRID_RGBA);
    }
    for (const gy of ys) {
      const oy = Math.round((gy - y0) * scale);
      for (let x = 0; x < outW; x++) if (!xs.some((gx) => Math.round((gx - x0) * scale) === x)) blendPixel(picture, x, oy, GRID_RGBA);
    }
    for (const gx of xs) drawLabel(picture, font, Math.round((gx - x0) * scale) + 2, 0, String(gx));
    for (const gy of ys) drawLabel(picture, font, 0, Math.round((gy - y0) * scale) + 2, String(gy));
    await giveWay(signal);
  }
  for (const mark of marks) {
    if (mark.x < x0 || mark.x >= x1 || mark.y < y0 || mark.y >= y1) continue;
    const cx = Math.round((mark.x - x0) * scale);
    const cy = Math.round((mark.y - y0) * scale);
    for (let d = -MARK_ARM; d <= MARK_ARM; d++) {
      blendPixel(picture, cx + d, cy, MARK_RGBA);
      if (d !== 0) blendPixel(picture, cx, cy + d, MARK_RGBA);
    }
    if (mark.label) drawLabel(picture, font, cx + MARK_ARM + 2, cy + MARK_ARM + 1, mark.label);
  }
  await giveWay(signal);

  const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png';
  const bytes = format === 'jpeg'
    ? await canvas.getBuffer('image/jpeg', { quality: 85 })
    : await canvas.getBuffer('image/png');
  checkAborted(signal);
  if (bytes.length > limits.maxRegionImageBytes) {
    throw new RegionRejected(
      `image too large: ${bytes.length} bytes (max ${limits.maxRegionImageBytes} bytes); ask for a smaller region, a smaller scale or format jpeg`,
      false,
    );
  }
  const info: RegionInfo = { origin: [x0, y0], scale, width: outW, height: outH, zoom };
  if (gridStep !== undefined) info.grid_step = gridStep;
  return { bytes, mimeType, info };
}
