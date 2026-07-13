// ImageAssetService (M9-T4) スモーク: Write Store 上の画像アセット domain layer。
// バイト実体は {saveFolder}/assets/{uid}.{ext} に置き、DB(assets テーブル)にはメタデータのみ持つ
// (ADR-0007 §7)。fixture は Jimp で実際に生成した小さな PNG を使う(サムネイル生成に使う
// 既存の画像処理依存を、デコード/メタデータ抽出にもそのまま流用する — 新規依存を足さない)。
// シナリオ:
//   (a) add: 実PNGをコピー → metadata(mime/width/height/ext) 正しい / assets/{uid}.{ext} に実体 /
//       title は string 入力でも内部形 {ja:...} (ADR-0005) / slug参照でも解決 (findAssetByRef)
//   (b) add: 既存slugへの add → Exist (アセットは作られない)
//   (c) add: 非画像ファイル(.txt) → Error{code:'invalid-request'} (slug/アセットとも消費されない) /
//       fs エラー(存在しないファイル) → 'not-found' (decode 失敗と誤診しない)
//   (d) list/search: metadata 行を返す(blob なし) / title・slug の部分一致でヒット
//   (e) rename: 既存slugへの改名 → Exist
//   (f) rename: stale expectedRevision → { error:'revision-conflict', current }
//   (g) rename: 正常系 → revision++ / registry 同期(旧slug解放・新slugで解決可能)
//   (h) getFilePath: 実在ファイルは file:// URL を返す
//   (i) delete: 本体・registry 掃除 / ファイルは削除でなく _trash へ退避 / 旧slugは再利用可能
//   (j) delete-race: rename の書込 (upsertAssetMeta) の直前に並行 delete (フックで注入、
//       事前チェックの順序に依らずガードを直撃) → 復活 (revision=1 再INSERT + registry slug 再占有)
//       せず Error{code:'not-found'}、slug は解放のまま (m9-t3 の l4 と同機構: upsertAssetRow の not-found ガード)
import { mkdtemp, rm, writeFile, mkdir, stat, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'image-asset-'));
const entryFile = path.join(workDir, 'image-asset-smoke.ts');
const electronStubFile = path.join(workDir, 'electron-stub.ts');
const electronStoreStubFile = path.join(workDir, 'electron-store-stub.ts');
const outDir = path.join(workDir, 'dist');
const bundledFile = path.join(outDir, 'image-asset-smoke.mjs');

try {
  const dataDir = path.join(workDir, 'data');
  const settingsPath = path.join(projectRoot, 'electron/services/SettingsService.ts');
  const sqlitePath = path.join(projectRoot, 'electron/services/SqliteDataService.ts');
  const servicePath = path.join(projectRoot, 'electron/services/ImageAssetService.ts');

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
      import { DatabaseSync } from 'node:sqlite';
      import { writeFile as fsWriteFile, mkdir as fsMkdir, stat as fsStat } from 'node:fs/promises';
      import nodePath from 'node:path';
      import { Jimp } from 'jimp';

      const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      const workDir = ${JSON.stringify(workDir)};
      const dataDir = ${JSON.stringify(dataDir)};

      // T4 legacy migration fixture: lang/source_name列がまだ無い既存assets表。
      const legacyDb = new DatabaseSync(nodePath.join(dataDir, 'maplat.sqlite'));
      legacyDb.exec(\`
        CREATE TABLE assets (
          uid TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, title_json TEXT NOT NULL,
          mime TEXT NOT NULL, ext TEXT NOT NULL, width INTEGER, height INTEGER,
          byte_size INTEGER NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
          updated_at TEXT DEFAULT (datetime('now'))
        );
        INSERT INTO assets (uid, slug, title_json, mime, ext, width, height, byte_size)
        VALUES ('22222222-2222-4222-8222-222222222222', 'legacy-language', '{"ja":"旧画像"}', 'image/png', 'png', 1, 1, 1);
      \`);
      legacyDb.close();

      const { default: SettingsService } = await import(${JSON.stringify(settingsPath)});
      SettingsService.set('saveFolder', dataDir);

      const { default: SqliteDataService } = await import(${JSON.stringify(sqlitePath)});
      const { default: imageAssetService, exceedsPixelLimit } = await import(${JSON.stringify(servicePath)});
      const migratedDb = await SqliteDataService.getDb();
      const rawMigratedLanguage = migratedDb.prepare('SELECT lang FROM assets WHERE slug = ?').get('legacy-language');
      assert.equal(rawMigratedLanguage.lang, 'ja', 'legacy langは表示時fallbackではなくDBへbackfillするはず');
      const migratedLanguageRow = await imageAssetService.get('legacy-language');
      assert.equal(migratedLanguageRow.lang, 'ja', 'lang列欠落の既存assetはjaへ一度だけ補完するはず');
      assert.equal(migratedLanguageRow.sourceName, null, '既存assetのsourceNameは推測せずnullのはず');

      // (a0) exceedsPixelLimit: 境界値 (10000x10000 = 100,000,000 はちょうど上限、超えない /
      // 10000x10001 は超える) — add の伸長爆弾ガードから切り出した純関数 (Phase 6 品質レビュー m9-t4 補強)
      assert.equal(exceedsPixelLimit(10000, 10000), false, '10000x10000 はちょうど上限で超過ではないはず');
      assert.equal(exceedsPixelLimit(10000, 10001), true, '10000x10001 は上限を超えるはず');
      console.log('ok: (a0) exceedsPixelLimit boundary (10000x10000=false, 10000x10001=true)');

      // --- fixtures: 実PNG(Jimpで生成) + 非画像テキストファイル ---
      const fixtureDir = nodePath.join(workDir, 'fixtures');
      await fsMkdir(fixtureDir, { recursive: true });
      const pngPath = nodePath.join(fixtureDir, 'source-image.png');
      const redImage = new Jimp({ width: 10, height: 6, color: 0xff0000ff });
      await redImage.write(pngPath as \`\${string}.png\`);
      const png2Path = nodePath.join(fixtureDir, 'source-image-2.png');
      const greenImage = new Jimp({ width: 4, height: 4, color: 0x00ff00ff });
      await greenImage.write(png2Path as \`\${string}.png\`);
      const txtPath = nodePath.join(fixtureDir, 'not-an-image.txt');
      await fsWriteFile(txtPath, 'this is not an image');

      // (t4) default language/sourceName/updateMetadata 契約。
      // sourceName は表示用basenameだけを保存し、絶対pathは既存どおりDBへ入れない。
      const languageAdded = await imageAssetService.add({
        slug: 'language-contract',
        title: { en: 'Language contract' },
        lang: 'en',
        sourceName: 'nested/source-image.png',
        sourcePath: pngPath,
      });
      assert.equal(languageAdded.result, 'Success', 'T4 language asset add は Success のはず: ' + JSON.stringify(languageAdded));
      const languageRow = await imageAssetService.get(languageAdded.uid);
      assert.equal(languageRow.lang, 'en', 'payloadのdefault languageを永続化するはず');
      assert.equal(languageRow.sourceName, 'source-image.png', 'sourceNameはbasenameだけを永続化するはず');
      assert.deepEqual(languageRow.title, { en: 'Language contract' });
      const languageUpdated = await imageAssetService.updateMetadata(languageAdded.uid, {
        slug: 'language-contract-updated',
        title: { en: 'Updated contract' },
        lang: 'en',
        expectedRevision: 1,
      });
      assert.equal(languageUpdated.result, 'Success');
      assert.equal(languageUpdated.revision, 2);
      const languageConflict = await imageAssetService.updateMetadata(languageAdded.uid, {
        slug: 'language-contract-stale',
        title: { en: 'Stale contract' },
        lang: 'en',
        expectedRevision: 1,
      });
      assert.deepEqual(languageConflict, { error: 'revision-conflict', current: 2 });
      const languageUpdatedRow = await imageAssetService.get(languageAdded.uid);
      assert.equal(languageUpdatedRow.sourceName, 'source-image.png', 'metadata更新でsourceNameを失わないはず');
      assert.equal(languageUpdatedRow.mime, 'image/png', 'metadata更新でbinary metadataを失わないはず');
      console.log('ok: (t4) language/sourceName/updateMetadata contract');

      // (a) add: metadata 正しい / 実体配置 / title 内部形 / slug参照でも解決
      const added = await imageAssetService.add({ slug: 'red-swatch', title: '赤色見本', sourcePath: pngPath });
      assert.equal(added.result, 'Success', 'add は Success を返すはず: ' + JSON.stringify(added));
      assert.match(added.uid, UUID_PATTERN);
      assert.equal(added.revision, 1);
      assert.equal(added.mime, 'image/png');
      assert.equal(added.ext, 'png');
      assert.equal(added.width, 10);
      assert.equal(added.height, 6);
      const uid = added.uid;

      const got = await imageAssetService.get(uid);
      assert.ok(got, 'get(uid) がアセットを返すはず');
      assert.equal(got.uid, uid);
      assert.equal(got.slug, 'red-swatch');
      assert.deepEqual(got.title, { ja: '赤色見本' }, 'title は string 入力でも内部形 {ja:...} になるはず (ADR-0005)');
      assert.equal(got.mime, 'image/png');
      assert.equal(got.ext, 'png');
      assert.equal(got.width, 10);
      assert.equal(got.height, 6);
      assert.ok(got.byteSize > 0, 'byteSize は実ファイルサイズを持つはず');
      assert.equal(got.revision, 1);
      assert.ok(typeof got.updatedAt === 'string' && got.updatedAt !== '', 'updatedAt を返すはず');

      const filePath = nodePath.join(dataDir, 'assets', uid + '.png');
      const fileStat = await fsStat(filePath);
      assert.ok(fileStat.isFile(), 'ファイルが assets/{uid}.png に存在するはず');
      assert.equal(fileStat.size, got.byteSize, 'byteSize は配置されたファイルの実サイズと一致するはず');

      const gotBySlug = await imageAssetService.get('red-swatch');
      assert.equal(gotBySlug.uid, uid, 'get は slug 参照でも解決するはず (findAssetByRef)');
      console.log('ok: (a) add copies bytes + records metadata (internal-form title)');

      // (b) add: 既存slugへの add → Exist
      const dupe = await imageAssetService.add({ slug: 'red-swatch', title: 'dup', sourcePath: pngPath });
      assert.equal(dupe.result, 'Exist', '既存 slug への add は Exist のはず');
      console.log('ok: (b) add rejects a taken slug');

      // (c) add: 非画像ファイル(.txt) → Error{code:'invalid-request'}。
      // fs エラーは decode 失敗と区別する: 存在しないファイルは invalid-request(恒久的な響き)ではなく
      // not-found を返すこと(EACCES/EBUSY 等の一時障害は同じ fs catch で internal へ落ちる設計)
      const rejected = await imageAssetService.add({ slug: 'not-image', title: 'bad', sourcePath: txtPath });
      assert.equal(rejected.result, 'Error', '非画像ファイルは Error のはず: ' + JSON.stringify(rejected));
      assert.equal(rejected.code, 'invalid-request', '非画像ファイルは invalid-request のはず');
      assert.equal(await SqliteDataService.findAssetBySlug('not-image'), null, '拒否された add でアセットは作られないはず');
      assert.equal(await SqliteDataService.isSlugAvailable('not-image'), true, '拒否された add で slug は消費されないはず');
      const missing = await imageAssetService.add({ slug: 'missing-image', title: 'x', sourcePath: nodePath.join(fixtureDir, 'no-such-file.png') });
      assert.equal(missing.result, 'Error', '存在しないファイルは Error のはず: ' + JSON.stringify(missing));
      assert.equal(missing.code, 'not-found', 'fs 読み取り失敗(ENOENT)は invalid-request でなく not-found のはず');
      assert.equal(await SqliteDataService.isSlugAvailable('missing-image'), true, '失敗した add で slug は消費されないはず');
      console.log('ok: (c) add rejects a non-image file; fs errors are not misdiagnosed as non-image');

      // (c2) add: 巨大ファイル(21MB, IMAGE_ASSET_MAX_BYTES=20MB超) → Jimp.read に到達させず
      // invalid-request/payload-too-large で拒否する。PNGヘッダ+ゼロ埋めのダミーバイトなので
      // デコードに到達すれば失敗するはず(=このバイト列は非画像扱いになる)だが、ガードは
      // decode 前に判定するため message は 'payload-too-large' になる(decode 失敗の汎用メッセージとは別)
      const hugePath = nodePath.join(fixtureDir, 'huge-image.png');
      const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const hugeBytes = Buffer.concat([pngSignature, Buffer.alloc(21 * 1024 * 1024 - pngSignature.length)]);
      await fsWriteFile(hugePath, hugeBytes);
      const hugeRejected = await imageAssetService.add({ slug: 'huge-image', title: 'huge', sourcePath: hugePath });
      assert.equal(hugeRejected.result, 'Error', '巨大ファイルは Error のはず: ' + JSON.stringify(hugeRejected));
      assert.equal(hugeRejected.code, 'invalid-request', '巨大ファイルは invalid-request のはず');
      assert.equal(hugeRejected.message, 'payload-too-large', 'サイズガードは Jimp.read の decode 失敗メッセージでなく payload-too-large を返すはず(decode に到達しない証跡)');
      assert.equal(await SqliteDataService.isSlugAvailable('huge-image'), true, '拒否された add で slug は消費されないはず');
      console.log('ok: (c2) add rejects an oversized file before decoding it');

      // 追加の2件目(list/search用)
      const added2 = await imageAssetService.add({ slug: 'green-swatch', title: '緑色見本', sourcePath: png2Path });
      assert.equal(added2.result, 'Success', '2件目の add も Success のはず: ' + JSON.stringify(added2));

      // (d) list/search: blob なし・title/slugでヒット
      const listed = await imageAssetService.list();
      assert.ok(listed.length >= 2, 'list は追加した2件を含むはず');
      const listedRow = listed.find((item: any) => item.uid === uid);
      assert.ok(listedRow, 'list に対象が含まれるはず');
      assert.deepEqual(listedRow.title, { ja: '赤色見本' });
      assert.ok(!('filePath' in listedRow) && !('bytes' in listedRow), 'list 行はファイル実体を含まないはず');

      const searchedByTitle = await imageAssetService.search('緑色');
      assert.equal(searchedByTitle.length, 1, 'title の部分一致でヒットするはず');
      assert.equal(searchedByTitle[0].uid, added2.uid);
      const searchedBySlug = await imageAssetService.search('red-swatch');
      assert.ok(searchedBySlug.some((item: any) => item.uid === uid), 'slug の部分一致でもヒットするはず');
      console.log('ok: (d) list/search surface metadata without bytes and hit by title/slug');

      // (e) rename: 既存slugへの改名 → Exist
      const collideRename = await imageAssetService.rename(uid, { slug: 'green-swatch', title: '赤色見本', expectedRevision: 1 });
      assert.equal(collideRename.result, 'Exist', '既存 slug への rename は Exist のはず');
      console.log('ok: (e) rename rejects a slug collision');

      // (f) rename: stale expectedRevision → revision-conflict
      const staleRename = await imageAssetService.rename(uid, { slug: 'red-swatch-renamed', title: '赤色見本', expectedRevision: 999 });
      assert.deepEqual(staleRename, { error: 'revision-conflict', current: 1 }, 'maps/apps/poi_sources と同じ revision-conflict 形のはず');
      console.log('ok: (f) rename detects a stale revision');

      // (g) rename: 正常系 → revision++ / registry 同期
      const renamed = await imageAssetService.rename(uid, { slug: 'crimson-swatch', title: '緋色見本', expectedRevision: 1 });
      assert.equal(renamed.result, 'Success', 'rename は Success のはず: ' + JSON.stringify(renamed));
      assert.equal(renamed.revision, 2, 'rename で revision++ のはず');
      const afterRename = await imageAssetService.get(uid);
      assert.equal(afterRename.slug, 'crimson-swatch');
      assert.deepEqual(afterRename.title, { ja: '緋色見本' });
      assert.equal(await SqliteDataService.isSlugAvailable('red-swatch'), true, '旧 slug は解放されるはず');
      const bySlugAfterRename = await imageAssetService.get('crimson-swatch');
      assert.equal(bySlugAfterRename.uid, uid, '新 slug で解決できるはず');
      console.log('ok: (g) rename bumps revision and syncs the registry');

      // (h) getFilePath: 実在ファイルは file:// URL
      const filePathResult = await imageAssetService.getFilePath(uid);
      assert.ok(typeof filePathResult === 'string' && filePathResult.startsWith('file://'), 'getFilePath は file:// URL を返すはず: ' + filePathResult);
      assert.ok(filePathResult.endsWith(uid + '.png'), 'getFilePath は {uid}.{ext} を指すはず');
      console.log('ok: (h) getFilePath resolves an existing file');

      // (i) delete: 本体・registry掃除 / ファイルは _trash へ退避 / slug 再利用可能
      const deleted = await imageAssetService.delete(uid);
      assert.equal(deleted.ok, true);
      assert.equal(await imageAssetService.get(uid), null, '削除後は get が null を返すはず');
      assert.equal(await SqliteDataService.isSlugAvailable('crimson-swatch'), true, 'delete で slug が解放されるはず');
      const trashPath = nodePath.join(dataDir, 'assets', '_trash', uid + '.png');
      const trashStat = await fsStat(trashPath);
      assert.ok(trashStat.isFile(), '削除されたファイルは物理削除でなく _trash に退避されるはず');
      assert.equal(await imageAssetService.getFilePath(uid), null, '削除後 getFilePath は null のはず');
      const reAdded = await imageAssetService.add({ slug: 'crimson-swatch', title: '再利用', sourcePath: pngPath });
      assert.equal(reAdded.result, 'Success', '解放された slug は再利用できるはず: ' + JSON.stringify(reAdded));
      console.log('ok: (i) delete moves the file to _trash and frees the slug');

      // (j) delete-race: rename の事前チェックが全て通過した後、書込の直前に並行 delete が挟まる
      // 状況を upsertAssetMeta 自体のフック(delete してから本来の書込へ委譲)で再現する —
      // 事前チェックの順序が将来変わっても、必ず upsertAssetRow の not-found ガードを直撃する。
      // 旧実装 (行不在時 INSERT) では削除済みアセットが revision=1 で復活し registry slug を
      // 再占有していた — ガードがそれを封鎖することを確認する
      const raceUid = reAdded.uid;
      const origUpsertAssetMeta = SqliteDataService.upsertAssetMeta.bind(SqliteDataService);
      (SqliteDataService as any).upsertAssetMeta = async (u: string, s: string, i: any, expectedRevision?: number) => {
        await imageAssetService.delete(raceUid);
        return origUpsertAssetMeta(u, s, i, expectedRevision);
      };
      let raceRename: any;
      try {
        raceRename = await imageAssetService.rename(raceUid, { slug: 'race-renamed', title: 'レース', expectedRevision: 1 });
      } finally {
        delete (SqliteDataService as any).upsertAssetMeta;
      }
      assert.equal(raceRename.result, 'Error', '並行 delete 後の rename は Error のはず: ' + JSON.stringify(raceRename));
      assert.equal(raceRename.code, 'not-found', '並行 delete は code not-found のはず');
      assert.equal(await SqliteDataService.findAsset(raceUid), null, '削除済みアセットが復活しないはず');
      assert.equal(await SqliteDataService.isSlugAvailable('race-renamed'), true, '改名先 slug が registry を再占有しないはず');
      assert.equal(await SqliteDataService.isSlugAvailable('crimson-swatch'), true, '旧 slug も解放のままのはず');
      console.log('ok: (j) delete during rename does not resurrect the asset');

      // (k) findAssetReferences/findReferences: icon 参照・image 配列内参照の poi_source を拾う。
      // 無関係な poi_source は拾わない。UUID 形でない ref は空配列(LIKE メタ文字混入ガード)
      const refAsset = await imageAssetService.add({ slug: 'pin-icon', title: 'ピン', sourcePath: png2Path });
      assert.equal(refAsset.result, 'Success');
      const refUid = refAsset.uid;

      const fcWithIcon = {
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', properties: { icon: refUid }, geometry: { type: 'Point', coordinates: [0, 0] } },
        ],
      };
      const { uid: poiWithIconUid } = await SqliteDataService.createPoiSource('poi-with-icon-ref', {
        title: { ja: 'アイコン参照あり' },
        mode: 'local',
        dataJson: JSON.stringify(fcWithIcon),
        featureCount: 1,
      });

      const fcWithImage = {
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', properties: { images: [refUid] }, geometry: { type: 'Point', coordinates: [0, 0] } },
        ],
      };
      const { uid: poiWithImageUid } = await SqliteDataService.createPoiSource('poi-with-image-ref', {
        title: { ja: '画像参照あり' },
        mode: 'local',
        dataJson: JSON.stringify(fcWithImage),
        featureCount: 1,
      });

      const fcUnrelated = {
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', properties: { icon: 'builtin:defaultpin' }, geometry: { type: 'Point', coordinates: [0, 0] } },
        ],
      };
      await SqliteDataService.createPoiSource('poi-unrelated', {
        title: { ja: '無関係' },
        mode: 'local',
        dataJson: JSON.stringify(fcUnrelated),
        featureCount: 1,
      });

      const refs = await SqliteDataService.findAssetReferences(refUid);
      const refUids = refs.poiSources.map((r) => r.uid).sort();
      assert.deepEqual(refUids, [poiWithIconUid, poiWithImageUid].sort(), 'icon 参照・image 配列内参照の両方を拾い、無関係な poi_source は拾わないはず: ' + JSON.stringify(refs));
      const iconRefRow = refs.poiSources.find((r) => r.uid === poiWithIconUid);
      assert.equal(iconRefRow.slug, 'poi-with-icon-ref');
      assert.deepEqual(iconRefRow.title, { ja: 'アイコン参照あり' });
      console.log('ok: (k1) findAssetReferences finds icon and image-array references, not unrelated sources');

      const nonUuidRefs = await SqliteDataService.findAssetReferences('not-a-uuid');
      assert.deepEqual(nonUuidRefs, { poiSources: [] }, 'UUID 形でない ref は空配列のはず(LIKE メタ文字混入ガード)');
      console.log('ok: (k2) findAssetReferences returns empty for a non-UUID-shaped ref');

      // findReferences (service層): uid-or-slug 参照を解決してから同じ走査をする
      const viaService = await imageAssetService.findReferences('pin-icon');
      assert.deepEqual(viaService.poiSources.map((r) => r.uid).sort(), [poiWithIconUid, poiWithImageUid].sort(), 'imageAssetService.findReferences は slug 参照でも解決するはず');
      const viaServiceMissing = await imageAssetService.findReferences('no-such-slug');
      assert.deepEqual(viaServiceMissing, { poiSources: [] }, '存在しないアセットへの findReferences は空のはず');
      console.log('ok: (k3) imageAssetService.findReferences resolves uid-or-slug and returns empty for a missing asset');

      console.log('M9-T4 image asset smoke passed');
      process.exit(0);
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
          entryFileNames: 'image-asset-smoke.mjs',
          format: 'es',
        },
      },
    },
  });

  await execFileAsync(process.execPath, [bundledFile], {
    cwd: projectRoot,
    timeout: 120000,
    maxBuffer: 1024 * 1024 * 8,
  });

  // ソースパターン断言: add が exceedsPixelLimit を呼ぶ形にリファクタされているはず
  // (ロジックの重複復活・呼び出し漏れの防止。Phase 6 品質レビュー m9-t4 補強)
  const serviceSource = await readFile(servicePath, 'utf8');
  assert.match(
    serviceSource,
    /export function exceedsPixelLimit\(width: number, height: number\): boolean/,
    'ImageAssetService.ts に exceedsPixelLimit の export がない'
  );
  assert.match(
    serviceSource,
    /if \(exceedsPixelLimit\(meta\.width, meta\.height\)\)/,
    'ImageAssetService.add が exceedsPixelLimit を呼んでいない'
  );

  console.log('M9-T4 image asset smoke passed');
} finally {
  await rm(workDir, { recursive: true, force: true });
}
