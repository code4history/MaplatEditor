import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { classifyAddress } from '../../src/utils/ipClassify';

/** 取得するものの種別。上限と受ける Content-Type は種別ごとに決まる。 */
export type IiifResourceKind = 'manifest' | 'info' | 'thumbnail';

/**
 * 種別ごとの上限。締め切りは全体で 1 本、バイト数は本文の累計に掛ける。
 * 値はここ 1 か所だけに置く。
 */
export const IIIF_FETCH_LIMITS: Record<
  IiifResourceKind,
  { timeoutMs: number; maxBytes: number }
> = {
  manifest: { timeoutMs: 15000, maxBytes: 8 * 1024 * 1024 },
  info: { timeoutMs: 15000, maxBytes: 1024 * 1024 },
  thumbnail: { timeoutMs: 15000, maxBytes: 2 * 1024 * 1024 },
};

/** 追う転送の回数の上限。6 回目で止める。 */
const MAX_REDIRECTS = 5;

/** 追う転送の状態のコード。 */
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

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
function failureFromError(error: unknown, timedOut = false): IiifFetchFailure {
  const candidate = (error ?? {}) as NetworkError;
  const code = typeof candidate.code === 'string' ? candidate.code : undefined;
  const address = typeof candidate.address === 'string' ? candidate.address : undefined;
  const port = typeof candidate.port === 'number' ? candidate.port : undefined;
  const message = error instanceof Error ? error.message : String(error);
  let reason: IiifFetchReason = 'fetch-failed';
  if (timedOut || code === 'ETIMEDOUT') reason = 'timeout';
  else if (code === 'EBLOCKEDADDRESS') reason = 'blocked-address';
  const failure: IiifFetchFailure = {
    ok: false,
    reason,
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

/** `Content-Length` を数として読む。読めなければ undefined（累計の上限で測る）。 */
function declaredLengthOf(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return undefined;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

/** 応答が圧縮されているか（`identity` 以外の `Content-Encoding` は受けない）。 */
function isCompressed(value: string | undefined): boolean {
  if (value === undefined) return false;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 && normalized !== 'identity';
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
 * 転送（3xx）は自分で追う。各段で URL の形の検査・IP のリテラルの分類・
 * 新しい固定の lookup による接続、の同じ道を通す。追うのは 5 回まで。
 * 締め切りは全体で 1 本。本文は `Content-Length` を先に見て、無ければ読みながら
 * 累計を測り、種別ごとの上限を超えたら切る。
 */
export async function fetchIiifResource(
  url: string,
  opts: IiifFetchOptions,
  deps: Partial<IiifFetchDeps> = {},
): Promise<IiifFetchResult> {
  const request: IiifRequest = deps.request ?? https.request;
  const lookup = deps.lookup ?? defaultLookup;
  const classify: IiifClassify = deps.classify ?? classifyAddress;

  const limits = IIIF_FETCH_LIMITS[opts.kind] ?? IIIF_FETCH_LIMITS.manifest;
  const timeoutMs =
    typeof opts.timeoutMs === 'number' && opts.timeoutMs > 0 ? opts.timeoutMs : limits.timeoutMs;
  const maxBytes = limits.maxBytes;

  return new Promise<IiifFetchResult>((resolve) => {
    let settled = false;
    let timedOut = false;
    let timer: NodeJS.Timeout | undefined;
    let currentReq: http.ClientRequest | undefined;
    const finish = (result: IiifFetchResult) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };

    // 締め切りは全体で 1 本。転送のたびに延ばさない。過ぎたら直前の要求を壊して止める。
    timer = setTimeout(() => {
      timedOut = true;
      const timeout: NetworkError = new Error('the request did not finish in ' + timeoutMs + ' ms');
      timeout.code = 'ETIMEDOUT';
      if (currentReq) currentReq.destroy(timeout);
      finish({ ok: false, reason: 'timeout', detail: String(timeout.message) });
    }, timeoutMs);

    const attempt = (targetUrl: string, redirects: number) => {
      if (settled) return;

      const shape = checkIiifUrlShape(targetUrl);
      if (!shape.ok) {
        finish({ ok: false, reason: shape.reason });
        return;
      }

      const parsed = shape.url;
      const hostname = parsed.hostname.replace(/^\[/, '').replace(/\]$/, '');

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
          finish({
            ok: false,
            reason: 'blocked-address',
            detail: verdict.reason ?? 'the address ' + hostname + ' is not allowed',
          });
          return;
        }
      } else {
        // 依頼の口（net の LookupFunction）はアドレスを必ず渡す形なので、
        // 省略可能な受け手との差だけを型の上で埋める。
        requestOptions.lookup = createPinnedLookup(lookup, classify) as unknown as NonNullable<
          https.RequestOptions['lookup']
        >;
        requestOptions.servername = hostname;
      }

      let req: http.ClientRequest;
      try {
        req = request(requestOptions, (response) => {
          const status = response.statusCode ?? 0;

          if (REDIRECT_STATUSES.has(status)) {
            const location = headerValue(response.headers.location);
            response.on('error', (error) => finish(failureFromError(error, timedOut)));
            // 転送の応答の本文は読み捨てる。
            response.resume();
            if (!location) {
              finish({
                ok: false,
                reason: 'fetch-failed',
                detail: 'status ' + status + ' without a location',
              });
              return;
            }
            if (redirects >= MAX_REDIRECTS) {
              finish({
                ok: false,
                reason: 'fetch-failed',
                detail:
                  'too many redirects (more than ' +
                  MAX_REDIRECTS +
                  ') at ' +
                  targetUrl,
              });
              return;
            }
            let next: URL;
            try {
              next = new URL(location, parsed);
            } catch {
              finish({
                ok: false,
                reason: 'bad-url',
                detail: 'the location is not a url: ' + location,
              });
              return;
            }
            attempt(next.toString(), redirects + 1);
            return;
          }

          // 200 だけを受ける。それ以外は本文を読まずに捨てる。
          if (status < 200 || status >= 300) {
            const location = headerValue(response.headers.location);
            response.on('error', () => {});
            response.resume();
            finish({
              ok: false,
              reason: 'fetch-failed',
              detail:
                'unexpected status ' + status + (location ? ' (location: ' + location + ')' : ''),
            });
            return;
          }

          // 圧縮された応答は捨てる（Accept-Encoding を送っていないので本来来ない）。
          const contentEncoding = headerValue(response.headers['content-encoding']);
          if (isCompressed(contentEncoding)) {
            response.on('error', () => {});
            response.resume();
            finish({
              ok: false,
              reason: 'fetch-failed',
              detail: 'the response is compressed: ' + String(contentEncoding),
            });
            return;
          }

          // Content-Length があれば、本文を読む前に上限と比べる。
          const declaredLength = declaredLengthOf(headerValue(response.headers['content-length']));
          if (declaredLength !== undefined && declaredLength > maxBytes) {
            response.on('error', () => {});
            response.destroy();
            if (currentReq) currentReq.destroy();
            finish({
              ok: false,
              reason: 'too-large',
              detail:
                'the declared length ' +
                declaredLength +
                ' is larger than the limit ' +
                maxBytes,
            });
            return;
          }

          const chunks: Buffer[] = [];
          let received = 0;
          let stopped = false;
          response.on('data', (chunk: Buffer | string) => {
            if (stopped) return;
            const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
            received += buffer.length;
            // Content-Length が無い（または足りない）ときは、読みながら累計で測る。
            if (received > maxBytes) {
              stopped = true;
              response.destroy();
              if (currentReq) currentReq.destroy();
              finish({
                ok: false,
                reason: 'too-large',
                detail: 'the body grew past the limit ' + maxBytes + ' while being read',
              });
              return;
            }
            chunks.push(buffer);
          });
          response.on('end', () => {
            if (settled) return;
            finish({
              ok: true,
              requestedUrl: url,
              finalUrl: targetUrl,
              accessControlAllowOrigin: headerValue(response.headers['access-control-allow-origin']),
              contentType: headerValue(response.headers['content-type']),
              body: Buffer.concat(chunks),
            });
          });
          response.on('error', (error) => finish(failureFromError(error, timedOut)));
        });
      } catch (error) {
        finish(failureFromError(error, timedOut));
        return;
      }

      currentReq = req;
      req.on('error', (error) => finish(failureFromError(error, timedOut)));

      req.end();
    };

    attempt(url, 0);
  });
}
