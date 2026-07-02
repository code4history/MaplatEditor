import Tin from '@maplat/tin';

const TIN_V2_OPTIONS = { useV2Algorithm: true };

interface TinUpdateRequest {
  gcps: any[];
  edges: any[];
  index: number;
  bounds: any;
  strict: any;
  vertex: any;
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

async function updateTin(payload: TinUpdateRequest): Promise<[number, any]> {
  const { gcps, edges, index, bounds, strict, vertex } = payload;
  if (gcps.length < 3) return [index, 'tooLessGcps'];

  const wh = index === 0 ? bounds : null;
  const bd = index !== 0 ? bounds : null;
  const tin = new Tin(TIN_V2_OPTIONS);
  if (wh) {
    tin.setWh(wh);
  } else if (bd) {
    tin.setBounds(bd);
  } else {
    throw new Error('Both wh and bounds are missing');
  }
  tin.setStrictMode(strict);
  tin.setVertexMode(vertex);
  tin.setPoints(gcps);
  tin.setEdges(edges);

  try {
    await tin.updateTinAsync();
    return [index, tin.getCompiled()];
  } catch (err) {
    const normalized = normalizeTinError(err);
    if (normalized) return [index, normalized];
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
