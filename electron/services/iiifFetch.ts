import dns from 'node:dns';
import https from 'node:https';

/** 取得するものの種別。上限と受ける Content-Type は種別ごとに決まる。 */
export type IiifResourceKind = 'manifest' | 'info' | 'thumbnail';

/** 取得の失敗の理由。判定（配れるか）の語彙とは混ぜない。 */
export type IiifFetchReason =
  | 'bad-url'
  | 'not-https'
  | 'blocked-address'
  | 'fetch-failed'
  | 'timeout'
  | 'too-large';

/** 取得の成功。要求した URL と転送の後の最終 URL、応答の事実、本文を返す。 */
export type IiifFetchSuccess = {
  ok: true;
  requestedUrl: string;
  finalUrl: string;
  accessControlAllowOrigin?: string;
  contentType?: string;
  body: Buffer;
};

/** 取得の失敗。例外は投げずにこの形で返す。 */
export type IiifFetchFailure = {
  ok: false;
  reason: IiifFetchReason;
  detail?: string;
};

export type IiifFetchResult = IiifFetchSuccess | IiifFetchFailure;

export type IiifFetchOptions = {
  kind: IiifResourceKind;
};

/** 名前解決の結果。`dns.lookup` の両方の呼び方（配列・単数）を受ける。 */
export type IiifLookupCallback = (
  err: NodeJS.ErrnoException | null,
  address?: string | dns.LookupAddress[],
  family?: number,
) => void;

export type IiifLookupOptions = { all?: boolean; verbatim?: boolean };

export type IiifLookup = (
  hostname: string,
  options: IiifLookupOptions,
  callback: IiifLookupCallback,
) => void;

/** 宛先の分類。拒むなら blocked を真で返す。 */
export type IiifClassify = (address: string) => { blocked: boolean; reason?: string };

/** 取得の口。差し替えられるように依存として受け取る。 */
export type IiifFetchDeps = {
  lookup: IiifLookup;
  classify: IiifClassify;
  request: typeof https.request;
};

const defaultLookup: IiifLookup = (hostname, options, callback) => {
  if (options.all) {
    dns.lookup(hostname, { ...options, all: true }, (err, addresses) => callback(err, addresses));
    return;
  }
  dns.lookup(hostname, { ...options, all: false }, (err, address, family) =>
    callback(err, address, family),
  );
};

// 宛先の分類は取得の道を組み立てる段で入れる。それまでは何も拒まない。
const allowAll: IiifClassify = () => ({ blocked: false });

/**
 * URL の形を検査する。読めない文字列・https 以外の scheme・ポート 0 をここで落とす。
 * `http:` は「取得しない」ので `not-https`、それ以外の scheme は `bad-url` にする。
 */
export function checkIiifUrlShape(
  rawUrl: string,
): { ok: true; url: URL } | { ok: false; reason: 'bad-url' | 'not-https' } {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, reason: 'bad-url' };
  }
  if (parsed.protocol !== 'https:') {
    return { ok: false, reason: parsed.protocol === 'http:' ? 'not-https' : 'bad-url' };
  }
  if (parsed.port === '0') {
    return { ok: false, reason: 'bad-url' };
  }
  return { ok: true, url: parsed };
}

/**
 * IIIF の資源を取得する。Node の `https` だけを使い、名前解決の結果を分類して
 * 通ったときだけ取得する。失敗は例外にせず戻り値で返す。
 */
export async function fetchIiifResource(
  url: string,
  opts: IiifFetchOptions,
  deps: Partial<IiifFetchDeps> = {},
): Promise<IiifFetchResult> {
  const request = deps.request ?? https.request;
  const lookup = deps.lookup ?? defaultLookup;
  const classify = deps.classify ?? allowAll;
  void request;
  void lookup;
  void classify;
  void opts;

  const shape = checkIiifUrlShape(url);
  if (!shape.ok) {
    return { ok: false, reason: shape.reason };
  }

  return { ok: false, reason: 'fetch-failed', detail: 'the fetch transport is not wired yet' };
}
