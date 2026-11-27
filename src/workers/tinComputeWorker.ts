import type { TinUpdateRequest, TinUpdateResult } from '../services/editorComputeBackend';
import { TinWorkerSession } from './tinWorkerSession.ts';
import type { TinWorkerRequest } from './tinWorkerProtocol.ts';

/**
 * worker 1 つにつき、層ごとの網を持つ 1 つの状態（MaplatTin#100・設計書 §9.3）。
 * 依頼は `tinWorkerSession.ts` が 1 つずつ処理する。
 */
const session = new TinWorkerSession();

/**
 * 今の `updateTin` と同じ入口と結果（全部組み直して compiled を返す）。違いは、組み直した網を層ごとに持ち続けること。
 * 出力（compiled・診断・エラー文字列）は、網を持たなかった今までと変わらない。
 */
export async function updateTin(payload: TinUpdateRequest): Promise<TinUpdateResult> {
  return (await session.rebuild(payload)).result;
}

async function handle(request: TinWorkerRequest): Promise<unknown> {
  switch (request.type) {
    case 'updateTin':
      return updateTin(request.payload);
    case 'rebuild':
      return session.rebuild(request.payload);
    case 'applyEdits':
      return session.applyEdits(request.payload);
    case 'getCompiled':
      return session.getCompiled(request.payload);
    case 'getSnapshot':
      return session.getSnapshot(request.payload);
    case 'finalize':
      return session.finalize(request.payload);
    case 'disposeLayer':
      await session.disposeLayer(request.payload.layerKey);
      return null;
    case 'dispose':
      await session.dispose();
      return null;
    default:
      throw new Error(`Unknown worker request: ${(request as { type?: unknown }).type}`);
  }
}

if (typeof self !== 'undefined') self.onmessage = async (event: MessageEvent<TinWorkerRequest>) => {
  const request = event.data;
  try {
    const result = await handle(request);
    self.postMessage({ id: request.id, result });
  } catch (err) {
    self.postMessage({ id: request.id, error: String(err instanceof Error ? err.message : err) });
  }
};
