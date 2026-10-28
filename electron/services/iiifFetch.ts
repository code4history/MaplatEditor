import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { classifyAddress } from '../../src/utils/ipClassify';

/** 応答を受け取るまでの既定の締め切り（全体で 1 本）。 */
const DEFAULT_TIMEOUT_MS = 15000;

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
  /**
   * 元のエラーの事実。IPC を越えるので文字列と数だけを持つ
   * （renderer に `Error` の文字列をそのまま出さないため）。
   */
  cause?: { code?: string; address?: string; port?: number };
};

export type IiifFetchResult = IiifFetchSuccess | IiifFetchFailure;

export type IiifFetchOptions = {
  kind: IiifResourceKind;
  /** 締め切り（ミリ秒）。省略したら既定の 15 秒。試験からは短く渡す。 */
  timeoutMs?: number;
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
export type IiifRequest = (
  options: https.RequestOptions,
  callback: (response: http.IncomingMessage) => void,
) => http.ClientRequest;

export type IiifFetchDeps = {
  lookup: IiifLookup;
  classify: IiifClassify;
  request: IiifRequest;
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

/** 名前解決のエラーに、接続の相手の事実を添えて返すための型。 */
type NetworkError = NodeJS.ErrnoException & { address?: string; port?: number };

/** 名前解決の答えを、単数の文字列でも配列でも受けて配列にそろえる。 */
function normalizeAddresses(
  answer: string | dns.LookupAddress[] | undefined,
  family?: number,
): dns.LookupAddress[] {
  if (Array.isArray(answer)) {
    return answer.filter((entry) => entry && typeof entry.address === 'string');
  }
  if (typeof answer === 'string' && answer.length > 0) {
    return [{ address: answer, family: family ?? 0 }];
  }
  return [];
}

/**
 * 名前解決を 1 回だけ行い、判定を通った先頭のアドレスへ宛先を固定する lookup を作る。
 * 返った全部のアドレスを分類に掛け、1 つでも拒むなら接続しない。
 * `options.all` が真なら 1 件の配列、偽なら単数のアドレスと family を返す
 * （`dns.lookup` の 2 つの呼び方に合わせる）。
 */
export function createPinnedLookup(lookup: IiifLookup, classify: IiifClassify): IiifLookup {
  return (hostname, options, callback) => {
    lookup(hostname, { all: true, verbatim: true }, (error, answer, family) => {
      if (error) {
        callback(error);
        return;
      }
      const addresses = normalizeAddresses(answer, family);
      if (addresses.length === 0) {
        const empty: NetworkError = new Error('the name did not resolve to any address');
        empty.code = 'ENOTFOUND';
        callback(empty);
        return;
      }
      const blocked = addresses.find((entry) => classify(entry.address).blocked);
      if (blocked) {
        const refusal: NetworkError = new Error('the name resolved to a blocked address');
        refusal.code = 'EBLOCKEDADDRESS';
        refusal.address = blocked.address;
        callback(refusal);
        return;
      }
      const pinned = addresses[0];
      if (options.all) {
        callback(null, [pinned]);
        return;
      }
      callback(null, pinned.address, pinned.family);
    });
  };
}

/** エラーを、例外にせず戻り値に載せられる形へ畳む。 */
function failureFromError(error: unknown): IiifFetchFailure {
  const candidate = (error ?? {}) as NetworkError;
  const code = typeof candidate.code === 'string' ? candidate.code : undefined;
  const address = typeof candidate.address === 'string' ? candidate.address : undefined;
  const port = typeof candidate.port === 'number' ? candidate.port : undefined;
  const message = error instanceof Error ? error.message : String(error);
  const failure: IiifFetchFailure = {
    ok: false,
    reason: code === 'EBLOCKEDADDRESS' ? 'blocked-address' : 'fetch-failed',
    detail: message,
  };
  if (code !== undefined || address !== undefined || port !== undefined) {
    failure.cause = {};
    if (code !== undefined) failure.cause.code = code;
    if (address !== undefined) failure.cause.address = address;
    if (port !== undefined) failure.cause.port = port;
  }
  return failure;
}

/** 応答のヘッダの値を 1 本の文字列にする（配列なら先頭）。 */
function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

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
 *
 * 名前の宛先は 1 回の解決で固定する（判定したアドレスと接続の宛先を食い違わせない）。
 * リダイレクト・本文の大きさの上限はこの段では扱わない。
 */
export async function fetchIiifResource(
  url: string,
  opts: IiifFetchOptions,
  deps: Partial<IiifFetchDeps> = {},
): Promise<IiifFetchResult> {
  const request: IiifRequest = deps.request ?? https.request;
  const lookup = deps.lookup ?? defaultLookup;
  const classify: IiifClassify = deps.classify ?? classifyAddress;

  const shape = checkIiifUrlShape(url);
  if (!shape.ok) {
    return { ok: false, reason: shape.reason };
  }

  const parsed = shape.url;
  const hostname = parsed.hostname.replace(/^\[/, '').replace(/\]$/, '');
  const timeoutMs =
    typeof opts.timeoutMs === 'number' && opts.timeoutMs > 0 ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;

  const requestOptions: https.RequestOptions = {
    hostname,
    port: parsed.port ? Number(parsed.port) : 443,
    path: (parsed.pathname || '/') + parsed.search,
    method: 'GET',
    // Cookie・Authorization・Accept-Encoding は送らない。
    headers: { accept: 'application/json, application/ld+json, image/*;q=0.9, */*;q=0.1' },
    agent: false,
  };

  if (net.isIP(hostname)) {
    // IP のリテラルは名前解決を通らないので、要求の前に文字列のまま分類に掛ける。
    const verdict = classify(hostname);
    if (verdict.blocked) {
      return {
        ok: false,
        reason: 'blocked-address',
        detail: verdict.reason ?? 'the address ' + hostname + ' is not allowed',
      };
    }
  } else {
    // 依頼の口（net の LookupFunction）はアドレスを必ず渡す形なので、
    // 省略可能な受け手との差だけを型の上で埋める。
    requestOptions.lookup = createPinnedLookup(lookup, classify) as unknown as NonNullable<
      https.RequestOptions['lookup']
    >;
    requestOptions.servername = hostname;
  }

  return new Promise<IiifFetchResult>((resolve) => {
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const finish = (result: IiifFetchResult) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };

    let req: http.ClientRequest;
    try {
      req = request(requestOptions, (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer | string) => {
          chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
        });
        response.on('end', () => {
          const status = response.statusCode ?? 0;
          if (status < 200 || status >= 300) {
            const location = headerValue(response.headers.location);
            finish({
              ok: false,
              reason: 'fetch-failed',
              detail: 'unexpected status ' + status + (location ? ' (location: ' + location + ')' : ''),
            });
            return;
          }
          finish({
            ok: true,
            requestedUrl: url,
            finalUrl: url,
            accessControlAllowOrigin: headerValue(response.headers['access-control-allow-origin']),
            contentType: headerValue(response.headers['content-type']),
            body: Buffer.concat(chunks),
          });
        });
        response.on('error', (error) => finish(failureFromError(error)));
      });
    } catch (error) {
      finish(failureFromError(error));
      return;
    }

    req.on('error', (error) => finish(failureFromError(error)));

    // 締め切りは全体で 1 本。過ぎたら要求を壊して止める。
    timer = setTimeout(() => {
      const timeout: NetworkError = new Error('the request did not finish in ' + timeoutMs + ' ms');
      timeout.code = 'ETIMEDOUT';
      req.destroy(timeout);
      finish({ ok: false, reason: 'timeout', detail: String(timeout.message) });
    }, timeoutMs);

    req.end();
  });
}
