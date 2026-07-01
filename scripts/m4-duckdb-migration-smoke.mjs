import { mkdtemp, rm, writeFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'duckdb-migration-'));
const entryFile = path.join(workDir, 'duckdb-migration-smoke.ts');
const electronStubFile = path.join(workDir, 'electron-stub.ts');
const electronStoreStubFile = path.join(workDir, 'electron-store-stub.ts');
const outDir = path.join(workDir, 'dist');
const bundledFile = path.join(outDir, 'duckdb-migration-smoke.mjs');

try {
  const dataDir = path.join(workDir, 'data');
  const settingsDir = path.join(dataDir, 'settings');
  const settingsPath = path.join(projectRoot, 'electron/services/SettingsService.ts');
  const mapDataPath = path.join(projectRoot, 'electron/services/MapDataService.ts');
  const duckDbPath = path.join(projectRoot, 'electron/services/DuckDbDataService.ts');
  const storageAdapterPath = path.join(projectRoot, 'electron/adapters/ElectronStorageAdapter.ts');

  await mkdir(settingsDir, { recursive: true });
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
      export const BrowserWindow = class {};
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
    path.join(dataDir, 'nedb.db'),
    JSON.stringify({
      _id: 'legacy-map',
      title: 'Legacy Map',
      officialTitle: '',
      description: 'Migrated from NeDB',
      attr: '',
      dataAttr: '',
      author: '',
      createdAt: '',
      era: '',
      license: '',
      dataLicense: '',
      contributor: '',
      mapper: '',
      reference: '',
      url: '',
      lang: 'ja',
      imageExtension: 'jpg',
      width: 320,
      height: 200,
      gcps: [],
      edges: [],
      sub_maps: [],
      homePosition: [0, 0],
      mercZoom: 0,
      strictMode: 'strict',
      vertexMode: 'plain',
    }) + '\n'
  );
  await writeFile(
    path.join(settingsDir, 'tmsList.json'),
    JSON.stringify([{ mapID: 'user-base', title: 'User Base', url: 'https://example.test/{z}/{x}/{y}.png' }])
  );
  await writeFile(
    path.join(settingsDir, 'tmsList_mapA.json'),
    JSON.stringify({ 'user-base': false, 'gsi_ort_USA10': true })
  );
  await writeFile(
    path.join(settingsDir, 'tmsList.mapB.json'),
    JSON.stringify({ 'user-base': true, 'gsi_ort_USA10': false })
  );

  await writeFile(
    entryFile,
    `
      import assert from 'node:assert/strict';
      import { access } from 'node:fs/promises';

      const { default: SettingsService } = await import(${JSON.stringify(settingsPath)});
      SettingsService.set('saveFolder', ${JSON.stringify(dataDir)});

      const { default: MapDataService } = await import(${JSON.stringify(mapDataPath)});
      const { default: DuckDbDataService } = await import(${JSON.stringify(duckDbPath)});
      const { default: StorageAdapter } = await import(${JSON.stringify(storageAdapterPath)});

      const db = await MapDataService.getDBInstance();
      assert.equal(await StorageAdapter.isMapIdAvailable('legacy-map'), false);
      const listed = await StorageAdapter.listMaps({ query: 'Legacy', page: 1, pageSize: 20 });
      assert.equal(listed.docs.length, 1);
      assert.equal(listed.docs[0].mapID, 'legacy-map');

      const loaded = await StorageAdapter.readMapForEdit('legacy-map');
      assert.equal(loaded.mapID, 'legacy-map');
      assert.equal(loaded.status, 'Update');

      await StorageAdapter.saveMapForEdit({
        mapObject: { ...loaded, title: 'Updated Legacy Map', status: 'Update' },
        tins: ['tooLessGcps'],
      });
      const reloaded = await db.findOneAsync({ _id: 'legacy-map' });
      assert.equal(reloaded.title, 'Updated Legacy Map');

      await access(${JSON.stringify(path.join(dataDir, 'maplat.duckdb'))});

      const mapA = await SettingsService.getTmsListOfMapID('mapA');
      assert.ok(mapA.some((tms) => tms.mapID === 'gsi_ort_USA10'));
      assert.ok(!mapA.some((tms) => tms.mapID === 'user-base'));

      const mapB = await SettingsService.getTmsListOfMapID('mapB');
      assert.ok(!mapB.some((tms) => tms.mapID === 'gsi_ort_USA10'));
      assert.ok(mapB.some((tms) => tms.mapID === 'user-base'));

      const mapC = await SettingsService.getTmsListOfMapID('mapC');
      assert.ok(mapC.some((tms) => tms.mapID === 'gsi_ort_USA10'));
      assert.ok(mapC.some((tms) => tms.mapID === 'user-base'));

      const connection = await DuckDbDataService.getConnection();
      const baseMaps = await connection.runAndReadAll(
        "SELECT scope, map_id FROM base_maps WHERE map_id IN ('osm', 'gsi', 'user-base') ORDER BY scope, map_id"
      );
      const rows = baseMaps.getRowObjectsJson();
      assert.ok(rows.some((row) => row.scope === 'builtin' && row.map_id === 'osm'));
      assert.ok(rows.some((row) => row.scope === 'builtin' && row.map_id === 'gsi'));
      assert.ok(rows.some((row) => row.scope === 'user' && row.map_id === 'user-base'));

      await DuckDbDataService.reset();
      await DuckDbDataService.getConnection();
      const duplicateCheck = await (await DuckDbDataService.getConnection()).runAndReadAll(
        "SELECT scope, map_id, count(*)::INTEGER AS count FROM base_maps GROUP BY scope, map_id HAVING count(*) > 1"
      );
      assert.equal(duplicateCheck.getRowObjectsJson().length, 0);

      console.log('M4 DuckDB migration smoke passed');
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
          entryFileNames: 'duckdb-migration-smoke.mjs',
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
  await access(path.join(dataDir, 'maplat.duckdb'));
  console.log('M4 DuckDB migration smoke passed');
} finally {
  await rm(workDir, { recursive: true, force: true });
}
