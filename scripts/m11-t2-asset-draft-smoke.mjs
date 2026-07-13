import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });

async function importSource(relativeEntry, fileName) {
  const workDir = await mkdtemp(path.join(scratchRoot, 'm11-t2-'));
  const outDir = path.join(workDir, 'dist');
  await build({
    root: projectRoot,
    logLevel: 'error',
    configFile: false,
    build: {
      outDir,
      emptyOutDir: true,
      lib: { entry: path.join(projectRoot, relativeEntry), formats: ['es'], fileName: () => fileName },
    },
  });
  const loaded = await import(`${pathToFileURL(path.join(outDir, fileName)).href}?t=${Date.now()}`);
  await rm(workDir, { recursive: true, force: true });
  return loaded;
}

class MemoryStore {
  values = new Map();
  get(key, fallback) { return this.values.has(key) ? this.values.get(key) : fallback; }
  set(key, value) { this.values.set(key, structuredClone(value)); }
  delete(key) { this.values.delete(key); }
}

const envelope = (kind, assetUid, revision = 1, payload = { title: 'draft' }) => ({
  schemaVersion: 1,
  kind,
  assetUid,
  baseRevision: revision,
  updatedAt: '2026-07-13T12:00:00.000Z',
  payload,
});

try {
  const {
    ASSET_DRAFT_KINDS,
    MAX_ASSET_DRAFT_BYTES,
    AssetDraftStore,
    validateAssetDraftEnvelope,
  } = await importSource('src/services/assetDraftStore.ts', 'assetDraftStore.mjs');

  assert.deepEqual(ASSET_DRAFT_KINDS, ['map', 'app', 'poi', 'base-map', 'image-asset']);
  assert.equal(MAX_ASSET_DRAFT_BYTES, 20 * 1024 * 1024);
  for (const kind of ASSET_DRAFT_KINDS) assert.doesNotThrow(() => validateAssetDraftEnvelope(envelope(kind, `${kind}-uid`)));
  for (const invalid of [
    envelope('unknown', 'uid'),
    envelope('map', ''),
    { ...envelope('map', 'uid'), schemaVersion: 2 },
    { ...envelope('map', 'uid'), updatedAt: 'not-a-date' },
    { ...envelope('map', 'uid'), baseRevision: -1 },
    { ...envelope('map', 'uid'), payload: undefined },
  ]) assert.throws(() => validateAssetDraftEnvelope(invalid));
  assert.throws(() => validateAssetDraftEnvelope(envelope('map', 'uid', 1, { data: 'x'.repeat(MAX_ASSET_DRAFT_BYTES) })));
  console.log('  [1/4] Draft envelope validation: PASS');

  const storage = new MemoryStore();
  const store = new AssetDraftStore(storage);
  await store.put(envelope('map', 'shared-uid', 3, { value: 'map' }));
  await store.put(envelope('app', 'shared-uid', 4, { value: 'app' }));
  assert.equal((await store.get('map', 'shared-uid')).payload.value, 'map');
  assert.equal((await store.get('app', 'shared-uid')).payload.value, 'app');
  await store.put(envelope('map', 'shared-uid', 3, { value: 'updated' }));
  assert.equal((await store.get('map', 'shared-uid')).payload.value, 'updated');
  console.log('  [2/4] Kind and UID key isolation/upsert: PASS');

  await store.put(envelope('poi', 'poi-2', null));
  assert.deepEqual((await store.list('map')).map(({ kind, assetUid }) => ({ kind, assetUid })), [
    { kind: 'map', assetUid: 'shared-uid' },
  ]);
  assert.equal((await store.list()).length, 3);
  assert.equal('payload' in (await store.list())[0], false, 'summary must not expose payload');
  await store.remove('map', 'shared-uid');
  assert.equal(await store.get('map', 'shared-uid'), null);
  assert.notEqual(await store.get('app', 'shared-uid'), null);
  console.log('  [3/4] Draft list summaries and scoped removal: PASS');

  storage.set('assetDrafts:map:broken', { bad: true });
  assert.equal(await store.get('map', 'broken'), null, 'corrupt entry must be quarantined');
  assert.equal(storage.values.has('assetDrafts:map:broken'), false);
  console.log('  [4/4] Corrupt draft quarantine: PASS');

  const serviceSource = await readFile(path.join(projectRoot, 'electron/services/AssetDraftService.ts'), 'utf8');
  assert.match(serviceSource, /electron-store/);
  assert.match(serviceSource, /new AssetDraftStore/);
  const storeSourceContract = await readFile(path.join(projectRoot, 'src/services/assetDraftStore.ts'), 'utf8');
  assert.doesNotMatch(storeSourceContract, /async\s+(?:put|get|remove|list)\(/, 'sync close flush requires synchronous store methods');
  const ipcSource = await readFile(path.join(projectRoot, 'electron/ipc/assetDrafts.ts'), 'utf8');
  for (const channel of ['put', 'get', 'remove', 'list']) {
    assert.match(ipcSource, new RegExp(`ipcMain\\.handle\\(['"]asset-drafts:${channel}['"]`));
  }
  assert.match(ipcSource, /ipcMain\.on\(['"]asset-drafts:flush-sync['"]/);
  assert.match(ipcSource, /event\.returnValue\s*=/);

  const mainSource = await readFile(path.join(projectRoot, 'electron/main.ts'), 'utf8');
  assert.match(mainSource, /registerAssetDraftHandlers\(\)/);
  for (const channel of ['put', 'get', 'remove', 'list']) {
    assert.match(mainSource, new RegExp(`removeHandler\\(['"]asset-drafts:${channel}['"]\\)`));
  }
  assert.match(mainSource, /removeAllListeners\(['"]asset-drafts:flush-sync['"]\)/);
  assert.match(mainSource, /executeJavaScript\(["']window\.dispatchEvent\(new Event\(["']maplat:flush-drafts/);
  assert.doesNotMatch(mainSource, /registerAppDraftHandlers|appdraft:/);

  const preloadSource = await readFile(path.join(projectRoot, 'electron/preload.ts'), 'utf8');
  assert.match(preloadSource, /exposeInMainWorld\(['"]assetDrafts['"]/);
  for (const channel of ['put', 'get', 'remove', 'list']) {
    assert.match(preloadSource, new RegExp(`ipcRenderer\\.invoke\\(['"]asset-drafts:${channel}['"]`));
  }
  assert.match(preloadSource, /ipcRenderer\.sendSync\(['"]asset-drafts:flush-sync['"]/);
  assert.doesNotMatch(preloadSource, /exposeInMainWorld\(['"]appdraft['"]/);

  const declarations = await readFile(path.join(projectRoot, 'src/electron.d.ts'), 'utf8');
  assert.match(declarations, /interface AssetDraftsAPI/);
  assert.match(declarations, /assetDrafts:\s*AssetDraftsAPI/);
  assert.doesNotMatch(declarations, /appdraft:\s*AppDraftAPI/);
  console.log('  [5/5] Safe IPC and typed preload boundary: PASS');

  const { createAssetDraftLifecycleCore, decideDraftRestore } = await importSource(
    'src/composables/assetDraftLifecycleCore.ts',
    'assetDraftLifecycleCore.mjs',
  );
  let nextTimerId = 1;
  const timers = new Map();
  const calls = { put: [], remove: [], sync: [] };
  let payload = { value: 1 };
  let failNextPut = false;
  const core = createAssetDraftLifecycleCore({
    delayMs: 2000,
    now: () => '2026-07-13T12:34:56.000Z',
    setTimeoutFn: (fn, delay) => { const id = nextTimerId++; timers.set(id, { fn, delay }); return id; },
    clearTimeoutFn: (id) => timers.delete(id),
    onError: () => {},
    api: {
      put: async (draft) => {
        if (failNextPut) { failNextPut = false; throw new Error('disk full'); }
        calls.put.push(structuredClone(draft));
      },
      remove: async (kind, uid) => calls.remove.push([kind, uid]),
      flushSync: (draft) => { calls.sync.push(structuredClone(draft)); return { ok: true }; },
    },
  });
  core.open({ kind: 'map', assetUid: 'map-1', baseRevision: 7 }, () => payload);
  core.schedule(false);
  assert.equal(timers.size, 0, 'clean state must not schedule a draft');
  core.schedule(true);
  payload = { value: 2 };
  core.schedule(true);
  assert.equal(timers.size, 1, 'continuous edits must share one trailing timer');
  const scheduled = [...timers.values()][0];
  assert.equal(scheduled.delay, 2000);
  timers.clear();
  await scheduled.fn();
  assert.equal(calls.put.length, 1);
  assert.deepEqual(calls.put[0].payload, { value: 2 });

  payload = { value: 3 };
  core.schedule(true);
  await core.flush();
  assert.equal(timers.size, 0, 'flush must cancel the pending timer');
  assert.deepEqual(calls.put.at(-1).payload, { value: 3 });
  core.flushSync();
  assert.deepEqual(calls.sync.at(-1).payload, { value: 3 });

  failNextPut = true;
  payload = { value: 4 };
  core.schedule(true);
  await core.flush();
  assert.match(core.error.value.message, /disk full/);
  payload = { value: 5 };
  core.schedule(true);
  await core.flush();
  assert.equal(core.error.value, null);
  assert.deepEqual(calls.put.at(-1).payload, { value: 5 });
  await core.markSaved();
  assert.deepEqual(calls.remove, [['map', 'map-1']]);
  console.log('  [6/6] Two-second throttle, flush, retry, sync, and save cleanup: PASS');

  const draft = envelope('map', 'map-1', 7);
  assert.equal(decideDraftRestore(null, 7), 'none');
  assert.equal(decideDraftRestore(draft, 7), 'auto-apply');
  assert.equal(decideDraftRestore(draft, 8), 'conflict');
  assert.equal(decideDraftRestore(envelope('map', 'map-1', null), null), 'auto-apply');
  console.log('  [7/7] Revision-aware restore decision: PASS');

  const lifecycleSource = await readFile(
    path.join(projectRoot, 'src/composables/useAssetDraftLifecycle.ts'),
    'utf8',
  );
  assert.match(lifecycleSource, /export function useAssetDraftLifecycle/);
  assert.match(lifecycleSource, /window\.assetDrafts\.get/);
  assert.match(lifecycleSource, /window\.assetDrafts\.put/);
  assert.match(lifecycleSource, /window\.assetDrafts\.remove/);
  assert.match(lifecycleSource, /window\.assetDrafts\.flushSync/);
  assert.match(lifecycleSource, /addEventListener\(['"]beforeunload['"]/);
  assert.match(lifecycleSource, /removeEventListener\(['"]beforeunload['"]/);
  assert.match(lifecycleSource, /addEventListener\(['"]maplat:flush-drafts['"]/);
  assert.match(lifecycleSource, /decideDraftRestore/);
  assert.match(lifecycleSource, /conflictDraft/);
  assert.match(lifecycleSource, /shouldPersist/);
  console.log('  [8/8] Vue lifecycle wraps restore and beforeunload safely: PASS');

  const conflictDialog = await readFile(
    path.join(projectRoot, 'src/components/editor-ui/DraftConflictDialog.vue'),
    'utf8',
  );
  assert.match(conflictDialog, /emit\('discard'\)/);
  assert.match(conflictDialog, /emit\('apply'\)/);
  assert.match(conflictDialog, /editor_ui\.draft_conflict/);
  for (const viewName of ['MapEdit.vue', 'AppEdit.vue', 'PoiEdit.vue']) {
    const source = await readFile(path.join(projectRoot, 'src/views', viewName), 'utf8');
    assert.match(source, /useAssetDraftLifecycle/, `${viewName}: draft lifecycle missing`);
    assert.match(source, /DraftConflictDialog/, `${viewName}: conflict dialog missing`);
    assert.match(source, /draftLifecycle\.open/, `${viewName}: draft open missing`);
    assert.match(source, /draftLifecycle\.schedule/, `${viewName}: throttled schedule missing`);
    assert.match(source, /draftLifecycle\.flush\(\)/, `${viewName}: hot-exit flush missing`);
    assert.match(source, /draftLifecycle\.markSaved\(\)/, `${viewName}: save cleanup missing`);
  }
  const mapView = await readFile(path.join(projectRoot, 'src/views/MapEdit.vue'), 'utf8');
  const appView = await readFile(path.join(projectRoot, 'src/views/AppEdit.vue'), 'utf8');
  const poiView = await readFile(path.join(projectRoot, 'src/views/PoiEdit.vue'), 'utf8');
  for (const [name, source] of [['MapEdit', mapView], ['AppEdit', appView], ['PoiEdit', poiView]]) {
    const start = Math.max(source.indexOf('const goBack = async'), source.indexOf('async function goBack'));
    const end = source.indexOf('router.push', start);
    const goBack = start >= 0 && end >= 0 ? source.slice(start, end + 'router.push'.length) : '';
    assert.ok(goBack, `${name}: goBack block missing`);
    assert.doesNotMatch(goBack, /showMessageBox/, `${name}: dirty leave confirmation must be removed`);
  }
  const poiSession = await readFile(
    path.join(projectRoot, 'src/composables/usePoiEditSession.ts'),
    'utf8',
  );
  assert.match(poiSession, /const reset = \(state: PoiEditState, restoredDraft = false\)/);
  assert.match(poiSession, /\breset,/);
  const { UndoStack } = await importSource('src/services/editorUndoStack.ts', 'draftUndoStack.mjs');
  const restoredHistory = new UndoStack({ value: 'draft' });
  restoredHistory.markDirty();
  assert.equal(restoredHistory.isDirty(), true, 'restored draft must remain saveable after history reset');
  assert.equal(restoredHistory.canUndo(), false, 'restored draft must not resurrect pre-exit undo history');
  console.log('  [9/9] Map/App/POI adapters use common hot-exit lifecycle: PASS');

  const listKinds = {
    'MapList.vue': 'map',
    'AppList.vue': 'app',
    'PoiSourceList.vue': 'poi',
    'BaseMapList.vue': 'base-map',
    'AssetList.vue': 'image-asset',
  };
  for (const [viewName, kind] of Object.entries(listKinds)) {
    const source = await readFile(path.join(projectRoot, 'src/views', viewName), 'utf8');
    assert.match(source, new RegExp(`useAssetDraftBadges\\(['"]${kind}['"]\\)`), `${viewName}: summary kind missing`);
    assert.match(source, /hasDraft\(/, `${viewName}: UID badge lookup missing`);
    assert.match(source, /editor_ui\.draft_badge/, `${viewName}: translated draft badge missing`);
    assert.match(source, /assetDrafts\.remove/, `${viewName}: asset deletion must remove orphan draft`);
  }
  for (const viewName of ['BaseMapList.vue', 'AssetList.vue']) {
    const source = await readFile(path.join(projectRoot, 'src/views', viewName), 'utf8');
    assert.match(source, /useAssetDraftLifecycle/, `${viewName}: modal draft lifecycle missing`);
    assert.match(source, /modalDraftLifecycle\.open/, `${viewName}: modal draft open missing`);
    assert.match(source, /modalDraftLifecycle\.schedule/, `${viewName}: modal draft schedule missing`);
    assert.match(source, /modalDraftLifecycle\.flush\(\)/, `${viewName}: modal close flush missing`);
    assert.match(source, /modalDraftLifecycle\.markSaved\(\)/, `${viewName}: modal save cleanup missing`);
  }
  const sqliteSource = await readFile(path.join(projectRoot, 'electron/services/SqliteDataService.ts'), 'utf8');
  assert.match(sqliteSource, /listBaseMaps[\s\S]*?SELECT uid, slug, scope, data_json, revision/);
  console.log('  [10/10] Five asset lists and lightweight editors share draft badges/lifecycle: PASS');
  console.log('M11-T2 asset draft smoke passed');
} catch (error) {
  console.error('M11-T2 asset draft smoke FAILED:', error.stack ?? error.message);
  process.exit(1);
}
