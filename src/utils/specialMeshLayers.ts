/**
 * 「この層の三角網は、特例の保存（局所更新の網をそのまま保存したもの）である」という印を、層ごとに持つ（MaplatTin#100・設計書 §9.5）。
 *
 * Tin の証拠が合格しても、その Tin のインスタンスには印が付かない（保存するのは `evidence.compiled`）。編集を続けている間の
 * 「この層は特例の網」という状態は、Editor の側で持つ。
 * - 付く: 開いた地図の三角網に印がある（`meshOrigin`）・清書が特例の保存になった
 * - 外れる: 次の清書が、全部組み直した結果になった（strict でもそうでなくても、保存するのは清書の結果）・全部組み直しの結果が入った
 * - 局所更新の結果が入っても、そのまま（特例の網から編集を続けているだけ）
 */
import type { SavedMeshDecisionLike } from '../workers/tinWorkerProtocol.ts';

export interface SpecialMeshLayers {
  has(layerId: string): boolean;
  readonly size: number;
  /** 印を付ける。新しく付いたら true（知らせるのは、このとき） */
  mark(layerId: string): boolean;
  clear(layerId: string): boolean;
  clearAll(): void;
  /** 清書の結果を受ける。特例の保存なら付け、全部組み直しの結果なら外す。付いた／外れたかを返す */
  observeFinalize(layerId: string, decision: SavedMeshDecisionLike): 'marked' | 'cleared' | 'unchanged';
  /** 三角網が入った。全部組み直しの結果なら外す。局所更新の結果は、そのまま */
  observeBuilt(layerId: string, origin: 'rebuild' | 'incremental'): void;
}

export function createSpecialMeshLayers(): SpecialMeshLayers {
  const layers = new Set<string>();
  const api: SpecialMeshLayers = {
    has: (layerId) => layers.has(layerId),
    get size() {
      return layers.size;
    },
    mark(layerId) {
      if (layers.has(layerId)) return false;
      layers.add(layerId);
      return true;
    },
    clear: (layerId) => layers.delete(layerId),
    clearAll: () => layers.clear(),
    observeFinalize(layerId, decision) {
      if (decision.source === 'incremental') return api.mark(layerId) ? 'marked' : 'unchanged';
      return layers.delete(layerId) ? 'cleared' : 'unchanged';
    },
    observeBuilt(layerId, origin) {
      if (origin === 'rebuild') layers.delete(layerId);
    },
  };
  return api;
}
