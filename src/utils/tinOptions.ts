import type { Options as TinOptions } from '@maplat/tin';
import type { CrsObject, StrictMode, VertexMode, WorldFile, YaxisMode } from '@maplat/transform';

/**
 * 三角網を作るときの層ごとの設定。省略した項目は Tin の既定に任せる。
 * yaxisMode はここに無い。地理の面の座標系の性質であり、作り方の選択肢ではない（`yaxisModeFromCrs`）。
 */
export interface LayerTinBuildOptions {
  strictMode?: StrictMode;
  vertexMode?: VertexMode;
}

/**
 * 層の CRS から y 軸の向きを導く（設計書 §4.6・横断設計 §2.x）。
 * yaxisMode は、TMS（y が上向き）と XYZ（y が下向き）の両方を扱うために付けたフラグで、人間が選ぶものではない。
 * Editor が扱う CRS は東・北（`+axis=enu`。採用で他の軸は拒否する）で、y が上向きなので invert になる。
 */
export function yaxisModeFromCrs(_crs: CrsObject): YaxisMode {
  return 'invert';
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
 * yaxisMode は、crs のある層では crs から導く（保存された値とは食い違っていても crs を正とする）。
 * crs の無い V2 の層は、保存されている値（compiled、無ければ層の直下）をそのまま使う。
 */
export function resolveTinBuildOptions(
  layer: TinBuildLayer,
  buildOptions: LayerTinBuildOptions = {},
  intent?: LayerTransformIntent,
): TinOptions | null {
  if (layer.tinEnabled === false) return null;
  const hasCrs = layer.crs !== undefined && layer.crs !== null;
  const yaxisMode = hasCrs
    ? yaxisModeFromCrs(layer.crs as CrsObject)
    : layer.compiled?.yaxisMode ?? layer.yaxisMode;
  const common: TinOptions = {
    ...(buildOptions.strictMode !== undefined ? { strictMode: buildOptions.strictMode } : {}),
    ...(buildOptions.vertexMode !== undefined ? { vertexMode: buildOptions.vertexMode } : {}),
    ...(yaxisMode !== undefined ? { yaxisMode } : {}),
  };
  const compiled = layer.compiled ?? {};
  const wantsWorldFile = intent === 'B' || (intent !== 'C' && compiled.outerTransform === 'worldFile');
  const worldFile = compiled.worldFile ?? layer.worldFile;
  if (intent === 'B' && !worldFile) throw new Error('B requires a worldFile');
  if (!hasCrs) return { useV2Algorithm: true, ...common };
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
