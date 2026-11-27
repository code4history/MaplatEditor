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
import { decideSavedMesh } from '../utils/tinSavedMesh.ts';
import { applyEditsToTracked, trackInputs } from '../utils/tinEditPlanner.ts';
import type { PlannerEdge, TrackedInputs } from '../utils/tinEditPlanner.ts';
import type { IncrementalEvidence } from '../utils/tinSavedMesh.ts';
import type {
  TinRestoreRequest,
  TinRestoreResponse,
  TinSnapshotRequest,
  TinSnapshotResponse,
  TinCompiledRequest,
  TinCompiledResponse,
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
  /**
   * 網が持っている入力（対応点・必須エッジ。外の座標系）の写し。`rebuild` の入力から始め、`applyEdits` の編集を当てて進める。
   * 清書を頼まれたときに、依頼の入力と同じ網か（特例の保存に使ってよいか）を確かめるのに使う。写せなくなったら undefined。
   */
  inputs: TrackedInputs | undefined;
}

export interface TinWorkerSessionOptions {
  /** Tin の作り方（試験で差し替える）。既定は `new Tin(options)` */
  createTin?: (options: TinOptions) => Tin;
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
  // 局所更新のスイッチが入っているときだけ、網を取り込ませ、帯の更新を許す（出力の compiled は、切っても入れても同じ）。
  // `incrementalRebuild`（繰り返しの置き換え。出力が変わりうる）は入れない
  const buildOptions = request.incrementalEdits ? { ...options, incremental: true, incrementalBand: true } : options;
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
  };
  if (withParams.centroid_point) {
    snapshot.centroid = { forw: [...withParams.centroid_point[0]], bakw: [...withParams.centroid_point[1]] };
  }
  if (withParams.vertices_params) snapshot.verticesParams = withParams.vertices_params.map((row) => [...row]);
  // 補完点の対は、添字ではなく頂点の指し方で持つ（点の削除・追加で、添字はずれる）
  if (model.supplements.length > 0) {
    snapshot.supplementPairs = model.supplements.map(({ vertex, kind, edge, anchor }) => ({
      node: { ...refOf(vertex) },
      kind,
      edge: [{ ...refOf(edge[0]) }, { ...refOf(edge[1]) }],
      ...(anchor === undefined ? {} : { anchor: { ...refOf(anchor) } }),
    }));
  }
  return snapshot;
}

const samePosition = (a: number[], b: number[]) => a[0] === b[0] && a[1] === b[1];
const sameNodes = (a: number[][], b: number[][]) => a.length === b.length && a.every((p, i) => samePosition(p, b[i]));

/** 網が持っている入力の写しが、清書の依頼の入力（対応点・必須エッジ。外の座標系）と同じか。 */
function inputsMatchRequest(tracked: TrackedInputs, request: TinUpdateRequest): boolean {
  if (tracked.points.length !== request.gcps.length || tracked.edges.length !== request.edges.length) return false;
  for (let i = 0; i < tracked.points.length; i++) {
    const [forw, bakw] = request.gcps[i];
    if (!samePosition(tracked.points[i][0], forw) || !samePosition(tracked.points[i][1], bakw)) return false;
  }
  for (let i = 0; i < tracked.edges.length; i++) {
    const [forwNodes, bakwNodes, [start, end]] = request.edges[i] as PlannerEdge;
    const [trackedForw, trackedBakw, [trackedStart, trackedEnd]] = tracked.edges[i];
    if (start !== trackedStart || end !== trackedEnd || !sameNodes(trackedForw, forwNodes) || !sameNodes(trackedBakw, bakwNodes)) return false;
  }
  return true;
}

export class TinWorkerSession {
  private readonly layers = new Map<string, LayerEntry>();
  private generationCounter = 0;
  private chain: Promise<unknown> = Promise.resolve();
  private readonly createTin: (options: TinOptions) => Tin;

  constructor(options: TinWorkerSessionOptions = {}) {
    this.createTin = options.createTin ?? ((tinOptions) => new Tin(tinOptions));
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

  private stampMatches(entry: LayerEntry, base: TinRevisionStamp): boolean {
    const current = this.stamp(entry);
    return base.generation === current.generation && base.revision === current.revision;
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
      inputs: trackInputs(request.gcps, request.edges as PlannerEdge[]),
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
      // 局所更新のスイッチが切なら、網は持ち続けない（使い道が無く、層ごとに大きなメモリを占めるため）
      if (!built.ok || !request.incrementalEdits) return { result: built.result };
      const entry = this.adopt(layerKey, built, request);
      const snapshot = snapshotFromTin(built.tin, built.compiled);
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
      entry.index = request.index;
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
      // 入力の写しにも、同じ編集を当てる（当てられなければ、写せなくなったとして、特例の保存の候補にしない）
      entry.inputs = entry.inputs && applyEditsToTracked(entry.inputs, request.edits);
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

  /** 網の今の状態から compiled を書き出す。網にも版にも触らない（局所更新の後に、主スレッドの Tin を作り直すのに使う）。 */
  getCompiled(request: TinCompiledRequest): Promise<TinCompiledResponse> {
    return this.enqueue(async (): Promise<TinCompiledResponse> => {
      const entry = this.layers.get(request.layerKey);
      if (!entry) return { status: 'noMesh' };
      const current = this.stamp(entry);
      if (request.base.generation !== current.generation || request.base.revision !== current.revision) {
        return { status: 'revisionMismatch', current };
      }
      entry.index = request.index;
      const { tin } = entry;
      return {
        status: 'ok',
        result: [entry.index, tin.getCompiled(), tin.boundaryDiagnostics ?? null],
        stamp: this.stamp(entry),
      };
    });
  }

  /** 網の今の状態から、表示用の網の全部を作る。網にも版にも触らない。 */
  getSnapshot(request: TinSnapshotRequest): Promise<TinSnapshotResponse> {
    return this.enqueue(async (): Promise<TinSnapshotResponse> => {
      const entry = this.layers.get(request.layerKey);
      if (!entry) return { status: 'noMesh' };
      const current = this.stamp(entry);
      if (request.base.generation !== current.generation || request.base.revision !== current.revision) {
        return { status: 'revisionMismatch', current };
      }
      const { tin } = entry;
      return { status: 'ok', snapshot: snapshotFromTin(tin, tin.getCompiled(), true), stamp: this.stamp(entry) };
    });
  }

  /**
   * 清書（§9.3 の 3）。局所更新の網とは別のインスタンスで全部組み直し、strict のときだけ、層の網を差し替える。
   * strict にならなかったときは、どちらを保存するかを決める（§9.5）。特例の保存（局所更新の網を保存する）なら網を保ち、
   * 全部組み直した結果を保存するのに条件（証拠）を満たさなかった（evidenceFailed・noEvidence）ときは、網も捨てる
   * （表示・次の編集を清書側へ合わせる）。
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
        // スイッチが切なら、網は持ち続けない（rebuild と同じ）
        if (!request.incrementalEdits) {
          return { result: built.result, decision: { source: 'rebuild', reason: 'rebuildStrict' }, replaced: false };
        }
        const entry = this.adopt(layerKey, built, request);
        const snapshot = snapshotFromTin(built.tin, built.compiled);
        return {
          result: built.result,
          decision: { source: 'rebuild', reason: 'rebuildStrict' },
          replaced: true,
          stamp: this.stamp(entry),
          ...(snapshot ? { snapshot } : {}),
        };
      }
      // strict にならなかった清書の網は捨てる（局所更新の網を、清書の strict_error で上書きしない）
      // 持っている網が、この清書を頼んだ Editor の入力・版に対応しているときだけ、特例の保存の候補にする。
      // 条件の判定は Tin が持つ: strict な網の帯を最新にし（refreshBand）、網の全部を数え直した証拠を集める（collectIncrementalEvidence）
      const meshMatchesRequest = !!kept && !!finalizeRequest.base && !!kept.inputs
        && this.stampMatches(kept, finalizeRequest.base) && inputsMatchRequest(kept.inputs, request);
      let bandPatch: TinPatch | undefined;
      let evidence: IncrementalEvidence | undefined;
      if (kept && meshMatchesRequest && kept.tin.strict_status === 'strict') {
        bandPatch = kept.tin.refreshBand();
        // 帯を最新にできなければ（スイッチが切・どの余白でも strict な帯にならない）、特例の保存はしない
        if (bandPatch) evidence = kept.tin.collectIncrementalEvidence({ status: status ?? 'strict_error', kinks: built.compiled.kinks_points?.length ?? 0 });
      }
      const decision = decideSavedMesh({ rebuildStatus: status ?? 'strict_error', evidence, meshMatchesRequest });
      // 帯を作り直した差分は、特例の保存（局所更新の網を保存する）のときだけ、Editor の表示用の網へ当てる（網は進んでいる）。
      // 全部組み直した結果を保存する判断では、表示も worker の網も清書側へ合わせる（帯の差分は返さない）
      const band = decision.source === 'incremental' && bandPatch ? { bandPatch } : {};
      if (decision.source === 'incremental' && kept && evidence?.compiled) {
        // 特例の保存: Tin が書き出した、印（meshOrigin）つきの compiled を保存する。診断に、清書の結果との違いを残す
        const diagnostics = { ...(kept.tin.boundaryDiagnostics ?? {}), incremental: decision.diagnostics };
        return {
          result: [request.index, evidence.compiled, diagnostics as TinUpdateResult[2]],
          decision: { source: 'incremental', reason: decision.reason },
          replaced: false,
          stamp: this.stamp(kept),
          ...band,
        };
      }
      // 全部組み直した結果を保存するのに、条件（証拠）を満たさなかった: 局所更新の網も捨て、表示と次の編集を清書側へ合わせる
      // （rebuildFailed〔入力のエラー〕と meshMismatch〔網と入力が対応しない〕では、網を保つ）
      const discardMesh = decision.source === 'rebuild'
        && (decision.reason === 'evidenceFailed' || decision.reason === 'noEvidence');
      if (discardMesh) this.layers.delete(layerKey);
      return {
        result: built.result,
        decision: { source: 'rebuild', reason: decision.reason, ...('failed' in decision && decision.failed ? { failed: decision.failed } : {}) },
        replaced: false,
        ...(kept && !discardMesh ? { stamp: this.stamp(kept) } : {}),
        ...band,
      };
    });
  }

  /**
   * 保存した compiled から、網を戻す（`Tin#restoreMesh`。三角形分けをしない。§9.5 (c)）。印のある（特例の保存の）compiled は、
   * `updateTin()` で開くと strict_error に戻るので、これで開く。印の無い compiled も戻せる（全部組み直しを待たずに編集を始められる）。
   * 戻せなければ `failed`（理由つき）。層の網は変えない（呼び出し側は、`rebuild` で作り直す）。
   * `request` の `gcps`・`edges` は、`compiled` と対応する入力（外の座標系）。
   */
  restore(restoreRequest: TinRestoreRequest): Promise<TinRestoreResponse> {
    return this.enqueue(async (): Promise<TinRestoreResponse> => {
      const { request, compiled } = restoreRequest;
      const layerKey = TinWorkerSession.layerKeyOf(request);
      if (!request.incrementalEdits) return { status: 'failed', reason: 'disabled' };
      const { gcps, edges, index, bounds, strict, vertex, tinOptions } = request;
      const options = tinOptions ?? resolveTinBuildOptions({}, { strictMode: strict, vertexMode: vertex }) ?? {};
      const tin = this.createTin({ ...options, incremental: true, incrementalBand: true });
      const wh = index === 0 ? bounds as number[] | undefined : undefined;
      const bd = index !== 0 ? bounds as number[][] | undefined : undefined;
      if (!applyTinGeometry(tin, options, { wh, bounds: bd })) throw new Error('Both wh and bounds are missing');
      const restored = tin.restoreMesh(compiled as Parameters<Tin['restoreMesh']>[0], {
        points: gcps as never,
        edges: edges as never,
      });
      if (!restored.ok) return { status: 'failed', reason: restored.reason };
      this.layers.delete(layerKey);
      const restoredCompiled = tin.getCompiled();
      const result: TinUpdateResult = [index, restoredCompiled, tin.boundaryDiagnostics ?? null];
      const entry = this.adopt(layerKey, { ok: true, tin, compiled: restoredCompiled, result }, request);
      const snapshot = snapshotFromTin(tin, restoredCompiled);
      return { status: 'ok', result, stamp: this.stamp(entry), ...(snapshot ? { snapshot } : {}) };
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
