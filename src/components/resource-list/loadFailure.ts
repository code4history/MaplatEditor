// 一覧の読み取りが保存先フォルダの DB を開けずに失敗したとき、main から届く理由。
// 理由（権限が無い／読み取り専用の場所／場所が無い／その他）と code だけを持ち、利用者の手元のパスは含めない
// （main 側の electron/utils/dbOpenFailure.ts と対で、画面の文言はこちらの理由で決める）。

export type LoadFailureReason = "permission" | "readonly-location" | "not-found" | "other";

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

const REASONS: readonly LoadFailureReason[] = ["permission", "readonly-location", "not-found", "other"];

/** search:* の応答が「DB を開けなかった」理由つきの失敗かどうか */
export function isSearchFailureReply(value: unknown): value is { failure: ResourceLoadFailure } {
  if (typeof value !== "object" || value === null) return false;
  const failure = (value as { failure?: unknown }).failure;
  if (typeof failure !== "object" || failure === null) return false;
  return typeof (failure as { reason?: unknown }).reason === "string"
    && REASONS.includes((failure as { reason: LoadFailureReason }).reason)
    && typeof (failure as { code?: unknown }).code === "string";
}

/**
 * 「権限が無い」の直し方の文言のキーを OS ごとに選ぶ。許可を与える場所の名前が OS で違う
 * （macOS はシステム設定、Windows は Windows セキュリティかフォルダのプロパティ、
 * Linux 等はフォルダの権限そのもの）。OS が分からないとき（Electron の外）は macOS の文言のまま。
 */
export function permissionFixKey(platform: string | undefined): string {
  if (platform === undefined || platform === "darwin") return "resource_list.load_error_fix_permission";
  if (platform === "win32") return "resource_list.load_error_fix_permission_windows";
  return "resource_list.load_error_fix_permission_linux";
}
