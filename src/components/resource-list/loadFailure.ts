// 一覧の読み取りが保存先フォルダの DB を開けずに失敗したとき、main から届く理由。
// 理由（権限が無い／場所が無い／その他）と code だけを持ち、利用者の手元のパスは含めない
// （main 側の electron/utils/dbOpenFailure.ts と対で、画面の文言はこちらの理由で決める）。

export type LoadFailureReason = "permission" | "not-found" | "other";

export interface ResourceLoadFailure {
  reason: LoadFailureReason;
  /** OS または SQLite の code の記号（EACCES・ENOENT・SQLITE_CANTOPEN 等）。表示は理由で行う */
  code: string;
}

export class ResourceLoadFailureError extends Error {
  readonly failure: ResourceLoadFailure;

  constructor(failure: ResourceLoadFailure) {
    super(`resource load failed (${failure.code})`);
    this.name = "ResourceLoadFailureError";
    this.failure = failure;
  }
}

const REASONS: readonly LoadFailureReason[] = ["permission", "not-found", "other"];

/** search:* の応答が「DB を開けなかった」理由つきの失敗かどうか */
export function isSearchFailureReply(value: unknown): value is { failure: ResourceLoadFailure } {
  if (typeof value !== "object" || value === null) return false;
  const failure = (value as { failure?: unknown }).failure;
  if (typeof failure !== "object" || failure === null) return false;
  return typeof (failure as { reason?: unknown }).reason === "string"
    && REASONS.includes((failure as { reason: LoadFailureReason }).reason)
    && typeof (failure as { code?: unknown }).code === "string";
}
