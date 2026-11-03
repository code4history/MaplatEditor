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
  /** maps.list: largest page number, largest page size and longest search text. */
  maxListPage: number;
  maxListPageSize: number;
  maxQueryLength: number;
  /** Longest map reference (uid or slug) a tool accepts. */
  maxMapRefLength: number;
  /** maps.transform: most points in one call. */
  maxTransformPoints: number;
  /** maps.render_region: largest output width and height, largest scale, most tiles read, densest grid, most marks, longest mark label. */
  maxRegionOutputPx: number;
  /** Largest image pixel coordinate a tool accepts (no map image is this large). */
  maxImagePixelCoordinate: number;
  maxRegionScale: number;
  maxRegionTiles: number;
  minGridStepOutputPx: number;
  maxRegionMarks: number;
  maxMarkLabelLength: number;
  /** maps.render_region: largest encoded picture sent back. */
  maxRegionImageBytes: number;
  /** A tile file larger than this is not read (a tile of 256 x 256 pixels is far smaller). */
  maxTileBytes: number;
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
  maxListPage: 10_000,
  maxListPageSize: 100,
  maxQueryLength: 200,
  maxMapRefLength: 100,
  maxTransformPoints: 1000,
  maxRegionOutputPx: 1024,
  maxImagePixelCoordinate: 1_000_000,
  maxRegionScale: 4,
  maxRegionTiles: 64,
  minGridStepOutputPx: 32,
  maxRegionMarks: 50,
  maxMarkLabelLength: 8,
  maxRegionImageBytes: 4 * 1024 * 1024,
  maxTileBytes: 1024 * 1024,
});

export function isValidPort(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= MIN_MCP_PORT && value <= MAX_MCP_PORT;
}
