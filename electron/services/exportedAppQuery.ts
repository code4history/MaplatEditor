// 書き出したアプリの index.html が URL のクエリから受け付けるキーと値の形（nov26-m6-t11）。
// 受け付けるのは lang・overlay・appid だけ。他のキー・形の合わない値は無視し、書き出した設定のまま起動する。

/** apps/<appid>.json のパスに入る。字種は Editor の slug（SLUG_PATTERN）と同じ。/ . % を通さない */
export const EXPORTED_APP_APPID_PATTERN = /^[A-Za-z0-9_-]{1,256}$/;
/** BCP 47 の簡略形（ja・en・zh-TW 等）。Maplat のデモ（demo/query.ts）と同じ */
export const EXPORTED_APP_LANG_PATTERN = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/;

/**
 * index.html の起動スクリプトのうち、`var option = …;` の直後に置く部分（ES5 の文）を返す。
 * overlayAvailable が偽なら overlay のキーを読まない（ベースマップの無いアプリで overlay=true は初期化に失敗する）。
 *
 * - 解析は URLSearchParams(window.location.search)。# 以降（MaplatCore の #! の状態 URL）に触れない
 * - 代入はキーを名指しした明示の代入だけ。動的なキーの代入・params の反復をしない
 * - 同じキーが複数あれば最初の 1 つ。合わない値は黙って捨てる
 * - 字下げは renderIndexHtml の <script> の中（4 桁）に合わせ、末尾に改行を付けない
 */
export function renderExportedAppQueryScript(overlayAvailable: boolean): string {
  const lines = [
    '(function () {',
    '  var params;',
    '  try { params = new URLSearchParams(window.location.search); } catch (e) { return; }',
    "  var appid = params.get('appid');",
    `  if (appid !== null && /${EXPORTED_APP_APPID_PATTERN.source}/.test(appid)) option.appid = appid;`,
    "  var lang = params.get('lang');",
    `  if (lang !== null && /${EXPORTED_APP_LANG_PATTERN.source}/.test(lang)) option.lang = lang;`,
  ];
  if (overlayAvailable) {
    lines.push(
      "  var overlay = params.get('overlay');",
      "  if (overlay === 'true' || overlay === 'false') option.overlay = overlay === 'true';",
    );
  }
  lines.push('})();');
  return lines.map((line) => `    ${line}`).join('\n');
}
