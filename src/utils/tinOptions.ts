import type { Options as TinOptions } from '@maplat/tin';
import type { CrsObject, StrictMode, VertexMode, WorldFile, YaxisMode } from '@maplat/transform';

/** 三角網を作るときの層ごとの設定。省略した項目は Tin の既定に任せる。 */
export interface LayerTinBuildOptions {
  strictMode?: StrictMode;
  vertexMode?: VertexMode;
  yaxisMode?: YaxisMode;
}

/** 層（主図・副層）のうち、三角網の作り方の判定に使う項目だけ。 */
export interface TinBuildLayer {
  crs?: CrsObject | null;
  tinEnabled?: boolean;
  worldFile?: WorldFile;
  yaxisMode?: YaxisMode;
  compiled?: {
    outerTransform?: 'worldFile' | 'extrapolate';
    worldFile?: WorldFile;
    yaxisMode?: YaxisMode;
  } | null;
}

export type LayerTransformIntent = 'A' | 'B' | 'C' | 'legacyV2' | string | undefined;

/**
 * 層直下の crs 鍵だけを基準に、従来 V2 と採用済み V4 外周を選ぶ。
 * - A（tinEnabled === false）: 三角網を作らないので null。
 * - crs 鍵なし: 従来の V2。
 * - crs 鍵あり: B は world file 外周、C は常に extrapolate を明示する。
 * yaxisMode は引数、層の直下、compiled の順に探し、無ければ Tin の既定に任せる。
 */
export function resolveTinBuildOptions(
  layer: TinBuildLayer,
  buildOptions: LayerTinBuildOptions = {},
  intent?: LayerTransformIntent,
): TinOptions | null {
  if (layer.tinEnabled === false) return null;
  const isLegacy = layer.crs === undefined || layer.crs === null;
  const yaxisMode = buildOptions.yaxisMode ?? layer.yaxisMode ?? layer.compiled?.yaxisMode;
  const common: TinOptions = {
    ...(buildOptions.strictMode !== undefined ? { strictMode: buildOptions.strictMode } : {}),
    ...(buildOptions.vertexMode !== undefined ? { vertexMode: buildOptions.vertexMode } : {}),
    ...(!isLegacy && yaxisMode !== undefined ? { yaxisMode } : {}),
  };
  if (isLegacy) return { useV2Algorithm: true, ...common };
  const compiled = layer.compiled ?? {};
  const wantsWorldFile = intent === 'B' || (intent !== 'C' && compiled.outerTransform === 'worldFile');
  const worldFile = compiled.worldFile ?? layer.worldFile;
  if (intent === 'B' && !worldFile) throw new Error('B の三角網にはワールドファイルが必要です');
  if (wantsWorldFile && worldFile) {
    return { useV2Algorithm: false, ...common, outerTransform: 'worldFile', worldFile };
  }
  return { useV2Algorithm: false, ...common, outerTransform: 'extrapolate' };
}

/**
 * Tin の幾何（wh か bounds）を設定する。setBounds は vertexMode を plain へ戻すので、
 * 幾何を決めたあとで tinOptions の vertexMode を入れ直す（古い引数は使わない）。
 */
export function applyTinGeometry(
  tin: {
    setWh(wh: number[]): void;
    setBounds(bounds: number[][]): void;
    setVertexMode(mode: VertexMode): void;
  },
  options: TinOptions,
  geometry: { wh?: number[] | null; bounds?: number[][] | null },
): boolean {
  if (geometry.wh) tin.setWh(geometry.wh);
  else if (geometry.bounds) tin.setBounds(geometry.bounds);
  else return false;
  if (options.vertexMode) tin.setVertexMode(options.vertexMode);
  return true;
}
