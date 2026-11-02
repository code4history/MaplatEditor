// The local MCP endpoint: http://127.0.0.1:<port>/mcp, stateless, JSON responses only.
//
// Order of checks for every request (each one ends the request when it fails):
//   1. path is exactly /mcp                      -> 404
//   2. Host is 127.0.0.1:<port> or localhost:<port>, and there is no Origin header -> 403
//   3. method is POST                             -> 405  (so browser GETs never reach the token check)
//   4. bearer token, after the failure delay      -> 401  (only these failures are counted)
//   5. at most maxConcurrent requests at a time   -> 429
//   6. body size                                  -> 413
// Then a fresh McpServer and transport are created for this request only and both are closed afterwards.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { connect } from 'node:net';
import { setTimeout as setTimer, clearTimeout as clearTimer } from 'node:timers';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { checkBearer, checkHost, checkOrigin, checkPath, FailureDelay, MCP_PATH } from './requestGuard';
import { registerTools as defaultRegisterTools, type RegisterTools } from './tools';
import { DEFAULT_LIMITS, type McpLimits } from './limits';
import { logLifecycle, logRejected, logRequest, safeName } from './log';
import type * as ReadFacade from './readFacade';

export type ListenResult = { ok: true } | { ok: false; kind: 'port-in-use' | 'listen-failed' };

export interface McpHttpServerDeps {
  port: number;
  /** Read on every request, so a regenerated token takes effect at once. */
  getToken: () => string;
  facade: typeof ReadFacade;
  version: string;
  limits?: Readonly<McpLimits>;
  registerTools?: RegisterTools;
  now?: () => number;
  /** Called after a request passed the token check. */
  onAuthorizedRequest?: () => void;
}

export interface McpHttpServer {
  listen(): Promise<ListenResult>;
  close(): Promise<void>;
  address(): ReturnType<Server['address']>;
  readonly failureDelay: FailureDelay;
}

type Socket = IncomingMessage['socket'];

/** Headers the transport needs. Nothing else from the request is passed on. */
const FORWARDED_HEADERS = ['content-type', 'accept', 'mcp-protocol-version', 'mcp-session-id', 'last-event-id'];

/**
 * Ends the connection once the answer is written, so a rejected client cannot keep the server reading the
 * rest of its body.
 */
function closeAfterAnswer(req: IncomingMessage, res: ServerResponse): void {
  if (res.headersSent || res.destroyed) return;
  res.setHeader('Connection', 'close');
  res.once('finish', () => req.destroy());
}

/** Resolves true when something already accepts connections on 127.0.0.1:<port>. */
function portAnswers(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ port, host: '127.0.0.1' });
    const done = (answered: boolean) => {
      socket.destroy();
      resolve(answered);
    };
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.setTimeout(1000, () => done(false));
  });
}

function sendPlain(res: ServerResponse, status: number, text: string, extra: Record<string, string> = {}): void {
  if (res.headersSent || res.destroyed) return;
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...extra });
  res.end(text);
}

function sendJsonRpcError(res: ServerResponse, status: number, id: unknown, code: number, message: string): number {
  if (res.headersSent || res.destroyed) return 0;
  const body = JSON.stringify({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(body);
  return Buffer.byteLength(body);
}

function wait(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimer(resolve, ms));
}

class BodyTooLarge extends Error {}

function readBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > maxBytes) {
      reject(new BodyTooLarge());
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        req.removeAllListeners('data');
        reject(new BodyTooLarge());
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** The name written to the log: the tool name for tools/call, otherwise the JSON-RPC method. */
function describeMessage(parsed: unknown): { name: string; id: unknown } {
  const first = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!first || typeof first !== 'object') return { name: 'unknown', id: null };
  const message = first as { method?: unknown; id?: unknown; params?: { name?: unknown } };
  const name = message.method === 'tools/call' ? message.params?.name : message.method;
  return { name: safeName(name), id: message.id ?? null };
}

export function createMcpHttpServer(deps: McpHttpServerDeps): McpHttpServer {
  const limits = deps.limits ?? DEFAULT_LIMITS;
  const now = deps.now ?? Date.now;
  const registerTools = deps.registerTools ?? defaultRegisterTools;
  const failureDelay = new FailureDelay(limits.failureDelayStepMs, limits.failureDelayCap);
  const sockets = new Set<Socket>();
  let waitingForAuth = 0;
  let active = 0;

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const target = req.url;
    if (!checkPath(target)) {
      logRejected('path');
      closeAfterAnswer(req, res);
      sendPlain(res, 404, 'Not Found');
      return;
    }
    if (!checkHost(req.headers.host, deps.port, target)) {
      logRejected('host');
      closeAfterAnswer(req, res);
      sendPlain(res, 403, 'Forbidden');
      return;
    }
    if (!checkOrigin(req.headers.origin)) {
      logRejected('origin');
      closeAfterAnswer(req, res);
      sendPlain(res, 403, 'Forbidden');
      return;
    }
    if (req.method !== 'POST') {
      logRejected('method');
      closeAfterAnswer(req, res);
      sendPlain(res, 405, 'Method Not Allowed', { Allow: 'POST' });
      return;
    }

    if (waitingForAuth >= limits.maxWaitingForAuth) {
      logRejected('auth-queue-full');
      closeAfterAnswer(req, res);
      sendPlain(res, 401, 'Unauthorized', { 'WWW-Authenticate': 'Bearer' });
      return;
    }
    waitingForAuth += 1;
    try {
      await wait(failureDelay.delayMs(now()));
    } finally {
      waitingForAuth -= 1;
    }
    if (res.destroyed) return;
    if (!checkBearer(req.headers.authorization, deps.getToken())) {
      failureDelay.recordFailure(now());
      logRejected('auth');
      closeAfterAnswer(req, res);
      sendPlain(res, 401, 'Unauthorized', { 'WWW-Authenticate': 'Bearer' });
      return;
    }
    deps.onAuthorizedRequest?.();

    if (active >= limits.maxConcurrent) {
      logRejected('busy');
      closeAfterAnswer(req, res);
      sendJsonRpcError(res, 429, null, -32000, `too many concurrent requests (max ${limits.maxConcurrent})`);
      return;
    }
    active += 1;
    const started = now();
    try {
      await handleAuthorized(req, res, started);
    } finally {
      active -= 1;
    }
  }

  async function handleAuthorized(req: IncomingMessage, res: ServerResponse, started: number): Promise<void> {
    let body: Buffer;
    try {
      body = await readBody(req, limits.maxRequestBodyBytes);
    } catch (e) {
      if (e instanceof BodyTooLarge) {
        logRejected('body-too-large');
        closeAfterAnswer(req, res);
        sendJsonRpcError(res, 413, null, -32600, `request body too large (max ${limits.maxRequestBodyBytes} bytes)`);
      } else {
        res.destroy();
      }
      return;
    }

    // Invalid JSON is left to the transport, which answers with a JSON-RPC parse error.
    let parsed: unknown;
    try {
      parsed = JSON.parse(body.toString('utf8'));
    } catch {
      parsed = undefined;
    }
    const { name, id } = describeMessage(parsed);
    if (Array.isArray(parsed)) {
      // One request carries one message; a JSON array would pack many tool calls past the concurrency limit.
      logRejected('batch');
      closeAfterAnswer(req, res);
      sendJsonRpcError(res, 400, null, -32600, 'batch requests are not supported');
      return;
    }

    const headers = new Headers();
    for (const key of FORWARDED_HEADERS) {
      const value = req.headers[key];
      if (typeof value === 'string') headers.set(key, value);
    }
    const request = new Request(`http://127.0.0.1:${deps.port}${MCP_PATH}`, { method: 'POST', headers, body: new Uint8Array(body) });

    const abort = new AbortController();
    const server = new McpServer({ name: 'maplat-editor', version: deps.version });
    registerTools(server, { facade: deps.facade, limits, signal: abort.signal, version: deps.version });
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
      maxRequestBodySize: limits.maxRequestBodyBytes,
    });

    let timer: ReturnType<typeof setTimer> | undefined;
    const timedOut = new Promise<'timeout'>((resolve) => {
      timer = setTimer(() => resolve('timeout'), limits.requestTimeoutMs);
    });
    // A client that hangs up before the answer is written aborts its tool.
    const clientGone = new Promise<'gone'>((resolve) => {
      res.once('close', () => {
        if (!res.writableFinished) resolve('gone');
      });
    });
    let handling: Promise<Response> | undefined;
    try {
      await server.connect(transport);
      handling = transport.handleRequest(request, parsed === undefined ? undefined : { parsedBody: parsed });
      const outcome = await Promise.race([handling, timedOut, clientGone]);
      if (outcome === 'timeout' || outcome === 'gone') {
        abort.abort();
        logRejected(outcome === 'timeout' ? 'timeout' : 'client-closed');
        const bytes = outcome === 'timeout'
          ? sendJsonRpcError(res, 200, id, -32001, `request timed out after ${limits.requestTimeoutMs} ms`)
          : 0;
        logRequest(name, outcome === 'timeout' ? 'error:timeout' : 'error:client-closed', bytes, now() - started);
        // Keep this request's slot until the tool has really stopped, so aborted tools still count
        // against the concurrency limit.
        await handling.catch(() => undefined);
        return;
      }
      const responseBody = Buffer.from(await outcome.arrayBuffer());
      if (!res.headersSent && !res.destroyed) {
        const outHeaders: Record<string, string> = { 'Cache-Control': 'no-store' };
        outcome.headers.forEach((value, key) => {
          outHeaders[key] = value;
        });
        res.writeHead(outcome.status, outHeaders);
        res.end(responseBody);
      }
      const isError = outcome.status >= 400 || /"error"\s*:/.test(responseBody.toString('utf8', 0, 4096)) ||
        /"isError"\s*:\s*true/.test(responseBody.toString('utf8'));
      logRequest(name, isError ? `error:${outcome.status >= 400 ? `http-${outcome.status}` : 'tool'}` : 'ok', responseBody.length, now() - started);
    } catch {
      const bytes = sendJsonRpcError(res, 500, id, -32603, 'internal error');
      logRequest(name, 'error:internal', bytes, now() - started);
    } finally {
      if (timer) clearTimer(timer);
      await transport.close().catch(() => undefined);
      await server.close().catch(() => undefined);
    }
  }

  const http = createServer((req, res) => {
    handle(req, res).catch(() => {
      sendPlain(res, 500, 'Internal Server Error');
    });
  });
  http.headersTimeout = limits.headersTimeoutMs;
  http.maxConnections = limits.maxConnections;
  // Errors after listening (for example EMFILE on accept) must not reach the process as uncaught.
  http.on('error', () => {
    if (http.listening) logLifecycle('server-error', deps.port);
  });
  http.requestTimeout = limits.httpRequestTimeoutMs;
  http.on('connection', (socket: Socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  return {
    failureDelay,
    address: () => http.address(),
    async listen() {
      // On macOS a listener on :: or 0.0.0.0 does not stop a listen on 127.0.0.1, and clients would reach
      // that other program. Refuse when anything already answers on 127.0.0.1:<port>.
      if (await portAnswers(deps.port)) {
        logLifecycle('port-in-use', deps.port);
        return { ok: false, kind: 'port-in-use' } as ListenResult;
      }
      return new Promise<ListenResult>((resolve) => {
        const onError = (error: NodeJS.ErrnoException) => {
          http.off('listening', onListening);
          const kind = error.code === 'EADDRINUSE' ? 'port-in-use' : 'listen-failed';
          logLifecycle(kind, deps.port);
          resolve({ ok: false, kind });
        };
        const onListening = () => {
          http.off('error', onError);
          logLifecycle('listening', deps.port);
          resolve({ ok: true });
        };
        http.once('error', onError);
        http.once('listening', onListening);
        http.listen({ port: deps.port, host: '127.0.0.1', exclusive: true });
      });
    },
    close() {
      return new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        sockets.clear();
        if (!http.listening) {
          resolve();
          return;
        }
        http.close(() => {
          logLifecycle('stopped', deps.port);
          resolve();
        });
      });
    },
  };
}
