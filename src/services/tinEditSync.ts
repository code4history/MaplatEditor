/**
 * 主スレッド側の、層ごとの網の同期（MaplatTin#100・設計書 §9.3）。
 *
 * worker が持つ網の版（`TinRevisionStamp`）・worker の入力の写し（`TrackedInputs`）・画面の表示用の網（`TinDisplayMesh`）を、
 * 1 つにまとめて持つ。
 * - `rebuild`: 入力の全部で網を作り直す（今の `updateTin` と同じ結果）。版と、表示用の網の全部を取り込む
 * - `edit`: 編集の差分を送る。差分（`TinPatch`）が返れば、表示用の網へ当てる。版が合わない・網が無い・差分が当たらない、
 *   のときは、**最新の入力の全部で `rebuild` を送り直す**（worker の網は古いので、worker 側の全部組み直しでは、
 *   Editor の入力に追いつかない）
 * - `refresh`: Editor の対応点・必須エッジの配列そのものを渡す。前の入力との差から編集を作り（`tinEditPlanner.ts`）、
 *   `edit` で当てる。局所で済めば、worker の網から compiled を書き出させて返す（三角形分けはしない）
 * - `finalize`: 清書。strict のときだけ網が差し替わる
 *
 * 依頼は 1 つずつ処理する（同じ層の依頼が追い越し合うと、入力の写しと worker の網が食い違うため）。
 * worker との通信は `TinComputeTransport` で抜き出してあるので、smoke では、worker を立てずに同じ筋道を動かせる。
 */
import { TinDisplayMesh } from '../utils/tinDisplayMesh.ts';
import type { PatchChange } from '../utils/tinDisplayMesh.ts';
import { applyEditsToTracked, planEdits, trackInputs } from '../utils/tinEditPlanner.ts';
import type { PlannerEdge, TrackedInputs } from '../utils/tinEditPlanner.ts';
import type { TinUpdateRequest, TinUpdateResult } from './editorComputeBackend';
import type {
  TinApplyEditsRequest,
  TinApplyEditsResponse,
  TinCompiledRequest,
  TinCompiledResponse,
  TinEdit,
  TinFinalizeRequest,
  TinFinalizeResponse,
  TinPatch,
  TinPatchFallbackReason,
  TinRebuildResponse,
  TinRevisionStamp,
  TinSnapshotRequest,
  TinSnapshotResponse,
} from '../workers/tinWorkerProtocol.ts';

export interface TinComputeTransport {
  rebuild(request: TinUpdateRequest, isCurrent?: () => boolean): Promise<TinRebuildResponse>;
  applyEdits(request: TinApplyEditsRequest, isCurrent?: () => boolean): Promise<TinApplyEditsResponse>;
  getCompiled(request: TinCompiledRequest, isCurrent?: () => boolean): Promise<TinCompiledResponse>;
  getSnapshot(request: TinSnapshotRequest, isCurrent?: () => boolean): Promise<TinSnapshotResponse>;
  finalize(request: TinFinalizeRequest, isCurrent?: () => boolean): Promise<TinFinalizeResponse>;
  disposeLayer(layerKey: string): Promise<void>;
}

/** `edit` が、差分で済まずに全部の入力で `rebuild` を送り直した理由。 */
export type TinRebuildReason =
  | 'noMesh'
  | 'revisionMismatch'
  | 'unsupported'
  | 'failed'
  /** 差分が表示用の網に当たらなかった（版が飛んだ・知らない頂点を指した、など） */
  | 'patchRejected'
  /** Tin が、局所で済まず全部組み直しへ落ちた（理由は `TinPatch#fallbackReason`） */
  | TinPatchFallbackReason;

export type TinEditOutcome =
  | { kind: 'patched'; patch: TinPatch; stamp: TinRevisionStamp }
  | { kind: 'rebuilt'; result: TinUpdateResult; reason: TinRebuildReason };

/** `refresh` が全部組み直した理由（`TinRebuildReason` のほか、入力の側の理由）。 */
export type TinRefreshReason =
  | TinRebuildReason
  /** 作り方（設定・範囲・生成設定）が変わった */
  | 'optionsChanged'
  /** 前の入力との差を、編集の列にできなかった */
  | 'noPlan';

export type TinRefreshOutcome =
  /** 局所で済んだ。`result` は、worker の網から書き出した compiled（三角形分けはしていない） */
  | { kind: 'patched'; result: TinUpdateResult; patch: TinPatch }
  /** 前の入力と同じ（編集なし）。`result` は、網の今の compiled */
  | { kind: 'unchanged'; result: TinUpdateResult }
  | { kind: 'rebuilt'; result: TinUpdateResult; reason: TinRefreshReason };

/** 表示用の網が変わったときの通知（画面の描き直しに使う）。 */
export type DisplayChange =
  | { kind: 'replace' }
  | { kind: 'patch'; change: PatchChange };

export const STALE_REQUEST_MESSAGE = '三角網の生成依頼が失効しました';

/**
 * 依頼が失効した（worker へ送る前に断った）。worker の網にも、こちらの版・入力の写しにも触っていない。
 * `refresh` は、次の依頼で入力の写しとの差を取り直すので、この失敗では網を捨てない。
 */
export class StaleRequestError extends Error {
  constructor() {
    super(STALE_REQUEST_MESSAGE);
    this.name = 'StaleRequestError';
  }
}

/** 作り方が同じか（同じなら、前の入力との差を編集にできる）。 */
export function tinSignatureOf(request: Pick<TinUpdateRequest, 'index' | 'bounds' | 'strict' | 'vertex' | 'tinOptions' | 'incrementalEdits'>): string {
  // 層の番号そのものは、結果に付ける印（層の削除で変わる）。作り方に効くのは、主図（0）か副層かだけ
  return JSON.stringify([request.index === 0, request.bounds, request.strict, request.vertex, request.tinOptions, !!request.incrementalEdits]);
}

export class LayerTinSync {
  readonly layerKey: string;
  readonly display = new TinDisplayMesh();
  /** worker が持つ網の版。網が無ければ undefined */
  stamp: TinRevisionStamp | undefined;
  /** worker の網が持つ入力の写し（id つき）。局所更新のスイッチが入っていないとき・網が無いときは undefined */
  tracked: TrackedInputs | undefined;
  private signature: string | undefined;
  private chain: Promise<unknown> = Promise.resolve();
  private readonly listeners = new Set<(change: DisplayChange) => void>();
  private readonly transport: TinComputeTransport;

  constructor(transport: TinComputeTransport, layerKey: string) {
    this.transport = transport;
    this.layerKey = layerKey;
  }

  /** 表示用の網が変わったときに呼ばれる。戻り値で、購読をやめる。 */
  onDisplayChange(listener: (change: DisplayChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(change: DisplayChange): void {
    for (const listener of this.listeners) listener(change);
  }

  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const next = this.chain.then(task, task);
    this.chain = next.catch(() => undefined);
    return next;
  }

  private assertCurrent(isCurrent?: () => boolean): void {
    if (isCurrent && !isCurrent()) throw new StaleRequestError();
  }

  /**
   * 公開の入口（`rebuild`・`edit`・`finalize`）: 例外で終わったら、worker の網と Editor の入力が合っているか分からないので、
   * 版を捨てる（次の編集は noMesh で、入力の全部を送り直す）。失効して送られなかった依頼も同じ（呼び出し側が、
   * その依頼の編集を、次の依頼へ持ち越さないため）。
   */
  private strict<T>(task: () => Promise<T>): Promise<T> {
    return this.exclusive(async () => {
      try {
        return await task();
      } catch (error) {
        this.reset();
        throw error;
      }
    });
  }

  /** 送るときの通信の失敗。失効（送っていない）なら、網はそのまま。それ以外は、網の状態が分からない。 */
  private failed(error: unknown): never {
    if (!(error instanceof StaleRequestError)) this.reset();
    throw error;
  }

  /** worker の網を信用できなくなった（通信の失敗・worker の作り直しなど）。版・入力の写し・表示用の網を捨てる。次は rebuild から。 */
  reset(): void {
    this.stamp = undefined;
    this.tracked = undefined;
    this.signature = undefined;
    this.display.clear();
    this.notify({ kind: 'replace' });
  }

  /** `rebuild` の応答（版と、表示用の網の全部）を取り込む。網を持たない応答（エラー）は、両方を空にする。 */
  private adopt(response: TinRebuildResponse): void {
    this.stamp = response.stamp;
    if (response.stamp && response.snapshot) this.display.replaceAll(response.snapshot, response.stamp.revision);
    else this.display.clear();
    this.notify({ kind: 'replace' });
  }

  private async rebuildNow(request: TinUpdateRequest, isCurrent?: () => boolean): Promise<TinUpdateResult> {
    this.assertCurrent(isCurrent);
    let response: TinRebuildResponse;
    try {
      response = await this.transport.rebuild({ ...request, layerKey: this.layerKey }, isCurrent);
    } catch (error) {
      this.failed(error);
    }
    this.adopt(response);
    // 作り直した網の id は添字（setPoints・setEdges の規約）。入力の写しも、そこから始める
    if (response.stamp && request.incrementalEdits) {
      this.tracked = trackInputs(request.gcps, request.edges as PlannerEdge[]);
      this.signature = tinSignatureOf(request);
    } else {
      this.tracked = undefined;
      this.signature = undefined;
    }
    return response.result;
  }

  /** 入力の全部で、網を作り直す。結果は、今の `updateTin` と同じ。 */
  rebuild(request: TinUpdateRequest, isCurrent?: () => boolean): Promise<TinUpdateResult> {
    return this.strict(() => this.rebuildNow(request, isCurrent));
  }

  private async editNow(edits: TinEdit[], latestRequest: TinUpdateRequest, isCurrent?: () => boolean): Promise<TinEditOutcome> {
    const resend = async (reason: TinRebuildReason): Promise<TinEditOutcome> => ({
      kind: 'rebuilt',
      result: await this.rebuildNow(latestRequest, isCurrent),
      reason,
    });
    if (!this.stamp) return resend('noMesh');
    this.assertCurrent(isCurrent);
    const before = this.tracked;
    let response: TinApplyEditsResponse;
    try {
      // 版は、送る時点の値（前の依頼の応答を待ってから）。依頼は 1 つずつ処理するので、続けて編集しても食い違わない
      response = await this.transport.applyEdits({ layerKey: this.layerKey, edits, base: this.stamp, index: latestRequest.index }, isCurrent);
    } catch (error) {
      this.failed(error);
    }
    switch (response.status) {
      case 'patched': {
        if (response.full) {
          // Tin が全部組み直しへ落ちた。差分は無いので、全部を取り込む（網は同じインスタンスなので、id は編集のとおりに保たれる）
          this.adopt(response.full);
          this.tracked = before && applyEditsToTracked(before, edits);
          return { kind: 'rebuilt', result: response.full.result, reason: response.patch.fallbackReason ?? 'unsupported' };
        }
        const applied = this.display.applyPatch(response.patch);
        this.stamp = response.stamp;
        this.tracked = before && applyEditsToTracked(before, edits);
        if (!applied.ok) {
          // 補完点の対の一覧が変わる差分は、表示用の網へ当てられない。worker の網から全部を取り直す（網は進んでいる）
          if (applied.reason === 'supplementPairs' && (await this.resnapshot(isCurrent))) {
            return { kind: 'patched', patch: response.patch, stamp: response.stamp };
          }
          return resend('patchRejected');
        }
        this.notify({ kind: 'patch', change: applied.change });
        return { kind: 'patched', patch: response.patch, stamp: response.stamp };
      }
      case 'revisionMismatch':
      case 'noMesh':
      case 'unsupported':
      case 'failed':
        return resend(response.status);
    }
  }

  /**
   * 編集を当てる。`latestRequest` は、編集を反映した、最新の入力の全部（`rebuild` を送り直すときに使う）。
   * 差分で済めば `patched`（表示用の網へ当てた）、済まなければ `rebuilt`。
   */
  edit(edits: TinEdit[], latestRequest: TinUpdateRequest, isCurrent?: () => boolean): Promise<TinEditOutcome> {
    return this.strict(() => this.editNow(edits, latestRequest, isCurrent));
  }

  /** worker の網から表示用の網の全部を取り直す。取り直せたら true。 */
  private async resnapshot(isCurrent?: () => boolean): Promise<boolean> {
    if (!this.stamp) return false;
    let response: TinSnapshotResponse;
    try {
      response = await this.transport.getSnapshot({ layerKey: this.layerKey, base: this.stamp }, isCurrent);
    } catch (error) {
      this.failed(error);
    }
    if (response.status !== 'ok' || !response.snapshot) return false;
    this.display.replaceAll(response.snapshot, response.stamp.revision);
    this.notify({ kind: 'replace' });
    return true;
  }

  /** worker の網の今の compiled を書き出させる（網にも版にも触らない）。 */
  private async compiledNow(request: TinUpdateRequest, isCurrent?: () => boolean): Promise<{ result: TinUpdateResult; fromMesh: boolean }> {
    this.assertCurrent(isCurrent);
    if (this.stamp) {
      let response: TinCompiledResponse;
      try {
        response = await this.transport.getCompiled({ layerKey: this.layerKey, base: this.stamp, index: request.index }, isCurrent);
      } catch (error) {
        this.failed(error);
      }
      if (response.status === 'ok') return { result: response.result, fromMesh: true };
    }
    return { result: await this.rebuildNow(request, isCurrent), fromMesh: false };
  }

  /**
   * Editor の対応点・必須エッジ（`request.gcps`・`request.edges`）を、今の網へ反映する。前の入力との差から編集を作って当て、
   * 局所で済めば、三角形分けをせずに compiled を返す。作り方が変わった・編集にできない・局所で済まない、ときは全部組み直す。
   */
  refresh(request: TinUpdateRequest, isCurrent?: () => boolean): Promise<TinRefreshOutcome> {
    return this.exclusive(async (): Promise<TinRefreshOutcome> => {
      this.assertCurrent(isCurrent);
      const rebuilt = async (reason: TinRefreshReason): Promise<TinRefreshOutcome> =>
        ({ kind: 'rebuilt', result: await this.rebuildNow(request, isCurrent), reason });
      if (!request.incrementalEdits) return rebuilt('optionsChanged');
      if (!this.stamp || !this.tracked) return rebuilt('noMesh');
      if (this.signature !== tinSignatureOf(request)) return rebuilt('optionsChanged');
      const plan = planEdits(this.tracked, request.gcps, request.edges as PlannerEdge[]);
      if (!plan) return rebuilt('noPlan');
      if (plan.edits.length === 0) {
        const { result, fromMesh } = await this.compiledNow(request, isCurrent);
        return fromMesh ? { kind: 'unchanged', result } : { kind: 'rebuilt', result, reason: 'noMesh' };
      }
      const outcome = await this.editNow(plan.edits, request, isCurrent);
      if (outcome.kind === 'rebuilt') return { kind: 'rebuilt', result: outcome.result, reason: outcome.reason };
      const { result, fromMesh } = await this.compiledNow(request, isCurrent);
      return fromMesh
        ? { kind: 'patched', result, patch: outcome.patch }
        : { kind: 'rebuilt', result, reason: 'noMesh' };
    });
  }

  /** 清書。strict のときだけ、worker の網が差し替わる（表示用の網も全部入れ替える。入力の写しも添字の id へ戻る）。 */
  finalize(request: TinUpdateRequest, isCurrent?: () => boolean): Promise<TinFinalizeResponse> {
    return this.strict(async () => {
      this.assertCurrent(isCurrent);
      let response: TinFinalizeResponse;
      try {
        response = await this.transport.finalize({ request: { ...request, layerKey: this.layerKey }, ...(this.stamp ? { base: this.stamp } : {}) }, isCurrent);
      } catch (error) {
        this.failed(error);
      }
      if (response.replaced && response.stamp) {
        this.stamp = response.stamp;
        if (response.snapshot) this.display.replaceAll(response.snapshot, response.stamp.revision);
        else this.display.clear();
        this.notify({ kind: 'replace' });
        // 別のインスタンスに替わったので、id は添字に戻る
        if (request.incrementalEdits) {
          this.tracked = trackInputs(request.gcps, request.edges as PlannerEdge[]);
          this.signature = tinSignatureOf(request);
        } else {
          this.tracked = undefined;
          this.signature = undefined;
        }
      }
      return response;
    });
  }

  /** この層の網を捨てる。 */
  async dispose(): Promise<void> {
    this.listeners.clear();
    this.stamp = undefined;
    this.tracked = undefined;
    this.signature = undefined;
    this.display.clear();
    await this.transport.disposeLayer(this.layerKey);
  }
}
