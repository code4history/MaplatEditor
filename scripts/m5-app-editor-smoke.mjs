import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'app-editor-'));
const entryFile = path.join(workDir, 'app-editor-smoke.ts');
const electronStubFile = path.join(workDir, 'electron-stub.ts');
const electronStoreStubFile = path.join(workDir, 'electron-store-stub.ts');
const outDir = path.join(workDir, 'dist');
const bundledFile = path.join(outDir, 'app-editor-smoke.mjs');

try {
  const dataDir = path.join(workDir, 'data');
  const appDataServicePath = path.join(projectRoot, 'electron/services/AppDataService.ts');
  const settingsPath = path.join(projectRoot, 'electron/services/SettingsService.ts');

  await mkdir(dataDir, { recursive: true });
  await writeFile(
    electronStubFile,
    `
      export const app = {
        getPath(name: string) {
          if (name === 'documents') return ${JSON.stringify(path.join(workDir, 'documents'))};
          if (name === 'temp') return ${JSON.stringify(path.join(workDir, 'temp'))};
          if (name === 'appData') return ${JSON.stringify(path.join(workDir, 'appData'))};
          return ${JSON.stringify(workDir)};
        },
        getName() { return 'MaplatEditor'; },
        whenReady() { return Promise.resolve(); },
        exit(code?: number) { if (code && code !== 0) process.exitCode = code; },
      };
      export const dialog = {
        showOpenDialog() { return Promise.resolve({ canceled: true, filePaths: [] }); },
        showMessageBox() { return Promise.resolve({ response: 0 }); },
      };
      export const ipcMain = { handle() {} };
      export const BrowserWindow = class {
        static getAllWindows() { return []; }
      };
    `
  );
  await writeFile(
    electronStoreStubFile,
    `
      export default class Store<T extends Record<string, any>> {
        store: T;
        constructor(options: { defaults?: T } = {}) {
          this.store = { ...(options.defaults || {}) } as T;
        }
        get(key: string) { return this.store[key]; }
        set(key: string, value: any) { this.store[key as keyof T] = value; }
        has(key: string) { return Object.prototype.hasOwnProperty.call(this.store, key); }
      }
    `
  );

  await writeFile(
    entryFile,
    `
      import assert from 'node:assert/strict';

      const { default: SettingsService } = await import(${JSON.stringify(settingsPath)});
      SettingsService.set('saveFolder', ${JSON.stringify(dataDir)});

      const { default: AppDataService } = await import(${JSON.stringify(appDataServicePath)});

      const doc = {
        appID: 'demo_app',
        title: { ja: 'デモアプリ', en: 'Demo App' },
        description: { ja: '説明', en: 'Description' },
        lang: 'ja',
        sources: [
          { sourceType: 'base-map', mapID: 'osm', role: 'base', title: 'OpenStreetMap', data: { mapID: 'osm', maptype: 'base' } },
          { sourceType: 'maplat', mapID: 'histmap', role: 'maplat', title: 'Hist Map', startFrom: true, data: { mapID: 'histmap', maptype: 'maplat', noload: true } },
        ],
        startFrom: 'histmap',
      };

      assert.equal(await AppDataService.isAppIdAvailable('demo_app'), true);
      assert.equal(await AppDataService.saveApp('demo_app', doc), 'Success');
      assert.equal(await AppDataService.isAppIdAvailable('demo_app'), false);

      const loaded = await AppDataService.getApp('demo_app');
      assert.equal(loaded.appID, 'demo_app');
      assert.equal(loaded.title.ja, 'デモアプリ');
      assert.equal(loaded.sources.length, 2);
      assert.equal(loaded.startFrom, 'histmap');

      const listed = await AppDataService.requestApps('デモ', 1, 20);
      assert.equal(listed.docs.length, 1);
      assert.equal(listed.docs[0].appID, 'demo_app');
      assert.equal(listed.docs[0].title, 'デモアプリ');

      assert.equal(await AppDataService.saveApp('other_app', { ...doc, appID: 'other_app', originalAppID: 'demo_app' }), 'Success');
      assert.equal(await AppDataService.getApp('demo_app'), null);
      assert.ok(await AppDataService.getApp('other_app'));

      assert.equal(await AppDataService.saveApp('other_app', { ...doc, appID: 'other_app' }), 'Exist');

      await AppDataService.deleteApp('other_app');
      assert.equal(await AppDataService.getApp('other_app'), null);

      console.log('M5 app editor smoke passed');
    `
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
          entryFileNames: 'app-editor-smoke.mjs',
          format: 'es',
        },
      },
    },
  });

  await execFileAsync(process.execPath, [bundledFile], {
    cwd: projectRoot,
    timeout: 30000,
    maxBuffer: 1024 * 1024 * 8,
  });
  console.log('M5 app editor smoke passed');
} finally {
  await rm(workDir, { recursive: true, force: true });
}
