// M12-T15 (NeDB→512px 連続マイニング): 旧形式 nedb.db からの legacy 移行と 512px マイニングが
// 1 回の getDb() で連続実行され、tmbs/{uid}_512.jpg が正しいアスペクト比で生成されることを検証する。
// 実データ不使用（一時フォルダ + electron/electron-store stub + vite ssr build）。
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'm12-t15-nedb-mining-'));
const entryFile = path.join(workDir, 'm12-t15-nedb-mining-smoke.ts');
const electronStubFile = path.join(workDir, 'electron-stub.ts');
const electronStoreStubFile = path.join(workDir, 'electron-store-stub.ts');
const outDir = path.join(workDir, 'dist');
const bundledFile = path.join(outDir, 'm12-t15-nedb-mining-smoke.mjs');

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

// 旧形式の地図 doc（旧ID, 非正方形 900x300）
function legacyMapDoc(id, title) {
  return JSON.stringify({
    _id: id, title, officialTitle: '', description: 'NeDB legacy', attr: '', author: '',
    createdAt: '', license: '', lang: 'ja', imageExtension: 'jpg', width: 900, height: 300,
    gcps: [[[0, 0], [15550000, 4160000]], [[900, 0], [15560000, 4160000]], [[900, 300], [15560000, 4150000]]],
    edges: [], sub_maps: [], homePosition: [0, 0], mercZoom: 0, strictMode: 'strict', vertexMode: 'plain',
    status: 'New', reference: '', url: '', contributor: '', mapper: '', era: '', dataAttr: {},
  }) + '\n';
}

try {
  const dataDir = path.join(workDir, 'data');
  await mkdir(dataDir, { recursive: true });
  // nedb.db（旧形式地図）を配置
  await writeFile(path.join(dataDir, 'nedb.db'), legacyMapDoc('oldmap', '旧形式地図'));
  // 旧ID キーの zoom2 タイル（4x2 赤タイル）を配置
  const pngBuf = Buffer.from(PNG_B64, 'base64');
  for (let tx = 0; tx < 4; tx++) {
    const dir = path.join(dataDir, 'tiles', 'oldmap', '2', String(tx));
    await mkdir(dir, { recursive: true });
    for (let ty = 0; ty < 2; ty++) await writeFile(path.join(dir, `${ty}.png`), pngBuf);
  }

  await writeFile(
    electronStubFile,
    `
      const handlers = new Map();
      export const __handlers = handlers;
      export const app = {
        getPath(name) {
          if (name === 'documents') return ${JSON.stringify(path.join(workDir, 'documents'))};
          if (name === 'temp') return ${JSON.stringify(path.join(workDir, 'temp'))};
          return ${JSON.stringify(workDir)};
        },
        getName() { return 'MaplatEditorSmoke'; },
      };
      export const ipcMain = { handle: (ch, fn) => handlers.set(ch, fn), removeHandler: (ch) => handlers.delete(ch) };
      export const dialog = {
        showOpenDialog() { return Promise.resolve({ canceled: true, filePaths: [] }); },
        showMessageBox() { return Promise.resolve({ response: 0 }); },
      };
      export const BrowserWindow = class { static getAllWindows() { return []; } };
      export const session = { defaultSession: { webRequest: { onBeforeRequest: () => {} } } };
    `,
  );
  await writeFile(
    electronStoreStubFile,
    `
      export default class Store {
        constructor(options = {}) { this.store = { ...(options.defaults || {}) }; }
        get(key) { return this.store[key]; }
        set(key, value) { this.store[key] = value; }
        has(key) { return Object.prototype.hasOwnProperty.call(this.store, key); }
      }
    `,
  );

  await writeFile(
    entryFile,
    `
      import fs from 'node:fs/promises';
      import nodePath from 'node:path';
      import assert from 'node:assert/strict';
      import { Jimp } from 'jimp';

      const dataDir = ${JSON.stringify(dataDir)};
      const { default: SettingsService } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/SettingsService.ts'))});
      SettingsService.set('saveFolder', dataDir);
      SettingsService.set('lang', 'ja');
      const { default: SqliteDataService } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/SqliteDataService.ts'))});

      // getDb() で migrate() が走り、legacy 移行 → 512px マイニングが連続実行される
      await SqliteDataService.getDb();

      // legacy 移行: 地図が uid で取り込まれる
      const map = await SqliteDataService.findMapBySlug('oldmap');
      assert.ok(map, 'legacy 地図 oldmap が移行される');
      assert.ok(map.uid, 'uid 採番される');
      console.log('ok: legacy 移行で oldmap が uid=' + map.uid + ' として取り込まれた');

      // 連続 512px マイニング: tiles/{旧ID} は tiles/{uid} へリネームされ、tmbs/{uid}_512.jpg が生成される
      const thumb512 = nodePath.join(dataDir, 'tmbs', map.uid + '_512.jpg');
      assert.ok(await fs.stat(thumb512).then(() => true).catch(() => false), '連続マイニングで tmbs/{uid}_512.jpg が生成される');

      // Fix-1: 白帯なし（アスペクト比 900:300 = 3:1）
      const image = await Jimp.read(thumb512);
      const aspect = image.width / image.height;
      assert.ok(aspect > 2.5, '連続マイニングの 512px は aspect ≈ 3:1（白帯なし）: ' + aspect.toFixed(2));
      assert.ok(Math.max(image.width, image.height) <= 512, '長辺は 512 以下');
      console.log('ok: 連続マイニングの 512px は aspect ' + aspect.toFixed(2) + '（白帯なし）');

      console.log('m12-t15 NeDB→512px 連続マイニング smoke: ALL PASS');
    `,
  );

  await build({
    configFile: false,
    logLevel: 'silent',
    resolve: {
      alias: [
        { find: 'electron', replacement: electronStubFile },
        { find: 'electron-store', replacement: electronStoreStubFile },
      ],
    },
    build: {
      emptyOutDir: true,
      outDir,
      ssr: entryFile,
      target: 'node22',
      rollupOptions: {
        external: ['@duckdb/node-api', '@duckdb/node-bindings', /^@duckdb\/node-bindings-.*/, '@seald-io/nedb'],
        output: {
          entryFileNames: 'm12-t15-nedb-mining-smoke.mjs',
          format: 'es',
        },
      },
    },
  });

  const { stdout, stderr } = await execFileAsync(process.execPath, [bundledFile], {
    cwd: projectRoot,
    timeout: 120000,
    maxBuffer: 1024 * 1024 * 8,
  });
  process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
} finally {
  // .tmp-smoke は破壊的操作禁止のため残置
}
