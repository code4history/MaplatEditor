// Smoke: maps.render_region, the tool that draws a part of a map image (with an optional grid and marks).
//
// Builds a save folder in a temporary directory: a SQLite database with a few maps and, for each, the tile
// pyramid cut from a generated source image whose pixels are known (a colour that follows the position and a
// dark line every 100 px). Starts the real MCP server on 127.0.0.1 with the real read-only facade, calls the
// tool over HTTP and checks:
//   (1) the picture equals the same rectangle cut from the source image and scaled (Jimp on both sides)
//   (2) origin, scale, width, height and zoom are as asked
//   (3) with a grid, the pixels on multiples of grid_step have the grid colour and the others are unchanged
//   (4) marks are drawn where they were asked
//   (5) input limits (output size, tile count, grid density, empty or outside regions, marks, labels, keys)
//   (6) a missing tile leaves its part transparent and the picture is still made
//   (7) a request past its time limit stops reading tiles; an abort after the tiles are read stops the drawing
//   (8) no file in the save folder and no database row changes
// It also checks that tiles are read inside the save folder only, that the encoded picture has a size limit,
// that an unexpected failure is answered "internal error" without detail, and it times the largest request.
//
// The token is never printed. MCP_SMOKE_TOKEN_FILE and MCP_SMOKE_SECRET_FILE (set by the log-redaction smoke)
// receive the issued token and pieces of the encoded pictures, so that smoke can check this output for them.
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const rel = (p) => path.join(projectRoot, p);

// ---------------------------------------------------------------------------------------------
// Static: the font module stays outside the main bundle (its font files are found next to the module)
// ---------------------------------------------------------------------------------------------
{
  const viteConfig = await readFile(rel('vite.config.ts'), 'utf8');
  const external = /external:\s*\[([^\]]*)\]/.exec(viteConfig)?.[1] ?? '';
  assert.match(external, /'jimp\/fonts'/, 'the main bundle keeps jimp/fonts external');
  const source = await readFile(rel('electron/mcp/renderRegion.ts'), 'utf8');
  const specs = [...source.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)].map((m) => m[1]).sort();
  assert.deepEqual([...new Set(specs)], ['../utils/tilePyramid', './limits', './readFacade', 'jimp', 'jimp/fonts'],
    'renderRegion.ts imports Jimp, the tile pyramid formulas, the limits and the facade types only');
  console.log('ok: jimp/fonts is external to the main bundle; renderRegion.ts imports only what it needs');
}

const scratchRoot = rel('.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'mcp-render-region-'));

try {
  const electronStubFile = path.join(workDir, 'electron-stub.ts');
  const electronStoreStubFile = path.join(workDir, 'electron-store-stub.ts');
  const entryFile = path.join(workDir, 'mcp-render-region-entry.ts');
  const outDir = path.join(workDir, 'dist');
  const bundledFile = path.join(outDir, 'mcp-render-region-entry.mjs');
  const dataDir = path.join(workDir, 'data');
  const outsideDir = path.join(workDir, 'outside');
  await mkdir(dataDir, { recursive: true });

  await writeFile(electronStubFile, `
    export const app = {
      isPackaged: true,
      getPath(name: string) { return ${JSON.stringify(path.join(workDir, 'paths'))} + '/' + name; },
      getName() { return 'MaplatEditor'; },
      getVersion() { return '0.0.0-smoke'; },
      whenReady() { return Promise.resolve(); },
      exit() {},
    };
    export const ipcMain = { handle() {}, removeHandler() {}, on() {}, removeAllListeners() {} };
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
    import { readdirSync, statSync, writeFileSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
    import { join } from 'node:path';
    import { Jimp } from 'jimp';

    const dataDir = ${JSON.stringify(dataDir)};
    const workDir = ${JSON.stringify(workDir)};
    const outsideDir = ${JSON.stringify(outsideDir)};

    const { default: SettingsService } = await import(${JSON.stringify(rel('electron/services/SettingsService.ts'))});
    SettingsService.set('saveFolder', dataDir);
    const { default: SqliteDataService } = await import(${JSON.stringify(rel('electron/services/SqliteDataService.ts'))});
    const { tileMaxZoom, tileLevelSize } = await import(${JSON.stringify(rel('electron/utils/tilePyramid.ts'))});
    const { DEFAULT_LIMITS } = await import(${JSON.stringify(rel('electron/mcp/limits.ts'))});
    const { renderRegion, GRID_RGBA, MARK_RGBA } = await import(${JSON.stringify(rel('electron/mcp/renderRegion.ts'))});
    const facade = await import(${JSON.stringify(rel('electron/mcp/readFacade.ts'))});

    // ---------------- fixture ----------------
    // A source pixel: a colour that follows the position, and a dark line every 100 px.
    const sourcePixel = (x: number, y: number): [number, number, number] =>
      x % 100 === 0 || y % 100 === 0 ? [20, 20, 20] : [(x * 7) & 255, (y * 5) & 255, (((x >> 4) ^ (y >> 4)) * 16) & 255];
    function sourceImage(width: number, height: number) {
      const img = new Jimp({ width, height, color: 0x000000ff });
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const [r, g, b] = sourcePixel(x, y);
        img.bitmap.data[i] = r; img.bitmap.data[i + 1] = g; img.bitmap.data[i + 2] = b; img.bitmap.data[i + 3] = 255;
      }
      return img;
    }
    // The tiles are cut with the same formulas the upload uses (tilePyramid.ts).
    async function cutTiles(uid: string, src: any, ext: 'png' | 'jpg') {
      const { width, height } = src;
      const maxZoom = tileMaxZoom(width, height);
      for (let z = maxZoom; z >= 0; z--) {
        const { pw, ph } = tileLevelSize(width, height, maxZoom, z);
        const f = Math.pow(2, maxZoom - z);
        for (let tx = 0; tx * 256 < pw; tx++) for (let ty = 0; ty * 256 < ph; ty++) {
          const tw = (tx + 1) * 256 > pw ? pw - tx * 256 : 256;
          const th = (ty + 1) * 256 > ph ? ph - ty * 256 : 256;
          const sx = tx * 256 * f; const sy = ty * 256 * f;
          const sw = (tx + 1) * 256 * f > width ? width - sx : 256 * f;
          const sh = (ty + 1) * 256 * f > height ? height - sy : 256 * f;
          const tile = src.clone().crop({ x: sx, y: sy, w: sw, h: sh }).resize({ w: tw, h: th });
          const dir = join(dataDir, 'tiles', uid, String(z), String(tx));
          mkdirSync(dir, { recursive: true });
          writeFileSync(join(dir, ty + '.' + ext), await tile.getBuffer(ext === 'png' ? 'image/png' : 'image/jpeg'));
        }
      }
      return maxZoom;
    }
    const R = { uid: '77777777-7777-4777-8777-777777777777', slug: 'mcp-render-r', width: 1300, height: 1100 };
    const S = { uid: '88888888-8888-4888-8888-888888888888', slug: 'mcp-render-s', width: 600, height: 500 };
    const J = { uid: '99999999-9999-4999-8999-999999999999', slug: 'mcp-render-j', width: 300, height: 200 };
    const N = { uid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', slug: 'mcp-render-n', width: 400, height: 300 };
    const L = { uid: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', slug: 'mcp-render-l', width: 600, height: 500 };
    const base = { officialTitle: {}, author: {}, era: {}, createdAt: {}, contributor: {}, mapper: {}, attr: {}, dataAttr: {},
      description: {}, license: 'PD', dataLicense: 'CC0', reference: '', url: '', lang: 'en', imageExtension: 'png',
      edges: [], sub_maps: [], homePosition: [139.75, 35.66], mercZoom: 14, strictMode: 'auto', vertexMode: 'plain', gcps: [] };
    for (const m of [R, S, J, N, L]) {
      await SqliteDataService.createMap(m.slug, { ...base, title: 'Render ' + m.slug, width: m.width, height: m.height,
        imageExtension: m === J ? 'jpg' : 'png' }, m.uid);
    }
    const srcR = sourceImage(R.width, R.height);
    const srcS = sourceImage(S.width, S.height);
    assert.equal(await cutTiles(R.uid, srcR, 'png'), 3, 'map R has zoom levels 0..3');
    assert.equal(await cutTiles(S.uid, srcS, 'png'), 2, 'map S has zoom levels 0..2');
    await cutTiles(J.uid, sourceImage(J.width, J.height), 'jpg');
    // S: one tile of the largest level is missing.
    rmSync(join(dataDir, 'tiles', S.uid, '2', '1', '0.png'));
    // L: the tiles of its largest level are a link to a folder outside the save folder.
    await cutTiles(L.uid, sourceImage(L.width, L.height), 'png');
    mkdirSync(outsideDir, { recursive: true });
    const outsideLevel = join(outsideDir, 'level2');
    // Move the real level out of the save folder and link to it from inside.
    const { renameSync } = await import('node:fs');
    renameSync(join(dataDir, 'tiles', L.uid, '2'), outsideLevel);
    symlinkSync(outsideLevel, join(dataDir, 'tiles', L.uid, '2'), 'dir');

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
    const freePort = (): Promise<number> => new Promise((resolve, reject) => {
      const s = net.createServer();
      s.once('error', reject);
      s.listen(0, '127.0.0.1', () => { const p = (s.address() as any).port; s.close(() => resolve(p)); });
    });
    const token = (await import('node:crypto')).randomBytes(32).toString('base64url');
    if (process.env.MCP_SMOKE_TOKEN_FILE) writeFileSync(process.env.MCP_SMOKE_TOKEN_FILE, token + '\\n', { mode: 0o600 });
    const secretPieces: string[] = [];
    const remember = (b64: string) => {
      // Pieces from the middle of an encoded picture: the log-redaction smoke checks the output for them.
      for (let i = 0; i < 3 && b64.length > 400; i++) secretPieces.push(b64.slice(100 + i * 97, 100 + i * 97 + 40));
    };
    async function startServer(limits = DEFAULT_LIMITS, f: any = facade) {
      const port = await freePort();
      const server = createMcpHttpServer({ port, getToken: () => token, facade: f, version: '0.0.0-smoke', limits });
      assert.deepEqual(await server.listen(), { ok: true }, 'server listens');
      return { port, server };
    }
    const main = await startServer();

    let rpcId = 0;
    async function rpc(port: number, method: string, params: unknown) {
      const res = await fetch(\`http://127.0.0.1:\${port}/mcp\`, {
        method: 'POST',
        headers: { Authorization: \`Bearer \${token}\`, Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
      });
      assert.equal(res.status, 200, \`\${method} answers 200\`);
      return (await res.json()) as any;
    }
    async function call(args: unknown, port = main.port) {
      const reply = await rpc(port, 'tools/call', { name: 'maps.render_region', arguments: args });
      assert.ok(reply.result, 'maps.render_region has a result (' + JSON.stringify(reply.error ?? '') + ')');
      assert.ok(!JSON.stringify(reply).includes(workDir), 'no answer names a folder on this computer');
      return reply.result;
    }
    async function render(args: Record<string, unknown>, port = main.port) {
      const result = await call(args, port);
      assert.notEqual(result.isError, true, \`render \${JSON.stringify(args).slice(0, 100)} succeeds (\${result.content?.[0]?.text?.slice(0, 160)})\`);
      const image = result.content.find((c: any) => c.type === 'image');
      assert.ok(image, 'the result has an image');
      const text = result.content.find((c: any) => c.type === 'text');
      assert.deepEqual(JSON.parse(text.text), result.structuredContent, 'text and structured content agree');
      remember(image.data);
      const bytes = Buffer.from(image.data, 'base64');
      const picture = await Jimp.fromBuffer(bytes);
      return { info: result.structuredContent, mimeType: image.mimeType, bytes, picture };
    }
    async function rejected(args: unknown, text: RegExp, label: string, port = main.port) {
      const result = await call(args, port);
      assert.equal(result.isError, true, \`\${label}: rejected\`);
      assert.match(result.content[0].text, /-32602/, \`\${label}: rejected as invalid params (\${result.content[0].text})\`);
      assert.match(result.content[0].text, text, \`\${label}: says why (\${result.content[0].text})\`);
    }
    async function failed(args: unknown, text: RegExp, label: string, port = main.port) {
      const result = await call(args, port);
      assert.equal(result.isError, true, \`\${label}: ends as an error\`);
      assert.match(result.content[0].text, text, \`\${label}: says why (\${result.content[0].text})\`);
    }
    const px = (img: any, x: number, y: number) => {
      const i = (y * img.bitmap.width + x) * 4;
      return [...img.bitmap.data.subarray(i, i + 4)];
    };
    function maxDiff(a: any, b: any) {
      assert.equal(a.bitmap.width, b.bitmap.width, 'same width');
      assert.equal(a.bitmap.height, b.bitmap.height, 'same height');
      let m = 0;
      for (let i = 0; i < a.bitmap.data.length; i++) m = Math.max(m, Math.abs(a.bitmap.data[i] - b.bitmap.data[i]));
      return m;
    }
    const expected = (src: any, x0: number, y0: number, x1: number, y1: number, scale: number) =>
      src.clone().crop({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }).resize({ w: (x1 - x0) * scale, h: (y1 - y0) * scale });

    try {
      const listed = await rpc(main.port, 'tools/list', {});
      const tool = listed.result.tools.find((t: any) => t.name === 'maps.render_region');
      assert.ok(tool, 'tools/list has maps.render_region');
      assert.equal(tool.inputSchema.additionalProperties, false, 'maps.render_region input schema is strict');
      assert.equal(tool.annotations?.readOnlyHint, true, 'maps.render_region is marked read-only');
      console.log('ok: tools/list has maps.render_region (strict, read-only)');

      // ---------------- (1)(2) the picture without a grid ----------------
      {
        const cases: [number, number, number, number, number][] = [
          [150, 120, 450, 380, 2], [0, 0, 256, 256, 1], [255, 255, 257, 257, 4], [1000, 900, 1300, 1100, 3], [37, 611, 300, 700, 1],
        ];
        for (const [x0, y0, x1, y1, scale] of cases) {
          const r = await render({ map: R.uid, x0, y0, x1, y1, scale });
          assert.equal(r.mimeType, 'image/png', 'png by default');
          assert.deepEqual(r.info, { origin: [x0, y0], scale, width: (x1 - x0) * scale, height: (y1 - y0) * scale, zoom: 3 }, \`info for \${[x0, y0, x1, y1, scale]}\`);
          const diff = maxDiff(r.picture, expected(srcR, x0, y0, x1, y1, scale));
          assert.ok(diff <= 8, \`region \${[x0, y0, x1, y1]} x\${scale} equals the source cut and scaled (largest difference \${diff})\`);
        }
        const bySlug = await render({ map: R.slug, x0: 150, y0: 120, x1: 450, y1: 380 });
        assert.equal(bySlug.info.scale, 2, 'scale is 2 by default');
        assert.equal(maxDiff(bySlug.picture, expected(srcR, 150, 120, 450, 380, 2)), 0, 'by slug, the default scale gives the same picture');
        const jpeg = await render({ map: R.uid, x0: 150, y0: 120, x1: 450, y1: 380, format: 'jpeg' });
        assert.equal(jpeg.mimeType, 'image/jpeg', 'jpeg when asked');
        assert.deepEqual([jpeg.bytes[0], jpeg.bytes[1]], [0xff, 0xd8], 'the jpeg bytes are a jpeg');
        assert.ok(maxDiff(jpeg.picture, expected(srcR, 150, 120, 450, 380, 2)) < 128, 'the jpeg is close to the source');
        const j = await render({ map: J.slug, x0: 10, y0: 10, x1: 290, y1: 190, scale: 1 });
        assert.deepEqual([j.info.width, j.info.height, j.info.zoom], [280, 180, 1], 'a map with jpeg tiles renders');
        console.log(\`ok: \${cases.length} regions equal the source image cut and scaled; info, slug, default scale and jpeg are right\`);
      }

      // ---------------- (3) grid ----------------
      {
        const [x0, y0, x1, y1, scale] = [150, 120, 450, 380, 2];
        const plain = await render({ map: R.uid, x0, y0, x1, y1, scale });
        const grid = await render({ map: R.uid, x0, y0, x1, y1, scale, grid_step: 100 });
        assert.equal(grid.info.grid_step, 100, 'info has grid_step');
        const [gr, gg, gb, ga] = GRID_RGBA;
        const blend = (base: number[]) => [0, 1, 2].map((k) => Math.round(([gr, gg, gb][k] * ga + base[k] * (255 - ga)) / 255));
        const rowY = 250; // away from the horizontal lines (out y 160, 360) and the labels at the top
        for (const sx of [200, 300, 400]) {
          const ox = (sx - x0) * scale;
          const want = blend(px(plain.picture, ox, rowY));
          const got = px(grid.picture, ox, rowY);
          assert.ok(want.every((v, k) => Math.abs(v - got[k]) <= 1), \`a vertical grid line at x=\${sx} (\${got} vs \${want})\`);
          assert.deepEqual(px(grid.picture, ox + 1, rowY), px(plain.picture, ox + 1, rowY), \`next to the line at x=\${sx} is unchanged\`);
        }
        const colX = 250;
        for (const sy of [200, 300]) {
          const oy = (sy - y0) * scale;
          const want = blend(px(plain.picture, colX, oy));
          const got = px(grid.picture, colX, oy);
          assert.ok(want.every((v, k) => Math.abs(v - got[k]) <= 1), \`a horizontal grid line at y=\${sy} (\${got} vs \${want})\`);
          assert.deepEqual(px(grid.picture, colX, oy + 1), px(plain.picture, colX, oy + 1), \`next to the line at y=\${sy} is unchanged\`);
        }
        // Away from lines and labels the picture is the plain one.
        let changed = 0;
        for (let y = 20; y < grid.picture.bitmap.height; y += 7) for (let x = 40; x < grid.picture.bitmap.width; x += 7) {
          const onLine = [200, 300, 400].some((s) => (s - x0) * scale === x) || [200, 300].some((s) => (s - y0) * scale === y);
          if (!onLine && px(grid.picture, x, y).join() !== px(plain.picture, x, y).join()) changed++;
        }
        assert.equal(changed, 0, 'pixels off the grid lines and labels are unchanged');
        // The coordinate labels: a light box with dark text next to each line, on the top and left edges.
        const darkIn = (img: any, x0b: number, y0b: number, w: number, h: number) => {
          let dark = 0; let light = 0;
          for (let y = y0b; y < y0b + h; y++) for (let x = x0b; x < x0b + w; x++) {
            const [r, g, b] = px(img, x, y);
            if (r + g + b < 200) dark++;
            if (r + g + b > 700) light++;
          }
          return { dark, light };
        };
        const top = darkIn(grid.picture, (200 - x0) * scale + 2, 1, 18, 10);
        assert.ok(top.dark > 3 && top.light > 20, \`a label at the top of the line x=200 (\${JSON.stringify(top)})\`);
        const left = darkIn(grid.picture, 1, (200 - y0) * scale + 2, 18, 10);
        assert.ok(left.dark > 3 && left.light > 20, \`a label at the left of the line y=200 (\${JSON.stringify(left)})\`);
        const okDense = await render({ map: R.uid, x0, y0, x1, y1, scale, grid_step: 16 });
        assert.equal(okDense.info.grid_step, 16, 'grid_step x scale = 32 output pixels is accepted');
        console.log('ok: the grid lines are on multiples of grid_step, other pixels are unchanged, lines are labelled');
      }

      // ---------------- (4) marks ----------------
      {
        const [x0, y0, x1, y1, scale] = [150, 120, 450, 380, 2];
        const plain = await render({ map: R.uid, x0, y0, x1, y1, scale });
        const marked = await render({ map: R.uid, x0, y0, x1, y1, scale, marks: [{ x: 250, y: 250, label: 'A1' }, { x: 420, y: 150 }, { x: 900, y: 900 }] });
        for (const [mx, my] of [[250, 250], [420, 150]]) {
          const cx = (mx - x0) * scale; const cy = (my - y0) * scale;
          for (const [dx, dy] of [[0, 0], [-3, 0], [3, 0], [0, -3], [0, 3], [-1, 0], [0, 2]]) {
            assert.deepEqual(px(marked.picture, cx + dx, cy + dy), MARK_RGBA, \`mark at (\${mx}, \${my}) has the mark colour at \${dx},\${dy}\`);
          }
          assert.deepEqual(px(marked.picture, cx + 2, cy + 2), px(plain.picture, cx + 2, cy + 2), \`mark at (\${mx}, \${my}) is a cross, not a square\`);
        }
        let labelPixels = 0;
        const lx = (250 - x0) * scale + 5; const ly = (250 - y0) * scale + 4;
        for (let y = ly; y < ly + 10; y++) for (let x = lx; x < lx + 14; x++) if (px(marked.picture, x, y).join() !== px(plain.picture, x, y).join()) labelPixels++;
        assert.ok(labelPixels > 20, \`the mark label is drawn next to the mark (\${labelPixels} pixels)\`);
        console.log('ok: marks are crosses of the mark colour at the asked places, with their labels; marks outside are left out');
      }

      // ---------------- (5) limits ----------------
      {
        const r = { map: R.uid };
        await rejected({ ...r, x0: 0, y0: 0, x1: 513, y1: 10, scale: 2 }, /region too large: 1026x20 output pixels \\(max 1024x1024 output pixels\\)/, '1026 output pixels wide');
        await rejected({ ...r, x0: 0, y0: 0, x1: 10, y1: 1025, scale: 1 }, /region too large: 10x1025 output pixels/, '1025 output pixels high');
        await rejected({ ...r, x0: 0, y0: 0, x1: 300, y1: 300, scale: 4 }, /region too large: 1200x1200/, '300 px at scale 4');
        await rejected({ ...r, x0: 100, y0: 0, x1: 100, y1: 10 }, /region is empty/, 'x0 = x1');
        await rejected({ ...r, x0: 101, y0: 0, x1: 100, y1: 10 }, /region is empty/, 'x0 > x1');
        await rejected({ ...r, x0: 0, y0: 10, x1: 10, y1: 10 }, /region is empty/, 'y0 = y1');
        await rejected({ ...r, x0: 1200, y0: 0, x1: 1301, y1: 10 }, /outside the image \\(1300x1100\\)/, 'x1 past the image width');
        await rejected({ ...r, x0: 0, y0: 1000, x1: 10, y1: 1101 }, /outside the image/, 'y1 past the image height');
        await rejected({ ...r, x0: -1, y0: 0, x1: 10, y1: 10 }, /x0/, 'a negative x0');
        await rejected({ ...r, x0: 0.5, y0: 0, x1: 10, y1: 10 }, /x0/, 'a fractional x0');
        await rejected({ ...r, x0: 0, y0: 0, x1: 100, y1: 100, grid_step: 15, scale: 2 }, /grid_step too small: grid_step x scale must be at least 32 output pixels/, 'grid_step 15 at scale 2');
        await rejected({ ...r, x0: 0, y0: 0, x1: 100, y1: 100, grid_step: 31, scale: 1 }, /grid_step too small/, 'grid_step 31 at scale 1');
        await rejected({ ...r, x0: 0, y0: 0, x1: 100, y1: 100, grid_step: 0 }, /grid_step/, 'grid_step 0');
        for (const scale of [0, 5, 1.5]) await rejected({ ...r, x0: 0, y0: 0, x1: 10, y1: 10, scale }, /scale/, \`scale \${scale}\`);
        const many = Array.from({ length: 51 }, (_, i) => ({ x: i, y: i }));
        await rejected({ ...r, x0: 0, y0: 0, x1: 100, y1: 100, marks: many }, /marks/, '51 marks');
        assert.equal((await render({ ...r, x0: 0, y0: 0, x1: 100, y1: 100, marks: many.slice(0, 50) })).info.width, 200, '50 marks are accepted');
        await rejected({ ...r, x0: 0, y0: 0, x1: 100, y1: 100, marks: [{ x: 1, y: 1, label: '123456789' }] }, /label/, 'a label of 9 characters');
        await rejected({ ...r, x0: 0, y0: 0, x1: 100, y1: 100, marks: [{ x: 1, y: 1, label: '地図' }] }, /label/, 'a label with characters the font does not have');
        await rejected({ ...r, x0: 0, y0: 0, x1: 100, y1: 100, marks: [{ x: 1, y: 1, colour: 'red' }] }, /colour|Unrecognized/, 'a mark with an unknown key');
        await rejected({ ...r, x0: 0, y0: 0, x1: 10, y1: 10, format: 'gif' }, /format/, 'format gif');
        await rejected({ ...r, x0: 0, y0: 0, x1: 10, y1: 10, path: '/etc' }, /path|Unrecognized/, 'an unknown key');
        await rejected({ x0: 0, y0: 0, x1: 10, y1: 10 }, /map/, 'no map');
        await failed({ map: 'no-such-map', x0: 0, y0: 0, x1: 10, y1: 10 }, /^map not found$/, 'an unknown map');
        await failed({ map: N.uid, x0: 0, y0: 0, x1: 10, y1: 10 }, /^map has no tiles$/, 'a map without tiles');

        // The largest region: 1024 x 1024 output pixels from 25 tiles. Timed once (it must stay well under the request limit).
        const started = Date.now();
        const big = await render({ ...r, x0: 100, y0: 50, x1: 1124, y1: 1074, scale: 1, grid_step: 100,
          marks: Array.from({ length: 50 }, (_, i) => ({ x: 120 + i * 20, y: 80 + i * 19, label: 'M' + i })) });
        const ms = Date.now() - started;
        assert.deepEqual([big.info.width, big.info.height], [1024, 1024], 'the largest region is 1024 x 1024');
        assert.ok(ms < DEFAULT_LIMITS.requestTimeoutMs / 2, \`the largest region takes well under the request limit (\${ms} ms)\`);
        console.log(\`ok: the largest region (1024x1024 from 25 tiles, grid and 50 marks) took \${ms} ms, \${big.bytes.length} bytes of png\`);

        // Tile count: the default limit (64) cannot be reached at scale 1 or more; a smaller limit shows the check.
        const few = await startServer({ ...DEFAULT_LIMITS, maxRegionTiles: 4 });
        try {
          await rejected({ ...r, x0: 0, y0: 0, x1: 600, y1: 300, scale: 1 }, /region too large: 6 tiles \\(max 4 tiles\\)/, 'six tiles with a limit of 4', few.port);
          assert.equal((await render({ ...r, x0: 0, y0: 0, x1: 512, y1: 300, scale: 1 }, few.port)).info.width, 512, 'four tiles with a limit of 4');
        } finally {
          await few.server.close();
        }
        // The encoded picture has a size limit too.
        const small = await startServer({ ...DEFAULT_LIMITS, maxRegionImageBytes: 2000 });
        try {
          await failed({ ...r, x0: 0, y0: 0, x1: 300, y1: 300 }, /^image too large: \\d+ bytes \\(max 2000 bytes\\); ask for a smaller region, a smaller scale or format jpeg$/, 'a picture over the byte limit', small.port);
        } finally {
          await small.server.close();
        }
        console.log('ok: output size, tile count, grid density, empty and outside regions, marks, labels, keys and picture size are limited');
      }

      // ---------------- (6) a missing tile; tiles outside the save folder ----------------
      {
        // S: the tile x=1, y=0 of level 2 (source x 256..511, y 0..255) is missing.
        const s = await render({ map: S.uid, x0: 200, y0: 100, x1: 600, y1: 400, scale: 1 });
        assert.equal(px(s.picture, 100, 50)[3], 0, 'the part of the missing tile is transparent');
        assert.equal(px(s.picture, 20, 50)[3], 255, 'the part of a present tile is opaque');
        assert.equal(px(s.picture, 100, 200)[3], 255, 'the tile below the missing one is opaque');
        assert.equal(maxDiff(s.picture.clone().crop({ x: 0, y: 160, w: 400, h: 140 }), expected(srcS, 200, 260, 600, 400, 1)), 0, 'the rest equals the source');
        const sj = await render({ map: S.uid, x0: 200, y0: 100, x1: 600, y1: 400, scale: 1, format: 'jpeg' });
        const [r0, g0, b0] = px(sj.picture, 100, 50);
        assert.ok(r0 > 240 && g0 > 240 && b0 > 240, 'in a jpeg the missing tile is white');
        // L: level 2 is a link out of the save folder, so none of its tiles are read.
        const l = await render({ map: L.uid, x0: 0, y0: 0, x1: 600, y1: 500, scale: 1 });
        let opaque = 0;
        for (let i = 3; i < l.picture.bitmap.data.length; i += 4) if (l.picture.bitmap.data[i] !== 0) opaque++;
        assert.equal(opaque, 0, 'tiles behind a link out of the save folder are not read');
        assert.equal(await facade.readTile(L.uid, 2, 0, 0), null, 'readTile does not read through a link out of the save folder');
        const inside = await facade.readTile(L.uid, 1, 0, 0);
        assert.equal(inside?.mimeType, 'image/png', 'readTile reads a tile inside the save folder');
        // R has levels 0..3; level 0 is one tile, level 1 is 2 x 2 tiles.
        for (const [z, x, y] of [[4, 0, 0], [-1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 2, 0], [0.5, 0, 0]]) {
          assert.equal(await facade.readTile(R.uid, z, x, y), null, \`readTile out of range \${[z, x, y]}\`);
        }
        assert.equal((await facade.readTile(R.slug, 1, 1, 1))?.mimeType, 'image/png', 'readTile reads the last tile of a level, by slug');
        console.log('ok: a missing tile is transparent (white in jpeg); tiles behind a link out of the save folder are not read');
      }

      // ---------------- (7) time limit and abort ----------------
      {
        let settled: Promise<unknown> | null = null;
        const slow = { ...facade,
          readTilesForRegion: (...args: any[]) => {
            settled = (async () => { await new Promise((r) => setTimeout(r, 300)); return (facade.readTilesForRegion as any)(...args); })();
            return settled;
          } };
        const timed = await startServer({ ...DEFAULT_LIMITS, requestTimeoutMs: 100 }, slow);
        try {
          const reply = await rpc(timed.port, 'tools/call', { name: 'maps.render_region', arguments: { map: R.uid, x0: 0, y0: 0, x1: 500, y1: 500, scale: 1 } });
          assert.equal(reply.error?.code, -32001, 'a request past its time limit answers -32001');
          assert.match(reply.error?.message ?? '', /timed out after 100 ms/, 'and says why');
          assert.ok(settled, 'the tiles were being read');
          await assert.rejects(settled!, /^Error: aborted$/, 'reading the tiles stopped at the abort');
        } finally {
          await timed.server.close();
        }
        // The facade looks at the signal between tiles.
        const controller = new AbortController();
        setImmediate(() => controller.abort());
        await assert.rejects(facade.readTilesForRegion(R.uid, 3, { x0: 0, y0: 0, x1: 4, y1: 3 }, controller.signal), /^Error: aborted$/,
          'an abort while tiles are read stops the reading');
        // The drawing gives way and looks at the signal after the tiles are read.
        const late = new AbortController();
        const abortAfterRead = { ...facade, readTilesForRegion: async (...args: any[]) => {
          const tiles = await (facade.readTilesForRegion as any)(...args);
          late.abort();
          return tiles;
        } };
        await assert.rejects(renderRegion(abortAfterRead as any, R.uid, { x0: 0, y0: 0, x1: 1000, y1: 1000, scale: 1, marks: [], format: 'png' }, DEFAULT_LIMITS, late.signal),
          /^Error: aborted$/, 'an abort after the tiles are read stops the drawing');
        console.log('ok: a request past its time limit stops reading tiles; an abort after reading stops the drawing');
      }

      // ---------------- an unexpected failure is not described to the client ----------------
      {
        const detail = 'unexpected detail ' + dataDir;
        const broken = { ...facade, readTilesForRegion: async () => { throw new Error(detail); } };
        const b = await startServer(DEFAULT_LIMITS, broken);
        const logged: string[] = [];
        const log = console.log;
        console.log = (...args: unknown[]) => { logged.push(args.map(String).join(' ')); };
        let result: any;
        try {
          result = (await rpc(b.port, 'tools/call', { name: 'maps.render_region', arguments: { map: R.uid, x0: 0, y0: 0, x1: 10, y1: 10 } })).result;
        } finally {
          console.log = log;
          await b.server.close();
        }
        assert.equal(result.isError, true, 'an unexpected failure ends as an error');
        assert.equal(result.content[0].text, 'internal error', 'the client only sees "internal error"');
        assert.ok(!JSON.stringify(result).includes('unexpected detail'), 'the detail is not sent');
        assert.ok(logged.some((l) => l.includes('unexpected detail')), 'the detail is written to the main process console');
        console.log('ok: an unexpected failure answers "internal error" and the detail stays in the main process console');
      }

      // ---------------- (8) no writes ----------------
      assert.deepEqual(snapshot(), filesBefore, 'no file in the save folder changed');
      assert.equal(changes(), changesBefore, 'no database row changed');
      console.log('ok: no file and no database row changed while the pictures were made');
    } finally {
      await main.server.close();
    }
    if (process.env.MCP_SMOKE_SECRET_FILE) writeFileSync(process.env.MCP_SMOKE_SECRET_FILE, secretPieces.join('\\n') + '\\n', { mode: 0o600 });
    console.log('ok: mcp-render-region finished');
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
        external: ['jimp', 'jimp/fonts', '@jsquash/webp', 'pwa-asset-generator', 'electron-updater'],
        output: { entryFileNames: 'mcp-render-region-entry.mjs', format: 'es' },
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
    throw new Error('mcp-render-region: the runtime part failed');
  }
} finally {
  await rm(workDir, { recursive: true, force: true });
}
console.log('ok: mcp-render-region smoke passed');
