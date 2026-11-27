import type { GcpPair, WorldFile } from '@c4h/daedalus';
import type { EstimationFailure, EstimationResult } from '@c4h/teiresias';
import type { CrsObject } from '@maplat/transform';

export interface CrsEstimationInput {
  /** 画素は角原点、地理座標は WGS84 の経度・緯度順。 */
  gcps: readonly GcpPair[];
  onshoreOnly?: boolean;
}

export interface CrsCandidateInput extends CrsEstimationInput {
  candidateId: string;
}

export interface CrsCandidateInfo {
  id: string;
  authority: string;
  code: string;
  name: string;
  crs: CrsObject;
  coreCompatible: boolean;
  coreIncompatibilityReason?: string;
}

type RankedCandidate = EstimationResult['ranked'][number] & CrsCandidateInfo;

export interface SelectedCrsCandidate extends Omit<NonNullable<EstimationResult['selected']>, 'worldFile'>, CrsCandidateInfo {
  /** 角原点のワールドファイル。診断表示専用。 */
  rawWorldFile: WorldFile;
  /** 画素中心原点に換算済み。比較・採用で同じ値を使う。 */
  worldFile: WorldFile;
  /** 画素と候補 CRS へ変換した座標の組。比較・採用で同じ値を使う。 */
  gcpsNew: GcpPair[];
}

export type CrsEstimationFailureReason =
  | 'invalid_input' | 'too_many_gcps' | 'busy' | 'candidate_not_found'
  | 'worker_crashed' | 'worker_error' | 'timeout' | 'estimation_failed' | 'invalid_world_file';

export type CrsEstimationResponse =
  | {
      requestId: string;
      status: 'ok' | 'ok_with_warnings' | 'insufficient';
      selected: SelectedCrsCandidate | null;
      ranked: RankedCandidate[];
      warnings: EstimationResult['warnings'];
      untransformableIds: string[];
      candidateCount: number;
      transformableCount: number;
      base3857Score: number | null;
    }
  | { requestId: string; status: 'canceled' }
  | {
      requestId: string;
      status: 'failed';
      failureReason: CrsEstimationFailureReason;
      errorMessage?: string;
      failure?: EstimationFailure;
    };

export interface CrsEstimationAPI {
  estimate(input: CrsEstimationInput): Promise<CrsEstimationResponse>;
  estimateCandidate(input: CrsCandidateInput): Promise<CrsEstimationResponse>;
  cancel(requestId?: string): Promise<boolean>;
}
