import type { CrsObject, WorldFileSurface } from '@maplat/transform';
import { crsToMercator, mercatorToCrs } from './crsProjection.ts';

/**
 * 層の座標変換の入口。主図・副層の別なく、画面からは「メルカトル ⇄ 画像座標」だけを見る。
 *
 * - `surface`: Plan A（`tinEnabled: false`）の WorldFileSurface。あればこちらを使う。
 * - `tin`: Tin のインスタンス、または生成エラーの文字列（`'tooLessGcps'` など）、未生成なら undefined。
 * - `crs`: 層の CRS。Tin は層の CRS の座標を受け取るので、メルカトルとの間に挟む。
 */
export interface LayerCoordTarget {
  surface: WorldFileSurface | null;
  tin: unknown;
  crs?: CrsObject;
}

interface TransformableTin {
  strict_status?: string;
  transform(coord: number[], backward?: boolean): number[] | false;
}

function transformableTin(tin: unknown): TransformableTin | null {
  return tin && typeof tin === 'object' && typeof (tin as TransformableTin).transform === 'function'
    ? tin as TransformableTin
    : null;
}

/** メルカトル → 画像座標（Tin の逆変換）。変換できないときは false。 */
export function transformMercatorToXy(mercator: number[], target: LayerCoordTarget): number[] | false {
  if (target.surface) return target.surface.transform(mercator, true);
  const tin = transformableTin(target.tin);
  if (!tin) return false;
  // strict_error の Tin は逆変換が成立せず例外を投げる（編集中は日常的に起きる）。
  // 呼び出し側（ホームマーカー・テストクリックなど）は false を「画像側に表示しない」と扱う。
  if (tin.strict_status === 'strict_error') return false;
  const native = mercatorToCrs(mercator, target.crs);
  return native === false ? false : tin.transform(native, true);
}

/** 画像座標 → メルカトル（Tin の順変換）。変換できないときは false。 */
export function transformXyToMercator(xy: number[], target: LayerCoordTarget): number[] | false {
  if (target.surface) return target.surface.transform(xy, false);
  const tin = transformableTin(target.tin);
  if (!tin) return false;
  const native = tin.transform(xy, false);
  return native === false ? false : crsToMercator(native, target.crs);
}
