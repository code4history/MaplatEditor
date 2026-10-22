// m6-t7: リモート fetch の共有防御ユーティリティ。scheme 検証・タイムアウト・
// ストリームサイズガードの3点のみを担う（PoiSourceService.fetchRemote/fetchSnapshot
// 冒頭の scheme 検証から抽出。挙動は完全に踏襲し、写像は呼び出し元が行う — 設計書
// docs/superpowers/specs/2026-08-06-m6-t7-tilejson-import-design.md §3.1 参照）。
//
// セキュリティ境界: 本モジュールが行うのはこの3点のみ。localhost・プライベート IP・
// リンクローカルアドレス（169.254.169.254 等）への到達は塞がない（SSRF 対策は対象外）。
// これは既存 PoiSourceService と同一の姿勢であり、本モジュールが新規リスクを導入する
// ものではない。呼び出し元は「guardedFetch を通したから安全」と誤解しないこと。
// 宛先の検査・DNS 解決結果の固定（rebinding 対策）・リダイレクト先の検査は **無い**
// （Node の fetch も既定で最大 20 回まで追随する）。ここは現状の強さを変えずに維持する。
//
// NOV26-IM-NETFETCH-CONTINGENCY-0483: 取得そのものは fetchTransport 経由にした。
// 製品（Electron main）では `net.fetch`（Chromium のネットワークスタック）で実行され、
// Node 同梱 brotli の CVE-2026-111497（brotli 展開の範囲外書き込み）を通らない。
// 3点の防御は transport を差し替えても不変（scheme は transport を呼ぶ前に、大きさは
// 応答の読み方で、時間は AbortController で担保している）。
import { getFetchTransport } from './fetchTransport';

export const DEFAULT_FETCH_TIMEOUT_MS = 10_000;
export const DEFAULT_REMOTE_MAX_BYTES = 50 * 1024 * 1024;

export type GuardedFetchResult =
  | { ok: true; text: string; contentLanguage?: string }
  | { ok: false; code: 'unsupported-scheme' }
  | { ok: false; code: 'too-large' }
  | { ok: false; code: 'network' | 'http-status'; message: string };

export async function guardedFetch(
  url: string,
  options?: { timeoutMs?: number; maxBytes?: number },
): Promise<GuardedFetchResult> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return { ok: false, code: 'unsupported-scheme' };
  }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return { ok: false, code: 'unsupported-scheme' };
  }

  const timeoutMs = options?.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const maxBytes = options?.maxBytes ?? DEFAULT_REMOTE_MAX_BYTES;

  // 取得は transport 経由（製品では net.fetch）。scheme 検査はこの解決より前で済んでいる。
  // net.fetch は file: も読めるため、この順序（scheme → transport）が防御の一部である。
  // 解決は try の外で行う: Electron 上で transport 未登録なら「ネットワーク失敗」ではなく
  // プログラミングの誤りとして投げる（fail loudly。e2e が検出する）。
  const transport = getFetchTransport();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await transport(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      return { ok: false, code: 'http-status', message: `HTTP ${response.status} ${response.statusText}` };
    }
    // content-length が明らかに上限超過なら本文を読まずに打ち切る
    const contentLength = response.headers.get('content-length');
    if (contentLength && Number.parseInt(contentLength, 10) > maxBytes) {
      controller.abort();
      return { ok: false, code: 'too-large' };
    }
    if (!response.body) {
      // body stream 非対応環境の保険 (Node の fetch は常に body を持つ)
      const text = await response.text();
      if (Buffer.byteLength(text, 'utf8') > maxBytes) {
        return { ok: false, code: 'too-large' };
      }
      return { ok: true, text, contentLanguage: response.headers.get('content-language') || undefined };
    }
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        controller.abort();
        return { ok: false, code: 'too-large' };
      }
      chunks.push(Buffer.from(value));
    }
    return { ok: true, text: Buffer.concat(chunks).toString('utf8'), contentLanguage: response.headers.get('content-language') || undefined };
  } catch (e: any) {
    const message = e?.name === 'AbortError' ? 'Fetch timed out' : String(e);
    return { ok: false, code: 'network', message };
  } finally {
    clearTimeout(timeout);
  }
}
