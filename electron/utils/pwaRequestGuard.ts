// PWA 画像の描画に使う専用セッションの封じ込め。
//
// 描画用の非表示ウィンドウは「一時ファイルの HTML と元画像（file:）」しか読まない。
// 外部への通信（http/https 等）は起こさない・起こさせない。ここでは
// `file:` と `data:` 以外のリクエストをすべて cancel する判定だけを持つ。
//
// Electron を import しない（node の smoke で単体検証する）。

/** 描画用に許可するスキーム（一時ファイルの HTML と元画像だけ） */
const ALLOWED_SCHEMES = ['file:', 'data:'];

/** この URL を描画用ウィンドウから出してよいか。 */
export function isAllowedPwaRequestUrl(url: string): boolean {
  if (typeof url !== 'string') return false;
  const trimmed = url.trim().toLowerCase();
  if (!trimmed) return false;
  return ALLOWED_SCHEMES.some(scheme => trimmed.startsWith(scheme));
}

/**
 * セッションの webRequest に「file:/data: 以外は cancel」を登録する。
 * 引数は `session.webRequest`（Electron の型に依存しない最小の形にして単体試験できるようにする）。
 *
 * 戻り値ではなく **callback** で答える（戻り値で答える形にすると、この Electron では
 * file: の読み込みが完了せずウィンドウの load が止まることを実測で確認している）。
 */
export function installPwaRequestGuard(webRequest: {
  onBeforeRequest(
    filter: { urls: string[] },
    listener: (details: { url: string }, callback: (response: { cancel?: boolean }) => void) => void,
  ): void;
}): void {
  webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    callback(isAllowedPwaRequestUrl(details?.url) ? {} : { cancel: true });
  });
}
