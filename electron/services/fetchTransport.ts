// NOV26-IM-NETFETCH-CONTINGENCY-0483: main プロセスが外へ HTTP を取りに行くときの
// 「どのスタックで実行するか」だけを持つ差し込み口。
//
// なぜ要るか: Node 24.22.1 で修正された CVE-2026-111497（Brotli 展開時の範囲外書き込み）は、
// Electron 45.0.0 が同梱する Node 24.22.0 に残っている（43.8.3 も同じ Node）。Node の fetch（undici）は
// `Content-Encoding: br` の応答を Node 同梱の brotli で自動展開するため、外部 URL を
// 読む経路がこの CVE を通る。Chromium のネットワークサービス（別プロセス）で取得・展開
// すれば Node の brotli を通らない。
//
// 既定は **Node の fetch**。これは electron を import できない node 単体の smoke が
// 実サービス（remoteFetchGuard / AppAssetService）を直接呼べるようにするためで、
// 製品の経路はここではない。Electron の main プロセスは起動時に
// `installFetchTransport(remoteSessionFetchTransport)` を呼び、以後は外部取得専用の
// session の fetch が使われる（electron/main.ts・electron/services/electronFetchTransport.ts）。
//
// Electron 上で未登録のまま呼ばれた場合は **黙って Node の fetch へ落とさない**。
// 落とすと CVE を静かに呼び戻すことになり、しかも画面は正常に見えるため、
// 明示的に失敗させる（e2e と起動時登録のどちらかが壊れたら必ず気付ける）。

// NOV26-IM-NETFETCH-CONTINGENCY-0484: 「http/https 以外の scheme へは取りに行かない」ことを
// transport 層でも表せるようにする。リダイレクト先が独自スキームだった場合、transport は
// 通信エラーではなくこの印で失敗し、guardedFetch は原因を `unsupported-scheme` として返す
// （呼び出し元の既存の写像をそのまま使う。取れなかった場合は従来どおり network でよい）。

/** remoteFetchGuard / AppAssetService が要求する最小の fetch 形（DOM の fetch と互換）。 */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** 取得先（リダイレクト先を含む）が http/https でないことを表す失敗。 */
export class UnsupportedSchemeError extends Error {
  readonly code = 'unsupported-scheme' as const;

  constructor(message = 'unsupported scheme') {
    super(message);
    this.name = 'UnsupportedSchemeError';
  }
}

/** `UnsupportedSchemeError` か（別バンドル境界でも判定できるよう name/code も見る）。 */
export function isUnsupportedSchemeError(e: unknown): e is UnsupportedSchemeError {
  if (e instanceof UnsupportedSchemeError) return true;
  return (
    typeof e === 'object' &&
    e !== null &&
    (e as { name?: unknown }).name === 'UnsupportedSchemeError' &&
    (e as { code?: unknown }).code === 'unsupported-scheme'
  );
}

/** `http:` / `https:` の URL か。URL として不正な値は false。 */
export function isHttpUrl(value: unknown): boolean {
  if (typeof value !== 'string' || !value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

let installed: FetchLike | null = null;

/** Electron main の起動時に一度だけ呼ぶ。node 単体のテストから差し替えるのにも使う。 */
export function installFetchTransport(transport: FetchLike | null): void {
  installed = transport;
}

/** Electron の main プロセスで動いているか（renderer からは呼ばれない前提の判定）。 */
function isElectronMainRuntime(): boolean {
  return typeof process !== 'undefined' && typeof process.versions?.electron === 'string';
}

const nodeFetchTransport: FetchLike = (url, init) => fetch(url, init);

/** 現在の transport。Electron 上で未登録なら投げる（Node へ黙って落ちない）。 */
export function getFetchTransport(): FetchLike {
  if (installed) return installed;
  if (isElectronMainRuntime()) {
    throw new Error(
      'fetch transport is not installed in the Electron main process: ' +
        'electron/main.ts must call installFetchTransport(remoteSessionFetchTransport) before any remote fetch',
    );
  }
  return nodeFetchTransport;
}
