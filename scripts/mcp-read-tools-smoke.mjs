// Smoke: the read tools of the local MCP server.
//
// Builds a save folder in a temporary directory (a SQLite database with three maps, one of them with a compiled
// transformation, and a list thumbnail), starts the real MCP server on 127.0.0.1 with the real read-only facade,
// and calls the tools over HTTP. The renderer's IPC handlers for the same data are called with a trusted fake
// event, and:
//   - every tool result is checked against the IPC result for the same request (one read path for both),
//   - the IPC results are compared with a copy recorded from the handlers before they were moved onto the
//     facade, so moving them did not change what the renderer gets,
//   - input limits and unknown keys are rejected,
//   - no file in the save folder and no row in the database changes while the tools and handlers run.
//
// The token is never printed. MCP_SMOKE_TOKEN_FILE and MCP_SMOKE_SECRET_FILE (set by the log-redaction smoke)
// receive the issued tokens and the fixture's coordinate values, so that smoke can check this output for them.
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const rel = (p) => path.join(projectRoot, p);
const CAPTURE = process.env.MCP_READ_TOOLS_CAPTURE === '1';

// ---------------------------------------------------------------------------------------------
// Static: the IPC handlers read through the facade, not through the adapter
// ---------------------------------------------------------------------------------------------
function handlerBody(source, channel) {
  const start = source.indexOf(`ipc.handle('${channel}'`);
  assert.ok(start >= 0, `${channel} is registered`);
  const next = source.indexOf('ipc.handle(', start + 1);
  return source.slice(start, next < 0 ? undefined : next);
}
if (!CAPTURE) {
  const maps = await readFile(rel('electron/ipc/maps.ts'), 'utf8');
  const list = handlerBody(maps, 'maplist:request');
  assert.doesNotMatch(list, /StorageAdapter\.listMaps\(/, 'maplist:request does not call the adapter directly');
  assert.match(list, /readFacade\.listMaps\(/, 'maplist:request reads through the facade');
  console.log('ok: maplist:request reads through the read-only facade');
}

// ---------------------------------------------------------------------------------------------
// The IPC results recorded before the handlers were moved onto the facade (master c68b6d71), with the
// temporary directory written as <root>, are in scripts/fixtures/mcp-read-tools-ipc.json. Print fresh ones
// with MCP_READ_TOOLS_CAPTURE=1 only when the renderer's contract changes on purpose.
// ---------------------------------------------------------------------------------------------
const RECORDED = JSON.parse(await readFile(rel('scripts/fixtures/mcp-read-tools-ipc.json'), 'utf8'));

const scratchRoot = rel('.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'mcp-read-tools-'));

try {
  const electronStubFile = path.join(workDir, 'electron-stub.ts');
  const electronStoreStubFile = path.join(workDir, 'electron-store-stub.ts');
  const entryFile = path.join(workDir, 'mcp-read-tools-entry.ts');
  const outDir = path.join(workDir, 'dist');
  const bundledFile = path.join(outDir, 'mcp-read-tools-entry.mjs');
  const dataDir = path.join(workDir, 'data');
  await mkdir(dataDir, { recursive: true });

  await writeFile(electronStubFile, `
    export const __handlers = new Map<string, any>();
    export const app = {
      isPackaged: true,
      getPath(name: string) { return ${JSON.stringify(path.join(workDir, 'paths'))} + '/' + name; },
      getName() { return 'MaplatEditor'; },
      getVersion() { return '0.0.0-smoke'; },
      whenReady() { return Promise.resolve(); },
      exit() {},
    };
    export const ipcMain = {
      handle(channel: string, fn: any) { __handlers.set(channel, fn); },
      removeHandler(channel: string) { __handlers.delete(channel); },
      on() {},
      removeAllListeners() {},
    };
    export const dialog = {
      showOpenDialog() { return Promise.resolve({ canceled: true, filePaths: [] }); },
      showSaveDialog() { return Promise.resolve({ canceled: true }); },
      showMessageBox() { return Promise.resolve({ response: 0 }); },
    };
    export const clipboard = { writeText() {}, readText() { return ''; }, clear() {} };
    export class BrowserWindow {
      static getAllWindows() { return []; }
      static fromWebContents() { return null; }
    }
    export const session = { defaultSession: { clearStorageData() { return Promise.resolve(); } } };
    export const shell = { trashItem() { return Promise.resolve(); }, openPath() { return Promise.resolve(''); } };
  `);
  await writeFile(electronStoreStubFile, `
    export default class Store<T extends Record<string, any>> {
      store: T;
      constructor(options: { defaults?: T } = {}) { this.store = { ...(options.defaults || {}) } as T; }
      get(key: string) { return this.store[key]; }
      set(key: string, value: any) { this.store[key as keyof T] = value; }
      has(key: string) { return Object.prototype.hasOwnProperty.call(this.store, key); }
      delete(key: string) { delete this.store[key as keyof T]; }
    }
  `);

  await writeFile(entryFile, `
    import assert from 'node:assert/strict';
    import { readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
    import { join } from 'node:path';
    import { __handlers } from 'electron';

    const CAPTURE = ${JSON.stringify(CAPTURE)};
    const RECORDED: { maplist: Record<string, unknown>; mapedit: Record<string, unknown> } = ${JSON.stringify(RECORDED)};
    const dataDir = ${JSON.stringify(dataDir)};
    const workDir = ${JSON.stringify(workDir)};

    const { default: SettingsService } = await import(${JSON.stringify(rel('electron/services/SettingsService.ts'))});
    SettingsService.set('saveFolder', dataDir);
    const { default: SqliteDataService } = await import(${JSON.stringify(rel('electron/services/SqliteDataService.ts'))});
    const { registerMapHandlers } = await import(${JSON.stringify(rel('electron/ipc/maps.ts'))});
    const { registerMapEditHandlers } = await import(${JSON.stringify(rel('electron/ipc/mapedit.ts'))});
    const { default: Tin } = await import('@maplat/tin');

    // ---------------- fixture ----------------
    const HALF = 20037508.342789244;
    const toMerc = ([lon, lat]: number[]) => [lon * HALF / 180, Math.log(Math.tan((90 + lat) * Math.PI / 360)) / (Math.PI / 180) * HALF / 180];
    const A = { uid: '11111111-1111-4111-8111-111111111111', slug: 'mcp-read-a', width: 1000, height: 800 };
    const B = { uid: '22222222-2222-4222-8222-222222222222', slug: 'mcp-read-b', width: 300, height: 200 };
    const C = { uid: '33333333-3333-4333-8333-333333333333', slug: 'mcp-read-c', width: 5000, height: 3000 };
    const gcpsLonLat: [number[], number[]][] = [
      [[0, 0], [139.70, 35.70]], [[1000, 0], [139.80, 35.70]], [[1000, 800], [139.80, 35.62]],
      [[0, 800], [139.70, 35.62]], [[500, 400], [139.752, 35.661]],
    ];
    const gcpsA = gcpsLonLat.map(([img, ll]) => [img, toMerc(ll)]);
    const tin = new Tin({ useV2Algorithm: true });
    tin.setWh([A.width, A.height]);
    tin.setStrictMode('auto');
    tin.setVertexMode('plain');
    tin.setPoints(gcpsA);
    tin.setEdges([]);
    await tin.updateTinAsync();
    const compiledA = tin.getCompiled();
    const base = { officialTitle: {}, author: {}, era: {}, createdAt: {}, contributor: {}, mapper: {}, attr: {}, dataAttr: {},
      description: {}, license: 'PD', dataLicense: 'CC0', reference: '', url: '', lang: 'ja', imageExtension: 'jpg',
      edges: [], sub_maps: [], homePosition: [139.75, 35.66], mercZoom: 14, strictMode: 'auto', vertexMode: 'plain' };
    await SqliteDataService.createMap(A.slug, { ...base, title: { ja: '読み取り試験 甲', en: 'Read test A' },
      width: A.width, height: A.height, gcps: gcpsA, compiled: compiledA }, A.uid);
    await SqliteDataService.createMap(B.slug, { ...base, title: 'Read test B', lang: 'en',
      width: B.width, height: B.height, gcps: gcpsA.slice(0, 2) }, B.uid);
    await SqliteDataService.createMap(C.slug, { ...base, title: { ja: '読み取り試験 丙' }, width: C.width, height: C.height, gcps: [] }, C.uid);
    mkdirSync(join(dataDir, 'tmbs'), { recursive: true });
    writeFileSync(join(dataDir, 'tmbs', A.uid + '.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    if (process.env.MCP_SMOKE_SECRET_FILE) {
      const values = gcpsA.flatMap(([, m]) => m.map((v: number) => String(v)));
      writeFileSync(process.env.MCP_SMOKE_SECRET_FILE, values.join('\\n') + '\\n', { mode: 0o600 });
    }

    // ---------------- IPC ----------------
    registerMapHandlers();
    registerMapEditHandlers();
    const trusted = { senderFrame: { url: 'app://bundle/index.html', parent: null } };
    const ipcCall = (channel: string, ...args: any[]) => __handlers.get(channel)(trusted, ...args);
    const normalize = (value: unknown) => JSON.parse(JSON.stringify(value).split(workDir).join('<root>'));
    const LIST_CALLS: Record<string, unknown[]> = {
      'maplist:request()': [undefined, undefined, undefined],
      'maplist:request(,1,2)': ['', 1, 2],
      'maplist:request(,2,2)': ['', 2, 2],
    };
    const EDIT_REFS = [A.uid, A.slug, B.uid, C.uid];
    async function runIpcReads() {
      const maplist: Record<string, unknown> = {};
      for (const [key, args] of Object.entries(LIST_CALLS)) maplist[key] = normalize(await ipcCall('maplist:request', ...args));
      const mapedit: Record<string, unknown> = {};
      for (const ref of EDIT_REFS) mapedit[ref] = normalize(await ipcCall('mapedit:request', ref));
      return { maplist, mapedit };
    }
    const ipcResults = await runIpcReads();
    if (CAPTURE) {
      console.log('CAPTURED ' + JSON.stringify(ipcResults.maplist));
      for (const ref of EDIT_REFS) console.log('CAPTURED-EDIT ' + JSON.stringify([ref, ipcResults.mapedit[ref]]));
      process.exit(0);
    }
    for (const [key, value] of Object.entries(ipcResults.maplist)) {
      assert.deepEqual(value, RECORDED.maplist[key], \`IPC result unchanged: \${key}\`);
    }
    for (const [ref, value] of Object.entries(ipcResults.mapedit)) {
      assert.deepEqual(value, RECORDED.mapedit[ref], \`IPC result unchanged: mapedit:request(\${ref})\`);
    }
    console.log(\`ok: \${Object.keys(LIST_CALLS).length} maplist:request and \${EDIT_REFS.length} mapedit:request results match the copy recorded before the handlers moved onto the facade\`);

    // ---------------- no writes: snapshot ----------------
    function snapshot() {
      const files: Record<string, number> = {};
      const walk = (dir: string) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const p = join(dir, entry.name);
          if (entry.isDirectory()) walk(p);
          else files[p.slice(dataDir.length)] = statSync(p).mtimeMs;
        }
      };
      walk(dataDir);
      return files;
    }
    const db = await SqliteDataService.getDb();
    const changes = () => Number((db.prepare('SELECT total_changes() AS n').get() as any).n);
    const filesBefore = snapshot();
    const changesBefore = changes();

    // ---------------- MCP server ----------------
    const net = await import('node:net');
    const { createMcpHttpServer } = await import(${JSON.stringify(rel('electron/mcp/server.ts'))});
    const facade = await import(${JSON.stringify(rel('electron/mcp/readFacade.ts'))});
    const port: number = await new Promise((resolve, reject) => {
      const s = net.createServer();
      s.once('error', reject);
      s.listen(0, '127.0.0.1', () => { const p = (s.address() as any).port; s.close(() => resolve(p)); });
    });
    const token = (await import('node:crypto')).randomBytes(32).toString('base64url');
    if (process.env.MCP_SMOKE_TOKEN_FILE) writeFileSync(process.env.MCP_SMOKE_TOKEN_FILE, token + '\\n', { mode: 0o600 });
    const server = createMcpHttpServer({ port, getToken: () => token, facade, version: '0.0.0-smoke' });
    assert.deepEqual(await server.listen(), { ok: true }, 'server listens');

    let rpcId = 0;
    async function rpc(method: string, params: unknown) {
      const res = await fetch(\`http://127.0.0.1:\${port}/mcp\`, {
        method: 'POST',
        headers: { Authorization: \`Bearer \${token}\`, Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
      });
      assert.equal(res.status, 200, \`\${method} answers 200\`);
      return (await res.json()) as any;
    }
    async function tool(name: string, args: unknown) {
      const reply = await rpc('tools/call', { name, arguments: args });
      assert.ok(reply.result, \`\${name} has a result\`);
      return reply.result;
    }
    async function ok(name: string, args: unknown) {
      const result = await tool(name, args);
      assert.notEqual(result.isError, true, \`\${name} \${JSON.stringify(args).slice(0, 80)} succeeds (\${result.content?.[0]?.text?.slice(0, 120)})\`);
      assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent, \`\${name} text and structured content agree\`);
      return result.structuredContent;
    }
    async function rejected(name: string, args: unknown, label: string) {
      const result = await tool(name, args);
      assert.equal(result.isError, true, \`\${label}: rejected\`);
      assert.match(result.content[0].text, /-32602/, \`\${label}: rejected as invalid params\`);
    }
    async function failed(name: string, args: unknown, text: RegExp, label: string) {
      const result = await tool(name, args);
      assert.equal(result.isError, true, \`\${label}: ends as an error\`);
      assert.match(result.content[0].text, text, \`\${label}: says why\`);
    }

    try {
      const listed = await rpc('tools/list', {});
      const names = listed.result.tools.map((t: any) => t.name).sort();
      for (const name of ['editor.ping', 'maps.list']) assert.ok(names.includes(name), \`tools/list has \${name}\`);
      for (const t of listed.result.tools) {
        assert.equal(t.inputSchema.type, 'object', \`\${t.name} input schema is an object\`);
        assert.equal(t.inputSchema.additionalProperties, false, \`\${t.name} input schema is strict\`);
        assert.equal(t.annotations?.readOnlyHint, true, \`\${t.name} is marked read-only\`);
      }
      console.log('ok: tools/list: ' + names.join(', ') + ' (strict object schemas, read-only)');

      // ---------------- maps.list ----------------
      {
        const fromIpc = (r: any) => r.docs.map((d: any) => ({ uid: d.uid, slug: d.mapID, title: d.title }));
        const pick = (r: any) => r.maps.map((m: any) => ({ uid: m.uid, slug: m.slug, title: m.title }));
        const all = await ok('maps.list', {});
        const ipcAll = await ipcCall('maplist:request', undefined, undefined, undefined);
        assert.deepEqual(pick(all), fromIpc(ipcAll), 'maps.list matches maplist:request');
        assert.equal(all.total, 3, 'maps.list total');
        assert.equal(all.page, 1, 'maps.list page');
        assert.equal(all.next, false, 'maps.list next');
        const byUid = Object.fromEntries(all.maps.map((m: any) => [m.uid, m]));
        assert.deepEqual(byUid[A.uid], { uid: A.uid, slug: A.slug, title: '読み取り試験 甲', width: 1000, height: 800, maxZoom: 2 }, 'maps.list entry A');
        assert.deepEqual(byUid[B.uid], { uid: B.uid, slug: B.slug, title: 'Read test B', width: 300, height: 200, maxZoom: 1 }, 'maps.list entry B');
        assert.deepEqual(byUid[C.uid], { uid: C.uid, slug: C.slug, title: '読み取り試験 丙', width: 5000, height: 3000, maxZoom: 5 }, 'maps.list entry C');
        assert.deepEqual(Object.keys(byUid[A.uid]).sort(), ['height', 'maxZoom', 'slug', 'title', 'uid', 'width'], 'maps.list gives six fields only');

        const p1 = await ok('maps.list', { page: 1, pageSize: 2 });
        const p2 = await ok('maps.list', { page: 2, pageSize: 2 });
        assert.deepEqual(pick(p1), fromIpc(await ipcCall('maplist:request', '', 1, 2)), 'maps.list page 1 matches IPC');
        assert.deepEqual(pick(p2), fromIpc(await ipcCall('maplist:request', '', 2, 2)), 'maps.list page 2 matches IPC');
        assert.equal(p1.maps.length, 2);
        assert.equal(p1.next, true, 'page 1 of 2 has a next page');
        assert.equal(p2.maps.length, 1);
        assert.equal(p2.next, false, 'page 2 of 2 has no next page');
        const past = await ok('maps.list', { page: 9, pageSize: 2 });
        assert.equal(past.page, 2, 'a page past the end answers the last page and says which');

        for (const query of [A.slug, 'Read', '読み取り', 'nothing-matches-this']) {
          const r = await ok('maps.list', { query });
          assert.deepEqual(pick(r), fromIpc(await ipcCall('maplist:request', query, undefined, undefined)), \`maps.list query "\${query}" matches IPC\`);
        }
        assert.ok((await ok('maps.list', { query: A.slug })).maps.some((m: any) => m.uid === A.uid), 'maps.list query finds the map by slug');

        await rejected('maps.list', { pageSize: 101 }, 'maps.list pageSize 101');
        await rejected('maps.list', { pageSize: 0 }, 'maps.list pageSize 0');
        await rejected('maps.list', { page: 0 }, 'maps.list page 0');
        await rejected('maps.list', { page: 1.5 }, 'maps.list page 1.5');
        await rejected('maps.list', { query: 'x'.repeat(201) }, 'maps.list query of 201 characters');
        await rejected('maps.list', { query: 'a', path: '/etc' }, 'maps.list unknown key');
        assert.equal((await ok('maps.list', { pageSize: 100, query: 'x'.repeat(200) })).maps.length, 0, 'maps.list accepts the limits themselves');
        console.log('ok: maps.list matches maplist:request (all, pages, queries), gives six fields, rejects out-of-range input');
      }

      // ---------------- no writes ----------------
      await runIpcReads();
      assert.deepEqual(snapshot(), filesBefore, 'no file in the save folder changed');
      assert.equal(changes(), changesBefore, 'no database row changed');
      console.log('ok: no file and no database row changed while the tools and handlers ran');
    } finally {
      await server.close();
    }
    console.log('ok: mcp-read-tools finished');
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
        external: ['jimp', '@jsquash/webp', 'pwa-asset-generator', 'electron-updater'],
        output: { entryFileNames: 'mcp-read-tools-entry.mjs', format: 'es' },
      },
    },
  });

  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [bundledFile], {
      cwd: projectRoot,
      timeout: 240000,
      maxBuffer: 1024 * 1024 * 16,
      env: { ...process.env, MAPLAT_E2E_ROOT: path.join(workDir, 'root') },
    });
    process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
  } catch (error) {
    if (error.stdout) process.stdout.write(error.stdout);
    if (error.stderr) process.stderr.write(error.stderr);
    throw new Error('mcp-read-tools: the runtime part failed');
  }
} finally {
  await rm(workDir, { recursive: true, force: true });
}
console.log('ok: mcp-read-tools smoke passed');
