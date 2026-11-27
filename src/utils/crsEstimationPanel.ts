import type { EstimationResult, GcpPair, RecommendationReason, TransformSetup, WorldFile } from '@c4h/teiresias';
import { recommendTransformSetup, shouldRecommendCrsSwitch } from '@c4h/teiresias';
import type { CrsObject } from '@maplat/transform';
import { worldFileToCrs } from '@maplat/transform';
import type { CrsAdoptionSelection } from './crsAdoption.ts';
import type { CrsEstimationResponse, SelectedCrsCandidate } from '../types/crsEstimation';
import { compiledGeoJsonToMercator } from './compiledGeo.ts';
import { crsToLonLat, crsToMercator, geodesicDistanceMeters } from './crsProjection.ts';

/** 変換の形の画面の並び。A〜C の記号は画面に出さず、ラベルキーだけを持つ。 */
export type TransformSetupKey = 'A' | 'B' | 'C';

/** 比較プレビューの切り替え（元の状態 / A / B / C）。 */
export type PreviewMode = 'original' | TransformSetupKey;

export const SETUP_LABEL_KEYS = {
  A: 'mapedit.crs_setup_a',
  B: 'mapedit.crs_setup_b',
  C: 'mapedit.crs_setup_c',
  legacyV2: 'mapedit.crs_setup_legacy',
} as const;

export function setupKeyOf(setup: TransformSetup): TransformSetupKey {
  if (setup === 'worldFileOnly') return 'A';
  if (setup === 'tinGlobal') return 'B';
  return 'C';
}

export function setupLabelKey(setup: TransformSetupKey | 'legacyV2' | string): string {
  if (setup === 'A' || setup === 'B' || setup === 'C' || setup === 'legacyV2') return SETUP_LABEL_KEYS[setup];
  return SETUP_LABEL_KEYS.legacyV2;
}

export type EstimationOkResponse = Extract<CrsEstimationResponse, { status: 'ok' | 'ok_with_warnings' | 'insufficient' }>;

/** 失敗（`status: 'failed'`・`selected` 無し）の結果は、部分順位があっても表示・選択・比較・採用に使わない。 */
export function usableEstimation(response: CrsEstimationResponse | null | undefined): EstimationOkResponse | null {
  if (!response || response.status === 'canceled' || response.status === 'failed') return null;
  if (!response.selected) return null;
  return response;
}

/**
 * 推定結果が古いか（§4.8: 結果が古くなった後は「推奨のまま採用」を出さない）。
 * `editGeneration` が進んだら古い。推定前（`resultGeneration` 無し）は古くはないが、結果自体が無い。
 */
export function isEstimationStale(resultGeneration: number | null, editGeneration: number): boolean {
  return resultGeneration !== null && resultGeneration !== editGeneration;
}

export interface PipelineSummary {
  candidateCount: number;
  transformableCount: number;
  fittedCount: number;
  crsLabel: string | null;
  unitName: string | null;
  yScaleSign: -1 | 1 | null;
  currentSetupKey: string;
}

export function candidateCrsLabel(candidate: { authority: string; code: string } | null | undefined): string | null {
  return candidate ? `${candidate.authority}:${candidate.code}` : null;
}

export function buildPipelineSummary(response: EstimationOkResponse, currentSetup: string): PipelineSummary {
  const selected = response.selected!;
  return {
    candidateCount: response.candidateCount,
    transformableCount: response.transformableCount,
    fittedCount: response.ranked.length,
    crsLabel: candidateCrsLabel(selected),
    unitName: selected.unit?.name ?? null,
    yScaleSign: Number.isFinite(selected.worldFile?.yScale)
      ? ((selected.worldFile.yScale < 0 ? -1 : 1) as -1 | 1)
      : null,
    currentSetupKey: setupLabelKey(currentSetup),
  };
}

export type Comparison3857 =
  | { kind: 'switch'; percent: number; crsLabel: string }
  | { kind: 'keep'; percent: number }
  | { kind: 'unavailable' };

/** 3857 の基準スコアが欠損・0 以下・非有限のときは数値差を出さない。 */
export function compare3857(
  base3857Score: number | null | undefined,
  best: { score: number | null | undefined; authority: string; code: string },
): Comparison3857 {
  if (base3857Score === null || base3857Score === undefined
    || !Number.isFinite(base3857Score) || base3857Score <= 0) return { kind: 'unavailable' };
  const bestScore = best.score;
  if (bestScore === null || bestScore === undefined || !Number.isFinite(bestScore)) return { kind: 'unavailable' };
  const percent = ((base3857Score - bestScore) / base3857Score) * 100;
  const label = candidateCrsLabel(best)!;
  return shouldRecommendCrsSwitch(bestScore, base3857Score)
    ? { kind: 'switch', percent, crsLabel: label }
    : { kind: 'keep', percent };
}

export interface CandidateRow {
  rank: number;
  id: string;
  authority: string;
  code: string;
  name: string;
  score: number | null;
  rmsMeters: number;
  unitName: string;
  diff3857Percent: number | null;
  coreCompatible: boolean;
  coreIncompatibilityReason?: string;
}

/** `ranked` は診断一覧専用。選択・比較・採用には選択候補の `selected` だけを使う。 */
export function candidateRows(
  ranked: readonly (EstimationResult['ranked'][number] & {
    id: string; name: string; coreCompatible: boolean; coreIncompatibilityReason?: string;
  })[],
  base3857Score: number | null | undefined,
): CandidateRow[] {
  const base = base3857Score !== null && base3857Score !== undefined && Number.isFinite(base3857Score) && base3857Score > 0
    ? base3857Score
    : null;
  return ranked.map((row, index) => ({
    rank: index + 1,
    id: row.id,
    authority: row.authority,
    code: row.code,
    name: row.name,
    score: row.score,
    rmsMeters: row.rmsMeters,
    unitName: row.unit?.name ?? '',
    diff3857Percent: base !== null && row.score !== null && Number.isFinite(row.score)
      ? ((base - row.score) / base) * 100
      : null,
    coreCompatible: row.coreCompatible,
    ...(row.coreIncompatibilityReason !== undefined ? { coreIncompatibilityReason: row.coreIncompatibilityReason } : {}),
  }));
}

export interface ResidualRow {
  index: number;
  measuredMerc: [number, number];
  predictedMerc: [number, number];
  distanceMeters: number;
}

/**
 * 残差（選択候補の `gcpsNew` と換算済み `worldFile` の同一変換済み点列で計算する。再換算しない）。
 * 予測 = `worldFileToCrs(worldFile, pixel)`、実測 = `gcpsNew[i].geo`、距離 = Karney 法の測地線距離。
 */
export function residualRows(
  selected: Pick<SelectedCrsCandidate, 'crs' | 'worldFile' | 'gcpsNew'>,
  gcps: readonly GcpPair[],
): ResidualRow[] {
  const rows: ResidualRow[] = [];
  for (let index = 0; index < gcps.length; index += 1) {
    const gcp = gcps[index];
    const reference = selected.gcpsNew[index];
    if (!gcp || !reference) continue;
    const predicted = worldFileToCrs(selected.worldFile as WorldFile, [gcp.pixel[0], gcp.pixel[1]]);
    const measured = reference.geo;
    const predictedLonLat = Array.isArray(predicted) ? crsToLonLat(predicted, selected.crs) : false;
    const measuredLonLat = crsToLonLat(measured, selected.crs);
    const predictedMerc = Array.isArray(predicted) ? crsToMercator(predicted, selected.crs) : false;
    const measuredMerc = crsToMercator(measured, selected.crs);
    if (predictedLonLat === false || measuredLonLat === false
      || predictedMerc === false || measuredMerc === false) continue;
    rows.push({
      index: index + 1,
      measuredMerc: [measuredMerc[0], measuredMerc[1]],
      predictedMerc: [predictedMerc[0], predictedMerc[1]],
      distanceMeters: geodesicDistanceMeters(predictedLonLat, measuredLonLat),
    });
  }
  return rows;
}

export type ResidualScaleMode = '1x' | '5x' | 'auto';

export interface ResidualArrow {
  index: number;
  distanceMeters: number;
  from: [number, number];
  to: [number, number];
}

/** 残差矢印（`#mercMap` は 3857）。倍率は 1x / 5x / 自動拡大（最大 40 画素程度）。 */
export function residualArrows(
  rows: readonly ResidualRow[],
  mode: ResidualScaleMode,
  resolution: number,
): ResidualArrow[] {
  const drawable = rows.filter((row) => Number.isFinite(row.distanceMeters));
  let factor = mode === '5x' ? 5 : 1;
  if (mode === 'auto') {
    const maxVector = Math.max(0, ...drawable.map((row) => Math.hypot(
      row.predictedMerc[0] - row.measuredMerc[0],
      row.predictedMerc[1] - row.measuredMerc[1],
    )));
    factor = maxVector > 0 && Number.isFinite(resolution) && resolution > 0
      ? (40 * resolution) / maxVector
      : 1;
  }
  return drawable.map((row) => ({
    index: row.index,
    distanceMeters: row.distanceMeters,
    from: [row.measuredMerc[0], row.measuredMerc[1]],
    to: [
      row.measuredMerc[0] + (row.predictedMerc[0] - row.measuredMerc[0]) * factor,
      row.measuredMerc[1] + (row.predictedMerc[1] - row.measuredMerc[1]) * factor,
    ],
  }));
}

export interface SetupCard {
  key: TransformSetupKey;
  recommended: boolean;
  disabled: boolean;
}

export interface SetupAdvice {
  reason: RecommendationReason;
  score: number | null;
  cards: SetupCard[];
  /** `borderline` のとき 2 案の先頭（より近い側）。 */
  borderlineSetupKey: TransformSetupKey | null;
}

/** `recommendTransformSetup` を画面のカードへ写す。A〜C を必ず並べ、推奨バッジと無効を付ける。 */
export function setupAdvice(result: EstimationResult, vertexMode: 'plain' | 'birdeye'): SetupAdvice {
  const recommendation = recommendTransformSetup(result, { vertexMode });
  const keys: TransformSetupKey[] = ['A', 'B', 'C'];
  const recommendedKeys = new Set(recommendation.setups.map(setupKeyOf));
  const birdeye = recommendation.reason === 'birdeye';
  return {
    reason: recommendation.reason,
    score: recommendation.score,
    cards: keys.map((key) => ({
      key,
      recommended: recommendedKeys.has(key),
      disabled: birdeye && key !== 'C',
    })),
    borderlineSetupKey: recommendation.reason === 'borderline' && recommendation.setups.length
      ? setupKeyOf(recommendation.setups[0])
      : null,
  };
}

/** 「この変換の形を採用」へ渡す選択。比較と採用は同じ選択（`selected`）を使う。 */
export function manualSelection(selected: SelectedCrsCandidate, setup: TransformSetupKey): CrsAdoptionSelection {
  return { selected, setup };
}

/** 選択候補 1 件から `recommendTransformSetup` の入力（`EstimationResult`）を作る。 */
export function estimationResultFor(candidate: SelectedCrsCandidate): EstimationResult {
  return {
    status: 'ok',
    selected: {
      identity: { authority: candidate.authority, code: candidate.code },
      worldFile: candidate.worldFile as WorldFile,
      unit: candidate.unit,
      score: candidate.score,
      rmsMeters: candidate.rmsMeters,
      qualityGate: candidate.qualityGate,
    },
    ranked: [],
    warnings: [],
    untransformableIds: [],
    failure: null,
  };
}

export type AdoptRecommendedDisabledReason =
  | 'estimation-failed'
  | 'no-base-score'
  | 'unavailable'
  | 'core-incompatible';

export interface RecommendedPlan {
  crsChoice: 'best' | 'base3857';
  setup: TransformSetupKey;
  reason: RecommendationReason;
  selection: CrsAdoptionSelection;
  /** `borderline` のとき採る形のラベルキー（ボタン脇の案内で使う）。 */
  borderlineSetupLabelKey: string | null;
}

export interface AdoptRecommendedInput {
  /** 全体推定の結果（`selected` が最良候補）。 */
  response: CrsEstimationResponse | null;
  /** `EPSG:3857` 単体再推定の完全な `selected`（無いときは呼び出し側で取得してから渡す）。 */
  base3857Selected: SelectedCrsCandidate | null;
  vertexMode: 'plain' | 'birdeye';
}

export interface AdoptRecommendedVerdict {
  plan: RecommendedPlan | null;
  disabled: AdoptRecommendedDisabledReason | null;
}

/**
 * 「推奨のまま採用」の採る内容（§4.8）。画面が「推奨」と示すものと 1 ビットも違わないよう、
 * 乗り換え判定（`shouldRecommendCrsSwitch`）と `recommendTransformSetup` だけから組み立てる。
 */
export function adoptRecommendedPlan(input: AdoptRecommendedInput): AdoptRecommendedVerdict {
  const usable = usableEstimation(input.response);
  if (!usable || !usable.selected) return { plan: null, disabled: 'estimation-failed' };
  const baseScore = usable.base3857Score;
  if (baseScore === null || baseScore === undefined || !Number.isFinite(baseScore) || baseScore <= 0) {
    return { plan: null, disabled: 'no-base-score' };
  }
  const best = usable.selected;
  // 画面が「推奨」と示せない（`unavailable`）ときは押せない（§4.8 押せない条件 1）
  if (setupAdvice(estimationResultFor(best), input.vertexMode).reason === 'unavailable') {
    return { plan: null, disabled: 'unavailable' };
  }
  const crsChoice: 'best' | 'base3857' = shouldRecommendCrsSwitch(best.score, baseScore) ? 'best' : 'base3857';
  const target = crsChoice === 'best' ? best : input.base3857Selected;
  if (!target) return { plan: null, disabled: 'no-base-score' };
  const advice = setupAdvice(estimationResultFor(target), input.vertexMode);
  if (advice.reason === 'unavailable' || advice.cards.every((card) => !card.recommended)) {
    return { plan: null, disabled: 'unavailable' };
  }
  if (!target.coreCompatible) return { plan: null, disabled: 'core-incompatible' };
  const setup: TransformSetupKey = advice.reason === 'birdeye'
    ? 'C'
    : (advice.borderlineSetupKey ?? advice.cards.find((card) => card.recommended)?.key ?? 'A');
  return {
    plan: {
      crsChoice,
      setup,
      reason: advice.reason,
      selection: manualSelection(target, setup),
      borderlineSetupLabelKey: advice.reason === 'borderline' ? setupLabelKey(setup) : null,
    },
    disabled: null,
  };
}

/** 推定の警告（`DiagnosticFeedback` で結果の上に出す）。 */
export function warningMessageKeys(response: CrsEstimationResponse, gcpCount: number): string[] {
  const keys: string[] = [];
  const warnings = 'warnings' in response ? response.warnings : [];
  const codes = new Set(warnings.map((warning) => warning.code));
  if (gcpCount === 3 || codes.has('insufficientPointCount')) keys.push('mapedit.crs_warning_three_gcps');
  if (codes.has('affineSkippedInsufficientDof')) keys.push('mapedit.crs_warning_affine_skipped');
  if (codes.has('nearCollinearSource') || codes.has('affineSkippedCollinear')) {
    keys.push('mapedit.crs_warning_near_collinear');
  }
  return keys;
}

export interface PreviewMeshInput {
  /** Tin の `tins.bakw`（内部の地理座標）。 */
  bakw: unknown;
  yaxisMode?: 'invert' | 'follow';
  crs?: CrsObject;
}

/**
 * B/C ベクタ比較のメッシュを 3857 へ写す。`compiledGeo.ts` の共用 helper 経由で
 * `yaxisMode === 'follow'` の y 反転を戻す（主図・副層とも同じ経路）。
 */
export function previewMeshMercator(input: PreviewMeshInput): unknown | false {
  return compiledGeoJsonToMercator(input.bakw, input.yaxisMode, input.crs);
}

export interface PreviewCornersInput {
  worldFile: WorldFile;
  crs: CrsObject;
  /** 画像側の外枠（主図は四隅、副層は `bounds` の輪）。 */
  pixelCorners: readonly (readonly number[])[];
}

/** A（ワールドファイルだけ）の比較: 画像側の外枠ポリゴンを 3857 へ写す。 */
export function previewCornerPolygonMercator(input: PreviewCornersInput): {
  type: 'Feature';
  geometry: { type: 'Polygon'; coordinates: number[][][] };
  properties: Record<string, never>;
} | null {
  const corners: number[][] = [];
  for (const pixel of input.pixelCorners) {
    const inCrs = worldFileToCrs(input.worldFile, [pixel[0], pixel[1]]);
    const merc = crsToMercator(inCrs, input.crs);
    if (merc === false) return null;
    corners.push([merc[0], merc[1]]);
  }
  if (corners.length < 3) return null;
  corners.push([...corners[0]]);
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [corners] }, properties: {} };
}

/** 画像側の外枠（主図は `[0,0]-[w,h]`、副層は `bounds` の輪）。 */
export function pixelCornersForLayer(width: number, height: number, bounds?: readonly (readonly number[])[]): number[][] {
  if (bounds && bounds.length >= 3) return bounds.map((point) => [point[0], point[1]]);
  return [[0, 0], [width, 0], [width, height], [0, height]];
}

/** 比較プレビューの入力（選択候補の `gcpsNew`・再投影した `edges_new`・換算済み `worldFile` のみ）。 */
export interface PreviewInputs {
  gcpsNew: GcpPair[];
  edgesNew: unknown[];
  worldFile: WorldFile;
}
