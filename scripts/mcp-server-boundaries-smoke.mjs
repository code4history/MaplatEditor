// Smoke: the local MCP server's boundaries.
//
// Runs the real HTTP server on 127.0.0.1 and talks to it with raw sockets (so Host, Origin, the request line
// and HTTP/1.0 can be written by hand). Every rejection is a mutation of one positive request that returns 200,
// so a rejection can only pass if the positive request still passes. The IPC handlers are called with fake
// events through the shared registry. Static checks cover the import wall of electron/mcp/, the read-only
// facade, the IPC registration, main.ts wiring and how the SDK ends up in the main bundle.
//
// The token is never printed. When MCP_SMOKE_TOKEN_FILE is set, every token issued during the run is written
// there (one per line) so that the log-redaction smoke can check the output for them.
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir, readFile, readdir } from 'node:fs/promises';
import { readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { builtinModules } from 'node:module';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const rel = (p) => path.join(projectRoot, p);

// ---------------------------------------------------------------------------------------------
// The feature flag, read from source text (the .ts file cannot be imported by node directly)
// ---------------------------------------------------------------------------------------------
export const FLAG_PATTERN = /MCP_FEATURE_ENABLED\b[^=]*=\s*(true|false)/;
function readFlag(text) {
  const m = FLAG_PATTERN.exec(text);
  if (!m) throw new Error('feature flag declaration not found');
  return m[1] === 'true';
}
assert.equal(readFlag('export const MCP_FEATURE_ENABLED = false;'), false, 'flag pattern: plain false');
assert.equal(readFlag('export const MCP_FEATURE_ENABLED: boolean = false'), false, 'flag pattern: typed false');
assert.equal(readFlag('export const MCP_FEATURE_ENABLED = true;'), true, 'flag pattern: plain true');
console.log('ok: feature flag pattern reads the three positive controls');
const featureEnabled = readFlag(await readFile(rel('electron/mcp/featureFlag.ts'), 'utf8'));
console.log(`ok: feature flag in source is ${featureEnabled}`);

// ---------------------------------------------------------------------------------------------
// Static checks
// ---------------------------------------------------------------------------------------------
const mcpDir = rel('electron/mcp');
const mcpFiles = (await readdir(mcpDir, { recursive: true }))
  .filter((f) => f.endsWith('.ts'))
  .map((f) => path.join(mcpDir, f));
assert.ok(mcpFiles.length >= 8, 'electron/mcp has the expected modules');

const SPECIFIER_PATTERNS = [
  /\bimport\s+(?:type\s+)?[^'";]*?\sfrom\s*['"]([^'"]+)['"]/g,
  /\bexport\s+(?:type\s+)?[^'";]*?\sfrom\s*['"]([^'"]+)['"]/g,
  /\bimport\s*['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];
function specifiersOf(source) {
  const found = [];
  for (const re of SPECIFIER_PATTERNS) for (const m of source.matchAll(re)) found.push(m[1]);
  return found;
}
// Self-test of the collector: each form has to be found.
{
  const sample = [
    "import a from 'x1'", "import type { B } from 'x2'", "export { c } from 'x3'", "export * from 'x4'",
    "await import('x5')", "require('x6')", "import 'x7'",
  ].join('\n');
  assert.deepEqual(specifiersOf(sample).sort(), ['x1', 'x2', 'x3', 'x4', 'x5', 'x6', 'x7'], 'import collector self-test');
}

const COMMON_ALLOWED = (spec) =>
  spec.startsWith('./') ||
  spec.startsWith('@modelcontextprotocol/sdk/') ||
  ['zod', 'jimp', 'electron', 'electron-store', 'node:http', 'node:net', 'node:crypto', 'node:events', 'node:timers',
    '../utils/webMercator', '@maplat/transform', '../adapters/StorageAdapter', '../services/runtimeStoragePaths',
    '../utils/appScheme', '../../src/utils/thumbnailPaths', '../utils/tilePyramid'].includes(spec);
const FACADE_EXTRA_ALLOWED = (spec) =>
  spec.startsWith('../services/') || spec === '../adapters/ElectronStorageAdapter' || spec === 'node:path' || spec === 'fs-extra';

const violations = [];
for (const file of mcpFiles) {
  const source = await readFile(file, 'utf8');
  const isFacade = path.basename(file) === 'readFacade.ts';
  for (const spec of specifiersOf(source)) {
    if (COMMON_ALLOWED(spec) || (isFacade && FACADE_EXTRA_ALLOWED(spec))) continue;
    violations.push(`${path.relative(projectRoot, file)}: ${spec}`);
  }
  // electron: named imports only, and only these four
  for (const m of source.matchAll(/\bimport\s+([^'";]*?)\s+from\s*['"]electron['"]/g)) {
    const clause = m[1].trim();
    const named = /^(?:type\s+)?\{([^}]*)\}$/.exec(clause);
    if (!named) {
      violations.push(`${path.relative(projectRoot, file)}: electron imported as "${clause}"`);
      continue;
    }
    for (const part of named[1].split(',').map((s) => s.trim()).filter(Boolean)) {
      const name = part.replace(/^type\s+/, '').split(/\s+as\s+/)[0];
      if (!['app', 'clipboard', 'dialog', 'BrowserWindow'].includes(name)) {
        violations.push(`${path.relative(projectRoot, file)}: electron.${name}`);
      }
    }
  }
  // ../adapters/StorageAdapter: type imports and UUID_PATTERN only
  for (const m of source.matchAll(/\bimport\s+(type\s+)?([^'";]*?)\s+from\s*['"]\.\.\/adapters\/StorageAdapter['"]/g)) {
    if (m[1]) continue;
    const names = (/\{([^}]*)\}/.exec(m[2])?.[1] ?? 'default').split(',').map((s) => s.trim()).filter(Boolean);
    for (const n of names) if (!n.startsWith('type ') && n !== 'UUID_PATTERN') violations.push(`${path.relative(projectRoot, file)}: StorageAdapter.${n}`);
  }
}
assert.deepEqual(violations, [], `import wall of electron/mcp/ (violations: ${violations.join('; ')})`);
console.log(`ok: import wall holds for ${mcpFiles.length} files under electron/mcp/`);

{
  const facade = await readFile(rel('electron/mcp/readFacade.ts'), 'utf8');
  const exported = [...facade.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z0-9_]+)/gm)].map((m) => m[1]).sort();
  assert.deepEqual(exported, ['listMaps', 'readMapForEdit', 'readThumbnail512', 'readTile', 'readTilesForRegion', 'searchExtent', 'transformPoints'],
    'read-only facade exports exactly the seven read functions');
  assert.doesNotMatch(facade, /export\s+default/, 'read-only facade has no default export');
  assert.doesNotMatch(facade, /export\s*\{/, 'read-only facade does not re-export objects');
  const returnLines = facade.split('\n').filter((l) => /\breturn\b/.test(l));
  assert.ok(returnLines.every((l) => !/\b\w*(Service|Adapter)\b/.test(l)), 'read-only facade never returns a service or adapter');
  console.log('ok: read-only facade exports the seven names, no default, returns no service or adapter');
}

{
  const ipcSource = await readFile(rel('electron/ipc/mcp.ts'), 'utf8');
  assert.equal((ipcSource.match(/\bipc\.handle\(/g) ?? []).length, 5, 'electron/ipc/mcp.ts registers five handlers');
  assert.equal((ipcSource.match(/\bipcMain\b/g) ?? []).length, 0, 'electron/ipc/mcp.ts does not touch ipcMain');
  console.log('ok: electron/ipc/mcp.ts registers 5 handlers through the registry and never touches ipcMain');
}

{
  const mainSrc = await readFile(rel('electron/main.ts'), 'utf8');
  assert.match(mainSrc, /mcpController = registerMcpHandlers\(\)/, 'main.ts registers the MCP handlers');
  assert.match(mainSrc, /mcpController\.startIfEnabled\(\)/, 'main.ts starts the MCP server when it is enabled');
  const beforeQuitIdx = mainSrc.indexOf("app.on('before-quit'");
  const beforeQuitBody = mainSrc.slice(beforeQuitIdx, beforeQuitIdx + 600);
  assert.match(beforeQuitBody, /mcpController\?\.shutdown\(\)/, 'before-quit stops the MCP server');
  assert.match(beforeQuitBody, /clearCopiedConnectionCommand\(\)/, 'before-quit clears a copied connection command');
  const closeIdx = mainSrc.indexOf("win.on('close'");
  const closeBody = mainSrc.slice(closeIdx, mainSrc.indexOf('\n  })\n', closeIdx));
  assert.doesNotMatch(closeBody, /mcp/i, 'closing (hiding) the window does not stop the MCP server');
  console.log('ok: main.ts registers, starts on ready, stops on before-quit and not on window close');
}

// SDK placement: bundled into the main process code, so it is a devDependency and never an external import.
{
  const pkg = JSON.parse(await readFile(rel('package.json'), 'utf8'));
  assert.equal(pkg.devDependencies?.['@modelcontextprotocol/sdk'], '1.32.2', 'SDK pinned to 1.32.2 in devDependencies');
  assert.equal(pkg.dependencies?.['@modelcontextprotocol/sdk'], undefined, 'SDK is not a runtime dependency (it is bundled)');
  assert.equal(pkg.dependencies?.zod, undefined, 'zod is not a runtime dependency of the app (bundled)');
  const viteConfig = await readFile(rel('vite.config.ts'), 'utf8');
  assert.doesNotMatch(viteConfig, /modelcontextprotocol/, 'vite.config.ts does not mark the SDK external');
  const wsYaml = await readFile(rel('ci/pnpm-workspace.ci.yaml'), 'utf8');
  assert.match(wsYaml, /^\s*"page>path-to-regexp":\s*"~1\.9\.0"/m, 'path-to-regexp override is scoped to page');
  assert.doesNotMatch(wsYaml, /^\s*path-to-regexp:/m, 'no global path-to-regexp override');
}

const scratchRoot = rel('.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'mcp-server-boundaries-'));

try {
  // Bundle the server the way the main process is bundled (only builtins and the configured externals stay
  // outside) and check that the SDK did not stay an external import.
  {
    const bundleDir = path.join(workDir, 'bundle');
    const builtins = builtinModules.flatMap((m) => [m, `node:${m}`]);
    await build({
      configFile: false,
      logLevel: 'silent',
      root: projectRoot,
      build: {
        emptyOutDir: true,
        outDir: bundleDir,
        minify: false,
        lib: { entry: rel('electron/mcp/controller.ts'), formats: ['es'], fileName: 'controller' },
        rollupOptions: {
          external: [...builtins, 'electron', 'electron-store', 'node:sqlite', 'jimp', '@jsquash/webp', 'pwa-asset-generator', 'electron-updater'],
        },
      },
    });
    const files = readdirSync(bundleDir).filter((f) => f.endsWith('.js'));
    let externalRefs = 0;
    let bundledMarkers = 0;
    for (const f of files) {
      const code = await readFile(path.join(bundleDir, f), 'utf8');
      // Real module statements start a line; JSDoc examples inside the SDK start with "*".
      externalRefs += (code.match(/^\s*(?:import|export)\b[^\n;]*?from\s*["'](?:@modelcontextprotocol\/[^"']*|zod(?:\/[^"']*)?)["']/gm) ?? []).length;
      externalRefs += (code.match(/\brequire\(\s*["'](?:@modelcontextprotocol\/[^"']*|zod(?:\/[^"']*)?)["']\s*\)/g) ?? []).length;
      for (const banned of ['express', 'router', 'hono', '@hono/node-server', 'cors', 'express-rate-limit']) {
        assert.doesNotMatch(code, new RegExp(`(^\\s*import\\b[^\\n;]*?from\\s*["']${banned}["']|\\brequire\\(\\s*["']${banned}["']\\s*\\))`, 'm'), `bundle does not import ${banned}`);
      }
      bundledMarkers += (code.match(/Already connected to a transport|Not Acceptable: Client must accept both application\/json and text\/event-stream/g) ?? []).length;
    }
    assert.equal(externalRefs, 0, 'the bundle has no external import of the SDK or zod');
    assert.ok(bundledMarkers > 0, 'the SDK code is inside the bundle');
    console.log('ok: SDK and zod are bundled (no external import), express/router/hono/cors are not imported');
  }

  // Stubs: electron (with app, because the IPC registry reads app.isPackaged at load time) and electron-store,
  // which is replaced by its own backend `conf` so that the file mode is the real one.
  const electronStubFile = path.join(workDir, 'electron-stub.ts');
  const electronStoreStubFile = path.join(workDir, 'electron-store-stub.ts');
  const entryFile = path.join(workDir, 'mcp-server-boundaries-entry.ts');
  const outDir = path.join(workDir, 'dist');
  const bundledFile = path.join(outDir, 'mcp-server-boundaries-entry.mjs');
  const e2eRoot = path.join(workDir, 'root');
  await mkdir(e2eRoot, { recursive: true });

  const electronStoreDir = realpathSync(rel('node_modules/electron-store'));
  const confEntry = path.join(path.dirname(electronStoreDir), 'conf', 'dist', 'source', 'index.js');

  await writeFile(electronStubFile, `
    export const __handlers = new Map<string, any>();
    export const app = {
      isPackaged: true,
      getPath(name: string) { return ${JSON.stringify(path.join(workDir, 'paths'))} + '/' + name; },
      getName() { return 'MaplatEditor'; },
      getVersion() { return '0.0.0-smoke'; },
      whenReady() { return Promise.resolve(); },
    };
    export const ipcMain = {
      handle(channel: string, fn: any) { __handlers.set(channel, fn); },
      removeHandler(channel: string) { __handlers.delete(channel); },
      on() {},
      removeAllListeners() {},
    };
    export const dialog = {
      showOpenDialog() { return Promise.resolve({ canceled: true, filePaths: [] }); },
      showMessageBox() { return Promise.resolve({ response: 1 }); },
    };
    export const clipboard = { writeText() {}, readText() { return ''; }, clear() {} };
    export class BrowserWindow {
      static getAllWindows() { return []; }
      static fromWebContents() { return null; }
    }
    export const session = { defaultSession: { clearStorageData() { return Promise.resolve(); } } };
    // The read-only facade pulls in the services, and one of them imports shell.
    export const shell = { trashItem() { return Promise.resolve(); } };
  `);
  await writeFile(electronStoreStubFile, `
    import Conf from ${JSON.stringify(confEntry)};
    export default class Store<T extends Record<string, any>> extends (Conf as any)<T> {
      constructor(options: any = {}) {
        const o: any = { name: 'config', ...options };
        o.configName = o.name;
        delete o.name;
        o.projectVersion = '0.0.0';
        super(o);
      }
    }
  `);

  await writeFile(entryFile, `
    import assert from 'node:assert/strict';
    import net from 'node:net';
    import os from 'node:os';
    import { statSync, writeFileSync } from 'node:fs';
    import { __handlers } from 'electron';

    const { createMcpHttpServer } = await import(${JSON.stringify(rel('electron/mcp/server.ts'))});
    const { FailureDelay, checkPath, checkHost } = await import(${JSON.stringify(rel('electron/mcp/requestGuard.ts'))});
    const { createTokenStore, getDefaultTokenStore } = await import(${JSON.stringify(rel('electron/mcp/tokenStore.ts'))});
    const { createMcpController } = await import(${JSON.stringify(rel('electron/mcp/controller.ts'))});
    const { DEFAULT_LIMITS } = await import(${JSON.stringify(rel('electron/mcp/limits.ts'))});
    const facade = await import(${JSON.stringify(rel('electron/mcp/readFacade.ts'))});
    const { z } = await import('zod');
    const { registerTools } = await import(${JSON.stringify(rel('electron/mcp/tools.ts'))});
    const { registerMcpHandlers } = await import(${JSON.stringify(rel('electron/ipc/mcp.ts'))});
    const { assertRendererSettingsKey } = await import(${JSON.stringify(rel('electron/services/settingsKeys.ts'))});
    const featureEnabled = ${JSON.stringify(featureEnabled)};

    const issued: string[] = [];
    const recordTokens = (store: any) => { const t = store.ensureToken(); if (!issued.includes(t)) issued.push(t); return t; };

    function memoryBackend(initial: Record<string, unknown> = {}) {
      const data: Record<string, unknown> = { enabled: false, port: 41871, token: '', tokenIssuedAt: '', ...initial };
      return { get: (k: string) => data[k], set: (k: string, v: unknown) => { data[k] = v; } };
    }

    function freePort(): Promise<number> {
      return new Promise((resolve, reject) => {
        const s = net.createServer();
        s.once('error', reject);
        s.listen(0, '127.0.0.1', () => {
          const { port } = s.address() as net.AddressInfo;
          s.close(() => resolve(port));
        });
      });
    }

    type Raw = { status: number; head: string; body: string; ms: number; closedByServer: boolean };
    /** Sends raw bytes and reads until the server closes. If it does not close within waitMs, gives up. */
    function raw(port: number, text: string, host = '127.0.0.1', waitMs = 15000): Promise<Raw> {
      return new Promise((resolve, reject) => {
        const started = Date.now();
        const socket = net.connect({ port, host });
        let data = '';
        let done = false;
        socket.setEncoding('utf8');
        socket.on('data', (c) => { data += c; });
        const finish = (closedByServer = true) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          const status = Number(/^HTTP\\/1\\.[01] (\\d{3})/.exec(data)?.[1] ?? 0);
          const split = data.indexOf('\\r\\n\\r\\n');
          resolve({ status, head: data.slice(0, split), body: data.slice(split + 4), ms: Date.now() - started, closedByServer });
        };
        const timer = setTimeout(() => { finish(false); socket.destroy(); }, waitMs);
        socket.on('end', () => finish());
        // The server may answer and reset before a large body is fully written; keep the answer it sent.
        socket.on('error', (e) => (/^HTTP\\/1\\.[01] \\d{3}/.test(data) ? finish() : reject(e)));
        socket.write(text);
      });
    }

    const LIST = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    type Req = { method?: string; target?: string; host?: string | null; origin?: string; auth?: string | null;
      accept?: string | null; ctype?: string | null; body?: string; version?: string; keepAlive?: boolean };
    function requestText(port: number, token: string, r: Req = {}): string {
      const method = r.method ?? 'POST';
      const body = r.body ?? (method === 'POST' ? LIST : '');
      const lines = [\`\${method} \${r.target ?? '/mcp'} HTTP/\${r.version ?? '1.1'}\`];
      const host = r.host === undefined ? \`127.0.0.1:\${port}\` : r.host;
      if (host !== null) lines.push(\`Host: \${host}\`);
      if (r.origin !== undefined) lines.push(\`Origin: \${r.origin}\`);
      const auth = r.auth === undefined ? \`Bearer \${token}\` : r.auth;
      if (auth !== null) lines.push(\`Authorization: \${auth}\`);
      const accept = r.accept === undefined ? 'application/json, text/event-stream' : r.accept;
      if (accept !== null) lines.push(\`Accept: \${accept}\`);
      const ctype = r.ctype === undefined ? 'application/json' : r.ctype;
      if (ctype !== null && body) lines.push(\`Content-Type: \${ctype}\`);
      lines.push(\`Content-Length: \${Buffer.byteLength(body)}\`);
      if (!r.keepAlive) lines.push('Connection: close');
      return lines.join('\\r\\n') + '\\r\\n\\r\\n' + body;
    }

    // The slow test tool stops early when the request is aborted, like the real tools do between I/O steps.
    const toolStats = { started: 0, aborted: 0, finished: 0 };
    function slowTools(ms: number) {
      return (server: any, ctx: any) => {
        registerTools(server, ctx);
        server.registerTool('test.slow', { inputSchema: z.object({}).strict() }, async () => {
          toolStats.started += 1;
          const aborted = await new Promise<boolean>((r) => {
            const t = setTimeout(() => r(false), ms);
            ctx.signal.addEventListener('abort', () => { clearTimeout(t); r(true); }, { once: true });
          });
          if (aborted) toolStats.aborted += 1;
          else toolStats.finished += 1;
          return { content: [{ type: 'text', text: aborted ? 'slow aborted' : 'slow done' }] };
        });
      };
    }
    async function until(cond: () => boolean, label: string, ms = 5000) {
      const end = Date.now() + ms;
      while (!cond()) {
        if (Date.now() > end) throw new Error(\`timed out waiting for: \${label}\`);
        await new Promise((r) => setTimeout(r, 10));
      }
    }
    const SLOW = JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'test.slow', arguments: {} } });

    async function startServer(extra: Record<string, unknown> = {}) {
      const port = await freePort();
      const store = createTokenStore(memoryBackend({ port }) as any);
      const token = recordTokens(store);
      const server = createMcpHttpServer({ port, getToken: () => store.ensureToken(), facade, version: '0.0.0-smoke', ...extra });
      const result = await server.listen();
      assert.deepEqual(result, { ok: true }, 'server listens');
      return { port, token, store, server };
    }

    // ---------------- pure checks ----------------
    assert.equal(checkPath('/mcp'), true);
    assert.equal(checkPath('/mcp/'), false);
    assert.equal(checkPath('/mcp?x=1'), false);
    assert.equal(checkHost('127.0.0.1:5', 5, 'http://evil.example:5/mcp'), false, 'absolute-form request line with a foreign host');
    {
      const d = new FailureDelay(100, 20);
      const t0 = 1_000_000;
      for (let i = 0; i < 20; i += 1) d.recordFailure(t0 + i * 10);
      assert.equal(d.delayMs(t0 + 500), 2000, 'delay after 20 failures is 20 x step');
      for (let i = 0; i < 5; i += 1) d.recordFailure(t0 + 600);
      assert.equal(d.delayMs(t0 + 700), 2000, 'delay is capped at 20 failures');
      assert.equal(d.delayMs(t0 + 61_000), 0, 'failures older than 60 s are forgotten');
      console.log('ok: B FailureDelay counts the last 60 s, caps at 20, forgets after 60 s');
    }

    // ---------------- A: positive control and single mutations ----------------
    {
      const { port, token, server } = await startServer();
      const req = (r: Req) => raw(port, requestText(port, token, r));
      const positive = await req({});
      assert.equal(positive.status, 200, 'A positive control returns 200');
      assert.match(positive.body, /editor\\.ping/, 'A positive control lists editor.ping');
      assert.match(positive.body, /"additionalProperties":false/, 'A tools/list inputSchema is a strict JSON Schema object');
      console.log('ok: A positive control (no Origin, Host 127.0.0.1:<port>, POST /mcp, bearer, Accept, JSON) -> 200');
      assert.equal((await req({ host: \`localhost:\${port}\` })).status, 200);
      console.log('ok: A Host localhost:<port> -> 200');
      assert.equal((await req({ auth: \`bearer \${token}\` })).status, 200, 'A the scheme name is case-insensitive');
      console.log('ok: A "bearer" in lower case -> 200');

      const cases: [string, Req, number][] = [
        ['Origin present', { origin: 'http://evil.example' }, 403],
        ['Origin null', { origin: 'null' }, 403],
        ['Host evil.example:<port>', { host: \`evil.example:\${port}\` }, 403],
        ['Host localhost.:<port>', { host: \`localhost.:\${port}\` }, 403],
        ['Host LOCALHOST:<port>', { host: \`LOCALHOST:\${port}\` }, 403],
        ['Host [::1]:<port>', { host: \`[::1]:\${port}\` }, 403],
        ['Host 127.0.0.1 without port', { host: '127.0.0.1' }, 403],
        ['Host 127.1:<port>', { host: \`127.1:\${port}\` }, 403],
        ['Host missing (HTTP/1.0)', { host: null, version: '1.0' }, 403],
        ['absolute-form request line', { target: \`http://127.0.0.1:\${port}/mcp\` }, 200],
        ['absolute-form request line with a foreign host', { target: \`http://evil.example:\${port}/mcp\` }, 403],
        ['path /mcp/', { target: '/mcp/' }, 404],
        ['path /mcp?x=1', { target: '/mcp?x=1' }, 404],
        ['path /', { target: '/' }, 404],
        ['method GET', { method: 'GET' }, 405],
        ['method DELETE', { method: 'DELETE' }, 405],
        ['method PUT', { method: 'PUT' }, 405],
        ['no Authorization', { auth: null }, 401],
        ['Authorization Basic', { auth: 'Basic dXNlcjpwYXNz' }, 401],
        ['bearer one character off', { auth: \`Bearer \${token.slice(0, -1)}\${token.endsWith('A') ? 'B' : 'A'}\` }, 401],
        ['Content-Type text/plain', { ctype: 'text/plain' }, 415],
        ['Accept without text/event-stream', { accept: 'application/json' }, 406],
      ];
      for (const [name, r, expected] of cases) {
        const res = await req(r);
        assert.equal(res.status, expected, \`A \${name} -> \${expected} (got \${res.status})\`);
        console.log(\`ok: A \${name} -> \${expected}\`);
      }
      // Browser GETs are rejected before the token check, so they never slow down the real client.
      const before = server.failureDelay.failures(Date.now());
      for (let i = 0; i < 30; i += 1) assert.equal((await req({ method: 'GET', auth: null })).status, 405);
      assert.equal(server.failureDelay.failures(Date.now()), before, 'A GETs are not counted as failures');
      assert.equal(server.failureDelay.delayMs(Date.now()) <= before * DEFAULT_LIMITS.failureDelayStepMs, true);
      const fresh = await startServer();
      for (let i = 0; i < 30; i += 1) {
        assert.equal((await raw(fresh.port, requestText(fresh.port, fresh.token, { method: 'GET', auth: null }))).status, 405);
      }
      assert.equal(fresh.server.failureDelay.delayMs(Date.now()), 0, 'A after 30 GETs the delay is 0');
      const afterGets = await raw(fresh.port, requestText(fresh.port, fresh.token));
      assert.equal(afterGets.status, 200, 'A POST after 30 GETs -> 200');
      console.log(\`ok: A 30 GETs without Origin are not counted; the next POST -> 200 in \${afterGets.ms < 100 ? 'under 100 ms' : afterGets.ms + ' ms'}\`);
      await fresh.server.close();

      // bound to 127.0.0.1 only
      const address = server.address() as net.AddressInfo;
      assert.equal(address.address, '127.0.0.1', 'bound to 127.0.0.1');
      const connectError = (host: string) => new Promise<string>((resolve) => {
        const s = net.connect({ port, host });
        s.on('connect', () => { s.destroy(); resolve('connected'); });
        s.on('error', (e: any) => resolve(e.code));
      });
      const external = Object.values(os.networkInterfaces()).flat().find((i: any) => i && i.family === 'IPv4' && !i.internal) as any;
      if (external) {
        assert.equal(await connectError(external.address), 'ECONNREFUSED', 'not reachable on a non-loopback address');
        console.log('ok: bind: not reachable on a non-loopback IPv4 address');
      } else {
        console.log('ok: bind: no non-loopback IPv4 address on this machine (skipped)');
      }
      const v6 = await connectError('::1');
      assert.ok(['ECONNREFUSED', 'EADDRNOTAVAIL', 'EAFNOSUPPORT'].includes(v6), \`not reachable on ::1 (got \${v6})\`);
      console.log('ok: bind: address() is 127.0.0.1 and ::1 is refused');

      await server.close();
      await assert.rejects(raw(port, requestText(port, token)), (e: any) => e.code === 'ECONNREFUSED', 'closed server refuses connections');
      console.log('ok: after close() the port refuses connections');
    }

    // ---------------- B: delay, waiting cap, store mode ----------------
    {
      const limits = { ...DEFAULT_LIMITS, failureDelayStepMs: 10 };
      const { port, token, server } = await startServer({ limits });
      for (let i = 0; i < 20; i += 1) assert.equal((await raw(port, requestText(port, token, { auth: 'Bearer wrong' }))).status, 401);
      assert.equal(server.failureDelay.delayMs(Date.now()), 200, 'B 20 failures -> 200 ms with a 10 ms step');
      const ok = await raw(port, requestText(port, token));
      assert.equal(ok.status, 200, 'B the right token still passes after 20 failures');
      assert.ok(ok.ms >= 190, \`B the right token waits for the delay (\${ok.ms} ms)\`);
      console.log('ok: B after 20 failures the right token is delayed but passes (no lock-out)');
      await server.close();
    }
    {
      const limits = { ...DEFAULT_LIMITS, failureDelayStepMs: 1000, failureDelayCap: 1, maxConcurrent: 100 };
      const { port, token, server } = await startServer({ limits });
      assert.equal((await raw(port, requestText(port, token, { auth: 'Bearer wrong' }))).status, 401);
      const results = await Promise.all(Array.from({ length: 33 }, () => raw(port, requestText(port, token))));
      const refused = results.filter((r) => r.status === 401);
      const passed = results.filter((r) => r.status === 200);
      assert.equal(refused.length, 1, \`B the 33rd waiting request is refused (\${refused.length})\`);
      assert.equal(passed.length, 32, \`B 32 waiting requests pass after the delay (\${passed.length})\`);
      assert.ok(passed.every((r) => r.ms >= 900), 'B the 32 waiting requests waited for the delay');
      assert.ok(refused[0].ms < Math.min(...passed.map((r) => r.ms)), 'B the refused request did not wait');
      console.log('ok: B at most 32 requests wait for the token check; the 33rd gets 401 at once');
      await server.close();
    }
    {
      const store = getDefaultTokenStore();
      recordTokens(store);
      const file = ${JSON.stringify(path.join(e2eRoot, 'electron-store', 'settings', 'mcp-server.json'))};
      if (process.platform !== 'win32') {
        assert.equal(statSync(file).mode & 0o777, 0o600, 'B mcp-server.json is created with mode 0600');
        console.log('ok: B mcp-server.json is created with mode 0600');
      } else {
        console.log('ok: B file mode check skipped on Windows');
      }
      for (const key of ['mcpEnabled', 'mcpToken', 'mcpPort', 'token', 'enabled']) {
        assert.throws(() => assertRendererSettingsKey(key), /settings key is not allowed/, \`B settings key \${key} is not reachable\`);
      }
      console.log('ok: B MCP state is not reachable through settings:get/set keys');
    }
    {
      // Port taken by another program while the editor was not listening. On macOS a wildcard listener
      // (:: or 0.0.0.0) does not stop a later listen on 127.0.0.1, so the taker is tried on all three.
      for (const blockHost of ['127.0.0.1', '0.0.0.0', '::']) {
        const port = await freePort();
        const blocker = net.createServer((s) => s.destroy());
        const bound = await new Promise<boolean>((r) => {
          blocker.once('error', () => r(false));
          blocker.listen(port, blockHost, () => r(true));
        });
        if (!bound) {
          console.log(\`ok: B port taken on \${blockHost}: this machine cannot listen there (skipped)\`);
          continue;
        }
        const store = createTokenStore(memoryBackend({ port }) as any);
        recordTokens(store);
        const controller = createMcpController({ store, version: () => '0', featureEnabled: true });
        const status = await controller.enable();
        assert.equal(status.listening, false, \`B port taken on \${blockHost}: not listening\`);
        assert.equal(status.lastError, 'port-in-use', \`B port taken on \${blockHost}: port-in-use is reported\`);
        await new Promise<void>((r) => blocker.close(() => r()));
        const again = await controller.enable();
        assert.equal(again.listening, true, \`B port taken on \${blockHost}: listening once the port is free\`);
        assert.equal(again.lastError, null);
        await controller.shutdown();
        console.log(\`ok: B a port taken on \${blockHost} is reported as port-in-use and clears once free\`);
      }
    }

    // ---------------- C: strict input, concurrency, timeout ----------------
    {
      const { port, token, server } = await startServer({ registerTools: slowTools(1000) });
      const extra = await raw(port, requestText(port, token, { body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'editor.ping', arguments: { x: 1 } } }) }));
      assert.equal(extra.status, 200);
      assert.match(extra.body, /-32602/, 'C unknown key is rejected with -32602');
      assert.match(extra.body, /"isError":true/, 'C unknown key ends as an error');
      const ping = await raw(port, requestText(port, token, { body: JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'editor.ping', arguments: {} } }) }));
      assert.match(ping.body, /\\\\"ok\\\\":true/, 'C editor.ping answers ok');
      console.log('ok: C editor.ping works and unknown keys are rejected (-32602)');

      const four = await Promise.all(Array.from({ length: 4 }, () => raw(port, requestText(port, token, { body: SLOW }))));
      assert.deepEqual(four.map((r) => r.status), [200, 200, 200, 200], 'C four concurrent requests all succeed');
      assert.ok(four.every((r) => /slow done/.test(r.body)), 'C four concurrent requests all run the tool');
      console.log('ok: C four concurrent requests -> 200 (a fresh server per request)');
      const startedBefore = toolStats.started;
      const firstFour = Array.from({ length: 4 }, () => raw(port, requestText(port, token, { body: SLOW })));
      await until(() => toolStats.started - startedBefore >= 4, 'four slow tools running');
      const fifth = await raw(port, requestText(port, token, { body: SLOW }));
      const five = [...(await Promise.all(firstFour)), fifth];
      assert.deepEqual(five.map((r) => r.status).sort(), [200, 200, 200, 200, 429], 'C the fifth concurrent request -> 429');
      console.log('ok: C the fifth concurrent request -> 429');
      // The client sends only the start of the body: the server answers from Content-Length and closes, and a
      // client still writing a megabyte would race that close (EPIPE) instead of reading the answer.
      const bigLength = 1024 * 1024 + 1;
      const bigText = requestText(port, token, { body: 'x' }).replace(/Content-Length: \\d+/, \`Content-Length: \${bigLength}\`);
      const big = await raw(port, bigText);
      assert.equal(big.status, 413, 'C a body over 1 MiB -> 413');
      console.log('ok: C a body over 1 MiB -> 413');

      // A JSON array (batch) would put many calls into one request: refused.
      const batch = await raw(port, requestText(port, token, { body: JSON.stringify([JSON.parse(LIST), JSON.parse(LIST)]) }));
      assert.equal(batch.status, 400, \`C a batch request -> 400 (got \${batch.status})\`);
      assert.match(batch.body, /-32600/, 'C a batch request -> -32600');
      console.log('ok: C a batch (JSON array) request -> 400 / -32600');

      // Rejections close the connection instead of reading the rest of the body.
      for (const [label, r, expected] of [
        ['404', { target: '/x', keepAlive: true }, 404],
        ['403', { origin: 'http://evil.example', keepAlive: true }, 403],
        ['405', { method: 'GET', keepAlive: true }, 405],
        ['401', { auth: 'Bearer wrong', keepAlive: true }, 401],
      ] as [string, Req, number][]) {
        const res = await raw(port, requestText(port, token, r), '127.0.0.1', 2000);
        assert.equal(res.status, expected);
        assert.match(res.head, /\\r\\nConnection: close/i, \`C \${label} answers with Connection: close\`);
        assert.equal(res.closedByServer, true, \`C \${label}: the server closes the connection\`);
      }
      {
        // A 413 answer must not wait for the rest of a huge body.
        const socket = net.connect({ port, host: '127.0.0.1' });
        let data = '';
        socket.setEncoding('utf8');
        socket.on('data', (c) => { data += c; });
        socket.on('error', () => {});
        const closed = new Promise<void>((r) => socket.on('close', () => r()));
        socket.write([\`POST /mcp HTTP/1.1\`, \`Host: 127.0.0.1:\${port}\`, \`Authorization: Bearer \${token}\`,
          'Accept: application/json, text/event-stream', 'Content-Type: application/json', 'Content-Length: 104857600', '', ''].join('\\r\\n'));
        socket.write('x'.repeat(64 * 1024));
        await Promise.race([closed, new Promise((r) => setTimeout(r, 3000))]);
        assert.match(data, /^HTTP\\/1\\.1 413/, 'C 413 for a body declared over the limit');
        assert.match(data, /\\r\\nConnection: close/i, 'C 413 answers with Connection: close');
        assert.equal(socket.destroyed || socket.readyState === 'closed', true, 'C 413: the server closes without reading the rest');
        socket.destroy();
      }
      console.log('ok: C 401/403/404/405/413 answer with Connection: close and the server closes the connection');

      // A client that hangs up aborts its tool.
      {
        const abortedBefore = toolStats.aborted;
        const startedBefore2 = toolStats.started;
        const socket = net.connect({ port, host: '127.0.0.1' });
        socket.on('error', () => {});
        socket.write(requestText(port, token, { body: SLOW }));
        await until(() => toolStats.started > startedBefore2, 'slow tool started');
        socket.destroy();
        await until(() => toolStats.aborted > abortedBefore, 'tool aborted after the client hung up', 3000);
        console.log('ok: C a client that hangs up aborts its tool');
      }
      await server.close();
    }
    {
      const limits = { ...DEFAULT_LIMITS, requestTimeoutMs: 200 };
      const { port, token, server } = await startServer({ limits, registerTools: slowTools(1500) });
      const res = await raw(port, requestText(port, token, { body: SLOW }));
      assert.match(res.body, /timed out after 200 ms/, 'C a request over the time limit is aborted with a reason');
      console.log('ok: C a request over the time limit is aborted with a reason');
      // a slow request in flight is cut when the server closes
      const inflight = raw(port, requestText(port, token, { body: SLOW })).then((r) => r, (e) => ({ status: -1, body: String(e.code), ms: 0 }));
      await new Promise((r) => setTimeout(r, 50));
      await server.close();
      const cut = await inflight;
      assert.notEqual(cut.status, 200, 'C an in-flight request is cut by close()');
      console.log('ok: close() cuts an in-flight request');
    }

    // ---------------- token regeneration (controller) ----------------
    {
      const port = await freePort();
      const store = createTokenStore(memoryBackend({ port }) as any);
      const oldToken = recordTokens(store);
      const controller = createMcpController({ store, version: () => '0', featureEnabled: true });
      assert.equal((await controller.enable()).listening, true);
      assert.equal((await raw(port, requestText(port, oldToken))).status, 200);
      const status = await controller.regenerateToken();
      const newToken = recordTokens(store);
      assert.notEqual(newToken, oldToken);
      assert.equal(status.listening, true);
      assert.equal((await raw(port, requestText(port, oldToken))).status, 401, 'old token -> 401 after regeneration');
      assert.equal((await raw(port, requestText(port, newToken))).status, 200, 'new token -> 200 after regeneration');
      assert.equal(controller.status().tokenTail, newToken.slice(-4));
      console.log('ok: regeneration: the old token -> 401, the new token -> 200');
      assert.equal((await controller.disable()).listening, false);
      await assert.rejects(raw(port, requestText(port, newToken)), (e: any) => e.code === 'ECONNREFUSED');
      console.log('ok: disabling closes the port (ECONNREFUSED)');
    }

    // ---------------- feature flag ----------------
    {
      const port = await freePort();
      const store = createTokenStore(memoryBackend({ port, enabled: true }) as any);
      recordTokens(store);
      const hidden = createMcpController({ store, version: () => '0', featureEnabled: false });
      assert.equal((await hidden.startIfEnabled()).listening, false, 'flag false: startIfEnabled does not listen');
      await assert.rejects(hidden.enable(), /feature disabled/);
      const dflt = createMcpController({ store, version: () => '0' });
      assert.equal(dflt.featureEnabled, featureEnabled, 'the default controller follows the flag in featureFlag.ts');
      const started = await dflt.startIfEnabled();
      assert.equal(started.listening, featureEnabled, \`flag \${featureEnabled}: startIfEnabled \${featureEnabled ? 'listens' : 'does not listen'} when enabled\`);
      await dflt.shutdown();
      console.log(\`ok: flag: false never listens; the default (\${featureEnabled}) follows featureFlag.ts\`);
    }

    // ---------------- D: IPC through the registry ----------------
    {
      const trusted = { senderFrame: { url: 'app://bundle/index.html', parent: null }, sender: {} };
      const evil = { senderFrame: { url: 'http://evil.example/', parent: null }, sender: {} };
      const noFrame = { senderFrame: null, sender: {} };
      const call = (channel: string, event: any, ...args: any[]) => __handlers.get(channel)(event, ...args);

      for (const flag of [true, false]) {
        const port = await freePort();
        const store = createTokenStore(memoryBackend({ port }) as any);
        const token = recordTokens(store);
        const controller = createMcpController({ store, version: () => '0', featureEnabled: flag,
          limits: { ...DEFAULT_LIMITS, clipboardClearMs: 150 } });
        let clip = '';
        const clipboard = { writeText: (t: string) => { clip = t; }, readText: () => clip, clear: () => { clip = ''; } };
        const dialogCalls: any[] = [];
        let nextResponse = 1;
        const broadcasts: any[] = [];
        registerMcpHandlers({
          controller,
          clipboard,
          showMessageBox: async (_p: any, options: any) => { dialogCalls.push(options); return { response: nextResponse }; },
          lang: () => 'en',
          windowFor: () => null,
          broadcast: (channel: string, payload: unknown) => broadcasts.push([channel, payload]),
        });
        assert.deepEqual([...__handlers.keys()].filter((k) => k.startsWith('mcp:')).sort(),
          ['mcp:copy-connection-command', 'mcp:get-status', 'mcp:regenerate-token', 'mcp:set-enabled', 'mcp:set-port']);

        // positive control
        const status = await call('mcp:get-status', trusted);
        assert.equal(status.tokenTail, token.slice(-4), 'D trusted sender gets the status');
        nextResponse = 1;
        if (flag) {
          assert.deepEqual(await call('mcp:copy-connection-command', trusted, 'claude-code'), { copied: false });
          assert.equal(dialogCalls.length, 1, 'D trusted sender reaches the copy dialog');
        } else {
          await assert.rejects(async () => call('mcp:copy-connection-command', trusted, 'claude-code'), /feature disabled/);
          assert.equal(dialogCalls.length, 0, 'D [flag false] no copy dialog');
        }
        assert.equal(clip, '', 'D cancelled copy leaves the clipboard alone');
        const expectedDialogs = dialogCalls.length;
        console.log(\`ok: D [flag \${flag}] positive control: a trusted frame runs the handlers\`);

        // untrusted senders never run the handler body
        for (const [label, ev] of [['evil.example', evil], ['no frame', noFrame]] as const) {
          for (const ch of ['mcp:get-status', 'mcp:copy-connection-command', 'mcp:set-enabled']) {
            await assert.rejects(async () => call(ch, ev, ch === 'mcp:set-enabled' ? true : 'claude-code'), /IPC call from an untrusted frame/);
          }
          assert.equal(dialogCalls.length, expectedDialogs, \`D \${label}: no dialog was shown\`);
        }
        console.log(\`ok: D [flag \${flag}] untrusted frames are rejected before the handler runs\`);

        const json = JSON.stringify(await call('mcp:get-status', trusted));
        assert.doesNotMatch(json, /[A-Za-z0-9_-]{43}/, 'D status carries no 43-character token');
        assert.ok(!json.includes(token), 'D status does not contain the token');
        console.log(\`ok: D [flag \${flag}] status carries only the last 4 characters of the token\`);

        for (const bad of ['80', 80, 70000, 1.5, null]) {
          await assert.rejects(async () => call('mcp:set-port', trusted, bad), /invalid argument/, \`D set-port rejects \${String(bad)}\`);
        }
        await assert.rejects(async () => call('mcp:set-enabled', trusted, 'true'), /invalid argument/);
        await assert.rejects(async () => call('mcp:copy-connection-command', trusted, 'other'), /invalid argument/);
        console.log(\`ok: D [flag \${flag}] argument types and ranges are checked\`);

        if (!flag) {
          await assert.rejects(async () => call('mcp:set-enabled', trusted, true), /feature disabled/);
          assert.equal(controller.status().listening, false);
          // Nothing else may act either: no copy (so no token on the clipboard), no port change, no new token
          const tailBefore = controller.status().tokenTail;
          await assert.rejects(async () => call('mcp:copy-connection-command', trusted, 'mcp-remote'), /feature disabled/);
          await assert.rejects(async () => call('mcp:set-port', trusted, 45000), /feature disabled/);
          await assert.rejects(async () => call('mcp:regenerate-token', trusted), /feature disabled/);
          assert.equal(clip, '', 'D [flag false] nothing reached the clipboard');
          assert.equal(controller.status().tokenTail, tailBefore, 'D [flag false] the token was not regenerated');
          assert.notEqual(controller.status().port, 45000, 'D [flag false] the port was not changed');
          console.log('ok: D [flag false] set-enabled, copy, set-port and regenerate -> feature disabled');
          continue;
        }

        // enabling asks once; Cancel (also the default for Enter/Esc) keeps it off
        nextResponse = 1;
        const cancelled = await call('mcp:set-enabled', trusted, true);
        assert.equal(cancelled.enabled, false);
        assert.equal(cancelled.listening, false);
        const enableDialog = dialogCalls[dialogCalls.length - 1];
        assert.equal(enableDialog.defaultId, enableDialog.cancelId, 'D defaultId is the cancel button');
        assert.equal(enableDialog.buttons[enableDialog.cancelId], 'Cancel');
        nextResponse = 0;
        const enabled = await call('mcp:set-enabled', trusted, true);
        assert.equal(enabled.listening, true, 'D confirmed enabling listens');
        assert.ok(broadcasts.some(([c, s]) => c === 'mcp:status' && s.listening === true), 'D status is broadcast');
        assert.equal((await raw(port, requestText(port, token))).status, 200);
        console.log('ok: D enabling asks once (default and cancel = Cancel); cancel keeps it off; confirm listens');

        // copy after confirmation, cleared after the delay only if unchanged
        nextResponse = 0;
        assert.deepEqual(await call('mcp:copy-connection-command', trusted, 'claude-code'), { copied: true });
        assert.ok(clip.startsWith(\`claude mcp add --transport http maplat-editor http://127.0.0.1:\${port}/mcp --header "Authorization: Bearer \`), 'D the registration command is on the clipboard');
        await new Promise((r) => setTimeout(r, 1000));
        assert.equal(clip, '', 'D the copied command is cleared after the delay');
        assert.deepEqual(await call('mcp:copy-connection-command', trusted, 'mcp-remote'), { copied: true });
        clip = 'something the user copied later';
        await new Promise((r) => setTimeout(r, 1000));
        assert.equal(clip, 'something the user copied later', 'D a later clipboard content is left alone');
        console.log('ok: D copying needs the native dialog; the command is cleared after the delay unless replaced');

        const regenerated = await call('mcp:regenerate-token', trusted);
        const newToken = recordTokens(store);
        assert.equal(regenerated.tokenTail, newToken.slice(-4));
        assert.equal((await raw(port, requestText(port, token))).status, 401);
        assert.equal((await call('mcp:set-enabled', trusted, false)).listening, false);
        console.log('ok: D regenerate and disable through IPC');
        await controller.shutdown();
      }
    }

    if (process.env.MCP_SMOKE_TOKEN_FILE) writeFileSync(process.env.MCP_SMOKE_TOKEN_FILE, issued.join('\\n') + '\\n', { mode: 0o600 });
    console.log(\`ok: mcp-server-boundaries finished (\${issued.length} tokens issued, none printed)\`);
  `);

  await build({
    configFile: false,
    logLevel: 'silent',
    resolve: {
      alias: [
        { find: /^electron$/, replacement: electronStubFile },
        { find: /^electron-store$/, replacement: electronStoreStubFile },
      ],
    },
    build: {
      emptyOutDir: true,
      outDir,
      ssr: entryFile,
      target: 'node22',
      rollupOptions: {
        external: ['jimp'],
        output: { entryFileNames: 'mcp-server-boundaries-entry.mjs', format: 'es' },
      },
    },
  });

  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [bundledFile], {
      cwd: projectRoot,
      timeout: 240000,
      maxBuffer: 1024 * 1024 * 16,
      env: { ...process.env, MAPLAT_E2E_ROOT: e2eRoot },
    });
    process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
  } catch (error) {
    if (error.stdout) process.stdout.write(error.stdout);
    if (error.stderr) process.stderr.write(error.stderr);
    throw new Error('mcp-server-boundaries: the runtime part failed');
  }
} finally {
  await rm(workDir, { recursive: true, force: true });
}
console.log('ok: mcp-server-boundaries smoke passed');
