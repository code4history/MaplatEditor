// NOV26-IM-NETFETCH-CONTINGENCY-0483/0484: Chromium のネットワークスタックで取得する transport。
//
// 0483 の背景: Node 24.22.1 で直った CVE-2026-111497（Brotli 展開の範囲外書き込み）は
// Electron 同梱の Node 24.22.0 に残っている。Node の fetch（undici）は `Content-Encoding: br`
// の応答を Node 同梱の brotli で自動展開するため、外部 URL を読む経路がこの CVE を通る。
// Chromium 側（別プロセス）で展開すれば通らない。
//
// 0484 の背景（レビュー指摘・実 Electron で再現）: `net.fetch` は**既定の session** で動く。
// 既定の session には `protocol.handle` で登録した `app://` の handler があるため、http の応答が
// `302 Location: app://bundle/__local/...` を返すと、リダイレクトに追随した先で保存フォルダの
// ファイルが読めてしまった（scheme 制限は最初の URL にしか効いていなかった）。
//
// そこで外部取得は**外部取得専用の session** で行う:
//   - `session.fromPartition('maplat-remote-fetch', { cache: false })`（`persist:` を付けない
//     ＝ディスクに残らない）。独自スキームの handler は既定の session にしか無いので、
//     この session は `app://` を解決できない（実測: net::ERR_UNKNOWN_URL_SCHEME）。
//   - その session の `webRequest.onBeforeRequest` で http/https 以外の要求（リダイレクト先を
//     含む）をすべて cancel する。`onBeforeRedirect` でもリダイレクト先の scheme を記録し、
//     拒否の理由を `unsupported-scheme` として呼び出し元へ返す（取れなければ通信エラーでよい）。
//     Chromium のリダイレクト回数の上限（20）はそのまま任せる。
//   - 要求には `credentials: 'omit'` を付ける（専用 session でクッキーも共有しないが、念のため）。
//   - 応答 URL の scheme も確かめる（二重の防御。`session.fetch` は url を空で返す実測があるため、
//     実際の主防御は上の webRequest とリダイレクト記録である）。
//
// electron は名前空間で受ける（node 単体の smoke は electron を最小のスタブへ
// 差し替えており、名前付き import はリンク時に落ちるため。electron/utils/pwaChromiumRenderer.ts と同じ扱い）。
import * as electron from 'electron';
import { isHttpUrl, UnsupportedSchemeError, type FetchLike } from './fetchTransport';

/** 外部取得専用の session 名。`persist:` を付けないのでディスクには残らない。 */
export const REMOTE_FETCH_PARTITION = 'maplat-remote-fetch';

type AppLike = { isReady?: () => boolean; whenReady?: () => Promise<unknown> };
type WebRequestDetailsLike = { url: string; redirectURL?: string };
type CallbackResponseLike = { cancel: boolean };
type WebRequestLike = {
  onBeforeRequest: (
    filter: { urls: string[] },
    listener: (details: WebRequestDetailsLike, callback: (response: CallbackResponseLike) => void) => void,
  ) => void;
  onBeforeRedirect?: (listener: (details: WebRequestDetailsLike) => void) => void;
};
type RemoteSessionLike = {
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  webRequest: WebRequestLike;
};
type SessionModuleLike = {
  fromPartition?: (partition: string, options?: { cache: boolean }) => RemoteSessionLike;
};

// 「この要求の最中に http/https 以外を拒否した」ことを要求ごとに判定するための通し番号。
// 拒否そのものは webRequest が行い、ここは失敗の理由（unsupported-scheme）を付けるためだけに使う。
// 同時実行中の別要求の拒否を拾うことはあり得るが、その場合の差分は network → unsupported-scheme の
// 表記だけで、取得可否（＝防御）は変わらない。
let blockedSeq = 0;
let lastBlockedUrl = '';

function noteBlocked(url: string): void {
  blockedSeq += 1;
  lastBlockedUrl = url;
}

let remoteSession: Promise<RemoteSessionLike> | null = null;

/**
 * 外部取得専用 session を作り、http/https 以外を拒否する webRequest を一度だけ付ける。
 *
 * ready 前の呼び出しについて: `session.fromPartition` は app の ready 前に呼ぶと投げる（実測）。
 * 呼び出し元（IPC ハンドラ）は ready 後にしか到達しないが、将来の起動時経路が踏んでも
 * 壊れないよう、ここで ready を待ってから実行する。
 */
async function createRemoteSession(): Promise<RemoteSessionLike> {
  const app = (electron as { app?: AppLike }).app;
  if (app?.isReady && !app.isReady() && typeof app.whenReady === 'function') {
    await app.whenReady();
  }
  const sessionModule = (electron as { session?: SessionModuleLike }).session;
  if (!sessionModule || typeof sessionModule.fromPartition !== 'function') {
    throw new Error('session.fromPartition is unavailable (Electron main process required)');
  }
  const session = sessionModule.fromPartition(REMOTE_FETCH_PARTITION, { cache: false });

  session.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    if (isHttpUrl(details.url)) {
      callback({ cancel: false });
      return;
    }
    noteBlocked(details.url);
    callback({ cancel: true });
  });
  session.webRequest.onBeforeRedirect?.((details) => {
    const target = details.redirectURL;
    if (target && !isHttpUrl(target)) noteBlocked(target);
  });
  return session;
}

function getRemoteSession(): Promise<RemoteSessionLike> {
  if (!remoteSession) {
    remoteSession = createRemoteSession().catch((e) => {
      // 失敗した Promise を握り続けない（次回の取得で作り直す）
      remoteSession = null;
      throw e;
    });
  }
  return remoteSession;
}

/**
 * 外部取得専用 session の `fetch` を使う transport。
 *
 * - 最初の URL が http/https でなければ取りに行かない（`file:` もここで止まる。
 *   `AppAssetService.readTile` の file:/app: 分岐は従来どおり transport より前で fs 直読み）。
 * - リダイレクト先が http/https 以外なら webRequest が cancel する。失敗が「この要求の最中に
 *   起きた拒否」で説明できるときは `UnsupportedSchemeError` にして理由を伝える。
 */
export const remoteSessionFetchTransport: FetchLike = async (url, init) => {
  if (!isHttpUrl(url)) {
    throw new UnsupportedSchemeError(`unsupported scheme: ${url}`);
  }
  const session = await getRemoteSession();
  const startSeq = blockedSeq;
  let response: Response;
  try {
    response = await session.fetch(url, { ...init, credentials: 'omit' });
  } catch (e) {
    if (blockedSeq > startSeq) {
      throw new UnsupportedSchemeError(
        `blocked non-http(s) request while fetching ${url} (${lastBlockedUrl || 'unknown target'})`,
      );
    }
    throw e;
  }
  // 二重の防御: 応答 URL が http/https であること（本文はまだ読まない）。
  // session.fetch は url を空で返す実測があるため、値があるときだけ検査する。
  if (response.url && !isHttpUrl(response.url)) {
    throw new UnsupportedSchemeError(`response url is not http(s): ${response.url}`);
  }
  return response;
};
