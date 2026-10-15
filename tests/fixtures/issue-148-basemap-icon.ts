import assert from 'node:assert/strict';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import fs from 'fs-extra';
import Settings from '../../electron/services/SettingsService';
import Sqlite from '../../electron/services/SqliteDataService';
import { thumb512PathFor } from '../../src/utils/thumbnailPaths';

// Never point this fixture at an existing profile. The launcher supplies a fresh root.
assert.ok(process.env.MAPLAT_E2E_ROOT);
const root = String(Settings.get('saveFolder'));
const at = (rel: string) => path.join(root, rel);
const db = await Sqlite.getDb(); // finish migrations before seeding fixtures
const row = (uid: string) => db.prepare('SELECT * FROM base_maps WHERE uid = ?').get(uid) as any;
const document = (uid: string) => JSON.parse(row(uid).data_json);
const save = (uid: string, thumbnail: string, kind = 'tms', slug = uid) =>
  Sqlite.saveUserBaseMap({ uid, create: true, slug, tms: { kind, thumbnail } as any });
async function seed(rel: string, large = true) {
  await fs.outputFile(at(rel), '52-' + rel);
  if (large) await fs.outputFile(at(thumb512PathFor(rel)!), '512-' + rel);
}
async function preserved(rel: string, large = true) {
  assert.equal(await fs.readFile(at(rel), 'utf8'), '52-' + rel, 'source 52 must survive');
  if (large) assert.equal(await fs.readFile(at(thumb512PathFor(rel)!), 'utf8'), '512-' + rel);
}

// File bytes are sentinels: this tests byte preservation, not image codecs/rendering.
for (const kind of ['tms', 'merc', 'google', 'mapbox', 'maplibre']) {
  for (const ext of ['png', 'jpg', 'jpeg', 'webp', 'PNG']) {
    const source = randomUUID();
    const rel = `tmbs/${source}.${ext}`;
    await seed(rel);
    await save(source, rel, kind);
    const before = { ...row(source) };
    const uid = randomUUID();
    const result = await save(uid, rel, kind);
    await preserved(rel);
    assert.deepEqual({ ...row(source) }, before, 'source DB row unchanged');
    assert.equal(result.thumbnail, `tmbs/${uid}.${ext}`);
    assert.equal(await fs.readFile(at(result.thumbnail!), 'utf8'), '52-' + rel);
    assert.equal(await fs.readFile(at(thumb512PathFor(result.thumbnail!)!), 'utf8'), '512-' + rel);
    assert.equal(result.revision, 2);
  }
}
console.log('PASS: 25 kind/extension combinations, source DB and both files preserved');

for (const large of [false, true]) {
  const rel = `tmbs/legacy-${randomUUID()}.png`;
  await seed(rel, large);
  const result = await save(randomUUID(), rel);
  await preserved(rel, large);
  assert.equal(await fs.pathExists(at(thumb512PathFor(result.thumbnail!)!)), large);
}
for (const rel of ['basemap_icons/osm.png', '', 'https://example.test/icon.png',
  'file:///tmp/icon.png', 'tmbs/nested/icon.png', 'tmbs/missing.png']) {
  assert.equal((await save(randomUUID(), rel)).thumbnail, rel);
}
console.log('PASS: legacy names, optional 512, bundled/URL/missing references');

// Already-owned upload is not copied; missing source 52 does not move an orphan 512.
{
  const uid = randomUUID();
  const rel = `tmbs/${uid}.png`;
  await seed(rel);
  assert.equal((await save(uid, rel)).revision, 1);
  await preserved(rel);
  const missing = `tmbs/${randomUUID()}.png`;
  await fs.outputFile(at(thumb512PathFor(missing)!), 'orphan');
  assert.equal((await save(randomUUID(), missing)).thumbnail, missing);
  assert.equal(await fs.readFile(at(thumb512PathFor(missing)!), 'utf8'), 'orphan');
}
// A 52-only source cannot adopt an unrelated existing destination 512.
{
  const rel = `tmbs/${randomUUID()}.png`;
  await seed(rel, false);
  const uid = randomUUID();
  await fs.outputFile(at(thumb512PathFor(`tmbs/${uid}.png`)!), 'unrelated');
  assert.equal((await save(uid, rel)).thumbnail, rel);
  await preserved(rel, false);
}

// Conflicting target files must never be overwritten or silently used.
for (const which of ['52', '512']) {
  const rel = `tmbs/${randomUUID()}.png`;
  await seed(rel);
  const uid = randomUUID();
  const dest = `tmbs/${uid}.png`;
  const conflict = which === '52' ? dest : thumb512PathFor(dest)!;
  await fs.outputFile(at(conflict), 'unrelated');
  assert.equal((await save(uid, rel)).thumbnail, rel);
  assert.equal(await fs.readFile(at(conflict), 'utf8'), 'unrelated');
  await preserved(rel);
}

// Inject failure on each copy; restoring fs and retrying the private preparation
// verifies an identical partial copy is reusable without changing the source.
for (const which of ['52', '512']) {
  const rel = `tmbs/${randomUUID()}.png`;
  await seed(rel);
  const uid = randomUUID();
  const dest = `tmbs/${uid}.png`;
  const failAt = at(which === '52' ? dest : thumb512PathFor(dest)!);
  const copy = fs.copy;
  (fs as any).copy = async (src: string, dst: string, options: any) => {
    if (dst === failAt) throw new Error('injected copy failure');
    return copy(src, dst, options);
  };
  try { assert.equal((await save(uid, rel)).thumbnail, rel); }
  finally { (fs as any).copy = copy; }
  await preserved(rel);
  assert.equal(document(uid).thumbnail, rel);
  assert.equal(await (Sqlite as any).relocateBaseMapIcon(uid, rel), dest);
  await preserved(rel);
}
console.log('PASS: target conflicts and failure/retry on both sizes');

// Same-size corruption must not pass the fresh-copy size check alone.
{
  const rel = `tmbs/${randomUUID()}.png`;
  await seed(rel);
  const uid = randomUUID();
  const copy = fs.copy;
  (fs as any).copy = async (src: string, dst: string, options: any) => {
    await copy(src, dst, options);
    if (dst === at(`tmbs/${uid}.png`)) {
      const bytes = await fs.readFile(dst);
      bytes[0] ^= 1;
      await fs.writeFile(dst, bytes);
    }
  };
  try { assert.equal((await save(uid, rel)).thumbnail, rel); }
  finally { (fs as any).copy = copy; }
  await preserved(rel);
}
console.log('PASS: owned/missing/orphan images and same-size copy corruption');

// INSERT failure happens before filesystem work.
{
  const rel = `tmbs/${randomUUID()}.png`;
  await seed(rel);
  const uid = randomUUID();
  db.exec("CREATE TEMP TRIGGER fail_insert BEFORE INSERT ON base_maps BEGIN SELECT RAISE(ABORT, 'injected insert'); END");
  try { await assert.rejects(save(uid, rel), /injected insert/); }
  finally { db.exec('DROP TRIGGER fail_insert'); }
  assert.equal(row(uid), undefined);
  assert.equal(await fs.pathExists(at(`tmbs/${uid}.png`)), false);
  await preserved(rel);
}
// UPDATE failure after copying: committed row still references intact source.
// The existing update/repoint path recovers using the verified copy on retry.
{
  const rel = `tmbs/${randomUUID()}.png`;
  await seed(rel);
  const uid = randomUUID();
  db.exec("CREATE TEMP TRIGGER fail_update BEFORE UPDATE ON base_maps BEGIN SELECT RAISE(ABORT, 'injected update'); END");
  try { await assert.rejects(save(uid, rel), /injected update/); }
  finally { db.exec('DROP TRIGGER fail_update'); }
  await preserved(rel);
  assert.equal(document(uid).thumbnail, rel);
  const result = await Sqlite.saveUserBaseMap({ uid, slug: uid, expectedRevision: 1, tms: { thumbnail: rel } as any });
  assert.equal(result.thumbnail, `tmbs/${uid}.png`);
  assert.equal(result.revision, 2);
}
console.log('PASS: INSERT/UPDATE failures preserve valid references and recovery');
console.log('issue-148 ALL PASS');
