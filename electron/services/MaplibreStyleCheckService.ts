// MapLibre のベースマップの style を取得して、MapLibre GL JS の 5 系で動くかを判定する（IPC basemaps:check-maplibre-style）。
//
// 取得は main で行う（renderer から取ると style の配信元の CORS と renderer の CSP に左右される）。
// 既存の guardedFetch（http/https だけ・外部取得専用の session・時間切れと大きさの上限）を、時間と大きさを
// 引数で明示して使う。guardedFetch は内向きの宛先（localhost・プライベート IP）を塞がないので、返すものを
// 「判定の結果と、理由の種類と場所」だけに絞る。取得した本文・応答のヘッダ・相手の誤りの文は返さない。
import { guardedFetch } from './remoteFetchGuard';
import {
  judgeMaplibreStyleSupport,
  type MaplibreStyleSupportResult,
} from '../../src/utils/maplibreStyleSupport';

export const MAPLIBRE_STYLE_CHECK_TIMEOUT_MS = 10_000;
export const MAPLIBRE_STYLE_CHECK_MAX_BYTES = 5 * 1024 * 1024;
export const MAPLIBRE_STYLE_CHECK_MAX_URL_LENGTH = 2048;

export async function checkMaplibreStyle(url: unknown): Promise<MaplibreStyleSupportResult> {
  if (typeof url !== 'string' || url.length > MAPLIBRE_STYLE_CHECK_MAX_URL_LENGTH) {
    return { result: 'unknown', reasons: [{ kind: 'invalid-argument' }] };
  }
  const fetched = await guardedFetch(url, {
    timeoutMs: MAPLIBRE_STYLE_CHECK_TIMEOUT_MS,
    maxBytes: MAPLIBRE_STYLE_CHECK_MAX_BYTES,
  });
  if (!fetched.ok) {
    // 種類だけを返す（guardedFetch の message は相手の応答から来るので返さない）
    return { result: 'unknown', reasons: [{ kind: fetched.code }] };
  }
  let style: unknown;
  try {
    style = JSON.parse(fetched.text);
  } catch {
    return { result: 'unknown', reasons: [{ kind: 'invalid-json' }] };
  }
  return judgeMaplibreStyleSupport(style);
}
