// NOV26-IM-NETFETCH-CONTINGENCY-0483: Chromium のネットワークスタックで取得する transport。
//
// `net.fetch` は「renderer の fetch と同じく Chromium のネットワークサービス経由」で
// リクエストを出す（Node の fetch/undici とは別の実装）。応答本文は Chromium 側で
// 展開されるため、Node 同梱 brotli の CVE-2026-111497 を通らない。
//
// electron は名前空間で受ける（node 単体の smoke は electron を最小のスタブへ
// 差し替えており、名前付き import はリンク時に落ちるため。electron/utils/pwaChromiumRenderer.ts と同じ扱い）。
import * as electron from 'electron';
import type { FetchLike } from './fetchTransport';

type NetLike = { fetch?: (url: string, init?: RequestInit) => Promise<Response> };
type AppLike = { isReady?: () => boolean; whenReady?: () => Promise<unknown> };

/**
 * `net.fetch` をそのまま使う transport。
 *
 * ready 前の呼び出しについて: `net.fetch` は app の ready 前に呼ぶと
 * **同期で** `TypeError: Session can only be received when app is ready` を投げる（実測）。
 * 呼び出し元（IPC ハンドラ）は ready 後にしか到達しないが、将来の起動時経路が
 * 踏んでも壊れないよう、ここで ready を待ってから実行する。
 */
export const netFetchTransport: FetchLike = async (url, init) => {
  const net = (electron as { net?: NetLike }).net;
  const app = (electron as { app?: AppLike }).app;
  if (!net || typeof net.fetch !== 'function') {
    throw new Error('net.fetch is unavailable (Electron main process required)');
  }
  if (app?.isReady && !app.isReady() && typeof app.whenReady === 'function') {
    await app.whenReady();
  }
  return net.fetch(url, init);
};
