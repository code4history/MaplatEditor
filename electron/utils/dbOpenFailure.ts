// 保存先フォルダの DB（Write Store）を開けない失敗を、renderer へ渡せる形へ写像する。
//
// 理由は 3 つに分ける: 権限が無い（macOS の書類フォルダへのアクセス拒否・読み取り専用等）／
// 場所が無い（フォルダが無い・経路上に無い）／その他。OS と SQLite が返す code（EACCES・
// ENOENT・SQLITE_CANTOPEN 等）を手掛かりにするが、SQLite は chmod 000 の中へ開けないときも
// SQLITE_CANTOPEN しか返さないため、そのときは保存先フォルダの状態を見て分ける。
//
// renderer へは理由と code だけを渡す（redactPathsInResult.ts と同じ方針で、利用者の手元の
// パスは message にも応答にも載せない。原文は main のログにだけ出す）。
import { access, constants } from 'node:fs/promises';

export type DbOpenFailureReason = 'permission' | 'not-found' | 'other';

export interface DbOpenFailure {
  reason: DbOpenFailureReason;
  /** OS または SQLite の code の記号（EACCES・ENOENT・SQLITE_CANTOPEN 等）。パスは含めない */
  code: string;
}

const PERMISSION_CODES = new Set(['EACCES', 'EPERM', 'EROFS', 'ETXTBSY']);
const NOT_FOUND_CODES = new Set(['ENOENT', 'ENOTDIR', 'ENODEV', 'ENXIO']);

/** 失敗の code を、パスを含まない記号へ正規化する。読めないときは 'unknown' */
export function dbOpenFailureCode(error: unknown): string {
  if (error && typeof error === 'object') {
    const candidate = error as { code?: unknown; errcode?: unknown };
    if (candidate.errcode === 8) return 'SQLITE_READONLY';
    if (candidate.errcode === 14) return 'SQLITE_CANTOPEN';
    if (typeof candidate.code === 'string' && candidate.code !== '') return candidate.code;
  }
  return 'unknown';
}

function reasonOfCode(code: string): DbOpenFailureReason | null {
  if (PERMISSION_CODES.has(code) || code === 'SQLITE_READONLY') return 'permission';
  if (NOT_FOUND_CODES.has(code)) return 'not-found';
  return null;
}

/**
 * 失敗を理由へ分ける。SQLITE_CANTOPEN など code だけでは決まらないときは、保存先フォルダを
 * 見て（読める・書けるか、そもそも在るか）「権限が無い」「場所が無い」のどちらかに寄せる。
 */
export async function classifyDbOpenFailure(error: unknown, folder: string): Promise<DbOpenFailureReason> {
  const direct = reasonOfCode(dbOpenFailureCode(error));
  if (direct) return direct;
  try {
    await access(folder, constants.R_OK | constants.W_OK);
  } catch (probeError) {
    return reasonOfCode(dbOpenFailureCode(probeError)) ?? 'other';
  }
  return 'other';
}

/** 失敗を、理由と code だけを持つ DbOpenError へ包む（文言にパスを載せない） */
export class DbOpenError extends Error {
  readonly failure: DbOpenFailure;

  constructor(failure: DbOpenFailure) {
    super(`the write store could not be opened (${failure.code})`);
    this.name = 'DbOpenError';
    this.failure = failure;
  }
}

export async function toDbOpenError(error: unknown, folder: string): Promise<DbOpenError> {
  const failure: DbOpenFailure = {
    reason: await classifyDbOpenFailure(error, folder),
    code: dbOpenFailureCode(error),
  };
  return new DbOpenError(failure);
}

/** DbOpenError なら IPC の応答（理由と code だけ）へ写像する。それ以外の失敗は null */
export function toDbOpenFailureReply(error: unknown): { failure: DbOpenFailure } | null {
  return error instanceof DbOpenError ? { failure: error.failure } : null;
}

/**
 * 読み取りの IPC handler の包み込み。DB を開けない失敗だけを理由つきの応答へ写像し、
 * それ以外の失敗は従来どおり reject する（成功の応答の形は変えない）。
 */
export function withDbOpenFailureReply<T>(run: () => Promise<T>): Promise<T | { failure: DbOpenFailure }> {
  return run().catch((error: unknown) => {
    const reply = toDbOpenFailureReply(error);
    if (reply) return reply;
    throw error;
  });
}
