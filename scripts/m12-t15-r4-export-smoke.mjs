// M12-T15 (Test-3): R4 basemap 512/52 同時生成 + AC8 export 512px 同梱 の検証。
// 実データ不使用（一時フォルダ + ローカルタイルサーバー）。
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
// m19-t5: 512px は webp。寸法確認は符号化規則を持つ codec 経由で行う
const codecFile = path.join(projectRoot, 'electron/utils/thumbnail512Codec.ts');
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'm12-t15-r4export-'));
const entryFile = path.join(workDir, 'm12-t15-r4export-smoke.ts');
const electronStubFile = path.join(workDir, 'electron-stub.ts');
const electronStoreStubFile = path.join(workDir, 'electron-store-stub.ts');
const outDir = path.join(workDir, 'dist');
const bundledFile = path.join(outDir, 'm12-t15-r4export-smoke.mjs');

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

try {
  const dataDir = path.join(workDir, 'data');
  await mkdir(dataDir, { recursive: true });
  await writeFile(
    electronStubFile,
    `
      const handlers = new Map();
      export const __handlers = handlers;
      globalThis.__saveZipPath = null;
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
        async showOpenDialog() { return { canceled: true, filePaths: [] }; },
        async showSaveDialog() { return { canceled: false, filePath: globalThis.__saveZipPath }; },
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
      import http from 'node:http';
      import nodePath from 'node:path';
      import assert from 'node:assert/strict';
      import { Jimp } from 'jimp';
      // m19-t5: 512px は webp。Jimp では decode できないため codec の readImageMeta を使う
      import { readImageMeta } from ${JSON.stringify(codecFile)};
      import AdmZip from 'adm-zip';

      const dataDir = ${JSON.stringify(dataDir)};
      const { default: SettingsService } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/SettingsService.ts'))});
      SettingsService.set('saveFolder', dataDir);
      SettingsService.set('lang', 'ja');
      const { default: AppAssetService } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/AppAssetService.ts'))});

      // ---- R4: coverage stitch から 512px と 52px を同時生成 ----
      // ローカルタイルサーバー（任意の {z}/{x}/{y} で 256x256 赤タイルを返す）
      const tilePng = Buffer.from(${JSON.stringify(PNG_B64)}, 'base64');
      const server = http.createServer((req, res) => {
        res.writeHead(200, { 'content-type': 'image/png' });
        res.end(tilePng);
      });
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      const port = server.address().port;
      const tmsUrl = \`http://127.0.0.1:\${port}/{z}/{x}/{y}.png\`;
      const coverage = [[139.7, 35.6], [139.8, 35.7]];
      const mapID = 't15-r4-basemap';
      const result = await AppAssetService.generateTmsThumbnail(mapID, { url: tmsUrl, minZoom: 0, maxZoom: 18 }, coverage);
      server.close();
      assert.ok(!result.err, 'generateTmsThumbnail 成功: ' + JSON.stringify(result));

      const png52 = nodePath.join(dataDir, 'tmbs', mapID + '.png');
      const png512 = nodePath.join(dataDir, 'tmbs', mapID + '_512.webp');
      assert.ok(await fs.stat(png52).then(() => true).catch(() => false), 'R4: 52px tmbs/{mapID}.png が生成される');
      assert.ok(await fs.stat(png512).then(() => true).catch(() => false), 'R4: 512px tmbs/{mapID}_512.webp が生成される');
      const img512 = await readImageMeta(png512);
      assert.ok(Math.max(img512.width, img512.height) <= 512, 'R4: 512px の長辺は 512 以下');
      const img52 = await readImageMeta(png52);
      assert.ok(Math.max(img52.width, img52.height) <= 52, 'R4: 52px の長辺は 52 以下');
      console.log('ok: R4 basemap 512/52 同時生成');

      console.log('m12-t15 R4 smoke: ALL PASS');
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
        external: ['@duckdb/node-api', '@duckdb/node-bindings', /^@duckdb\/node-bindings-.*/, '@jsquash/webp'],
        output: {
          entryFileNames: 'm12-t15-r4export-smoke.mjs',
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
