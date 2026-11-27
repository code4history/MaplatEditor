import TileImage from 'ol/source/TileImage';
import TileGrid from 'ol/tilegrid/TileGrid';
import {
  addCoordinateTransforms,
  addProjection,
  fromLonLat,
  get as getProjection,
  getTransform,
  Projection,
  toLonLat,
} from 'ol/proj';
import type { Extent } from 'ol/extent';
// @ts-expect-error @maplat/core/package.json exports 対象外だが vite.config.ts で @maplat/core/src へ解決される（src/index.ts の window.assets 代入を回避するため source_ex を直接参照）
import { mapSourceFactory } from '@maplat/core/src/source_ex';
import type { Compiled, CrsObject, WorldFile } from '@maplat/transform';
import type { PreviewMode } from './crsEstimationPanel';

const MERC_MAX = 20037508.342789244;

export type CrsRasterPreviewSpec =
  | {
      mode: 'A';
      layerIndex: number;
      crs: CrsObject;
      worldFile: WorldFile;
      bounds?: number[][];
    }
  | {
      mode: 'B' | 'C';
      layerIndex: number;
      crs: CrsObject;
      compiled: Compiled;
      bounds?: number[][];
    };

export interface CrsPreviewEventPayload {
  mode: PreviewMode;
  opacity: number;
  geojson: unknown | null;
  rasterSpec?: CrsRasterPreviewSpec | null;
}

export interface CreateCrsPreviewRasterArgs {
  spec: CrsRasterPreviewSpec;
  width: number;
  height: number;
  url?: string;
  urls?: string[];
  delivery?: Record<string, unknown>;
  imageExtension?: string;
  attr?: unknown;
  thumbnail?: string;
}

export interface CrsPreviewRasterResult {
  source: TileImage;
  extent?: Extent;
  projectionCode: string;
  illstProjectionCode: string;
}

let sentinelNonce = 0;
const pendingSettingJson = new Map<string, string>();
let originalFetch: typeof window.fetch | null = null;

function allocateSentinelUrl(): string {
  const token = `${Date.now()}-${++sentinelNonce}`;
  const path = `__crs_preview_json__/${token}.json`;
  if (typeof window !== 'undefined' && window.location?.href) {
    try {
      const url = new URL(path, window.location.href);
      if (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'app:') {
        return url.href;
      }
    } catch {
      // フォールバックへ
    }
  }
  return `https://crs-preview.invalid/${path}`;
}

function resolveRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/**
 * mapSourceFactory（noload なし）は settingFile を fetch する。
 * CSP（connect-src 'self' https: http://localhost:*）で blob:/data: が禁止されているため、
 * 呼び出し中だけ同一オリジンの番兵 URL を 1 回限りでメモリから返す（他リクエストへは触れない）。
 */
async function withSentinelFetch<T>(url: string, jsonText: string, run: () => Promise<T>): Promise<T> {
  if (typeof window === 'undefined' || typeof window.fetch !== 'function') {
    return run();
  }
  if (pendingSettingJson.size === 0 && !originalFetch) {
    originalFetch = window.fetch;
    const baseFetch = originalFetch;
    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const targetUrl = resolveRequestUrl(input);
      const body = pendingSettingJson.get(targetUrl);
      if (body !== undefined) {
        return Promise.resolve(new Response(body, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }));
      }
      return baseFetch.call(window, input, init);
    }) as typeof window.fetch;
  }
  pendingSettingJson.set(url, jsonText);
  try {
    return await run();
  } finally {
    pendingSettingJson.delete(url);
    if (pendingSettingJson.size === 0 && originalFetch) {
      window.fetch = originalFetch;
      originalFetch = null;
    }
  }
}

function buildStorePayload(
  previewMapId: string,
  spec: CrsRasterPreviewSpec,
  width: number,
  height: number,
): Record<string, unknown> {
  const isSublayer = spec.layerIndex > 0;
  if (!isSublayer) {
    if (spec.mode === 'A') {
      return {
        mapID: previewMapId,
        width,
        height,
        tinEnabled: false,
        crs: spec.crs,
        worldFile: spec.worldFile,
      };
    }
    return {
      mapID: previewMapId,
      width,
      height,
      crs: spec.crs,
      compiled: spec.compiled,
    };
  }

  const subBounds = Array.isArray(spec.bounds) && spec.bounds.length >= 3
    ? spec.bounds
    : [[0, 0], [width, 0], [width, height], [0, height]];
  const subEntry = spec.mode === 'A'
    ? {
        tinEnabled: false,
        crs: spec.crs,
        worldFile: spec.worldFile,
        bounds: subBounds,
        priority: 1,
        importance: 1,
      }
    : {
        crs: spec.crs,
        compiled: spec.compiled,
        bounds: subBounds,
        priority: 1,
        importance: 1,
      };

  // 副層のプレビュー時は本図（index 0）を未編集・未コンパイルのまま通せるよう、本図側へは仮の正則面を置く
  return {
    mapID: previewMapId,
    width,
    height,
    tinEnabled: false,
    crs: { epsg: 3857 },
    worldFile: { xScale: 1, xSkew: 0, xOrigin: 0, ySkew: 0, yScale: -1, yOrigin: 0 },
    sub_maps: [subEntry],
  };
}

function computePixelRegion(spec: CrsRasterPreviewSpec, width: number, height: number): Extent {
  if (spec.layerIndex > 0 && Array.isArray(spec.bounds) && spec.bounds.length >= 3) {
    const xs = spec.bounds.map((p) => p[0]).filter(Number.isFinite);
    const ys = spec.bounds.map((p) => p[1]).filter(Number.isFinite);
    if (xs.length >= 3 && ys.length >= 3) {
      const minX = Math.max(0, Math.min(...xs));
      const maxX = Math.min(width, Math.max(...xs));
      const minY = Math.max(0, Math.min(...ys));
      const maxY = Math.min(height, Math.max(...ys));
      if (maxX > minX && maxY > minY) {
        return [minX, -maxY, maxX, -minY];
      }
    }
  }
  return [0, -height, width, 0];
}

function estimateMercatorExtent(
  forwardIllst: (coord: number[]) => number[],
  rasterExtent: Extent,
): Extent | undefined {
  const minPx = rasterExtent[0];
  const maxPx = rasterExtent[2];
  const minPy = -rasterExtent[3];
  const maxPy = -rasterExtent[1];
  let minMx = Infinity;
  let minMy = Infinity;
  let maxMx = -Infinity;
  let maxMy = -Infinity;
  let count = 0;

  const steps = 4;
  for (let ix = 0; ix <= steps; ix += 1) {
    const px = minPx + ((maxPx - minPx) * ix) / steps;
    for (let iy = 0; iy <= steps; iy += 1) {
      const py = minPy + ((maxPy - minPy) * iy) / steps;
      const merc = forwardIllst([px, py]);
      if (!Array.isArray(merc) || !Number.isFinite(merc[0]) || !Number.isFinite(merc[1])) continue;
      if (Math.abs(merc[0]) > MERC_MAX || Math.abs(merc[1]) > MERC_MAX) continue;
      minMx = Math.min(minMx, merc[0]);
      minMy = Math.min(minMy, merc[1]);
      maxMx = Math.max(maxMx, merc[0]);
      maxMy = Math.max(maxMy, merc[1]);
      count += 1;
    }
  }
  if (count < 2 || !(maxMx > minMx) || !(maxMy > minMy)) return undefined;
  const padX = Math.max((maxMx - minMx) * 1.5, 500);
  const padY = Math.max((maxMy - minMy) * 1.5, 500);
  return [
    Math.max(-MERC_MAX, minMx - padX),
    Math.max(-MERC_MAX, minMy - padY),
    Math.min(MERC_MAX, maxMx + padX),
    Math.min(MERC_MAX, maxMy + padY),
  ];
}

/**
 * `@maplat/core` の `mapSourceFactory`（`noload` なし・J4）を通じて `HistMap_tin` を生成し、
 * `#mercMap`（EPSG:3857）上で OpenLayers の再投影タイルとして表示できる `TileImage` ソースを返す。
 */
export async function createCrsPreviewRasterSource(
  args: CreateCrsPreviewRasterArgs,
): Promise<CrsPreviewRasterResult | null> {
  const { spec, width, height, url, urls, delivery, imageExtension, attr, thumbnail } = args;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  if (!delivery && !url && (!urls || urls.length === 0)) {
    return null;
  }

  const previewMapId = `__crs_preview_${spec.layerIndex}__`;
  const settingUrl = allocateSentinelUrl();
  const storePayload = buildStorePayload(previewMapId, spec, width, height);

  const factoryOptions: Record<string, unknown> = {
    mapID: previewMapId,
    settingFile: settingUrl,
    width,
    height,
    imageExtension: imageExtension || 'jpg',
    attr,
    thumbnail,
    enableCache: false,
    noCache: true,
  };
  if (delivery) {
    factoryOptions.delivery = delivery;
  } else if (urls && urls.length > 0) {
    factoryOptions.urls = urls;
  } else if (url) {
    factoryOptions.url = url;
  }

  const histSource = (await withSentinelFetch(settingUrl, JSON.stringify(storePayload), () =>
    mapSourceFactory(factoryOptions, {}),
  )) as TileImage | null;
  if (!histSource) return null;

  const illstProjectionCode = spec.layerIndex > 0 ? `Illst:${previewMapId}#1` : `Illst:${previewMapId}`;
  const forwardIllst = getTransform(illstProjectionCode, 'EPSG:3857');
  const inverseIllst = getTransform('EPSG:3857', illstProjectionCode);
  if (!forwardIllst || !inverseIllst) return null;

  const rasterExtent = computePixelRegion(spec, width, height);
  const projectionCode = `IllstRaster:${previewMapId}`;
  const rasterProj = new Projection({
    code: projectionCode,
    extent: rasterExtent,
    units: 'm',
  });
  addProjection(rasterProj);

  const rasterToMerc = (coord: number[]): number[] => {
    const out = forwardIllst([coord[0], -coord[1]]);
    return Array.isArray(out) && Number.isFinite(out[0]) && Number.isFinite(out[1])
      ? [out[0], out[1]]
      : [NaN, NaN];
  };
  const mercToRaster = (coord: number[]): number[] => {
    const out = inverseIllst([coord[0], coord[1]]);
    return Array.isArray(out) && Number.isFinite(out[0]) && Number.isFinite(out[1])
      ? [out[0], -out[1]]
      : [NaN, NaN];
  };

  addCoordinateTransforms(rasterProj, 'EPSG:3857', rasterToMerc, mercToRaster);
  addCoordinateTransforms(
    rasterProj,
    'EPSG:4326',
    (coord) => {
      const merc = rasterToMerc(coord);
      return Number.isFinite(merc[0]) && Number.isFinite(merc[1]) ? toLonLat(merc) : [NaN, NaN];
    },
    (lonLat) => {
      if (!Number.isFinite(lonLat[0]) || !Number.isFinite(lonLat[1])) return [NaN, NaN];
      return mercToRaster(fromLonLat(lonLat));
    },
  );

  const maxZoom = Math.max(0, Math.ceil(Math.max(Math.log2(width / 256), Math.log2(height / 256))));
  const resolutions = Array.from({ length: maxZoom + 1 }, (_, z) => Math.pow(2, maxZoom - z));
  const tileGrid = new TileGrid({
    extent: [0, -height, width, 0],
    origin: [0, 0],
    resolutions,
    tileSize: 256,
  });

  const histTileUrl = histSource.getTileUrlFunction?.();
  const histTileLoad = histSource.getTileLoadFunction?.();
  const histProj = histSource.getProjection?.() ?? getProjection('EPSG:3857')!;
  if (!histTileUrl || !histTileLoad) return null;

  const tileSource = new TileImage({
    projection: rasterProj,
    tileGrid,
    wrapX: false,
    interpolate: true,
    tileUrlFunction: (tileCoord, pixelRatio) => histTileUrl.call(histSource, tileCoord, pixelRatio, histProj),
    tileLoadFunction: (tile, src) => histTileLoad.call(histSource, tile, src),
  });

  return {
    source: tileSource,
    extent: estimateMercatorExtent(forwardIllst, rasterExtent),
    projectionCode,
    illstProjectionCode,
  };
}
