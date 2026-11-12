import path from 'node:path';

/**
 * 失敗の応答の message から、main が読んだファイルの**パスそのもの**だけを伏せる（ファイル名に置き換える）。
 *
 * service の message には `File not found: <絶対パス>` や fs の例外の原文（`EACCES … '<絶対パス>'`）が入る。
 * renderer へはパスを返さない（ファイルは token で指す）ので、IPC の境界でここを通す。
 * message のほかの部分（理由の文言）は残す。
 */
export function maskPathInResult<T>(result: T, filePath: string): T {
  if (!result || typeof result !== 'object' || !filePath) return result;
  const message = (result as { message?: unknown }).message;
  if (typeof message !== 'string' || !message.includes(filePath)) return result;
  return { ...result, message: message.split(filePath).join(path.basename(filePath)) };
}
