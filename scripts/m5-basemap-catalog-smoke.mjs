import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'basemap-catalog-'));
const entryFile = path.join(workDir, 'basemap-catalog-smoke.ts');
const electronStubFile = path.join(workDir, 'electron-stub.ts');
const electronStoreStubFile = path.join(workDir, 'electron-store-stub.ts');
const outDir = path.join(workDir, 'dist');
const bundledFile = path.join(outDir, 'basemap-catalog-smoke.mjs');

try {
  const dataDir = path.join(workDir, 'data');
  const settingsPath = path.join(projectRoot, 'electron/services/SettingsService.ts');
  const sqlitePath = path.join(projectRoot, 'electron/services/SqliteDataService.ts');

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

      const { default: SqliteDataService } = await import(${JSON.stringify(sqlitePath)});

      // Initial catalog exposes builtin base maps only
      const initial = await SettingsService.listBaseMaps();
      assert.ok(initial.some((item) => item.scope === 'builtin' && item.mapID === 'osm'));
      assert.equal(initial.filter((item) => item.scope === 'user').length, 0);

      // Builtin masters are seeded from the KTGIS catalog (ADR-0002):
      // osm carries a 52px icon, KTGIS maps carry icon + coverage, and the
      // catalog includes newly imported maps such as muroran00
      const osm = initial.find((item) => item.scope === 'builtin' && item.mapID === 'osm');
      assert.equal(osm.data.thumbnail, 'basemap_icons/osm.png');
      assert.ok(!osm.data.coverageLngLats, 'osm coverage must stay undefined (global)');
      const gsi = initial.find((item) => item.scope === 'builtin' && item.mapID === 'gsi');
      assert.ok(Array.isArray(gsi.data.coverageLngLats));
      assert.ok(!gsi.data.envelopeLngLats, 'usage envelope must stay empty by default (ADR-0004)');
      const muroran = initial.find((item) => item.scope === 'builtin' && item.mapID === 'muroran00');
      assert.ok(muroran, 'newly imported KTGIS map muroran00 must exist');
      assert.equal(muroran.data.thumbnail, 'basemap_icons/muroran00.png');
      assert.equal(muroran.data.coverageLngLats.length, 4);
      assert.ok(initial.filter((item) => item.scope === 'builtin').length >= 329);

      // Add a user base map
      await SettingsService.saveUserBaseMap({
        mapID: 'my_basemap',
        title: 'My Base Map',
        url: 'https://example.test/tiles/{z}/{x}/{y}.png',
        attr: 'Example Provider',
        minZoom: 5,
        maxZoom: 18,
      });
      const afterAdd = await SettingsService.listBaseMaps();
      const added = afterAdd.find((item) => item.mapID === 'my_basemap');
      assert.ok(added);
      assert.equal(added.scope, 'user');
      assert.equal(added.data.title, 'My Base Map');
      assert.equal(added.data.minZoom, 5);
      assert.equal(added.data.maxZoom, 18);

      // The new user base map is picked up by per-map TMS list
      const tmsList = await SettingsService.getTmsListOfMapID('some-map');
      assert.ok(tmsList.some((tms) => tms.mapID === 'my_basemap'));

      // Update preserves scope and updates content; user masters can carry
      // icon (thumbnail) and coverage (coverageLngLats) as app-selection defaults
      await SettingsService.saveUserBaseMap({
        mapID: 'my_basemap',
        title: 'My Base Map v2',
        url: 'https://example.test/tiles/{z}/{x}/{-y}.png',
        thumbnail: 'tmbs/my_basemap_menu.jpg',
        coverageLngLats: [[139, 35], [140, 35], [140, 36], [139, 36]],
      });
      const afterUpdate = await SettingsService.listBaseMaps();
      const updated = afterUpdate.find((item) => item.mapID === 'my_basemap');
      assert.equal(updated.data.title, 'My Base Map v2');
      assert.equal(updated.data.thumbnail, 'tmbs/my_basemap_menu.jpg');
      assert.equal(updated.data.coverageLngLats.length, 4);
      assert.equal(afterUpdate.filter((item) => item.mapID === 'my_basemap').length, 1);

      // Builtin ID conflicts are rejected
      await assert.rejects(() => SettingsService.saveUserBaseMap({
        mapID: 'osm',
        title: 'Fake OSM',
        url: 'https://example.test/{z}/{x}/{y}.png',
      }));
      await assert.rejects(() => SettingsService.saveUserBaseMap({ title: 'No ID' }));

      // Visibility rows of a deleted user base map are cleaned up
      await SettingsService.setBaseMapVisibilityForMapID('some-map', 'my_basemap', false);
      await SettingsService.deleteUserBaseMap('my_basemap');
      const afterDelete = await SettingsService.listBaseMaps();
      assert.ok(!afterDelete.some((item) => item.mapID === 'my_basemap'));
      const db = await SqliteDataService.getDb();
      const visibilityRows = db
        .prepare("SELECT 1 FROM map_base_map_visibility WHERE base_map_id = 'my_basemap'")
        .all();
      assert.equal(visibilityRows.length, 0);

      // Re-adding the same ID starts with default (enabled) visibility again
      await SettingsService.saveUserBaseMap({
        mapID: 'my_basemap',
        title: 'My Base Map v3',
        url: 'https://example.test/tiles/{z}/{x}/{y}.png',
      });
      const visibility = await SettingsService.getBaseMapVisibilityOfMapID('some-map');
      const readded = visibility.find((item) => item.mapID === 'my_basemap');
      assert.equal(readded.enabled, true);

      console.log('M5 base map catalog smoke passed');
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
          entryFileNames: 'basemap-catalog-smoke.mjs',
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
  console.log('M5 base map catalog smoke passed');
} finally {
  await rm(workDir, { recursive: true, force: true });
}
