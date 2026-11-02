// Every number that bounds the local MCP server, in one place. Tests pass a modified copy.
export interface McpLimits {
  /** Requests handled at the same time. Further requests get 429. */
  maxConcurrent: number;
  /** A request is aborted after this many milliseconds. */
  requestTimeoutMs: number;
  /** Largest accepted request body. */
  maxRequestBodyBytes: number;
  /** Open connections accepted at the same time. */
  maxConnections: number;
  /** Node http server timeouts. */
  headersTimeoutMs: number;
  httpRequestTimeoutMs: number;
  /** Delay added before each bearer check: min(failures in the last 60 s, cap) x step. */
  failureDelayStepMs: number;
  failureDelayCap: number;
  /** Connections allowed to wait for the bearer check at the same time. Further ones get 401 at once. */
  maxWaitingForAuth: number;
  /** The copied connection command is cleared from the clipboard after this long. */
  clipboardClearMs: number;
}

export const DEFAULT_MCP_PORT = 41871;
export const MIN_MCP_PORT = 1024;
export const MAX_MCP_PORT = 65535;

export const DEFAULT_LIMITS: Readonly<McpLimits> = Object.freeze({
  maxConcurrent: 4,
  requestTimeoutMs: 20_000,
  maxRequestBodyBytes: 1024 * 1024,
  maxConnections: 64,
  headersTimeoutMs: 10_000,
  httpRequestTimeoutMs: 30_000,
  failureDelayStepMs: 100,
  failureDelayCap: 20,
  maxWaitingForAuth: 32,
  clipboardClearMs: 60_000,
});

export function isValidPort(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= MIN_MCP_PORT && value <= MAX_MCP_PORT;
}
