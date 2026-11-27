import {
  createCandidateTransformer,
  initializeProjWasmRuntime,
  listProjectedCrsFromProjWasm,
} from '@c4h/atlas';
import { estimateCrs, type CandidatePoints } from '@c4h/teiresias';
import { createProj4ProjectionEngine, validateWorldFile, type CrsObject, type WorldFile } from '@maplat/transform';
import proj4 from 'proj4';
import type { CrsCandidateInfo, CrsEstimationResponse, SelectedCrsCandidate } from '../../src/types/crsEstimation';
import { OVERALL_TIMEOUT_MS, type CrsEstimationRequest, type CrsEstimationWorkerResult } from './crsEstimationProtocol.ts';

const CANDIDATE_TIMEOUT_MS = 10_000;
const LONLAT = { kind: 'lonlat_deg', axisOrder: 'lon-lat' } as const;
const BASELINE = {
  id: 'EPSG:3857',
  authority: 'EPSG',
  code: '3857',
  name: 'WGS 84 / Pseudo-Mercator',
  proj4: '+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +type=crs',
};
type Candidate = typeof BASELINE;
const projectionEngine = createProj4ProjectionEngine(proj4);

export function describeCandidate(candidate: Candidate): CrsCandidateInfo {
  const { id, authority, code, name } = candidate;
  const numericCode = Number(code);
  const epsg = authority === 'EPSG' && /^\d+$/.test(code) && Number.isSafeInteger(numericCode) && numericCode > 0
    ? numericCode
    : undefined;
  if (epsg === 3857 || epsg === 4326) return { id, authority, code, name, crs: { epsg }, coreCompatible: true };

  const terms = candidate.proj4.trim().split('+').map(term => term.trim()).filter(Boolean);
  const crs: CrsObject = { authority, code, ...(epsg === undefined ? {} : { epsg }) };
  const incompatibility = (coreIncompatibilityReason: string) => ({
    id, authority, code, name, crs, coreCompatible: false, coreIncompatibilityReason,
  });
  for (const term of terms) {
    const [rawKey, value] = term.split('=');
    const key = rawKey.toLowerCase();
    if (key === 'axis') {
      if (value !== 'enu') return incompatibility('unsupported_axis');
      continue;
    }
    if ((key === 'nadgrids' && value !== '@null') || key === 'geoidgrids' ||
        key === 'hgridshift' || key === 'vgridshift' ||
        (key === 'proj' && ['pipeline', 'hgridshift', 'vgridshift'].includes(value?.toLowerCase()))) {
      return incompatibility('unsupported_proj4');
    }
  }
  const normalized = candidate.proj4.replace(/\+axis=enu(?=\s|\+|$)/gi, '').trim();
  if (!normalized) return incompatibility('missing_proj4');
  if (!normalized.startsWith('+') || !terms.some(term => /^proj=\S/i.test(term))) {
    return incompatibility('invalid_proj4');
  }
  crs.proj4 = normalized;
  try {
    projectionEngine.validateDefinition?.(crs);
  } catch {
    return incompatibility('invalid_proj4');
  }
  return { id, authority, code, name, crs, coreCompatible: true };
}

export function toCenteredWorldFile(rawWorldFile: WorldFile): WorldFile {
  // Daedalus の角原点を、地図 JSON の左上画素の中心原点へ換算する。
  const worldFile = {
    xScale: rawWorldFile.xScale,
    xSkew: rawWorldFile.xSkew,
    ySkew: rawWorldFile.ySkew,
    yScale: rawWorldFile.yScale,
    xOrigin: rawWorldFile.xOrigin + 0.5 * rawWorldFile.xScale + 0.5 * rawWorldFile.xSkew,
    yOrigin: rawWorldFile.yOrigin + 0.5 * rawWorldFile.ySkew + 0.5 * rawWorldFile.yScale,
  };
  validateWorldFile(worldFile);
  return worldFile;
}

async function estimate(
  { requestId, input, candidateId }: Extract<CrsEstimationRequest, { type: 'estimate' }>,
  signal: AbortSignal,
): Promise<CrsEstimationResponse> {
  const { gcps, onshoreOnly = true } = input;
  const longitude = gcps.map(gcp => gcp.geo[0]);
  const latitude = gcps.map(gcp => gcp.geo[1]);
  await initializeProjWasmRuntime({ enableNetwork: false });
  signal.throwIfAborted();
  const rows: Candidate[] = await listProjectedCrsFromProjWasm({
    extent: {
      west: Math.min(...longitude), south: Math.min(...latitude),
      east: Math.max(...longitude), north: Math.max(...latitude),
    },
    onshoreOnly,
    includeCustomProjections: false,
  });
  signal.throwIfAborted();
  if (!rows.some(row => row.id === BASELINE.id)) rows.push(BASELINE);
  const candidates = candidateId === undefined ? rows : rows.filter(row => row.id === candidateId);
  if (!candidates.length) return { requestId, status: 'failed', failureReason: 'candidate_not_found' };

  const transform = createCandidateTransformer(candidates);
  const transformed = new Map<string, CandidatePoints['points']>();
  const result = await estimateCrs(gcps, candidates, {
    geoBasis: LONLAT,
    signal,
    timeoutMs: CANDIDATE_TIMEOUT_MS,
    transformer: async (id, points, basis) => {
      const converted = await transform(id, points, basis);
      if (converted) transformed.set(id, Array.isArray(converted) ? converted : converted.points);
      return converted;
    },
  });
  if (result.status === 'failed') {
    return {
      requestId, status: 'failed',
      failureReason: result.failure?.reason === 'timeout' ? 'timeout' : 'estimation_failed',
      failure: result.failure ?? undefined,
    };
  }

  const descriptions = new Map(candidates.map(row => [row.id, describeCandidate(row)]));
  let selected: SelectedCrsCandidate | null = null;
  if (result.selected) {
    const { identity, worldFile: rawWorldFile } = result.selected;
    const id = `${identity.authority}:${identity.code}`;
    let worldFile: WorldFile;
    try {
      worldFile = toCenteredWorldFile(rawWorldFile);
    } catch (error) {
      return { requestId, status: 'failed', failureReason: 'invalid_world_file', errorMessage: String(error) };
    }
    const points = transformed.get(id)!;
    selected = {
      ...result.selected,
      ...descriptions.get(id)!,
      rawWorldFile,
      worldFile,
      gcpsNew: gcps.map(({ pixel }, index) => ({ pixel, geo: points[index] })),
    };
  }
  return {
    requestId, status: result.status, selected,
    ranked: result.selected ? result.ranked.map(row => ({ ...row, ...descriptions.get(`${row.authority}:${row.code}`)! })) : [],
    warnings: result.warnings,
    untransformableIds: result.untransformableIds,
    candidateCount: candidates.length,
    transformableCount: transformed.size,
    base3857Score: result.ranked.find(row => row.authority === 'EPSG' && row.code === '3857')?.score ?? null,
  };
}

const { parentPort } = process;
if (parentPort) {
  let active: { requestId: string; controller: AbortController } | undefined;
  const send = (result: CrsEstimationResponse) => {
    const message: CrsEstimationWorkerResult = { ...result, type: 'result' };
    parentPort.postMessage(message);
  };
  parentPort.on('message', async ({ data }: { data: CrsEstimationRequest }) => {
    const { requestId } = data;
    if (data.type === 'cancel') {
      if (active?.requestId === requestId) active.controller.abort();
      return;
    }
    if (active) {
      send({ requestId, status: 'failed', failureReason: 'busy' });
      return;
    }
    const controller = new AbortController();
    active = { requestId, controller };
    const timeout = new DOMException('CRS 推定の制限時間を超えました', 'TimeoutError');
    const timer = setTimeout(() => controller.abort(timeout), OVERALL_TIMEOUT_MS);
    try {
      send(await estimate(data, controller.signal));
    } catch (error) {
      if (controller.signal.reason === timeout) send({ requestId, status: 'failed', failureReason: 'timeout' });
      else if (controller.signal.aborted) send({ requestId, status: 'canceled' });
      else send({ requestId, status: 'failed', failureReason: 'worker_error', errorMessage: String(error) });
    } finally {
      clearTimeout(timer);
      active = undefined;
    }
  });
}
