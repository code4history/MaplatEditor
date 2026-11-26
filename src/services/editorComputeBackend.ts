import type { Options as TinOptions, BoundaryDiagnostics } from '@maplat/tin';
import type { CompiledTransformData, EdgeSet, PointSet, StrictMode, VertexMode } from '@maplat/transform';
import type { LayerTinRequest } from '../composables/useLayerTransformState';
import { reverseFollowEdgeAxis } from '../utils/compiledGeo.ts';
import { resolveTransformLayerTinOptions, seedCompiledTin } from '../utils/layerTransformIntent.ts';

export interface TinUpdateRequest {
  gcps: PointSet[];
  edges: EdgeSet[];
  index: number;
  bounds?: number[] | number[][];
  strict: StrictMode;
  vertex: VertexMode;
  tinOptions?: TinOptions;
}

export type TinUpdateResult = [number, CompiledTransformData | string, BoundaryDiagnostics | null];

export interface EditorComputeBackend {
  updateTin(request: TinUpdateRequest, isCurrent?: () => boolean): Promise<TinUpdateResult>;
  dispose(): void;
}

type PendingRequest = {
  resolve: (value: TinUpdateResult) => void;
  reject: (reason?: any) => void;
};

class WorkerEditorComputeBackend implements EditorComputeBackend {
  private worker: Worker | null = null;
  private nextID = 1;
  private readonly pending = new Map<number, PendingRequest>();

  private queue: Promise<unknown> = Promise.resolve();

  updateTin(request: TinUpdateRequest, isCurrent?: () => boolean): Promise<TinUpdateResult> {
    const next = this.queue.then(() => {
      if (isCurrent && !isCurrent()) throw new Error('三角網の生成依頼が失効しました');
      const { tinOptions } = request;
      const plainTinOptions = tinOptions ? JSON.parse(JSON.stringify(tinOptions)) : undefined;
      return this.send({ ...request, tinOptions: plainTinOptions });
    });
    // 失敗した依頼が後続の生成を止めないようにする。
    this.queue = next.catch(() => undefined);
    return next;
  }

  private send(request: TinUpdateRequest): Promise<TinUpdateResult> {
    const worker = this.getWorker();
    const id = this.nextID++;
    return new Promise<TinUpdateResult>((resolve, reject) => {
      worker.postMessage({ id, type: 'updateTin', payload: request });
      this.pending.set(id, { resolve, reject });
    });
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    for (const pending of this.pending.values()) {
      pending.reject(new Error('Editor compute worker was disposed'));
    }
    this.pending.clear();
  }

  private getWorker(): Worker {
    if (this.worker) return this.worker;
    this.worker = new Worker(new URL('../workers/tinComputeWorker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<{ id: number; result?: TinUpdateResult; error?: string }>) => {
      const { id, result, error } = event.data;
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      if (error) {
        pending.reject(new Error(error));
      } else {
        pending.resolve(result as TinUpdateResult);
      }
    };
    this.worker.onerror = (event) => {
      for (const pending of this.pending.values()) {
        pending.reject(new Error(event.message || 'Editor compute worker error'));
      }
      this.pending.clear();
    };
    return this.worker;
  }
}

export const editorComputeBackend: EditorComputeBackend = new WorkerEditorComputeBackend();

export async function buildEditorLayerTin(
  request: LayerTinRequest,
  index: number,
  compute: EditorComputeBackend['updateTin'],
) {
  if (!request.isCurrent()) throw new Error('三角網の生成依頼が失効しました');
  try {
    return await buildLayerTin(request, index, compute);
  } catch (error) {
    // 失効した依頼の失敗は結果ごと捨てられる（呼び出し側が世代で判定する）ので、そのまま投げる。
    if (!request.isCurrent()) throw error;
    // 採用は結果を文書へ書き換える操作なので、失敗は失敗のまま返す。
    if (request.kind === 'adoption') throw error;
    // 通常の編集では、生成設定の解決・worker・結果の種付けのどこで想定外の例外が出ても、他の層の保存を止めない。
    // 契約は「通常編集で保存可能な応答は tin に入れる」。master と同じ 'unknownError' の印で保存できるようにする。
    return { tin: 'unknownError' };
  }
}

async function buildLayerTin(
  request: LayerTinRequest,
  index: number,
  compute: EditorComputeBackend['updateTin'],
) {
  if (index < 0) throw new Error('対象の層が見つかりません');
  const { layer } = request;
  const { buildOptions, gcps, edges, bounds } = layer;
  const tinOptions = resolveTransformLayerTinOptions(layer);
  if (!tinOptions) throw new Error('三角網の生成設定がありません');
  // Tin は GCP を内部軸に直すが、対応線は内部軸の入力を受け取る。
  const tinEdges = tinOptions.yaxisMode === 'follow' ? reverseFollowEdgeAxis(edges) : edges;
  const [, compiled, diagnostics] = await compute({
    gcps: gcps.map(([pixel, geo]) => [pixel, geo]),
    edges: tinEdges, index, bounds,
    strict: buildOptions.strictMode, vertex: buildOptions.vertexMode, tinOptions,
  }, request.isCurrent);
  if (!request.isCurrent()) throw new Error('三角網の生成依頼が失効しました');
  if (typeof compiled === 'string') {
    if (request.kind === 'adoption') throw new Error(compiled);
    return { tin: compiled };
  }
  return { tin: seedCompiledTin(layer, compiled), diagnostics: diagnostics ?? undefined };
}
