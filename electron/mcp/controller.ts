// State machine of the local MCP server. Native dialogs and the clipboard are handled by the IPC layer;
// this module only starts and stops the listener and reports status. Operations run one at a time.
import { createMcpHttpServer, type McpHttpServer, type McpHttpServerDeps } from './server';
import { getDefaultTokenStore, type McpTokenStore } from './tokenStore';
import { MCP_FEATURE_ENABLED } from './featureFlag';
import { DEFAULT_LIMITS, type McpLimits } from './limits';
import * as readFacade from './readFacade';

export type McpLastError = null | 'port-in-use' | 'listen-failed';

export interface McpStatus {
  /** False when the whole feature is hidden (MCP_FEATURE_ENABLED). */
  featureEnabled: boolean;
  enabled: boolean;
  listening: boolean;
  port: number;
  lastRequestAt: string | null;
  tokenTail: string;
  lastError: McpLastError;
}

export type McpClientKind = 'claude-code' | 'mcp-remote';

export interface McpControllerDeps {
  store: McpTokenStore;
  version: () => string;
  featureEnabled?: boolean;
  limits?: Readonly<McpLimits>;
  createServer?: (deps: McpHttpServerDeps) => McpHttpServer;
  serverDeps?: Partial<McpHttpServerDeps>;
  now?: () => Date;
}

export interface McpController {
  readonly featureEnabled: boolean;
  readonly limits: Readonly<McpLimits>;
  startIfEnabled(): Promise<McpStatus>;
  enable(): Promise<McpStatus>;
  disable(): Promise<McpStatus>;
  setPort(port: number): Promise<McpStatus>;
  regenerateToken(): Promise<McpStatus>;
  status(): McpStatus;
  onStatusChange(listener: (status: McpStatus) => void): () => void;
  /** The registration line for a client. Contains the token: only the IPC layer may put it on the clipboard. */
  connectionCommand(client: McpClientKind): string;
  shutdown(): Promise<void>;
}

export function createMcpController(deps: McpControllerDeps): McpController {
  const featureEnabled = deps.featureEnabled ?? MCP_FEATURE_ENABLED;
  const limits = deps.limits ?? DEFAULT_LIMITS;
  const createServer = deps.createServer ?? createMcpHttpServer;
  const now = deps.now ?? (() => new Date());
  const listeners = new Set<(status: McpStatus) => void>();
  let server: McpHttpServer | null = null;
  let listening = false;
  let lastError: McpLastError = null;
  let lastRequestAt: string | null = null;
  let queue: Promise<unknown> = Promise.resolve();

  const status = (): McpStatus => ({
    featureEnabled,
    enabled: deps.store.isEnabled(),
    listening,
    port: deps.store.getPort(),
    lastRequestAt,
    tokenTail: deps.store.tokenTail(),
    lastError,
  });

  const emit = () => {
    const current = status();
    for (const listener of listeners) {
      try {
        listener(current);
      } catch {
        // a broken listener must not stop the others
      }
    }
  };

  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
  };

  async function stop(): Promise<void> {
    const current = server;
    server = null;
    listening = false;
    if (current) await current.close();
  }

  async function start(): Promise<void> {
    await stop();
    deps.store.ensureToken();
    const candidate = createServer({
      port: deps.store.getPort(),
      getToken: () => deps.store.ensureToken(),
      facade: readFacade,
      version: deps.version(),
      limits,
      onAuthorizedRequest: () => {
        lastRequestAt = now().toISOString();
        emit();
      },
      ...deps.serverDeps,
    });
    const result = await candidate.listen();
    if (result.ok) {
      server = candidate;
      listening = true;
      lastError = null;
    } else {
      await candidate.close();
      lastError = result.kind;
    }
  }

  return {
    featureEnabled,
    limits,
    status,
    startIfEnabled: () =>
      serial(async () => {
        if (featureEnabled && deps.store.isEnabled()) await start();
        emit();
        return status();
      }),
    enable: () =>
      serial(async () => {
        if (!featureEnabled) throw new Error('feature disabled');
        deps.store.setEnabled(true);
        await start();
        emit();
        return status();
      }),
    disable: () =>
      serial(async () => {
        deps.store.setEnabled(false);
        await stop();
        lastError = null;
        emit();
        return status();
      }),
    setPort: (port: number) =>
      serial(async () => {
        deps.store.setPort(port);
        if (featureEnabled && deps.store.isEnabled()) await start();
        else lastError = null;
        emit();
        return status();
      }),
    regenerateToken: () =>
      serial(async () => {
        const wasListening = listening;
        await stop();
        deps.store.regenerate();
        if (featureEnabled && deps.store.isEnabled() && (wasListening || lastError !== null)) await start();
        emit();
        return status();
      }),
    onStatusChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    connectionCommand(client: McpClientKind) {
      const url = `http://127.0.0.1:${deps.store.getPort()}/mcp`;
      const header = `Authorization: Bearer ${deps.store.ensureToken()}`;
      if (client === 'claude-code') return `claude mcp add --transport http maplat-editor ${url} --header "${header}"`;
      // Claude Desktop goes through mcp-remote. The header is passed through an environment variable because
      // some clients do not escape spaces inside args (mcp-remote documents the "Name:${VAR}" form for this).
      const config = {
        mcpServers: {
          'maplat-editor': {
            command: 'npx',
            args: ['mcp-remote', url, '--transport', 'http-only', '--header', 'Authorization:${AUTH_HEADER}'],
            env: { AUTH_HEADER: `Bearer ${deps.store.ensureToken()}` },
          },
        },
      };
      return JSON.stringify(config, null, 2);
    },
    shutdown: () => serial(stop),
  };
}

let defaultController: McpController | null = null;

/** The controller used by the app. Created on first use. */
export function getMcpController(version: () => string, limits?: Readonly<McpLimits>): McpController {
  if (!defaultController) defaultController = createMcpController({ store: getDefaultTokenStore(), version, limits });
  return defaultController;
}
