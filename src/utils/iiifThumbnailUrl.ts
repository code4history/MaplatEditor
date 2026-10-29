// 取り込む画像サービスのサムネイル URL を、OpenLayers の IIIF の口から作る。
//
// Editor は IIIF の URL の文法（region・size の書き方）を書かない。info.json の
// 値は OpenLayers の IIIFInfo に読み取らせ、タイルの格子と URL の関数は
// ol/source/IIIF が返すものを使う。ここが返すのは URL の文字列だけ。
//
// 52px・512px は「画像の全体が 1 枚のタイルで覆える段」から選ぶ。そのような段が
// 無いときは null を返し、呼ぶ側はサムネイルを作らずに取り込みを続ける。

import { IIIFInfo } from 'ol/format';
import { IIIF } from 'ol/source';
import type { Projection } from 'ol/proj';

const THUMB_52 = 52;
const THUMB_512 = 512;

export type IiifThumbnailUrls = {
  url52: string;
  url512: string;
};

type FullCoverLevel = {
  z: number;
  longSide: number;
};

/** 1 枚のタイルで画像の全体を覆える段だけを集める。 */
function fullCoverLevels(source: IIIF, width: number, height: number): FullCoverLevel[] {
  const projection = source.getProjection() as Projection | null;
  const grid = source.getTileGridForProjection(projection as Projection);
  const resolutions = grid.getResolutions();
  const levels: FullCoverLevel[] = [];
  for (let z = 0; z < resolutions.length; z += 1) {
    const scale = grid.getResolution(z);
    if (!(scale > 0)) continue;
    const tileSize = grid.getTileSize(z);
    const tileWidth = Array.isArray(tileSize) ? tileSize[0] : tileSize;
    const tileHeight = Array.isArray(tileSize) ? tileSize[1] : tileSize;
    if (!(tileWidth > 0) || !(tileHeight > 0)) continue;
    if (Math.ceil(width / (scale * tileWidth)) > 1) continue;
    if (Math.ceil(height / (scale * tileHeight)) > 1) continue;
    levels.push({ z, longSide: Math.max(width, height) / scale });
  }
  return levels;
}

/** 長辺が target にいちばん近い段を選ぶ。 */
function nearestLevel(levels: FullCoverLevel[], target: number): FullCoverLevel {
  return levels.reduce((best, level) =>
    Math.abs(level.longSide - target) < Math.abs(best.longSide - target) ? level : best,
  );
}

/**
 * info.json の値から、52px と 512px のサムネイルの URL を作る。
 * 1 枚のタイルで全体を覆える段が無いときは null。
 */
export function iiifThumbnailUrls(infoJson: unknown): IiifThumbnailUrls | null {
  let options: ReturnType<IIIFInfo['getTileSourceOptions']>;
  try {
    options = new IIIFInfo(infoJson as any).getTileSourceOptions();
  } catch (_error) {
    return null;
  }
  if (!options || !Array.isArray(options.size) || options.size.length < 2) return null;

  const [width, height] = options.size;
  if (!(width > 0) || !(height > 0)) return null;

  let source: IIIF;
  try {
    source = new IIIF(options);
  } catch (_error) {
    return null;
  }

  const projection = source.getProjection() as Projection | null;
  const levels = fullCoverLevels(source, width, height);
  if (levels.length === 0) return null;

  const urlFunction = source.getTileUrlFunction();
  const url52 = urlFunction([nearestLevel(levels, THUMB_52).z, 0, 0], 1, projection as Projection);
  const url512 = urlFunction([nearestLevel(levels, THUMB_512).z, 0, 0], 1, projection as Projection);
  if (typeof url52 !== 'string' || typeof url512 !== 'string') return null;
  return { url52, url512 };
}
