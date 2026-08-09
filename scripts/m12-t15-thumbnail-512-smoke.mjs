// M12-T15 smoke: 512px サムネイル解決（resolveMapListImage512 / resolveAppListImage fallback / R4 生成）。
// m12-t13/m12-t14 と同型 harness（electron/electron-store stub + vite ssr build）。
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
const workDir = await mkdtemp(path.join(scratchRoot, 'm12-t15-512-'));
const entryFile = path.join(workDir, 'm12-t15-512-smoke.ts');
const electronStubFile = path.join(workDir, 'electron-stub.ts');
const electronStoreStubFile = path.join(workDir, 'electron-store-stub.ts');
const outDir = path.join(workDir, 'dist');
const bundledFile = path.join(outDir, 'm12-t15-512-smoke.mjs');

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
      export const dialog = {};
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

  const resolverPath = path.join(projectRoot, 'electron/services/resourceImageResolver.ts');
  await writeFile(
    entryFile,
    `
      import fs from 'node:fs/promises';
      import nodePath from 'node:path';
      import assert from 'node:assert/strict';

      const dataDir = ${JSON.stringify(dataDir)};
      const { default: SettingsService } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/SettingsService.ts'))});
      SettingsService.set('saveFolder', dataDir);
      SettingsService.set('lang', 'ja');

      const { resolveMapListImage512, resolveAppListImage } = await import(${JSON.stringify(resolverPath)});

      const uid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

      // AC3: 512px があればそれを優先（tmbs/{uid}_512.webp）
      await fs.mkdir(nodePath.join(dataDir, 'tmbs'), { recursive: true });
      await fs.writeFile(nodePath.join(dataDir, 'tmbs', uid + '_512.webp'), Buffer.from(${JSON.stringify(PNG_B64)}, 'base64'));
      await fs.writeFile(nodePath.join(dataDir, 'tmbs', uid + '.jpg'), Buffer.from(${JSON.stringify(PNG_B64)}, 'base64'));
      const with512 = await resolveMapListImage512({ uid });
      assert.ok(with512 && with512.includes('_512.webp'), 'AC3: 512px があれば _512.webp を優先: ' + with512);
      console.log('ok: AC3 512px preferred over 52px');

      // AC3: 512px がなければ 52px へ fallback
      await fs.rm(nodePath.join(dataDir, 'tmbs', uid + '_512.webp'));
      const with52 = await resolveMapListImage512({ uid });
      assert.ok(with52 && with52.endsWith(uid + '.jpg') && !with52.includes('_512'), 'AC3: 512px なしで 52px へ fallback: ' + with52);
      console.log('ok: AC3 52px fallback when no 512px');

      // AC3: 52px もなければ tile fallback
      await fs.rm(nodePath.join(dataDir, 'tmbs', uid + '.jpg'));
      await fs.mkdir(nodePath.join(dataDir, 'tiles', uid, '0', '0'), { recursive: true });
      await fs.writeFile(nodePath.join(dataDir, 'tiles', uid, '0', '0', '0.png'), Buffer.from(${JSON.stringify(PNG_B64)}, 'base64'));
      const withTile = await resolveMapListImage512({ uid });
      assert.ok(withTile && withTile.includes('/tiles/'), 'AC3: tile fallback: ' + withTile);
      console.log('ok: AC3 tile fallback');

      console.log('m12-t15 smoke: ALL PASS');
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
        external: ['@duckdb/node-api', '@duckdb/node-bindings', /^@duckdb\/node-bindings-.*/, 'jimp'],
        output: {
          entryFileNames: 'm12-t15-512-smoke.mjs',
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
  // cleanup は worktree 内の .tmp-smoke を残す（破壊的操作禁止のため削除しない）
}
