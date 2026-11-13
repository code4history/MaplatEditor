// 保存先フォルダの DB（Write Store）を開けない失敗を、renderer へ渡せる形へ写像する。
//
// 理由は 4 つに分ける: 権限が無い（macOS の書類フォルダへのアクセス拒否・chmod で書けない
// フォルダや DB ファイル等）／読み取り専用の場所（読み取り専用でつないだディスクイメージ・ISO・
// ro でマウントした場所。権限を足しても書けるようにならない）／場所が無い（フォルダが無い・
// 経路上に無い）／その他。OS と SQLite が返す code（EACCES・
// ENOENT・SQLITE_CANTOPEN 等）を手掛かりにするが、SQLite は chmod 000 の中へ開けないときも
// SQLITE_CANTOPEN しか返さないため、そのときは保存先フォルダの状態を見て分ける。
// 外付けドライブが外れたときは EACCES を返すため、保存先フォルダが無いこと（マウント点の
// 外れ）を先に見て「場所が無い」へ寄せる。
//
// 読み取り専用の場所は EROFS で見分ける。Node の fs.statfs はマウントの印（macOS の MNT_RDONLY・
// Linux の ST_RDONLY）を返さない（libuv の uv_statfs_t に f_flags が無い）ため使えない。
// 代わりに、失敗そのものの code が EROFS か、保存先フォルダへの access(W_OK) が EROFS を返すかを
// 見る（macOS・Linux の access(2) は読み取り専用のファイルシステムで EROFS を返す）。
// Windows の access はディレクトリの書き込みを確かめない（常に通る）ため、書き込み禁止の
// 媒体（ERROR_WRITE_PROTECT → EROFS）で失敗そのものが EROFS のときだけ見分けられ、
// それ以外は従来どおり「権限が無い」になる。
//
// renderer へは理由と code だけを渡す（redactPathsInResult.ts と同じ方針で、利用者の手元の
// パスは message にも応答にも載せない。原文は main のログにだけ出す）。
import { access, constants, lstat } from 'node:fs/promises';
import path from 'node:path';

export type DbOpenFailureReason = 'permission' | 'readonly-location' | 'not-found' | 'other';

export interface DbOpenFailure {
  reason: DbOpenFailureReason;
  /** OS または SQLite の code の記号（EACCES・ENOENT・SQLITE_CANTOPEN 等）。パスは含めない */
  code: string;
}

const PERMISSION_CODES = new Set(['EACCES', 'EPERM', 'ETXTBSY']);
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
  if (code === 'EROFS') return 'readonly-location';
  if (PERMISSION_CODES.has(code) || code === 'SQLITE_READONLY') return 'permission';
  if (NOT_FOUND_CODES.has(code)) return 'not-found';
  return null;
}

/** ドライブを差し込むフォルダ。この直下が無いのはドライブが外れたとき */
const MOUNT_PARENTS = new Set(['/Volumes', '/media', '/mnt', '/run/media']);
/** Linux はユーザーごとの /media/<user>・/run/media/<user> の下に差し込む */
const PER_USER_MOUNT_PARENTS = new Set(['/media', '/run/media']);

function isMountParent(dir: string): boolean {
  // /Volumes/<ドライブ名> はつながっているドライブそのものなので含めない
  return MOUNT_PARENTS.has(dir) || PER_USER_MOUNT_PARENTS.has(path.dirname(dir));
}

/**
 * 保存先フォルダを親へ向かってたどり、ドライブが外れて無い階層があれば「場所が無い」を返す。
 * 外付けドライブが外れた /Volumes/<ドライブ名>/… は ensureDir（mkdir -p）が ENOENT ではなく
 * EACCES を返すため、code だけでは「権限が無い」と誤る。
 * 在る最も深い祖先がドライブを差し込むフォルダ（/Volumes 等）のとき、またはルートまで無い
 * （Windows でドライブそのものが無い）ときだけ「場所が無い」にする。在る祖先がふつうの
 * フォルダなら、作れなかったのは親に書けないためなので code の判定に委ねる。
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
      // current は在る。その下が無く、current がドライブを差し込むフォルダなら外れている
      return sawMissing && isMountParent(current) ? 'not-found' : null;
    }
    sawMissing = true;
    const parent = path.dirname(current);
    // ルートまで欠けている（Windows でドライブそのものが外れている等）= マウント点の外れ
    if (parent === current) return 'not-found';
    current = parent;
  }
}

/**
 * 保存先フォルダが読み取り専用のファイルシステム上にあるか（access(W_OK) が EROFS を返すか）。
 * 書けないのが権限のためか（EACCES）、場所そのもののためか（EROFS）を分ける。
 * 保存先フォルダがまだ無いときは、在る最も近い祖先（フォルダを作る先）で確かめる。
 */
async function isReadOnlyLocation(folder: string): Promise<boolean> {
  let current = path.resolve(folder);
  for (;;) {
    try {
      await access(current, constants.W_OK);
      return false;
    } catch (probeError) {
      const code = dbOpenFailureCode(probeError);
      if (code === 'EROFS') return true;
      const parent = path.dirname(current);
      if (code !== 'ENOENT' || parent === current) return false;
      current = parent;
    }
  }
}

/**
 * 失敗を理由へ分ける。保存先フォルダが無いときは code より先に「場所が無い」を優先し、
 * SQLITE_CANTOPEN など code だけでは決まらないときは、保存先フォルダを見て
 * （読める・書けるか、そもそも在るか）「権限が無い」「場所が無い」のどちらかに寄せる。
 * 「権限が無い」になる失敗でも、保存先フォルダが読み取り専用のファイルシステム上なら
 * 「読み取り専用の場所」にする（権限を足しても直らず、データフォルダを変えるしかない）。
 */
export async function classifyDbOpenFailure(error: unknown, folder: string): Promise<DbOpenFailureReason> {
  const missing = await missingTargetReason(folder);
  if (missing) return missing;
  const code = dbOpenFailureCode(error);
  const direct = reasonOfCode(code);
  // macOS の読み取り専用のディスクイメージの中では、まだ無いフォルダの mkdir が EROFS ではなく
  // ENOENT を返す（実測）。「権限が無い」「場所が無い」のどちらに見えても、作る先が読み取り専用の
  // ファイルシステム上なら「読み取り専用の場所」にする（外れたドライブは上の missing で先に返る）
  if (direct === 'permission' || direct === 'not-found') {
    return (await isReadOnlyLocation(folder)) ? 'readonly-location' : direct;
  }
  if (direct) return direct;
  // 壊れた DB・ロック中など、code で理由が決まっている失敗はフォルダの状態で権限へ寄せない
  if (code !== 'SQLITE_CANTOPEN' && code !== 'unknown') return 'other';
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
