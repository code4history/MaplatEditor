import type { CrsEstimationInput, CrsEstimationResponse } from '../../src/types/crsEstimation';

export const OVERALL_TIMEOUT_MS = 60_000;

export type CrsEstimationRequest =
  | { type: 'estimate'; requestId: string; input: CrsEstimationInput; candidateId?: string }
  | { type: 'cancel'; requestId: string };

export type CrsEstimationWorkerResult = CrsEstimationResponse & { type: 'result' };
