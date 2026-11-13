// 保存先フォルダの DB（Write Store）を開けない失敗を、renderer へ渡せる形へ写像する。
//
// 理由は 3 つに分ける: 権限が無い（macOS の書類フォルダへのアクセス拒否・読み取り専用等）／
// 場所が無い（フォルダが無い・経路上に無い）／その他。OS と SQLite が返す code（EACCES・
// ENOENT・SQLITE_CANTOPEN 等）を手掛かりにするが、SQLite は chmod 000 の中へ開けないときも
// SQLITE_CANTOPEN しか返さないため、そのときは保存先フォルダの状態を見て分ける。
// 外付けドライブが外れたときは EACCES を返すため、保存先フォルダが無いこと（マウント点の
// 外れ）を先に見て「場所が無い」へ寄せる。
//
// renderer へは理由と code だけを渡す（redactPathsInResult.ts と同じ方針で、利用者の手元の
// パスは message にも応答にも載せない。原文は main のログにだけ出す）。
import { access, constants, lstat } from 'node:fs/promises';
import path from 'node:path';

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
    // SQLite は拡張 result code（1544 = SQLITE_READONLY_DIRECTORY、526 = SQLITE_CANTOPEN_ISDIR 等）
    // を返すことがある。基本 code（下位 8bit）で比較する
    const errcode = typeof candidate.errcode === 'number' ? candidate.errcode & 0xff : null;
    if (errcode === 8) return 'SQLITE_READONLY';
    if (errcode === 14) return 'SQLITE_CANTOPEN';
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
 * 保存先フォルダを親へ向かってたどり、「無い」階層があれば「場所が無い」を返す。
 * 外付けドライブが外れた /Volumes/<ドライブ名>/… は ensureDir（mkdir -p）が ENOENT ではなく
 * EACCES を返すため、code だけでは「権限が無い」と誤る。存在しない祖先の親がマウント点
 * （macOS の /Volumes 直下・Windows でドライブ直下が無い等）の外れなら必ずここに落ちる。
 * 普通の存在しないパスは ensureDir が作るため、ここまで来るのは作れなかった場合だけである。
 * （symlink は解決せず、行き先の無い symlink は従来どおり code と access の判定に委ねる）
 */
async function missingTargetReason(folder: string): Promise<DbOpenFailureReason | null> {
  let current = path.resolve(folder);
  let sawMissing = false;
  for (;;) {
    let missingHere = false;
    try {
      await lstat(current);
    } catch (probeError) {
      if (dbOpenFailureCode(probeError) !== 'ENOENT') return null;
      missingHere = true;
    }
    if (!missingHere) {
      // current は在る。保存先フォルダ自身が無ければ「作れなかった」= 場所が無い
      return sawMissing ? 'not-found' : null;
    }
    sawMissing = true;
    const parent = path.dirname(current);
    // ルートまで欠けている（Windows でドライブそのものが外れている等）= マウント点の外れ
    if (parent === current) return 'not-found';
    current = parent;
  }
}

/**
 * 失敗を理由へ分ける。保存先フォルダが無いときは code より先に「場所が無い」を優先し、
 * SQLITE_CANTOPEN など code だけでは決まらないときは、保存先フォルダを見て
 * （読める・書けるか、そもそも在るか）「権限が無い」「場所が無い」のどちらかに寄せる。
 */
export async function classifyDbOpenFailure(error: unknown, folder: string): Promise<DbOpenFailureReason> {
  const missing = await missingTargetReason(folder);
  if (missing) return missing;
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
