/**
 * 保存する三角網の選び方（MaplatTin#100 の設計書 §9.3 の 4・§9.5）。
 *
 * 原則: 保存する compiled は、清書（全部組み直し）の結果にする。ただ 1 つの例外が、人間の決定（2026-11-27）の特例の保存で、
 * 「清書が strict にならず、局所更新の網が strict のときは、局所更新の網を保存する」。
 *
 * 条件の判定は Tin が持つ（`Tin#refreshBand`・`Tin#collectIncrementalEvidence`。帯を最新にし、網の全部を数え直し、
 * 書き出した compiled の往復と、今の交差の数え上げまで確かめる）。ここでは、その結果（`IncrementalEvidence`）の
 * `eligible`・`failed` に従うだけで、証拠を読み直さない。Editor の側が持つのは、「worker の網が、清書を頼んだ入力・版と
 * 対応しているか」だけ（Tin は、清書の依頼の入力を知らない）。
 *
 * 読み直すときは、印（`meshOrigin: "incremental"`）のある compiled を `Tin#restoreMesh` で戻す（`tinWorkerSession.ts` の `restore`）。
 */
import type { IncrementalEvidence } from '@maplat/tin';
import type { CompiledTransformData, StrictStatus } from '@maplat/transform';

export type { IncrementalEvidence };

/** compiled に付く、特例の保存の印（保存される。MaplatTransform は読み飛ばす追加の項目）。 */
export interface CompiledProvenance {
  /** 無ければ、全部組み直し（清書）の産物。"incremental" は、局所更新の網をそのまま保存した特例 */
  meshOrigin?: 'incremental';
}

/** 診断（保存されない）。特例の保存を、後から追えるようにする。Tin の証拠から写す。 */
export interface IncrementalDiagnostics {
  /** 同じ入力を全部組み直したときの状態（"strict_error" など） */
  rebuildStatus: StrictStatus;
  /** 同じ入力を全部組み直したときの交差の件数 */
  rebuildKinks: number;
  /** 最後の清書から重ねた局所更新の回数 */
  editsSinceRebuild: number;
  /** 保存の直前に、書き出した網へ今の交差の数え上げを 1 件まで走らせた結果（両面の合計。0 が正常） */
  sweepKinks: number;
  /** 同じ必須エッジの点だけの三角形の数（残っていても保存はする） */
  remainingForbiddenTriangles: number;
}

export type SavedMeshReason =
  /** 清書が strict になった（通常） */
  | 'rebuildStrict'
  /** 清書がエラー（入力が不正）で、網が無い */
  | 'rebuildFailed'
  /** worker の網が、清書を頼んだ入力・版と対応していない（別の入力の網は保存しない） */
  | 'meshMismatch'
  /** 局所更新の網が無い・strict でない・帯を最新にできない（Tin の `refreshBand` が undefined）。証拠は集めていない */
  | 'noEvidence'
  /** Tin の証拠が `eligible` でない（`failed` に、満たさなかった条件） */
  | 'evidenceFailed'
  /** 特例の保存 */
  | 'specialSave';

export type SavedMeshDecision =
  | { source: 'rebuild'; reason: Exclude<SavedMeshReason, 'specialSave'>; failed?: IncrementalEvidence['failed'] }
  | { source: 'incremental'; reason: 'specialSave'; diagnostics: IncrementalDiagnostics };

export interface DecideSavedMeshInput {
  /** 清書の結果の状態。清書がエラーのときは undefined */
  rebuildStatus: StrictStatus | undefined;
  /** Tin が集めた証拠（`Tin#collectIncrementalEvidence`）。集めなかった（網が無い・帯を最新にできない）ときは undefined */
  evidence?: IncrementalEvidence;
  /**
   * worker の網が、清書を頼んだ入力（対応点・必須エッジ）と、Editor が見ている版に対応するか。
   * 偽（または未指定）なら、局所更新の網は保存の候補にしない。
   */
  meshMatchesRequest?: boolean;
}

/** どちらの網を保存するか。Tin の証拠が `eligible` で、compiled があるときだけ、局所更新の網。 */
export function decideSavedMesh(input: DecideSavedMeshInput): SavedMeshDecision {
  const { rebuildStatus, evidence } = input;
  if (rebuildStatus === undefined) return { source: 'rebuild', reason: 'rebuildFailed' };
  if (rebuildStatus === 'strict') return { source: 'rebuild', reason: 'rebuildStrict' };
  // 対応しない網の証拠は集めない。理由は、証拠が無いことより先に返す
  if (input.meshMatchesRequest !== true) return { source: 'rebuild', reason: 'meshMismatch' };
  if (!evidence) return { source: 'rebuild', reason: 'noEvidence' };
  if (evidence.eligible !== true || !evidence.compiled) {
    return { source: 'rebuild', reason: 'evidenceFailed', failed: [...evidence.failed] };
  }
  return {
    source: 'incremental',
    reason: 'specialSave',
    diagnostics: {
      rebuildStatus,
      rebuildKinks: evidence.rebuildKinks ?? 0,
      editsSinceRebuild: evidence.editsSinceRebuild,
      sweepKinks: evidence.sweepKinks,
      remainingForbiddenTriangles: evidence.remainingForbiddenTriangles,
    },
  };
}

/** compiled が特例の保存の産物か（地図データを走査して、印のある地図を数えるのに使う）。 */
export function hasIncrementalOrigin(compiled: unknown): boolean {
  return typeof compiled === 'object' && compiled !== null
    && (compiled as CompiledProvenance).meshOrigin === 'incremental';
}

/** 印を付ける（元の compiled は変えない）。Tin は、特例の compiled に印を付けて返すので、通常は要らない（試験・移行用）。 */
export function withMeshOrigin<T extends CompiledTransformData>(compiled: T): T & Required<CompiledProvenance> {
  return { ...compiled, meshOrigin: 'incremental' };
}
