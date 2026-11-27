import type { Options as TinOptions, BoundaryDiagnostics } from '@maplat/tin';
import type { CompiledTransformData, EdgeSet, PointSet, StrictMode, VertexMode } from '@maplat/transform';
import type { LayerTinRequest, TransformLayer } from '../composables/useLayerTransformState';
import { reverseFollowEdgeAxis } from '../utils/compiledGeo.ts';
import { resolveTransformLayerTinOptions, seedCompiledTin } from '../utils/layerTransformIntent.ts';
import type { TinDisplayMesh } from '../utils/tinDisplayMesh.ts';
import type {
  TinApplyEditsRequest,
  TinApplyEditsResponse,
  TinCompiledRequest,
  TinCompiledResponse,
  TinEdit,
  TinFinalizeRequest,
  TinFinalizeResponse,
  TinRebuildResponse,
  TinSnapshotRequest,
  TinSnapshotResponse,
} from '../workers/tinWorkerProtocol.ts';
import { LayerTinSync, StaleRequestError } from './tinEditSync.ts';
import type { DisplayChange, TinComputeTransport, TinEditOutcome, TinRefreshOutcome } from './tinEditSync.ts';

export interface TinUpdateRequest {
  gcps: PointSet[];
  edges: EdgeSet[];
  index: number;
  bounds?: number[] | number[][];
  strict: StrictMode;
  vertex: VertexMode;
  tinOptions?: TinOptions;
  /** worker が網を持ち続ける層の鍵（層の id）。無ければ層の番号 */
  layerKey?: string;
  /**
   * 局所更新の網を取り込ませ、表示用の網の全部（頂点表 + 三角形）を返させる（Editor の `incrementalEdits`）。
   * 既定は切で、切ったときは今と同じ（compiled は、切っても入れても同じ）。
   */
  incrementalEdits?: boolean;
}

export type TinUpdateResult = [number, CompiledTransformData | string, BoundaryDiagnostics | null];

export interface EditorComputeBackend {
  updateTin(request: TinUpdateRequest, isCurrent?: () => boolean): Promise<TinUpdateResult>;
  /**
   * 編集の差分を当てる。差分で済めば表示用の網へ当て、済まなければ（版が合わない・網が無い、など）
   * `latestRequest`（最新の入力の全部）で `rebuild` を送り直す。
   */
  applyEdits(layerKey: string, edits: TinEdit[], latestRequest: TinUpdateRequest, isCurrent?: () => boolean): Promise<TinEditOutcome>;
  /**
   * Editor の対応点・必須エッジの配列を、worker の網へ反映する。前の入力との差から編集を作って当て、局所で済めば
   * 三角形分けをせずに compiled を返す。済まなければ全部組み直す。
   */
  refreshTin(request: TinUpdateRequest, isCurrent?: () => boolean): Promise<TinRefreshOutcome>;
  /** 清書（別のインスタンスで全部組み直し、strict のときだけ網を差し替える） */
  finalize(request: TinUpdateRequest, isCurrent?: () => boolean): Promise<TinFinalizeResponse>;
  /** 表示用の網が変わったときの通知を受ける。戻り値で、購読をやめる */
  onDisplayChange(layerKey: string, listener: (change: DisplayChange) => void): () => void;
  /** 画面が三角網を描くための、層の表示用の網 */
  displayMesh(layerKey: string): TinDisplayMesh | undefined;
  disposeLayer(layerKey: string): Promise<void>;
  /** 持っている層の網を、全部捨てる（地図を開き直したとき） */
  disposeAllLayers(): Promise<void>;
  dispose(): void;
}

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason?: any) => void;
};

class WorkerEditorComputeBackend implements EditorComputeBackend {
  private worker: Worker | null = null;
  private nextID = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly syncs = new Map<string, LayerTinSync>();

  private queue: Promise<unknown> = Promise.resolve();

  /** worker との通信。依頼は 1 つずつ送り、失効した依頼は送らない。 */
  private readonly transport: TinComputeTransport = {
    rebuild: (request, isCurrent) => this.enqueue(isCurrent, () => this.send<TinRebuildResponse>('rebuild', this.plain(request))),
    applyEdits: (request, isCurrent) => this.enqueue(isCurrent, () => this.send<TinApplyEditsResponse>('applyEdits', request)),
    getCompiled: (request, isCurrent) => this.enqueue(isCurrent, () => this.send<TinCompiledResponse>('getCompiled', request)),
    getSnapshot: (request, isCurrent) => this.enqueue(isCurrent, () => this.send<TinSnapshotResponse>('getSnapshot', request)),
    finalize: (request, isCurrent) =>
      this.enqueue(isCurrent, () => this.send<TinFinalizeResponse>('finalize', { ...request, request: this.plain(request.request) })),
    // worker がまだ無ければ、捨てる網も無い（捨てるためだけに worker を立てない）
    disposeLayer: async (layerKey) => {
      if (!this.worker) return;
      await this.enqueue(undefined, () => this.send<null>('disposeLayer', { layerKey }));
    },
  };

  updateTin(request: TinUpdateRequest, isCurrent?: () => boolean): Promise<TinUpdateResult> {
    return this.syncOf(request).rebuild(request, isCurrent);
  }

  applyEdits(layerKey: string, edits: TinEdit[], latestRequest: TinUpdateRequest, isCurrent?: () => boolean): Promise<TinEditOutcome> {
    return this.syncOf({ ...latestRequest, layerKey }).edit(edits, latestRequest, isCurrent);
  }

  refreshTin(request: TinUpdateRequest, isCurrent?: () => boolean): Promise<TinRefreshOutcome> {
    return this.syncOf(request).refresh(request, isCurrent);
  }

  finalize(request: TinUpdateRequest, isCurrent?: () => boolean): Promise<TinFinalizeResponse> {
    return this.syncOf(request).finalize(request, isCurrent);
  }

  onDisplayChange(layerKey: string, listener: (change: DisplayChange) => void): () => void {
    // 層の同期は、最初の依頼で作られる。購読は、その前でもできるように、先に作る
    let sync = this.syncs.get(layerKey);
    if (!sync) {
      sync = new LayerTinSync(this.transport, layerKey);
      this.syncs.set(layerKey, sync);
    }
    return sync.onDisplayChange(listener);
  }

  displayMesh(layerKey: string): TinDisplayMesh | undefined {
    return this.syncs.get(layerKey)?.display;
  }

  async disposeLayer(layerKey: string): Promise<void> {
    const sync = this.syncs.get(layerKey);
    this.syncs.delete(layerKey);
    await sync?.dispose();
  }

  async disposeAllLayers(): Promise<void> {
    await Promise.all([...this.syncs.keys()].map((layerKey) => this.disposeLayer(layerKey)));
  }

  private syncOf(request: Pick<TinUpdateRequest, 'layerKey' | 'index'>): LayerTinSync {
    const layerKey = request.layerKey ?? String(request.index);
    let sync = this.syncs.get(layerKey);
    if (!sync) {
      sync = new LayerTinSync(this.transport, layerKey);
      this.syncs.set(layerKey, sync);
    }
    return sync;
  }

  private plain(request: TinUpdateRequest): TinUpdateRequest {
    const { tinOptions } = request;
    const plainTinOptions = tinOptions ? JSON.parse(JSON.stringify(tinOptions)) : undefined;
    return { ...request, tinOptions: plainTinOptions };
  }

  private enqueue<T>(isCurrent: (() => boolean) | undefined, task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(() => {
      if (isCurrent && !isCurrent()) throw new StaleRequestError();
      return task();
    });
    // 失敗した依頼が後続の生成を止めないようにする。
    this.queue = next.catch(() => undefined);
    return next;
  }

  private send<T>(
    type: 'rebuild' | 'applyEdits' | 'getCompiled' | 'getSnapshot' | 'finalize' | 'disposeLayer',
    payload: TinUpdateRequest | TinApplyEditsRequest | TinCompiledRequest | TinSnapshotRequest | TinFinalizeRequest | { layerKey: string },
  ): Promise<T> {
    const worker = this.getWorker();
    const id = this.nextID++;
    return new Promise<T>((resolve, reject) => {
      worker.postMessage({ id, type, payload });
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
    });
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    for (const pending of this.pending.values()) {
      pending.reject(new Error('Editor compute worker was disposed'));
    }
    this.pending.clear();
    // worker の網は、worker ごと無くなった。主スレッドの版と表示用の網も捨てる
    this.syncs.clear();
  }

  private getWorker(): Worker {
    if (this.worker) return this.worker;
    this.worker = new Worker(new URL('../workers/tinComputeWorker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<{ id: number; result?: unknown; error?: string }>) => {
      const { id, result, error } = event.data;
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      if (error) {
        pending.reject(new Error(error));
      } else {
        pending.resolve(result);
      }
    };
    this.worker.onerror = (event) => {
      for (const pending of this.pending.values()) {
        pending.reject(new Error(event.message || 'Editor compute worker error'));
      }
      this.pending.clear();
      // worker が落ちた。網は無くなったので、版も捨てる（次の編集は noMesh → rebuild になる）。購読は保つ
      for (const sync of this.syncs.values()) sync.reset();
    };
    return this.worker;
  }
}

export const editorComputeBackend: EditorComputeBackend = new WorkerEditorComputeBackend();

/** 層の三角網が、どの手順で作られた compiled か。 */
export type TinOrigin =
  /** 全部組み直し（清書と同じ手順の産物。保存してよい） */
  | 'rebuild'
  /** 局所更新の網から書き出した compiled（保存の前に清書する） */
  | 'incremental';

export interface BuildEditorLayerTinOptions {
  /** 設定 incrementalEdits。入っているときだけ、依頼に印を付ける（切れていれば、依頼は今と同じ形） */
  incrementalEdits?: boolean;
  /** 局所更新の入口（`EditorComputeBackend#refreshTin`）。あれば、編集の依頼（採用以外）で、`compute` の代わりに使う */
  refresh?: EditorComputeBackend['refreshTin'];
  /** 結果が、どの手順の産物かを知らせる（保存の前の清書が要るかの判断に使う） */
  onBuilt?: (layerId: string, origin: TinOrigin) => void;
  /** 採用の候補の計算が終わった（候補の鍵の網を捨てる）。候補は、層の網とは別の鍵で作るので、採用しなかった候補が層の網を汚さない */
  releaseCandidate?: (layerKey: string) => void;
}

/** 採用（CRS の試し）の候補を計算する鍵。層の網（同じ層の id の鍵）とは別にする。 */
export const adoptionCandidateKey = (layerId: string) => `${layerId}#adoption`;

export async function buildEditorLayerTin(
  request: LayerTinRequest,
  index: number,
  compute: EditorComputeBackend['updateTin'],
  options: BuildEditorLayerTinOptions = {},
) {
  if (!request.isCurrent()) throw new Error('三角網の生成依頼が失効しました');
  try {
    return await buildLayerTin(request, index, compute, options);
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

/** 層の文書から、worker への依頼（入力の全部）を作る。 */
function tinRequestOf(layer: TransformLayer, layerId: string, index: number): TinUpdateRequest {
  if (index < 0) throw new Error('対象の層が見つかりません');
  const { buildOptions, gcps, edges, bounds } = layer;
  const tinOptions = resolveTransformLayerTinOptions(layer);
  if (!tinOptions) throw new Error('三角網の生成設定がありません');
  // Tin は GCP を内部軸に直すが、対応線は内部軸の入力を受け取る。
  const tinEdges = tinOptions.yaxisMode === 'follow' ? reverseFollowEdgeAxis(edges) : edges;
  return {
    gcps: gcps.map(([pixel, geo]) => [pixel, geo]),
    edges: tinEdges, index, bounds, layerKey: layerId,
    strict: buildOptions.strictMode, vertex: buildOptions.vertexMode, tinOptions,
  };
}

async function buildLayerTin(
  request: LayerTinRequest,
  index: number,
  compute: EditorComputeBackend['updateTin'],
  options: BuildEditorLayerTinOptions,
) {
  const { layer } = request;
  // 採用は、層の網とは別の鍵で計算し、網を持たせない（採用しなかった候補が、worker の層の網を差し替えない）
  const candidate = request.kind === 'adoption';
  const input = tinRequestOf(layer, candidate ? adoptionCandidateKey(request.layerId) : request.layerId, index);
  const incremental = options.incrementalEdits && !candidate ? { incrementalEdits: true as const } : {};
  let compiled: CompiledTransformData | string;
  let diagnostics: BoundaryDiagnostics | null;
  // 結果がどの手順の産物か。変わらなかった（unchanged）ときは、前のまま（知らせない）
  let origin: TinOrigin | undefined = 'rebuild';
  if (options.incrementalEdits && options.refresh && request.kind === 'edit') {
    const outcome = await options.refresh({ ...input, ...incremental }, request.isCurrent);
    [, compiled, diagnostics] = outcome.result;
    origin = outcome.kind === 'patched' ? 'incremental' : outcome.kind === 'rebuilt' ? 'rebuild' : undefined;
  } else {
    try {
      [, compiled, diagnostics] = await compute({ ...input, ...incremental }, request.isCurrent);
    } finally {
      if (candidate) options.releaseCandidate?.(input.layerKey!);
    }
  }
  if (!request.isCurrent()) throw new Error('三角網の生成依頼が失効しました');
  if (origin) options.onBuilt?.(request.layerId, origin);
  if (typeof compiled === 'string') {
    if (request.kind === 'adoption') throw new Error(compiled);
    return { tin: compiled };
  }
  return { tin: seedCompiledTin(layer, compiled), diagnostics: diagnostics ?? undefined };
}

/**
 * 清書（§9.3 の 3）。層の今の入力の全部で、別のインスタンスに全部組み直させる。strict でなければ、worker の網は保たれる。
 * 結果は、保存してよい三角網（`buildEditorLayerTin` の結果と同じ形）。
 */
export async function finalizeEditorLayerTin(
  request: { layer: TransformLayer; layerId: string; isCurrent(): boolean },
  index: number,
  finalize: EditorComputeBackend['finalize'],
  options: { incrementalEdits?: boolean } = {},
) {
  const { layer } = request;
  const input = { ...tinRequestOf(layer, request.layerId, index), ...(options.incrementalEdits ? { incrementalEdits: true as const } : {}) };
  const response = await finalize(input, request.isCurrent);
  const [, compiled, diagnostics] = response.result;
  if (typeof compiled === 'string') return { tin: compiled, decision: response.decision };
  return { tin: seedCompiledTin(layer, compiled), diagnostics: diagnostics ?? undefined, decision: response.decision };
}
