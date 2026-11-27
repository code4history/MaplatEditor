/**
 * 三角網の状態つき worker と、主スレッドの受け渡しの型（MaplatTin#100 の設計書 §9.2・§9.3）。
 *
 * 型だけを置く（実行時の値は無い）。worker（`tinWorkerSession.ts`）・主スレッドの同期（`tinEditSync.ts`）・
 * 表示用の網（`tinDisplayMesh.ts`）が、同じ型を前提にする。Tin の側の型（`TinEdit`・`TinPatch`・`VertexRef`）は
 * MaplatTin の `src/incremental/types.ts`・`mesh.ts` が正本で、ここでは作り直さずに参照する。
 */
import type { TinEdit, TinPatch, VertexRef } from '@maplat/tin';
import type { TinUpdateRequest, TinUpdateResult } from '../services/editorComputeBackend';

export type { TinEdit, TinPatch, VertexRef };

/** 座標（`[x, y]`）。GeoJSON の Position と同じ形で、Tin の差分の座標（compiled と同じ内部の座標系）。 */
export type MeshPosition = number[];

/** 全部組み直しへ落ちた理由。`TinPatch#fallbackReason` と同じ値。 */
export type TinPatchFallbackReason = NonNullable<TinPatch['fallbackReason']>;

/**
 * worker が持つ網の版。`applyEdits` に、前提として渡す。
 *
 * - `generation`: 網を作り直した（`rebuild`・清書での差し替え）回数。作り直すたびに、worker 全体で一意の新しい値になる
 * - `revision`: `Tin#revision`（`applyEdits` で進む版。作り直すと 0 に戻る）
 *
 * `Tin` の版は作り直すと 0 に戻るので、番号だけでは「作り直された後の、別の網の 0」と区別できない。
 * 依頼が失効して Editor が結果を見ていない `rebuild` があっても、`generation` が違えば食い違いとして検出できる。
 */
export interface TinRevisionStamp {
  generation: number;
  revision: number;
}

/** 表示用の網の頂点。座標は compiled と同じ内部の座標系。 */
export interface TinMeshVertex {
  ref: VertexRef;
  forw: MeshPosition;
  bakw: MeshPosition;
}

/** 表示用の網の三角形。頂点は `VertexRef` で指す（三角形ごとに座標を複製しない）。 */
export interface TinMeshTriangle {
  id: number;
  vertices: [VertexRef, VertexRef, VertexRef];
}

/**
 * 網の全部（頂点表 + 三角形）。worker が `Tin#incrementalMesh` から作り、表示用の網が全部入れ替えで取り込む。
 * 差分（`TinPatch`）の最初の土台になる。
 */
export interface TinMeshSnapshot {
  vertices: TinMeshVertex[];
  triangles: TinMeshTriangle[];
  /** 重心・補助頂点の扇形の値（帯を作ったときの値） */
  centroid?: NonNullable<TinPatch['centroid']>;
  verticesParams?: number[][];
  supplementPairs?: NonNullable<TinPatch['supplementPairs']>;
  /** ok でない三角形の id */
  badTriangles?: number[];
  /** 補助頂点・重心が最新でない */
  boundaryStale: boolean;
}

/** `rebuild`（と、旧 `updateTin`）の応答。`result` は今の `updateTin` の結果と同じ。 */
export interface TinRebuildResponse {
  result: TinUpdateResult;
  /** 網を持ち続けたときだけ入る（結果がエラー文字列のときは、網を捨てるので無い） */
  stamp?: TinRevisionStamp;
  /** 局所更新の網（`incrementalEdits` が入っていて、網へ取り込めたとき）の全部 */
  snapshot?: TinMeshSnapshot;
}

export interface TinApplyEditsRequest {
  layerKey: string;
  edits: TinEdit[];
  /** この版の網に対する編集である、という前提。合わなければ、網に触らずに `revisionMismatch` を返す */
  base: TinRevisionStamp;
}

/**
 * 編集を当てた応答。
 * - `patched`: 当てた。`patch.mode` が `"local"` なら差分を表示用の網へ当てる。`"full"` なら、`full` に、全部組み直した結果が入る
 * - `revisionMismatch`: 版が合わない。網に触っていない。Editor は、最新の入力の全部で `rebuild` を送り直す
 * - `noMesh`: この層の網を持っていない（最初の呼び出し・worker の作り直し・捨てた後）。同じく `rebuild` を送り直す
 * - `unsupported`: 今の Tin が `applyEdits` を持たない（第 1 週）。同じく `rebuild` を送り直す
 * - `failed`: 編集を当てられず例外になった（網は捨てた）。同じく `rebuild` を送り直す（同じ入力のエラーは、そこで正規の経路で返る）
 */
export type TinApplyEditsResponse =
  | { status: 'patched'; stamp: TinRevisionStamp; patch: TinPatch; full?: TinRebuildResponse }
  | { status: 'revisionMismatch'; current: TinRevisionStamp }
  | { status: 'noMesh' }
  | { status: 'unsupported' }
  | { status: 'failed'; message: string };

/**
 * 清書（§9.3 の 3）の依頼。同じ入力の複製で、別のインスタンスに全部組み直させる。
 * `request` は、`rebuild` と同じ形（編集が止まった時点の、最新の入力の全部）。
 */
export interface TinFinalizeRequest {
  request: TinUpdateRequest;
}

/** 清書の応答。 */
export interface TinFinalizeResponse {
  /** 保存する結果（compiled かエラー文字列）。特例の保存のときは、局所更新の網から書いた compiled（`meshOrigin` つき） */
  result: TinUpdateResult;
  /** どちらの網を保存するか（`../utils/tinSavedMesh.ts`） */
  decision: SavedMeshDecisionLike;
  /** 清書の網で、worker の網を差し替えたとき */
  replaced: boolean;
  /** 差し替えた（または局所更新の網を保った）後の版 */
  stamp?: TinRevisionStamp;
  /** 差し替えたときの、表示用の網の全部 */
  snapshot?: TinMeshSnapshot;
}

/** `tinSavedMesh.ts` の `SavedMeshDecision` の、worker の応答に載せる分（循環を避けるため構造だけを写す）。 */
export interface SavedMeshDecisionLike {
  source: 'rebuild' | 'incremental';
  reason: string;
}

export type TinWorkerRequest =
  | { id: number; type: 'updateTin'; payload: TinUpdateRequest }
  | { id: number; type: 'rebuild'; payload: TinUpdateRequest }
  | { id: number; type: 'applyEdits'; payload: TinApplyEditsRequest }
  | { id: number; type: 'finalize'; payload: TinFinalizeRequest }
  | { id: number; type: 'disposeLayer'; payload: { layerKey: string } }
  | { id: number; type: 'dispose' };
