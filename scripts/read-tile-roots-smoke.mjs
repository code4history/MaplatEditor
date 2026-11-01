/* global Buffer, URL, console, process */
// タイルのローカル読み出しの許可ルートの smoke。
//
// 固定すること:
//   (A) readTile を直に: 保存フォルダの外・兄弟・外へ出るリンクは fs を読まずに拒否し、中は読める
//   (B) generateTmsThumbnail を本物で: 外を指す URL は NoTiles、中と同梱リソースはサムネイルができる
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'read-tile-roots-'));
const p = (r) => JSON.stringify(path.join(projectRoot, r));
const failures = [];

// 1x1 の透明 PNG
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

async function run(name, entrySource, env = {}) {
  const dir = path.join(workDir, name);
  await mkdir(dir, { recursive: true });
  const entryFile = path.join(dir, 'entry.ts');
  await writeFile(entryFile, entrySource);
  try {
    await build({
      configFile: false,
      logLevel: 'silent',
      resolve: {
        alias: [
          { find: 'electron', replacement: path.join(workDir, 'electron-stub.ts') },
          { find: 'electron-store', replacement: path.join(workDir, 'electron-store-stub.ts') },
        ],
      },
      build: {
        emptyOutDir: true,
        outDir: path.join(dir, 'dist'),
        ssr: entryFile,
        target: 'node22',
        rollupOptions: {
          external: ['jimp', 'adm-zip', 'pwa-asset-generator', '@maplat/tin', '@maplat/transform'],
          output: { entryFileNames: 'entry.mjs', format: 'es' },
        },
      },
    });
    const { stdout, stderr } = await execFileAsync(process.execPath, [path.join(dir, 'dist', 'entry.mjs')], {
      cwd: projectRoot,
      timeout: 180000,
      maxBuffer: 1024 * 1024 * 8,
      env: { ...process.env, ...env },
    });
    process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
  } catch (e) {
    process.stdout.write(e.stdout ?? '');
    process.stderr.write(e.stderr ?? '');
    failures.push(name);
    console.error(`NG ${name}: ${String(e?.message ?? e).split('\n')[0]}`);
  }
}

try {
  const save = path.join(workDir, 'save');
  const outside = path.join(workDir, 'outside');
  const sibling = `${save}-x`;
  const appRoot = path.join(workDir, 'app');
  for (const dir of [
    path.join(save, 'tiles/m/0/0'),
    path.join(outside, '0/0'),
    path.join(sibling, '0/0'),
    path.join(appRoot, 'public/bundled/0/0'),
    path.join(workDir, 'temp'),
  ]) {
    await mkdir(dir, { recursive: true });
  }
  await writeFile(path.join(save, 'tiles/m/0/0/0.png'), PNG_1PX);
  await writeFile(path.join(outside, '0/0/0.png'), PNG_1PX);
  await writeFile(path.join(sibling, '0/0/0.png'), PNG_1PX);
  await writeFile(path.join(appRoot, 'public/bundled/0/0/0.png'), PNG_1PX);
  await symlink(outside, path.join(save, 'link'));

  await writeFile(path.join(workDir, 'electron-stub.ts'), `
    export const app = {
      getPath(name: string) { return ${JSON.stringify(workDir)} + '/' + name; },
      getAppPath() { return ${JSON.stringify(projectRoot)}; },
      getName() { return 'MaplatEditor'; },
      isPackaged: false,
      whenReady() { return Promise.resolve(); },
      exit() {},
    };
    export const dialog = {};
    export const ipcMain = { handle() {}, on() {}, removeHandler() {}, removeAllListeners() {} };
    export const shell = {};
    export const session = { defaultSession: {} };
    export const BrowserWindow = class { static getAllWindows() { return []; } };
  `);
  await writeFile(path.join(workDir, 'electron-store-stub.ts'), `
    export default class Store<T extends Record<string, any>> {
      store: T;
      constructor(o: { defaults?: T } = {}) { this.store = { ...(o.defaults || {}) } as T; }
      get(k: string) { return this.store[k]; }
      set(k: string, v: any) { this.store[k as keyof T] = v; }
      has(k: string) { return Object.prototype.hasOwnProperty.call(this.store, k); }
    }
  `);

  const prelude = `
    import assert from 'node:assert/strict';
    import nodeFs from 'node:fs';
    import nodePath from 'node:path';
    const save = ${JSON.stringify(save)};
    const outside = ${JSON.stringify(outside)};
    const sibling = ${JSON.stringify(sibling)};
    const appRoot = ${JSON.stringify(appRoot)};
    const fileUrl = (abs: string) => ${JSON.stringify(pathToFileURL(workDir).href)} + abs.slice(${JSON.stringify(workDir)}.length);
    const local = (abs: string) => 'app://bundle/__local' + abs.split('/').map((s) => encodeURIComponent(s)).join('/');
  `;

  await run('readTile', `${prelude}
    const { readTile } = await import(${p('electron/services/localTileRead.ts')});
    let reads = 0;
    const fsStub = { readFile: async (file: string) => { reads += 1; return nodeFs.promises.readFile(file); } };
    const deps = { localRoots: () => [save], fs: fsStub, fetch: async () => { throw new Error('fetch must not be used'); } };

    for (const [label, url] of [
      ['(i) outside', fileUrl(nodePath.join(outside, '0/0/0.png'))],
      ['(ii) sibling', fileUrl(nodePath.join(sibling, '0/0/0.png'))],
      ['(iii) link', local(nodePath.join(save, 'link/0/0/0.png'))],
      ['(iii) link by file url', fileUrl(nodePath.join(save, 'link/0/0/0.png'))],
      ['(iii) outside by app url', local(nodePath.join(outside, '0/0/0.png'))],
      ['(iii) traversal', local(save) + '/../outside/0/0/0.png'],
      ['(iii) network path', 'file://host/share/0.png'],
    ] as const) {
      await assert.rejects(readTile(url, deps), label);
      assert.equal(reads, 0, label + ': nothing is read');
    }
    const inside = await readTile(local(nodePath.join(save, 'tiles/m/0/0/0.png')), deps);
    assert.ok(Buffer.isBuffer(inside) && inside.length > 0, '(iv) the tile is returned');
    assert.equal(reads, 1);
    const byFile = await readTile(fileUrl(nodePath.join(save, 'tiles/m/0/0/0.png')), deps);
    assert.equal(byFile.length, inside.length, '(iv) file url');

    const fetched: string[] = [];
    const remote = await readTile('https://tiles.example/0/0/0.png', {
      localRoots: () => [],
      fetch: async (url: string) => { fetched.push(url); return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1, 2]).buffer }; },
    });
    assert.equal(remote.length, 2, '(v) remote tiles still go through the fetch path');
    assert.deepEqual(fetched, ['https://tiles.example/0/0/0.png']);
    console.log('ok (A) readTile keeps local reads inside the allowed roots');
  `);

  await run('thumbnail', `${prelude}
    const { default: SettingsService } = await import(${p('electron/services/SettingsService.ts')});
    SettingsService.set('saveFolder', save);
    const { default: AppAssetService } = await import(${p('electron/services/AppAssetService.ts')});
    const coverage: [number, number][] = [[135, 35], [135.5, 35.5]];
    const tmbs = nodePath.join(save, 'tmbs');
    const thumbs = (id: string) => nodeFs.existsSync(tmbs) ? nodeFs.readdirSync(tmbs).filter((f) => f.startsWith(id)) : [];
    const generate = (id: string, url: string) => AppAssetService.generateTmsThumbnail(id, { url, minZoom: 0, maxZoom: 0 }, coverage);

    const failed: string[] = [];
    for (const [id, url] of [
      ['outside', fileUrl(outside) + '/{z}/{x}/{y}.png'],
      ['sibling', fileUrl(sibling) + '/{z}/{x}/{y}.png'],
      ['linked', local(nodePath.join(save, 'link')) + '/{z}/{x}/{y}.png'],
    ] as const) {
      const r = await generate(id, url);
      if (r.err !== 'NoTiles' || thumbs(id).length > 0) {
        failed.push(id + ' -> ' + JSON.stringify({ err: r.err, thumbs: thumbs(id) }));
      }
    }
    assert.deepEqual(failed, [], '(B) tiles outside the allowed roots make no thumbnail');

    const inside = await generate('inside', local(nodePath.join(save, 'tiles/m')) + '/{z}/{x}/{y}.png');
    assert.equal(inside.err, undefined, '(B) inside: ' + JSON.stringify(inside));
    assert.ok(thumbs('inside').length > 0, '(B) the thumbnail is written under tmbs');
    const bundled = await generate('bundled', fileUrl(nodePath.join(appRoot, 'public/bundled')) + '/{z}/{x}/{y}.png');
    assert.equal(bundled.err, undefined, '(B) bundled: ' + JSON.stringify(bundled));
    console.log('ok (B) generateTmsThumbnail honours the allowed roots');
  `, { APP_ROOT: appRoot });
} finally {
  await rm(workDir, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`read-tile-roots smoke FAILED: ${failures.join(' | ')}`);
  process.exit(1);
}
assert.equal(failures.length, 0);
console.log('read-tile-roots smoke PASS');
