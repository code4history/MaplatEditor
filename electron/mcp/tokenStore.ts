// Persistent state of the local MCP server: enabled, port and the bearer token. It lives in its own
// electron-store file (mcp-server.json) next to the settings file, created with mode 0600, and is never
// reachable through settings:get / settings:set. The token itself never leaves the main process except
// through the clipboard after the user confirms a native dialog.
import Store from 'electron-store';
import { randomBytes } from 'node:crypto';
import { resolveRuntimeStoragePaths } from '../services/runtimeStoragePaths';
import { DEFAULT_MCP_PORT, isValidPort } from './limits';

export interface McpStoreShape {
  enabled: boolean;
  port: number;
  token: string;
  tokenIssuedAt: string;
}

export interface McpStoreBackend {
  get<K extends keyof McpStoreShape>(key: K): McpStoreShape[K] | undefined;
  set<K extends keyof McpStoreShape>(key: K, value: McpStoreShape[K]): void;
}

export interface McpTokenStore {
  isEnabled(): boolean;
  setEnabled(enabled: boolean): void;
  getPort(): number;
  setPort(port: number): void;
  /** Creates a token on first use. */
  ensureToken(): string;
  regenerate(): string;
  /** Last four characters of the token, for display. */
  tokenTail(): string;
}

/** 32 random bytes as base64url: 43 characters. */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

export function createTokenStore(backend: McpStoreBackend, now: () => Date = () => new Date()): McpTokenStore {
  const issue = (): string => {
    const token = generateToken();
    backend.set('token', token);
    backend.set('tokenIssuedAt', now().toISOString());
    return token;
  };
  const ensureToken = (): string => {
    const current = backend.get('token');
    return typeof current === 'string' && current.length >= 43 ? current : issue();
  };
  return {
    isEnabled: () => backend.get('enabled') === true,
    setEnabled: (enabled) => backend.set('enabled', enabled === true),
    getPort: () => {
      const port = backend.get('port');
      return isValidPort(port) ? port : DEFAULT_MCP_PORT;
    },
    setPort: (port) => {
      if (!isValidPort(port)) throw new Error('invalid argument');
      backend.set('port', port);
    },
    ensureToken,
    regenerate: issue,
    tokenTail: () => ensureToken().slice(-4),
  };
}

let defaultStore: McpTokenStore | null = null;

/** The store used by the app. Created on first use so that importing this module has no side effects. */
export function getDefaultTokenStore(): McpTokenStore {
  if (!defaultStore) {
    const { settingsStoreCwd } = resolveRuntimeStoragePaths(process.env.MAPLAT_E2E_ROOT, '', '');
    const backend = new Store<McpStoreShape>({
      name: 'mcp-server',
      configFileMode: 0o600,
      defaults: { enabled: false, port: DEFAULT_MCP_PORT, token: '', tokenIssuedAt: '' },
      ...(settingsStoreCwd ? { cwd: settingsStoreCwd } : {}),
    });
    defaultStore = createTokenStore(backend as unknown as McpStoreBackend);
  }
  return defaultStore;
}
