/**
 * 三角網の状態つき worker の中身（MaplatTin#100・設計書 §9.3）。`self` に触れないので、worker の外（smoke・主スレッド）でも動く。
 *
 * 層ごとに `Tin`（網）を持ち続け、版（`TinRevisionStamp`）を付けて受け渡す。
 * - `rebuild`: 入力の全部（対応点・必須エッジ）から、新しい `Tin` を作って全部組み直し、層の網を差し替える。
 *   結果は、今の `updateTin` と同じ（出力として変えない）。
 * - `applyEdits`: 持っている網へ編集を当てる。版が合わなければ網に触らず `revisionMismatch` を返す
 *   （Editor は最新の入力の全部で `rebuild` を送り直す）。Tin が `applyEdits` を持たないうちは `unsupported`。
 * - `finalize`: 清書。局所更新の網とは別のインスタンスで全部組み直し、strict のときだけ網を差し替える。
 *   strict にならないときは、特例の保存の条件（`../utils/tinSavedMesh.ts`）で、どちらを保存するかを決める。
 * - `disposeLayer`・`dispose`: 網を捨てる。
 *
 * `applyEdits` は Tin の `incremental` スイッチ（`TinUpdateRequest#incrementalEdits`）が入っているときだけ局所で済む。
 * 切れていると、Tin は常に全部組み直す（`fallbackReason: "noMesh"`）。
 */
import Tin from '@maplat/tin';
import type { Options as TinOptions } from '@maplat/tin';
import type { CompiledTransformData } from '@maplat/transform';
import type { TinUpdateRequest, TinUpdateResult } from '../services/editorComputeBackend';
import { applyTinGeometry, resolveTinBuildOptions } from '../utils/tinOptions.ts';
import { decideSavedMesh, withMeshOrigin } from '../utils/tinSavedMesh.ts';
import type { SpecialSaveEvidence } from '../utils/tinSavedMesh.ts';
import type {
  TinApplyEditsRequest,
  TinApplyEditsResponse,
  TinFinalizeRequest,
  TinFinalizeResponse,
  TinMeshSnapshot,
  TinPatch,
  TinRebuildResponse,
  TinRevisionStamp,
} from './tinWorkerProtocol.ts';

export function normalizeTinError(err: unknown): string | null {
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

interface LayerEntry {
  tin: Tin;
  /** 結果の先頭に付ける層の番号（`TinUpdateResult` の 0 番目） */
  index: number;
  generation: number;
  /** 最後の清書から重ねた局所更新の回数（特例の保存の診断） */
  editsSinceRebuild: number;
}

export interface TinWorkerSessionOptions {
  /** Tin の作り方（試験で差し替える）。既定は `new Tin(options)` */
  createTin?: (options: TinOptions) => Tin;
  /**
   * 特例の保存（§9.5）の条件の証拠を集める口。保存の直前に、網の全部を数え直して集める。
   * Tin の `restoreMesh`・帯の差し替え・全数の確かめ（第 2 段 b）が入るまでは、集められない（undefined）。
   */
  collectEvidence?: (tin: Tin) => SpecialSaveEvidence | undefined;
}

type Built =
  | { ok: true; tin: Tin; compiled: CompiledTransformData; result: TinUpdateResult }
  | { ok: false; result: TinUpdateResult };

/** 今の `updateTin` と同じ手順で、新しい `Tin` を作って全部組み直す。 */
async function buildTin(request: TinUpdateRequest, createTin: (options: TinOptions) => Tin): Promise<Built> {
  const { gcps, edges, index, bounds, strict, vertex, tinOptions } = request;
  if (gcps.length < 3) return { ok: false, result: [index, 'tooLessGcps', null] };

  // tinOptions があるときは、それがそのまま Tin の作り方。古い strict / vertex は無いときの代わりだけ。
  const options = tinOptions ?? resolveTinBuildOptions({}, { strictMode: strict, vertexMode: vertex }) ?? {};
  // 局所更新のスイッチが入っているときだけ、網を取り込ませる（出力の compiled は、切っても入れても同じ）。
  const buildOptions = request.incrementalEdits ? { ...options, incremental: true } : options;
  const tin = createTin(buildOptions) as Tin;
  const wh = index === 0 ? bounds as number[] | undefined : undefined;
  const bd = index !== 0 ? bounds as number[][] | undefined : undefined;
  if (!applyTinGeometry(tin, options, { wh, bounds: bd })) {
    throw new Error('Both wh and bounds are missing');
  }
  tin.setPoints(gcps);
  tin.setEdges(edges);

  try {
    await tin.updateTinAsync();
    const compiled = tin.getCompiled();
    return { ok: true, tin, compiled, result: [index, compiled, tin.boundaryDiagnostics ?? null] };
  } catch (err) {
    const normalized = normalizeTinError(err);
    if (normalized) return { ok: false, result: [index, normalized, null] };
    throw err;
  }
}

/** 局所更新の網（`Tin#incrementalMesh`）から、頂点表 + 三角形の全部を作る。網を持たなければ undefined。 */
export function snapshotFromTin(tin: Tin, compiled: CompiledTransformData, boundaryStale = false): TinMeshSnapshot | undefined {
  const model = tin.incrementalMesh;
  if (!model) return undefined;
  const { mesh } = model;
  const refOf = (vertex: number) => mesh.vertices.get(vertex)!.ref;
  const snapshot: TinMeshSnapshot = {
    // 座標は写す（網の内部の配列を、表示用の網と共有しない）
    vertices: [...mesh.vertices.values()].map(({ ref, forw, bakw }) => ({ ref, forw: [...forw], bakw: [...bakw] })),
    triangles: [...mesh.triangles.entries()].map(([id, [a, b, c]]) => ({ id, vertices: [refOf(a), refOf(b), refOf(c)] })),
    badTriangles: [...mesh.bad],
    boundaryStale,
  };
  const withParams = compiled as CompiledTransformData & {
    centroid_point?: [number[], number[]];
    vertices_params?: number[][];
    supplementPairs?: NonNullable<TinMeshSnapshot['supplementPairs']>;
  };
  if (withParams.centroid_point) {
    snapshot.centroid = { forw: [...withParams.centroid_point[0]], bakw: [...withParams.centroid_point[1]] };
  }
  if (withParams.vertices_params) snapshot.verticesParams = withParams.vertices_params.map((row) => [...row]);
  if (withParams.supplementPairs) snapshot.supplementPairs = structuredClone(withParams.supplementPairs);
  return snapshot;
}

export class TinWorkerSession {
  private readonly layers = new Map<string, LayerEntry>();
  private generationCounter = 0;
  private chain: Promise<unknown> = Promise.resolve();
  private readonly createTin: (options: TinOptions) => Tin;
  private readonly collectEvidence?: TinWorkerSessionOptions['collectEvidence'];

  constructor(options: TinWorkerSessionOptions = {}) {
    this.createTin = options.createTin ?? ((tinOptions) => new Tin(tinOptions));
    this.collectEvidence = options.collectEvidence;
  }

  /** 層の鍵。指定が無ければ層の番号。 */
  static layerKeyOf(request: Pick<TinUpdateRequest, 'layerKey' | 'index'>): string {
    return request.layerKey ?? String(request.index);
  }

  /** 持っている層の鍵（試験・診断用）。 */
  layerKeys(): string[] {
    return [...this.layers.keys()];
  }

  /** 層の今の版。網を持たなければ undefined。 */
  stampOf(layerKey: string): TinRevisionStamp | undefined {
    const entry = this.layers.get(layerKey);
    return entry && this.stamp(entry);
  }

  /** 層が持つ `Tin`（試験・診断用。呼び出し側は、網を書き換えないこと）。 */
  peekTin(layerKey: string): Tin | undefined {
    return this.layers.get(layerKey)?.tin;
  }

  /** 依頼は 1 つずつ処理する（同じ層の `rebuild` が追い越し合わないように）。 */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = this.chain.then(task, task);
    this.chain = next.catch(() => undefined);
    return next;
  }

  private stamp(entry: LayerEntry): TinRevisionStamp {
    return { generation: entry.generation, revision: entry.tin.revision };
  }

  private adopt(layerKey: string, built: Extract<Built, { ok: true }>, request: TinUpdateRequest): LayerEntry {
    const entry: LayerEntry = {
      tin: built.tin,
      index: request.index,
      generation: ++this.generationCounter,
      editsSinceRebuild: 0,
    };
    this.layers.set(layerKey, entry);
    return entry;
  }

  /** 全部組み直して、層の網を差し替える。結果は、今の `updateTin` と同じ。 */
  rebuild(request: TinUpdateRequest): Promise<TinRebuildResponse> {
    return this.enqueue(async () => {
      const layerKey = TinWorkerSession.layerKeyOf(request);
      // 組み直しに失敗したときに、古い網が残らないようにする
      this.layers.delete(layerKey);
      const built = await buildTin(request, this.createTin);
      if (!built.ok) return { result: built.result };
      const entry = this.adopt(layerKey, built, request);
      const snapshot = request.incrementalEdits ? snapshotFromTin(built.tin, built.compiled) : undefined;
      return { result: built.result, stamp: this.stamp(entry), ...(snapshot ? { snapshot } : {}) };
    });
  }

  /** 持っている網へ編集を当てる。版が合わなければ、網に触らずに返す。 */
  applyEdits(request: TinApplyEditsRequest): Promise<TinApplyEditsResponse> {
    return this.enqueue(async (): Promise<TinApplyEditsResponse> => {
      const entry = this.layers.get(request.layerKey);
      if (!entry) return { status: 'noMesh' };
      const current = this.stamp(entry);
      if (request.base.generation !== current.generation || request.base.revision !== current.revision) {
        return { status: 'revisionMismatch', current };
      }
      const { tin } = entry;
      // 入れ替えた Tin が applyEdits を持たない（古い版・試験の差し替え）ときは、局所更新を使わない
      if (typeof tin.applyEdits !== 'function') return { status: 'unsupported' };
      let patch: TinPatch;
      try {
        patch = tin.applyEdits(request.edits, request.base.revision);
      } catch (err) {
        // 網は途中の状態かもしれない。捨てて、Editor に rebuild を送り直させる
        this.layers.delete(request.layerKey);
        return { status: 'failed', message: String(err instanceof Error ? err.message : err) };
      }
      if (patch.fallbackReason === 'revisionMismatch') {
        return { status: 'revisionMismatch', current: this.stamp(entry) };
      }
      if (patch.mode === 'local') {
        entry.editsSinceRebuild++;
        return { status: 'patched', stamp: this.stamp(entry), patch };
      }
      // 全部組み直しへ落ちた。Tin の中の網は作り直されているので、新しい世代にして、全部を返す
      entry.generation = ++this.generationCounter;
      entry.editsSinceRebuild = 0;
      const compiled = tin.getCompiled();
      const snapshot = snapshotFromTin(tin, compiled);
      const full: TinRebuildResponse = {
        result: [entry.index, compiled, tin.boundaryDiagnostics ?? null],
        stamp: this.stamp(entry),
        ...(snapshot ? { snapshot } : {}),
      };
      return { status: 'patched', stamp: this.stamp(entry), patch, full };
    });
  }

  /**
   * 清書（§9.3 の 3）。局所更新の網とは別のインスタンスで全部組み直し、strict のときだけ、層の網を差し替える。
   * strict にならなかったときは、層の網を保ち、どちらを保存するかを決める（§9.5）。
   */
  finalize(finalizeRequest: TinFinalizeRequest): Promise<TinFinalizeResponse> {
    return this.enqueue(async (): Promise<TinFinalizeResponse> => {
      const { request } = finalizeRequest;
      const layerKey = TinWorkerSession.layerKeyOf(request);
      const built = await buildTin(request, this.createTin);
      const kept = this.layers.get(layerKey);
      if (!built.ok) {
        // 入力が不正で、網が作れない。保存するのも、そのエラー（今と同じ）。局所更新の網は触らない
        return {
          result: built.result,
          decision: { source: 'rebuild', reason: 'rebuildFailed' },
          replaced: false,
          ...(kept ? { stamp: this.stamp(kept) } : {}),
        };
      }
      const status = built.compiled.strict_status;
      if (status === 'strict') {
        const entry = this.adopt(layerKey, built, request);
        const snapshot = request.incrementalEdits ? snapshotFromTin(built.tin, built.compiled) : undefined;
        return {
          result: built.result,
          decision: { source: 'rebuild', reason: 'rebuildStrict' },
          replaced: true,
          stamp: this.stamp(entry),
          ...(snapshot ? { snapshot } : {}),
        };
      }
      // strict にならなかった清書の網は捨てる（局所更新の網を、清書の strict_error で上書きしない）
      const evidence = kept ? this.collectEvidence?.(kept.tin) : undefined;
      const decision = decideSavedMesh({
        rebuildStatus: status,
        rebuildKinks: built.compiled.kinks_points?.length ?? 0,
        evidence: evidence && { ...evidence, editsSinceRebuild: kept!.editsSinceRebuild },
      });
      if (decision.source === 'incremental' && kept) {
        // 特例の保存: 局所更新の網から書いた compiled に印を付けて保存する。診断に、清書の結果との違いを残す
        const diagnostics = { ...(kept.tin.boundaryDiagnostics ?? {}), incremental: decision.diagnostics };
        return {
          result: [kept.index, withMeshOrigin(kept.tin.getCompiled()), diagnostics as TinUpdateResult[2]],
          decision: { source: 'incremental', reason: decision.reason },
          replaced: false,
          stamp: this.stamp(kept),
        };
      }
      return {
        result: built.result,
        decision: { source: 'rebuild', reason: decision.reason },
        replaced: false,
        ...(kept ? { stamp: this.stamp(kept) } : {}),
      };
    });
  }

  disposeLayer(layerKey: string): Promise<void> {
    return this.enqueue(async () => {
      this.layers.delete(layerKey);
    });
  }

  dispose(): Promise<void> {
    return this.enqueue(async () => {
      this.layers.clear();
    });
  }
}
