// NOV26-IM-NETFETCH-CONTINGENCY-0483: main プロセスが外へ HTTP を取りに行くときの
// 「どのスタックで実行するか」だけを持つ差し込み口。
//
// なぜ要るか: Node 24.22.1 で修正された CVE-2026-111497（Brotli 展開時の範囲外書き込み）は、
// Electron 43.8.3 が同梱する Node 24.22.0 に残っている。Node の fetch（undici）は
// `Content-Encoding: br` の応答を Node 同梱の brotli で自動展開するため、外部 URL を
// 読む経路がこの CVE を通る。Electron の `net.fetch` は Chromium のネットワーク
// サービス（別プロセス）が展開するので Node の brotli を通らない。
//
// 既定は **Node の fetch**。これは electron を import できない node 単体の smoke が
// 実サービス（remoteFetchGuard / AppAssetService）を直接呼べるようにするためで、
// 製品の経路はここではない。Electron の main プロセスは起動時に
// `installFetchTransport(netFetchTransport)` を呼び、以後は `net.fetch` が使われる
// （electron/main.ts）。
//
// Electron 上で未登録のまま呼ばれた場合は **黙って Node の fetch へ落とさない**。
// 落とすと CVE を静かに呼び戻すことになり、しかも画面は正常に見えるため、
// 明示的に失敗させる（e2e と起動時登録のどちらかが壊れたら必ず気付ける）。

/** remoteFetchGuard / AppAssetService が要求する最小の fetch 形（DOM の fetch と互換）。 */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

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
        'electron/main.ts must call installFetchTransport(netFetchTransport) before any remote fetch',
    );
  }
  return nodeFetchTransport;
}
