// issue #192: ベースマップ複製直後（未保存）のサムネイル置換が複製元を壊さないことを、
// renderer の composable・main の IPC・AppAssetService・SqliteDataService の実コードで確かめる。
//
// 書き込み先の決定（規則 K）は production と同じ
// `src/components/basemap/baseMapThumbnailTarget.ts` を直接呼ぶ。ここで決定を書き写すと
// 「実サービスを呼んだ」ことにならず、実装の証明にならない。
import assert from 'node:assert/strict';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import fs from 'fs-extra';
import Settings from '../../electron/services/SettingsService';
import Sqlite from '../../electron/services/SqliteDataService';
import { registerAppAssetHandlers } from '../../electron/ipc/appassets';
import { useThumbnailReplace } from '../../src/composables/useThumbnailReplace';
import {
  isOwnThumbnail,
  resolveBaseMapThumbnailWriteTarget,
  shouldForceDerive52,
} from '../../src/components/basemap/baseMapThumbnailTarget';
import { thumb512PathFor } from '../../src/utils/thumbnailPaths';

assert.ok(process.env.MAPLAT_E2E_ROOT, 'MAPLAT_E2E_ROOT is required');
const root = String(Settings.get('saveFolder'));
const at = (rel: string) => path.join(root, rel);

// 実 IPC ハンドラ（electron/ipc/appassets.ts）を登録し、renderer 側の口だけを差し替える。
// これで composable → IPC → AppAssetService の経路をそのまま通す。
registerAppAssetHandlers();
const handlers = (globalThis as any).__ipcHandlers as Record<string, (...args: any[]) => any>;
assert.ok(handlers?.['appassets:replace-map-thumbnail'], 'replace-map-thumbnail handler が登録されている');
(globalThis as any).window = {
  appAssets: {
    replaceMapThumbnail: (mapUid: string, kind: '512' | '52', derive52: boolean, ext?: string, copy512From?: string) =>
      handlers['appassets:replace-map-thumbnail']({ sender: {} }, mapUid, kind, derive52, ext, copy512From),
    fileUrl: (relPath: string) => handlers['appassets:file-url']({}, relPath),
  },
};

const db = await Sqlite.getDb(); // migration を先に済ませる
const row = (uid: string) => db.prepare('SELECT * FROM base_maps WHERE uid = ?').get(uid) as any;
const document = (uid: string) => JSON.parse(row(uid).data_json);

// 置換に使う実画像（Jimp が読める最小 PNG）
const replacementImage = path.join(String(process.env.MAPLAT_E2E_ROOT), 'replacement.png');
await fs.outputFile(
  replacementImage,
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
    'base64',
  ),
);
(globalThis as any).__pickImagePath = replacementImage;

const SOURCE_52 = '52-source-sentinel';
const SOURCE_512 = '512-source-sentinel';

async function seedSource(sourceUid: string, ext: string): Promise<string> {
  await fs.emptyDir(root);
  const rel52 = `tmbs/${sourceUid}.${ext}`;
  await fs.outputFile(at(rel52), SOURCE_52);
  await fs.outputFile(at(thumb512PathFor(rel52)!), SOURCE_512);
  // 複製元の保存済み文書（DB 行）も用意し、置換の前後で変わらないことを見る
  await Sqlite.saveUserBaseMap({
    uid: sourceUid,
    create: true,
    slug: `issue192-src-${sourceUid.slice(0, 8)}`,
    tms: { kind: 'tms', thumbnail: rel52 } as any,
  });
  return rel52;
}

interface Doc {
  uid: string;
  slug: string;
  thumbnail: string;
}

function duplicateDoc(sourceThumbnail: string): Doc {
  // BaseMapEdit.vue の duplicateInitial と同じ形: uid だけ新しく、thumbnail は複製元を指したまま
  return {
    uid: randomUUID(),
    slug: `issue192-copy-${randomUUID().slice(0, 8)}`,
    thumbnail: sourceThumbnail,
  };
}

function replacerFor(doc: Doc) {
  return useThumbnailReplace({
    rel52: () => doc.thumbnail || null,
    writeTarget: () => resolveBaseMapThumbnailWriteTarget({
      thumbnail: doc.thumbnail,
      ownKey: doc.uid,
      slug: doc.slug,
    }),
    disabledReason: () => 'slug required',
    forceDerive52: ({ exists52 }) => shouldForceDerive52({
      thumbnail: doc.thumbnail,
      ownKey: doc.uid,
      exists52,
    }),
    onPointerMoved: (next) => { doc.thumbnail = next; },
  });
}

async function assertSourceUntouched(sourceUid: string, ext: string): Promise<void> {
  assert.equal(await fs.readFile(at(`tmbs/${sourceUid}.${ext}`), 'utf8'), SOURCE_52,
    `複製元の 52px（tmbs/${sourceUid}.${ext}）を書き換えてはならない`);
  assert.equal(await fs.readFile(at(thumb512PathFor(`tmbs/${sourceUid}.${ext}`)!), 'utf8'), SOURCE_512,
    `複製元の 512px（${thumb512PathFor(`tmbs/${sourceUid}.${ext}`)}）を書き換えてはならない`);
}

async function assertOwnPair(doc: Doc): Promise<void> {
  assert.equal(isOwnThumbnail(doc.thumbnail, doc.uid), true,
    `thumbnail は自分の uid 名へ付け替える（実測: ${doc.thumbnail}）`);
  assert.equal(await fs.pathExists(at(doc.thumbnail)), true, '自分の 52px が実在する');
  const own512 = thumb512PathFor(doc.thumbnail);
  assert.ok(own512, '自分の 52px から 512px を導ける');
  assert.equal(await fs.pathExists(at(own512!)), true, `自分の 512px（${own512}）が実在する`);
}

async function replaceCase(kind: '52' | '512', opts: { deriveOff?: boolean } = {}) {
  const sourceUid = randomUUID();
  const rel52 = await seedSource(sourceUid, 'png');
  const sourceRowBefore = row(sourceUid);
  const doc = duplicateDoc(rel52);
  const replace = replacerFor(doc);
  await replace.refreshThumbnails();
  // 複製直後は「他者のファイル」なので、実体があっても 52px 派生の強制を外さない
  assert.equal(replace.derive52Forced.value, true,
    'thumbnail が他者のファイルを指す間は 512px 置換で 52px 派生を強制する');
  if (opts.deriveOff) replace.derive52Model.value = false;
  await replace.replaceThumbnail(kind);
  assert.equal(replace.thumbnailError.value, "", `置換が成功する（kind=${kind}）`);
  // 先に「データが壊れていないか」を見る（この smoke の主目的）
  await assertSourceUntouched(sourceUid, 'png');
  await assertOwnPair(doc);
  assert.deepEqual({ ...row(sourceUid) }, { ...sourceRowBefore }, '複製元の DB 行も変わらない');

  // 置換後の初回保存（複製先の新規作成）で、二重のファイルや参照の食い違いが起きない
  const saved = await Sqlite.saveUserBaseMap({
    uid: doc.uid,
    create: true,
    slug: doc.slug,
    tms: { kind: 'tms', thumbnail: doc.thumbnail } as any,
  });
  assert.equal(saved.thumbnail, doc.thumbnail, '初回保存は置換で書いた自分の uid 名を保持する');
  assert.equal(saved.revision, 1, '既に自分の uid 名なので保存時の付け替え（revision +1）は起きない');
  assert.equal(document(doc.uid).thumbnail, doc.thumbnail);
  await assertSourceUntouched(sourceUid, 'png');
  const files = (await fs.readdir(at('tmbs'))).sort();
  assert.deepEqual(files, [
    `${doc.uid}.png`,
    `${doc.uid}_512.webp`,
    `${sourceUid}.png`,
    `${sourceUid}_512.webp`,
  ].sort(), `tmbs/ に余分なファイル・二重のファイルを作らない（実測: ${JSON.stringify(files)}）`);
  return doc;
}

// 1) 52px 単独置換: 書き込み先は自分の uid、thumbnail も自分の uid へ。52/512 の対を壊さない。
await replaceCase('52');
console.log('ok: 複製直後の 52px 置換は複製元を書き換えず、自分の uid 名へ書く');

// 2) 512px 置換 + derive OFF: 他者の 52px を参照したまま自分の 512px だけ作る状態を許さない。
await replaceCase('512', { deriveOff: true });
console.log('ok: 複製直後の 512px 置換（derive OFF でも）は複製元を書き換えず、52px も自分の uid 名へ書く');

// 3) 置換ソースが jpg でも拡張子を引き継ぎ、512px の対を保つ。
{
  const sourceUid = randomUUID();
  const rel52 = await seedSource(sourceUid, 'jpg');
  const doc = duplicateDoc(rel52);
  const replace = replacerFor(doc);
  await replace.refreshThumbnails();
  await replace.replaceThumbnail('52');
  await assertSourceUntouched(sourceUid, 'jpg');
  await assertOwnPair(doc);
  assert.equal(doc.thumbnail, `tmbs/${doc.uid}.jpg`, '書き込み先の拡張子は thumbnail から引き継ぐ');
  console.log('ok: jpg の複製元でも拡張子を引き継いで自分の uid 名へ書く');
}

// 4) 自分の uid 名を指しているとき（規則 K1）は従来どおり。derive 強制も外れたまま。
{
  const uid = randomUUID();
  const rel52 = await seedSource(uid, 'png');
  const doc: Doc = { uid, slug: `issue192-own-${uid.slice(0, 8)}`, thumbnail: rel52 };
  const replace = replacerFor(doc);
  await replace.refreshThumbnails();
  assert.equal(replace.derive52Forced.value, false, '自分の uid 名かつ実体ありなら 52px 派生の強制は外れる');
  await replace.replaceThumbnail('52');
  assert.equal(doc.thumbnail, rel52, 'K1 では thumbnail を動かさない（同値ガード）');
  assert.notEqual(await fs.readFile(at(rel52), 'utf8'), SOURCE_52, 'K1 は従来どおり自分のファイルを置換する');
  assert.equal(await fs.readFile(at(thumb512PathFor(rel52)!), 'utf8'), SOURCE_512, 'K1 の 512px は触らない');
  console.log('ok: 自分の uid 名（K1）は従来どおり');
}

// 5) 同梱画像・URL・空は従来どおり自分の uid 名（規則 K2 / K0）。
for (const thumbnail of ['basemap_icons/osm.png', 'https://example.test/i.png', 'file:///tmp/i.png', '']) {
  const target = resolveBaseMapThumbnailWriteTarget({ thumbnail, ownKey: 'own-uid', slug: 'slug' });
  assert.deepEqual(target, { fileKey: 'own-uid', ext: 'png' }, `K2 の書き込み先（${thumbnail || '空'}）`);
  assert.equal(target?.copy512From, undefined, 'K2 では他者の 512px を引き継がない');
}
assert.equal(resolveBaseMapThumbnailWriteTarget({ thumbnail: '', ownKey: 'own-uid', slug: '' }), null,
  '規則 K0: slug 未入力なら書かない');
console.log('ok: 同梱画像・URL・空（K2/K0）と slug ガードは従来どおり');

console.log('issue-192 ALL PASS');
