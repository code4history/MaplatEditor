import assert from 'node:assert/strict';
import { getM2ViteArtifactStatus, readM2TextFile, writeM2TextFile } from './local-file-access';
import { M2MockStorageAdapter } from './mock-storage-adapter';

const storage = new M2MockStorageAdapter();

await storage.save({
  mapID: 'm2-electrobun-map',
  title: 'M2 Electrobun Mock Map',
  payload: {
    source: 'm2-smoke',
  },
});

const saved = await storage.read('m2-electrobun-map');
assert.equal(saved?.title, 'M2 Electrobun Mock Map');
assert.equal((await storage.list()).length, 1);

const writtenPath = await writeM2TextFile('smoke/local-file.txt', 'M2 local file access passed');
const readBack = await readM2TextFile('smoke/local-file.txt');
assert.equal(readBack.path, writtenPath);
assert.equal(readBack.text, 'M2 local file access passed');

const viteArtifact = getM2ViteArtifactStatus();
assert.equal(viteArtifact.exists, true, `Vite artifact missing: ${viteArtifact.indexPath}`);

console.log('M2 Electrobun PoC core smoke passed');
