// M12-T15 (M6/M7): タイル実寸からのコンテンツ寸法導出（M6）と破損シグネチャ検出（M7）の検証。
// 実データ不使用（一時フォルダ + electron/electron-store stub + vite ssr build）。
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
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
const workDir = await mkdtemp(path.join(scratchRoot, 'm12-t15-m6m7-'));
const entryFile = path.join(workDir, 'm12-t15-m6m7-smoke.ts');
const electronStubFile = path.join(workDir, 'electron-stub.ts');
const electronStoreStubFile = path.join(workDir, 'electron-store-stub.ts');
const outDir = path.join(workDir, 'dist');
const bundledFile = path.join(outDir, 'm12-t15-m6m7-smoke.mjs');

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

try {
  const dataDir = path.join(workDir, 'data');
  await mkdir(dataDir, { recursive: true });
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
      export const dialog = { showOpenDialog() { return Promise.resolve({ canceled: true, filePaths: [] }); } };
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
      // m19-t5: 512px は webp。Jimp では decode できないため codec の readImageMeta を使う
      import { readImageMeta } from ${JSON.stringify(codecFile)};

      const dataDir = ${JSON.stringify(dataDir)};
      const { default: SettingsService } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/SettingsService.ts'))});
      SettingsService.set('saveFolder', dataDir);
      SettingsService.set('lang', 'ja');
      const { default: SqliteDataService } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/SqliteDataService.ts'))});

      const uid = '11111111-2222-3333-4444-555555555555';
      const tileFolder = nodePath.join(dataDir, 'tiles');
      const thumbFolder = nodePath.join(dataDir, 'tmbs');
      const zoom2Dir = nodePath.join(tileFolder, uid, '2');

      // 端タイル付き 3x4 グリッド（実画像 673x991、列0-1=256幅・列2=161幅、行0-2=256高・行3=223高）
      // タイルは非パディング実寸。全タイルに地図（赤）を描く
      async function makeTile(w, h, filePath) {
        const t = new Jimp({ width: w, height: h, color: 0xff0000ff });
        await t.write(filePath);
      }
      for (let tx = 0; tx < 3; tx++) {
        for (let ty = 0; ty < 4; ty++) {
          const w = tx === 2 ? 161 : 256;
          const h = ty === 3 ? 223 : 256;
          const dir = nodePath.join(zoom2Dir, String(tx));
          await fs.mkdir(dir, { recursive: true });
          await makeTile(w, h, nodePath.join(dir, ty + '.png'));
        }
      }

      // M6: data_json なし（width/height を渡さない）で generateThumbnail512FromTiles を実行
      // タイル実寸からコンテンツ寸法（673x991）を導出し、348x512 を生成するはず
      const svc = SqliteDataService;
      await svc.generateThumbnail512FromTiles(uid, dataDir, tileFolder, thumbFolder);
      const thumb512 = nodePath.join(thumbFolder, uid + '_512.webp');
      const img = await readImageMeta(thumb512);
      assert.equal(img.width, 348, 'M6: 348px 幅（673*512/991）: ' + img.width);
      assert.equal(img.height, 512, 'M6: 512px 高（長辺）: ' + img.height);
      console.log('ok: M6 端タイル付き 3x4 グリッド + data_json なしで 348x512 を正しく生成');

      // M7: 破損シグネチャ（全グリッド 768x1024 を長辺512に縮小した 384x512）を検出
      const brokenFile = nodePath.join(${JSON.stringify(workDir)}, 'broken.jpg');
      const brokenCanvas = new Jimp({ width: 768, height: 1024, color: 0xffffffff });
      brokenCanvas.resize({ w: 384, h: 512 });
      await brokenCanvas.write(brokenFile);
      const brokenResult = await svc.isBrokenThumbnail512(brokenFile, zoom2Dir);
      assert.equal(brokenResult, true, 'M7: 破損シグネチャ（384x512 全グリッド縮小）を検出');
      console.log('ok: M7 破損シグネチャ（384x512）を検出');

      // M7: 正規生成（348x512、コンテンツ境界で crop 済み）は破損とみなさない
      const correctResult = await svc.isBrokenThumbnail512(thumb512, zoom2Dir);
      assert.equal(correctResult, false, 'M7: 正規生成（348x512）は破損とみなさない');
      console.log('ok: M7 正規生成は破損とみなさない');

      // M7: ユーザー置換（512x512、破損シグネチャと寸法が異なる）は巻き込まない
      const userFile = nodePath.join(${JSON.stringify(workDir)}, 'user.jpg');
      await new Jimp({ width: 512, height: 512, color: 0x00ff00ff }).write(userFile);
      const userResult = await svc.isBrokenThumbnail512(userFile, zoom2Dir);
      assert.equal(userResult, false, 'M7: ユーザー置換（512x512）は巻き込まない');
      console.log('ok: M7 ユーザー置換は巻き込まない');

      console.log('m12-t15 M6/M7 smoke: ALL PASS');
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
        external: ['@duckdb/node-api', '@duckdb/node-bindings', /^@duckdb\/node-bindings-.*/, '@jsquash/webp', '@seald-io/nedb'],
        output: {
          entryFileNames: 'm12-t15-m6m7-smoke.mjs',
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
