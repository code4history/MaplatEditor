// IIIF の取り込みで main が行う取得の入口（Manifest・info.json・サムネイル）。
//
// 取得の道は electron/services/iiifFetch.ts の fetchIiifResource 1 本だけを通す
// （別の道を作らない）。ここでは配れるかの判定をせず、取れた事実と JSON を返す
// だけにする。renderer とのやり取り（IPC）はこの段には置かない。

import {
  fetchIiifResource,
  type IiifFetchDeps,
  type IiifFetchFailure,
  type IiifFetchReason,
  type IiifFetchResult,
} from './iiifFetch';

/** 取得の依存の差し込み口。省略したら本物（名前解決・分類・要求）を使う。 */
export type IiifServiceDeps = Partial<IiifFetchDeps>;

/** JSON を読めなかったときの理由。取得の失敗の語彙に 1 語だけ足す。 */
export type IiifInspectReason = IiifFetchReason | 'not-json';

/** 取得の失敗、または本文を JSON として読めなかったこと。 */
export type IiifInspectFailure = Omit<IiifFetchFailure, 'reason'> & {
  reason: IiifInspectReason;
};

/** 取得して JSON にしたものと、応答の事実。 */
export type IiifInspectSuccess = {
  ok: true;
  /** `JSON.parse` に通した値。生の応答の文字列は返さない。 */
  json: unknown;
  /** 要求した URL。 */
  requestedUrl: string;
  /** 転送を追った後の最終 URL。 */
  finalUrl: string;
  /** 応答の `Access-Control-Allow-Origin`（無ければ undefined）。 */
  accessControlAllowOrigin?: string;
};

export type IiifInspectResult = IiifInspectSuccess | IiifInspectFailure;

/** サムネイル 1 枚の取得の結果。本文のバイトと `Content-Type` を返す。 */
export type IiifThumbnailResult = IiifFetchResult;

export type IiifThumbnailsResult = {
  url52: IiifThumbnailResult;
  url512: IiifThumbnailResult;
};

/** サムネイルの URL の組。URL は renderer が作って渡す。 */
export type IiifThumbnailUrls = { url52: string; url512: string };

/**
 * 画像サービスの URL から info.json の URL を作る。
 * すでに `/info.json` で終わっていれば足さない。末尾の `/` は 1 つにまとめる。
 */
export function iiifInfoJsonUrl(serviceUrl: string): string {
  if (serviceUrl.endsWith('/info.json')) return serviceUrl;
  // 末尾の / は 1 つにまとめる（Core が info.json の URL を作るときと同じ形）
  return serviceUrl.replace(/\/+$/, '') + '/info.json';
}

/**
 * 取得して本文を JSON として読む。JSON かどうかは `JSON.parse` で決める
 * （`Content-Type` は見ない）。読めなければ `not-json` を返す。
 */
async function fetchJsonResource(
  url: string,
  kind: 'manifest' | 'info',
  deps: IiifServiceDeps,
): Promise<IiifInspectResult> {
  const result = await fetchIiifResource(url, { kind }, deps);
  if (!result.ok) return result;

  let json: unknown;
  try {
    json = JSON.parse(result.body.toString('utf8'));
  } catch {
    return { ok: false, reason: 'not-json', detail: 'the response is not json: ' + url };
  }

  return {
    ok: true,
    json,
    requestedUrl: result.requestedUrl,
    finalUrl: result.finalUrl,
    accessControlAllowOrigin: result.accessControlAllowOrigin,
  };
}

/** Manifest を取得して JSON にする。 */
export async function inspectManifest(
  url: string,
  deps: IiifServiceDeps = {},
): Promise<IiifInspectResult> {
  return fetchJsonResource(url, 'manifest', deps);
}

/**
 * 画像サービスの info.json を取得して JSON にする。
 * `serviceUrl` の末尾に `/info.json` を足して取る（すでに終わっていれば足さない）。
 */
export async function inspectInfo(
  serviceUrl: string,
  deps: IiifServiceDeps = {},
): Promise<IiifInspectResult> {
  return fetchJsonResource(iiifInfoJsonUrl(serviceUrl), 'info', deps);
}

/**
 * サムネイル 2 枚（52px・512px）を取得する。URL は renderer が作って渡す。
 * この段では取るだけで、保存はしない。
 */
export async function fetchThumbnails(
  urls: IiifThumbnailUrls,
  deps: IiifServiceDeps = {},
): Promise<IiifThumbnailsResult> {
  const url52 = await fetchIiifResource(urls.url52, { kind: 'thumbnail' }, deps);
  const url512 = await fetchIiifResource(urls.url512, { kind: 'thumbnail' }, deps);
  return { url52, url512 };
}
