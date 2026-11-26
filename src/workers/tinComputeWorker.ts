import Tin from '@maplat/tin';
import type { Options as TinOptions, BoundaryDiagnostics } from '@maplat/tin';
import { applyTinGeometry, resolveTinBuildOptions } from '../utils/tinOptions';

interface TinUpdateRequest {
  gcps: any[];
  edges: any[];
  index: number;
  bounds: any;
  strict: any;
  vertex: any;
  tinOptions?: TinOptions;
}

interface WorkerRequest {
  id: number;
  type: 'updateTin';
  payload: TinUpdateRequest;
}

function normalizeTinError(err: unknown): string | null {
  const message = String(err);
  if (message.includes('SOME POINTS OUTSIDE')) return 'pointsOutside';
  if (message.indexOf('TOO LINEAR') === 0) return 'tooLinear';
  if (
    message.includes('Vertex indices') ||
    message.includes('is degenerate!') ||
    message.includes('already exists or intersects with an existing edge!')
  ) {
    return 'edgeError';
  }
  return null;
}

async function updateTin(payload: TinUpdateRequest): Promise<[number, any, BoundaryDiagnostics | null]> {
  const { gcps, edges, index, bounds, strict, vertex, tinOptions } = payload;
  if (gcps.length < 3) return [index, 'tooLessGcps', null];

  // tinOptions があるときは、それがそのまま Tin の作り方。古い strict / vertex は無いときの代わりだけ。
  const options = tinOptions ?? resolveTinBuildOptions({}, { strictMode: strict, vertexMode: vertex }) ?? {};
  const tin = new Tin(options);
  const wh = index === 0 ? bounds : null;
  const bd = index !== 0 ? bounds : null;
  if (!applyTinGeometry(tin, options, { wh, bounds: bd })) {
    throw new Error('Both wh and bounds are missing');
  }
  tin.setPoints(gcps);
  tin.setEdges(edges);

  try {
    await tin.updateTinAsync();
    return [index, tin.getCompiled(), tin.boundaryDiagnostics ?? null];
  } catch (err) {
    const normalized = normalizeTinError(err);
    if (normalized) return [index, normalized, null];
    throw err;
  }
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, type, payload } = event.data;
  try {
    if (type !== 'updateTin') throw new Error(`Unknown worker request: ${type}`);
    const result = await updateTin(payload);
    self.postMessage({ id, result });
  } catch (err) {
    self.postMessage({ id, error: String(err instanceof Error ? err.message : err) });
  }
};
