import os from 'node:os';
import path from 'node:path';

/**
 * 失敗の応答の message から、利用者の手元のパスだけを伏せる（renderer へパスを返さないため）。
 *
 * service の message には `File not found: <絶対パス>` や fs の例外の原文（`ENOENT … '<絶対パス>'`）が入る。
 * 一方、理由の文言（ZIP の中の名前 `pois/*.geojson`・`imgs/…` など）は利用者に役立つので、message ごとは落とさない。
 *
 * 伏せるのは、main が読んだファイルのパス・その親・ホームディレクトリ・一時ディレクトリで、長い順に
 * `<file>`・`<dir>`・`~`・`<tmp>` へ置き換える。働くのは `result: 'Error'` のときだけ。
 * 置き換えたときは、原文を main のログへだけ出す（`logLabel` は IPC の channel 名）。
 *
 * 使う経路: POI の取り込み（poisource:importFile）・画像アセットの登録（imageassets:add）。
 */
export function redactPathsInResult<T>(result: T, filePath: string, logLabel: string): T {
  if (!result || typeof result !== 'object') return result;
  const record = result as Record<string, unknown>;
  const { message } = record;
  if (record.result !== 'Error' || typeof message !== 'string') return result;
  const replacements: Array<[string, string]> = [
    [filePath, '<file>'],
    [path.dirname(filePath), '<dir>'],
    [os.homedir(), '~'],
    [os.tmpdir(), '<tmp>'],
  ];
  let redacted = message;
  for (const [needle, label] of replacements.sort((a, b) => b[0].length - a[0].length)) {
    if (needle && needle !== path.sep && needle !== '.') redacted = redacted.split(needle).join(label);
  }
  if (redacted === message) return result;
  console.error(`[${logLabel}] failed:`, message);
  return { ...record, message: redacted } as T;
}
