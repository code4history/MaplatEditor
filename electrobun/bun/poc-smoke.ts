import assert from 'node:assert/strict';
import { getM2ViteArtifactStatus, readM2TextFile, writeM2TextFile } from './local-file-access';
import { M2MockStorageAdapter } from './mock-storage-adapter';

const storage = new M2MockStorageAdapter();

await storage.save({
  mapID: 'poc-electrobun-map',
  title: 'Electrobun Mock Map',
  payload: {
    source: 'poc-smoke',
  },
});

const saved = await storage.read('poc-electrobun-map');
assert.equal(saved?.title, 'Electrobun Mock Map');
assert.equal((await storage.list()).length, 1);

const writtenPath = await writeM2TextFile('smoke/local-file.txt', 'PoC local file access passed');
const readBack = await readM2TextFile('smoke/local-file.txt');
assert.equal(readBack.path, writtenPath);
assert.equal(readBack.text, 'PoC local file access passed');

const viteArtifact = getM2ViteArtifactStatus();
assert.equal(viteArtifact.exists, true, `Vite artifact missing: ${viteArtifact.indexPath}`);

console.log('Electrobun PoC core smoke passed');
