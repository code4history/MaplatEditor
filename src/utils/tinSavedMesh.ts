/**
 * 保存する三角網の選び方（MaplatTin#100 の設計書 §9.3 の 4・§9.5）。
 *
 * 原則: 保存する compiled は、清書（全部組み直し）の結果にする。ただ 1 つの例外が、人間の決定（2026-11-27）の特例の保存で、
 * 「清書が strict にならず、局所更新の網が strict のときは、局所更新の網を保存する」。次の条件を全部満たす場合に限り、
 * 1 つでも欠ければ清書の結果を保存する。
 *
 * - (a) 保存の直前に帯を最新にして、S1〜S4 を（全数で）満たす
 * - (b) 書き出した compiled が整合し（往復が一致）、今の交差の数え上げでも交差が 0 件
 * - (c) 印（`meshOrigin`）を付け、読み直すときは `restoreMesh` で戻す（Editor の読み込み側。保存の可否には入れない）
 * - (d) 「再現しない特例の保存」であることを、診断で追えるようにする
 *
 * 第 1 週は、受け皿の型と、分岐の骨組みまで。条件の証拠（`SpecialSaveEvidence`）を集める口は Tin の
 * `restoreMesh`・帯の差し替え・保存の直前の全数の確かめ（第 2 段 b）を待つので、今は証拠が集まらず、
 * 常に清書の結果を保存する（今と同じ）。
 */
import type { CompiledTransformData, StrictStatus } from '@maplat/transform';

/** compiled に付く、特例の保存の印（保存される。MaplatTransform は読み飛ばす追加の項目）。 */
export interface CompiledProvenance {
  /** 無ければ、全部組み直し（清書）の産物。"incremental" は、局所更新の網をそのまま保存した特例 */
  meshOrigin?: 'incremental';
}

/** 診断（保存されない）。特例の保存を、後から追えるようにする。 */
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

/** 局所更新の網が、特例の保存の条件を満たすことの証拠。保存の直前に、網の全部を数え直して集める。 */
export interface SpecialSaveEvidence {
  /** 局所更新の網の状態（`bad` が空で S2 が成り立てば "strict"） */
  incrementalStatus: StrictStatus;
  /** (a) 保存の直前に帯の差し替えを行い、`boundaryStale` が `false` になった */
  boundaryFresh: boolean;
  /** (a) S1（全部の三角形が ok）・S2（外周が両面で単純）・S3（必須エッジが全部ある）・S4（補助頂点だけの三角形が 0 個） */
  invariantsHold: boolean;
  /** (b) 書き出した compiled を Transform に読ませた、全部の GCP の往復が一致した */
  roundTripMatches: boolean;
  /** (b) 書き出した網へ今の交差の数え上げを走らせた結果（両面の合計）。1 件以上は、判定の食い違い */
  sweepKinks: number;
  /** (d) 同じ必須エッジの点だけの三角形の数（診断に書くだけ） */
  remainingForbiddenTriangles: number;
  /** 最後の清書から重ねた局所更新の回数 */
  editsSinceRebuild: number;
}

export type SavedMeshReason =
  /** 清書が strict になった（通常） */
  | 'rebuildStrict'
  /** 清書がエラー（入力が不正）で、網が無い */
  | 'rebuildFailed'
  /** 証拠が集められていない（第 1 週・局所更新の網が無い・取り込めなかった網） */
  | 'noEvidence'
  /** worker が持つ網が、清書を頼んだ Editor の入力・版と対応していない（別の入力の網は保存しない） */
  | 'meshMismatch'
  /** 証拠の値が、型・範囲に合わない（欠けている・数でない、など） */
  | 'evidenceInvalid'
  | 'incrementalNotStrict'
  | 'boundaryStale'
  | 'invariantsNotHeld'
  | 'roundTripMismatch'
  /** 今の数え上げと局所の判定が食い違った（網を試験 T3 の材料として記録する） */
  | 'sweepKinksFound'
  /** 特例の保存 */
  | 'specialSave';

export type SavedMeshDecision =
  | { source: 'rebuild'; reason: Exclude<SavedMeshReason, 'specialSave'> }
  | { source: 'incremental'; reason: 'specialSave'; diagnostics: IncrementalDiagnostics };

export interface DecideSavedMeshInput {
  /** 清書の結果の状態。清書がエラーのときは undefined */
  rebuildStatus: StrictStatus | undefined;
  /** 清書の結果の交差の件数（診断用） */
  rebuildKinks?: number;
  /** 局所更新の網の証拠。集められなければ undefined */
  evidence?: SpecialSaveEvidence;
  /**
   * worker が持つ網が、清書を頼んだ入力（対応点・必須エッジ）と、Editor が見ている版に対応するか。
   * 偽（または未指定）なら、局所更新の網は保存の候補にしない。
   */
  meshMatchesRequest?: boolean;
}

const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0;

/** 証拠の型・範囲を、実行時に確かめる（worker の外から来る値・未配線の値を通さない）。 */
export function isValidEvidence(evidence: unknown): evidence is SpecialSaveEvidence {
  if (typeof evidence !== 'object' || evidence === null) return false;
  const e = evidence as Record<string, unknown>;
  return (e.incrementalStatus === 'strict' || e.incrementalStatus === 'strict_error' || e.incrementalStatus === 'loose')
    && typeof e.boundaryFresh === 'boolean'
    && typeof e.invariantsHold === 'boolean'
    && typeof e.roundTripMatches === 'boolean'
    && isCount(e.sweepKinks)
    && isCount(e.remainingForbiddenTriangles)
    && isCount(e.editsSinceRebuild);
}

/** どちらの網を保存するか。条件が 1 つでも欠ければ、清書の結果を選ぶ。 */
export function decideSavedMesh(input: DecideSavedMeshInput): SavedMeshDecision {
  const { rebuildStatus, evidence } = input;
  if (rebuildStatus === undefined) return { source: 'rebuild', reason: 'rebuildFailed' };
  if (rebuildStatus === 'strict') return { source: 'rebuild', reason: 'rebuildStrict' };
  // 対応が偽と分かっているなら、その理由を先に返す（証拠が無いのも、対応しない網の証拠は集めないため）
  if (input.meshMatchesRequest === false) return { source: 'rebuild', reason: 'meshMismatch' };
  if (!evidence) return { source: 'rebuild', reason: 'noEvidence' };
  // 対応が確かめられていない（未指定）なら、証拠があっても使わない
  if (input.meshMatchesRequest !== true) return { source: 'rebuild', reason: 'meshMismatch' };
  if (!isValidEvidence(evidence)) return { source: 'rebuild', reason: 'evidenceInvalid' };
  if (evidence.incrementalStatus !== 'strict') return { source: 'rebuild', reason: 'incrementalNotStrict' };
  if (!evidence.boundaryFresh) return { source: 'rebuild', reason: 'boundaryStale' };
  if (!evidence.invariantsHold) return { source: 'rebuild', reason: 'invariantsNotHeld' };
  if (!evidence.roundTripMatches) return { source: 'rebuild', reason: 'roundTripMismatch' };
  if (evidence.sweepKinks !== 0) return { source: 'rebuild', reason: 'sweepKinksFound' };
  return {
    source: 'incremental',
    reason: 'specialSave',
    diagnostics: {
      rebuildStatus,
      rebuildKinks: input.rebuildKinks ?? 0,
      editsSinceRebuild: evidence.editsSinceRebuild,
      sweepKinks: evidence.sweepKinks,
      remainingForbiddenTriangles: evidence.remainingForbiddenTriangles,
    },
  };
}

/** 特例の保存の compiled に印を付ける（元の compiled は変えない）。 */
export function withMeshOrigin<T extends CompiledTransformData>(compiled: T): T & Required<CompiledProvenance> {
  return { ...compiled, meshOrigin: 'incremental' };
}

/** compiled が特例の保存の産物か（地図データを走査して、印のある地図を数えるのに使う）。 */
export function hasIncrementalOrigin(compiled: unknown): boolean {
  return typeof compiled === 'object' && compiled !== null
    && (compiled as CompiledProvenance).meshOrigin === 'incremental';
}
