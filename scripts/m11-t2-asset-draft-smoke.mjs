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
  console.log('M11-T2 asset draft smoke passed');
} catch (error) {
  console.error('M11-T2 asset draft smoke FAILED:', error.stack ?? error.message);
  process.exit(1);
}
