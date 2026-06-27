import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import ts from 'typescript';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const workDir = await mkdtemp(path.join(tmpdir(), 'maplat-editor-m1-'));
const bundledAdapter = path.join(workDir, 'StorageAdapter.mjs');

try {
  const preloadSource = await readFile(path.join(projectRoot, 'electron/preload.ts'), 'utf8');
  assert.match(preloadSource, /exposeInMainWorld\('maplist'/);
  assert.match(preloadSource, /exposeInMainWorld\('mapedit'/);
  assert.match(preloadSource, /ipcRenderer\.invoke\('maplist:request'/);
  assert.match(preloadSource, /ipcRenderer\.invoke\('mapedit:request'/);
  assert.match(preloadSource, /ipcRenderer\.invoke\('mapedit:save'/);

  const mapEditIpcSource = await readFile(path.join(projectRoot, 'electron/ipc/mapedit.ts'), 'utf8');
  assert.match(mapEditIpcSource, /ElectronStorageAdapter/);
  assert.doesNotMatch(mapEditIpcSource, /from '\.\.\/services\/MapEditService'/);
  assert.match(mapEditIpcSource, /StorageAdapter\.readMapForEdit/);
  assert.match(mapEditIpcSource, /StorageAdapter\.saveMapForEdit/);

  const mapListIpcSource = await readFile(path.join(projectRoot, 'electron/ipc/maps.ts'), 'utf8');
  assert.match(mapListIpcSource, /ElectronStorageAdapter/);
  assert.doesNotMatch(mapListIpcSource, /from '\.\.\/services\/MapDataService'/);
  assert.match(mapListIpcSource, /StorageAdapter\.listMaps/);
  assert.match(mapListIpcSource, /StorageAdapter\.deleteMap/);

  const adapterSource = await readFile(
    path.join(projectRoot, 'electron/adapters/StorageAdapter.ts'),
    'utf8'
  );
  const transpiled = ts.transpileModule(adapterSource, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
      strict: true,
    },
  });
  await writeFile(bundledAdapter, transpiled.outputText);

  const { ServiceBackedStorageAdapter } = await import(pathToFileURL(bundledAdapter).href);

  const savedMaps = new Map([
    ['edo', { mapID: 'edo', title: 'Edo', status: 'Update', gcps: [], sub_maps: [] }],
  ]);
  const calls = [];

  const adapter = new ServiceBackedStorageAdapter({
    async listMaps(query, page, pageSize) {
      calls.push(['listMaps', query, page, pageSize]);
      const docs = [...savedMaps.values()]
        .filter((map) => !query || String(map.title).includes(query))
        .map((map) => ({ mapID: map.mapID, title: map.title, image: null }));
      return { docs, prev: page > 1, next: false };
    },
    async deleteMap(mapID) {
      calls.push(['deleteMap', mapID]);
      savedMaps.delete(mapID);
    },
    async readMapForEdit(mapID) {
      calls.push(['readMapForEdit', mapID]);
      return savedMaps.get(mapID);
    },
    async saveMapForEdit(mapObject, tins) {
      calls.push(['saveMapForEdit', mapObject.mapID, tins.length]);
      savedMaps.set(mapObject.mapID, { ...mapObject, savedTinCount: tins.length });
      return 'Success';
    },
    async isMapIdAvailable(mapID) {
      calls.push(['isMapIdAvailable', mapID]);
      return !savedMaps.has(mapID);
    },
  });

  const listed = await adapter.listMaps({ page: 1 });
  assert.equal(listed.docs.length, 1);
  assert.equal(listed.docs[0].mapID, 'edo');

  const loaded = await adapter.readMapForEdit('edo');
  assert.equal(loaded.status, 'Update');

  const saveResult = await adapter.saveMapForEdit({
    mapObject: { ...loaded, title: 'Edo edited' },
    tins: ['tooLessGcps'],
  });
  assert.equal(saveResult, 'Success');

  const reloaded = await adapter.readMapForEdit('edo');
  assert.equal(reloaded.title, 'Edo edited');
  assert.equal(reloaded.savedTinCount, 1);

  assert.equal(await adapter.isMapIdAvailable('edo'), false);
  assert.equal(await adapter.isMapIdAvailable('new-map'), true);

  await adapter.deleteMap('edo');
  assert.equal((await adapter.listMaps({ page: 1 })).docs.length, 0);

  await assert.rejects(() => adapter.readMapForEdit(''), /mapID must be a non-empty string/);
  await assert.rejects(
    () => adapter.saveMapForEdit({ mapObject: { mapID: 'bad' }, tins: undefined }),
    /tins must be JSON serializable|tins must be an array/
  );

  const methodOrder = calls.map((call) => call[0]);
  assert.deepEqual(methodOrder, [
    'listMaps',
    'readMapForEdit',
    'saveMapForEdit',
    'readMapForEdit',
    'isMapIdAvailable',
    'isMapIdAvailable',
    'deleteMap',
    'listMaps',
  ]);

  console.log('M1 StorageAdapter smoke passed');
} finally {
  await rm(workDir, { recursive: true, force: true });
}
