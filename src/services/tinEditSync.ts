/**
 * 主スレッド側の、層ごとの網の同期（MaplatTin#100・設計書 §9.3）。
 *
 * worker が持つ網の版（`TinRevisionStamp`）と、画面の表示用の網（`TinDisplayMesh`）を 1 つにまとめて持つ。
 * - `rebuild`: 入力の全部で網を作り直す（今の `updateTin` と同じ結果）。版と、表示用の網の全部を取り込む
 * - `edit`: 編集の差分を送る。差分（`TinPatch`）が返れば、表示用の網へ当てる。版が合わない・網が無い・差分が当たらない、
 *   のときは、**最新の入力の全部で `rebuild` を送り直す**（worker の網は古いので、worker 側の全部組み直しでは、
 *   Editor の入力に追いつかない）
 * - `finalize`: 清書。strict のときだけ網が差し替わる
 *
 * worker との通信は `TinComputeTransport` で抜き出してあるので、smoke では、worker を立てずに同じ筋道を動かせる。
 */
import { TinDisplayMesh } from '../utils/tinDisplayMesh.ts';
import type { TinUpdateRequest, TinUpdateResult } from './editorComputeBackend';
import type {
  TinApplyEditsRequest,
  TinApplyEditsResponse,
  TinEdit,
  TinFinalizeRequest,
  TinFinalizeResponse,
  TinPatch,
  TinPatchFallbackReason,
  TinRebuildResponse,
  TinRevisionStamp,
} from '../workers/tinWorkerProtocol.ts';

export interface TinComputeTransport {
  rebuild(request: TinUpdateRequest, isCurrent?: () => boolean): Promise<TinRebuildResponse>;
  applyEdits(request: TinApplyEditsRequest, isCurrent?: () => boolean): Promise<TinApplyEditsResponse>;
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

export class LayerTinSync {
  readonly layerKey: string;
  readonly display = new TinDisplayMesh();
  /** worker が持つ網の版。網が無ければ undefined */
  stamp: TinRevisionStamp | undefined;
  private readonly transport: TinComputeTransport;

  constructor(transport: TinComputeTransport, layerKey: string) {
    this.transport = transport;
    this.layerKey = layerKey;
  }

  /** `rebuild` の応答（版と、表示用の網の全部）を取り込む。網を持たない応答（エラー）は、両方を空にする。 */
  private adopt(response: TinRebuildResponse): void {
    this.stamp = response.stamp;
    if (response.stamp && response.snapshot) this.display.replaceAll(response.snapshot, response.stamp.revision);
    else this.display.clear();
  }

  /** 入力の全部で、網を作り直す。結果は、今の `updateTin` と同じ。 */
  async rebuild(request: TinUpdateRequest, isCurrent?: () => boolean): Promise<TinUpdateResult> {
    const response = await this.transport.rebuild({ ...request, layerKey: this.layerKey }, isCurrent);
    this.adopt(response);
    return response.result;
  }

  /**
   * 編集を当てる。`latestRequest` は、編集を反映した、最新の入力の全部（`rebuild` を送り直すときに使う）。
   * 差分で済めば `patched`（表示用の網へ当てた）、済まなければ `rebuilt`。
   */
  async edit(edits: TinEdit[], latestRequest: TinUpdateRequest, isCurrent?: () => boolean): Promise<TinEditOutcome> {
    const resend = async (reason: TinRebuildReason): Promise<TinEditOutcome> => ({
      kind: 'rebuilt',
      result: await this.rebuild(latestRequest, isCurrent),
      reason,
    });
    if (!this.stamp) return resend('noMesh');
    const response = await this.transport.applyEdits({ layerKey: this.layerKey, edits, base: this.stamp }, isCurrent);
    switch (response.status) {
      case 'patched': {
        if (response.full) {
          // Tin が全部組み直しへ落ちた。差分は無いので、全部を取り込む
          this.adopt(response.full);
          return { kind: 'rebuilt', result: response.full.result, reason: response.patch.fallbackReason ?? 'unsupported' };
        }
        const applied = this.display.applyPatch(response.patch);
        if (!applied.ok) return resend('patchRejected');
        this.stamp = response.stamp;
        return { kind: 'patched', patch: response.patch, stamp: response.stamp };
      }
      case 'revisionMismatch':
      case 'noMesh':
      case 'unsupported':
      case 'failed':
        return resend(response.status);
    }
  }

  /** 清書。strict のときだけ、worker の網が差し替わる（表示用の網も全部入れ替える）。 */
  async finalize(request: TinUpdateRequest, isCurrent?: () => boolean): Promise<TinFinalizeResponse> {
    const response = await this.transport.finalize({ request: { ...request, layerKey: this.layerKey } }, isCurrent);
    if (response.replaced && response.stamp) {
      this.stamp = response.stamp;
      if (response.snapshot) this.display.replaceAll(response.snapshot, response.stamp.revision);
      else this.display.clear();
    }
    return response;
  }

  /** この層の網を捨てる。 */
  async dispose(): Promise<void> {
    this.stamp = undefined;
    this.display.clear();
    await this.transport.disposeLayer(this.layerKey);
  }
}
