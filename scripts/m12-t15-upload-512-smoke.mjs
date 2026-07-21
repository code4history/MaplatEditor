// M12-T15 (Test-2): 新規地図画像登録経路の 512px 生成検証。
// imageCutter（showMapSelectDialog 経由）で thumbnail_512.jpg が正しいアスペクト比で生成されること、
// 長辺≤512px の画像ではスキップされることを、実データ不使用（一時フォルダ）で検証する。
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
const workDir = await mkdtemp(path.join(scratchRoot, 'm12-t15-upload-'));
const entryFile = path.join(workDir, 'm12-t15-upload-smoke.ts');
const electronStubFile = path.join(workDir, 'electron-stub.ts');
const electronStoreStubFile = path.join(workDir, 'electron-store-stub.ts');
const outDir = path.join(workDir, 'dist');
const bundledFile = path.join(outDir, 'm12-t15-upload-smoke.mjs');

try {
  const dataDir = path.join(workDir, 'data');
  await mkdir(dataDir, { recursive: true });
  await writeFile(
    electronStubFile,
    `
      const handlers = new Map();
      export const __handlers = handlers;
      // 選択する画像パスを差し替えられるよう、グローバルに持つ
      globalThis.__nextImagePath = null;
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
        async showOpenDialog() {
          const p = globalThis.__nextImagePath;
          if (!p) return { canceled: true, filePaths: [] };
          return { canceled: false, filePaths: [p] };
        },
      };
      export const BrowserWindow = class {};
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

      const { showMapSelectDialog } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/MapUploadService.ts'))});

      async function makeImage(w, h, filePath) {
        const img = new Jimp({ width: w, height: h, color: 0xff0000ff });
        await img.write(filePath);
      }

      // Test-2 正例: 800x400 (>512px) の画像 → thumbnail_512.jpg が aspect 2:1 で生成
      const tmpFolder1 = nodePath.join(${JSON.stringify(workDir)}, 'tmp1');
      await fs.mkdir(tmpFolder1, { recursive: true });
      const srcFile1 = nodePath.join(${JSON.stringify(workDir)}, 'src800x400.png');
      await makeImage(800, 400, srcFile1);
      globalThis.__nextImagePath = srcFile1;
      const r1 = await showMapSelectDialog(null, tmpFolder1, '地図画像');
      assert.ok(!r1.err, 'imageCutter 800x400 成功: ' + JSON.stringify(r1));
      const thumb512_1 = nodePath.join(tmpFolder1, 'tiles', 'thumbnail_512.jpg');
      assert.ok(await fs.stat(thumb512_1).then(() => true).catch(() => false), 'thumbnail_512.jpg が生成される');
      const img1 = await Jimp.read(thumb512_1);
      const aspect1 = img1.width / img1.height;
      assert.ok(aspect1 > 1.7 && aspect1 < 2.3, '800x400 の 512px は aspect ≈ 2:1（白帯なし）: ' + aspect1.toFixed(2));
      assert.ok(Math.max(img1.width, img1.height) <= 512, '長辺は 512px 以下');
      console.log('ok: Test-2 positive (800x400 -> 512px aspect ' + aspect1.toFixed(2) + ')');

      // Test-2 負例: 300x200 (<=512px) の画像 → thumbnail_512.jpg はスキップ（§C3）
      const tmpFolder2 = nodePath.join(${JSON.stringify(workDir)}, 'tmp2');
      await fs.mkdir(tmpFolder2, { recursive: true });
      const srcFile2 = nodePath.join(${JSON.stringify(workDir)}, 'src300x200.png');
      await makeImage(300, 200, srcFile2);
      globalThis.__nextImagePath = srcFile2;
      const r2 = await showMapSelectDialog(null, tmpFolder2, '地図画像');
      assert.ok(!r2.err, 'imageCutter 300x200 成功: ' + JSON.stringify(r2));
      const thumb512_2 = nodePath.join(tmpFolder2, 'tiles', 'thumbnail_512.jpg');
      const exists2 = await fs.stat(thumb512_2).then(() => true).catch(() => false);
      assert.equal(exists2, false, '長辺<=512px の画像では thumbnail_512.jpg はスキップ');
      // 52px は現行どおり生成される
      assert.ok(await fs.stat(nodePath.join(tmpFolder2, 'tiles', 'thumbnail.jpg')).then(() => true).catch(() => false), '52px thumbnail.jpg は生成される');
      console.log('ok: Test-2 negative (300x200 -> 512px skipped, 52px generated)');

      console.log('m12-t15 upload smoke: ALL PASS');
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
        external: ['@duckdb/node-api', '@duckdb/node-bindings', /^@duckdb\/node-bindings-.*/],
        output: {
          entryFileNames: 'm12-t15-upload-smoke.mjs',
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
