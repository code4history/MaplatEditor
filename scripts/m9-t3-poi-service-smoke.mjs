// PoiSourceService v2 (M9-T3) スモーク: Write Store 上の POI ソース domain layer。
// electron-store + poi-sources/ ファイル実装のゼロベース置換を検証する。
// registerRemote/refreshRemote は使い捨てローカル HTTP サーバ (node:http, 127.0.0.1 ephemeral port)
// で fixture GeoJSON を配信して検証する (確立済み手法)。
// シナリオ:
//   (a) createLocal → get: 空FC / title は string 入力でも内部形 {ja:...} / revision=1 / slug参照でも解決
//   (b) save: level='error' issue (name欠落) で保存拒否 (result:'Invalid' + issues)、revision不変
//   (c) save 正常系: revision++ / feature_count更新 / 表示ID・_maplatUid 採番 / title内部形
//   (d) save stale expectedRevision → { error:'revision-conflict', current } (maps/apps と同形)
//   (e) importFile: GeoJSON FeatureCollection (.geojson)
//   (f) importFile: 旧POIオブジェクト形式 (.json 配列, lat/lng・lnglat) → 正規化して取込
//   (g) importFile: Point以外を含む → 取込拒否 (POI-104)、ソースは作られない
//   (h) registerRemote: fetch成功時のみ登録、snapshot が DB に永続 (mode='remote')
//   (i) remote ソースへの save は拒否 (read-only)
//   (j) refreshRemote: サーバ内容変更 → snapshot更新 + revision++ (POI-118)
//   (k) refreshRemote: fetch失敗 → Error、既存 snapshot は無傷 (degraded cache)
//   (l) POI-121 閾値: warn超え → warning issue付きで登録 / max超え → 登録拒否
//   (l2) Error taxonomy: HTTP 非2xx → code 'http-status' / 非JSON応答 → code 'parse'
//   (l3) chunked 応答 (content-length なし) が閾値超過 → stream 読みを abort し登録拒否
//   (l4) delete-race: refreshRemote の fetch 中に並行 delete → 復活せず Error code 'not-found'、slug は解放のまま
//   (m) cloneToLocal: remote → local 複製 (features維持、複製先は保存可能)
//   (n) findReferences → [] (Phase 7 まで参照は書かれない)
//   (o) delete: 本体・registry掃除 (slug解放)
//   (p) 旧 poi-sources.json / poi-sources/ ディレクトリは読みも消しもしない (無傷)
//   (q) list: uid/slug/title/mode/featureCount/revision/updatedAt を返し blob を含まない / query=FTS
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'poi-service-'));
const entryFile = path.join(workDir, 'poi-service-smoke.ts');
const electronStubFile = path.join(workDir, 'electron-stub.ts');
const electronStoreStubFile = path.join(workDir, 'electron-store-stub.ts');
const outDir = path.join(workDir, 'dist');
const bundledFile = path.join(outDir, 'poi-service-smoke.mjs');

try {
  const dataDir = path.join(workDir, 'data');
  const settingsPath = path.join(projectRoot, 'electron/services/SettingsService.ts');
  const sqlitePath = path.join(projectRoot, 'electron/services/SqliteDataService.ts');
  const servicePath = path.join(projectRoot, 'electron/services/PoiSourceService.ts');
  const packageServicePath = path.join(projectRoot, 'electron/services/PoiPackageService.ts');

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
      import { createServer } from 'node:http';
      import { readFile as fsReadFile, writeFile as fsWriteFile, mkdir as fsMkdir } from 'node:fs/promises';
      import nodePath from 'node:path';

      const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      const workDir = ${JSON.stringify(workDir)};

      const { default: SettingsService } = await import(${JSON.stringify(settingsPath)});
      SettingsService.set('saveFolder', ${JSON.stringify(dataDir)});

      const { default: SqliteDataService } = await import(${JSON.stringify(sqlitePath)});
      const { default: poiSourceService, PoiSourceService } = await import(${JSON.stringify(servicePath)});
      await SqliteDataService.getDb();

      // (p) 事前に旧実装のファイルを置いておく → 全操作後に無傷であること
      const legacyStoreFile = nodePath.join(workDir, 'poi-sources.json');
      const legacyDir = nodePath.join(workDir, 'poi-sources', 'deadbeef-dead-4bad-8bad-badbadbadbad');
      const legacyGeojsonFile = nodePath.join(legacyDir, 'source.geojson');
      const legacyStoreContent = JSON.stringify({ poiSources: { index: [{ sourceId: 'legacy', title: 'legacy' }] } });
      const legacyGeojsonContent = JSON.stringify({ type: 'FeatureCollection', features: [] });
      await fsMkdir(legacyDir, { recursive: true });
      await fsWriteFile(legacyStoreFile, legacyStoreContent);
      await fsWriteFile(legacyGeojsonFile, legacyGeojsonContent);

      // (a) createLocal → get
      const created = await poiSourceService.createLocal({ slug: 'kyoto-poi', title: '京都POI', lang: 'ja' });
      assert.equal(created.result, 'Success', 'createLocal は Success を返すはず: ' + JSON.stringify(created));
      assert.match(created.uid, UUID_PATTERN);
      assert.equal(created.revision, 1);
      const uid = created.uid;
      const got = await poiSourceService.get(uid);
      assert.ok(got, 'get(uid) がソースを返すはず');
      assert.equal(got.uid, uid);
      assert.equal(got.slug, 'kyoto-poi');
      assert.deepEqual(got.title, { ja: '京都POI' }, 'title は string 入力でも内部形 {ja:...} になるはず (ADR-0005)');
      assert.equal(got.mode, 'local');
      assert.equal(got.readOnly, false);
      assert.equal(got.featureCount, 0);
      assert.equal(got.revision, 1);
      assert.ok(typeof got.updatedAt === 'string' && got.updatedAt !== '', 'updatedAt を返すはず');
      assert.equal(got.lang, 'ja', '未指定の既定言語は設定/UI言語へ固定されるはず');
      assert.deepEqual(got.fc, { type: 'FeatureCollection', lang: 'ja', features: [] }, 'lang付き空FCで作成されるはず');
      // slug 参照でも解決 (findPoiSourceByRef)
      const gotBySlug = await poiSourceService.get('kyoto-poi');
      assert.equal(gotBySlug.uid, uid, 'get は slug 参照でも解決するはず');
      console.log('ok: (a) createLocal → get (empty FC, internal-form title)');

      // (b) save: name 欠落 (level=error) で保存拒否
      const badSave = await poiSourceService.save(uid, {
        slug: 'kyoto-poi',
        title: '京都POI',
        fc: {
          type: 'FeatureCollection',
          features: [
            { type: 'Feature', id: 'p1', geometry: { type: 'Point', coordinates: [135.7, 35.0] }, properties: {} },
          ],
        },
      });
      assert.equal(badSave.result, 'Invalid', '検証エラー時は保存拒否 (Invalid) のはず');
      assert.ok(badSave.issues.some((i: any) => i.level === 'error' && i.code === 'name-required'), 'name-required issue を返すはず');
      const afterBadSave = await poiSourceService.get(uid);
      assert.equal(afterBadSave.revision, 1, '拒否された保存で revision が変わらないはず');
      assert.equal(afterBadSave.featureCount, 0, '拒否された保存で内容が変わらないはず');
      console.log('ok: (b) save rejected on validation error');

      // (c) save 正常系: revision++ / feature_count / 表示ID・_maplatUid 採番 / title 内部形
      const goodSave = await poiSourceService.save(uid, {
        slug: 'kyoto-poi',
        title: '京都POI',
        fc: {
          type: 'FeatureCollection',
          features: [
            { type: 'Feature', id: 'kinkakuji', geometry: { type: 'Point', coordinates: [135.729, 35.039] },
              properties: { _maplatUid: '11111111-1111-4111-8111-111111111111', name: { ja: '金閣寺' } } },
            // 表示ID・_maplatUid 無し → 採番されるはず
            { type: 'Feature', geometry: { type: 'Point', coordinates: [135.798, 35.027] },
              properties: { name: '銀閣寺' } },
          ],
        },
        expectedRevision: 1,
      });
      assert.equal(goodSave.result, 'Success', 'save は Success を返すはず: ' + JSON.stringify(goodSave));
      assert.equal(goodSave.revision, 2, 'save で revision++ のはず');
      const afterSave = await poiSourceService.get(uid);
      assert.equal(afterSave.featureCount, 2, 'feature_count が更新されるはず');
      assert.deepEqual(afterSave.title, { ja: '京都POI' }, 'save 経路でも title は内部形のはず');
      const savedFeatures = afterSave.fc.features;
      assert.equal(savedFeatures[0].id, 'kinkakuji');
      assert.equal(savedFeatures[0].properties._maplatUid, '11111111-1111-4111-8111-111111111111', '既存 _maplatUid は維持されるはず');
      assert.ok(typeof savedFeatures[1].id === 'string' && savedFeatures[1].id !== '', '欠落表示IDは採番されるはず');
      assert.match(savedFeatures[1].properties._maplatUid, UUID_PATTERN, '_maplatUid が採番されるはず');
      assert.deepEqual(savedFeatures[1].properties.name, { ja: '銀閣寺' }, 'feature の name も内部形へ正規化されるはず');
      console.log('ok: (c) valid save bumps revision + ensures ids/uids');

      // (d) stale expectedRevision → revision-conflict
      const conflict = await poiSourceService.save(uid, {
        slug: 'kyoto-poi',
        title: '京都POI',
        fc: afterSave.fc,
        expectedRevision: 1,
      });
      assert.deepEqual(conflict, { error: 'revision-conflict', current: 2 }, 'maps/apps と同じ revision-conflict 形のはず');
      console.log('ok: (d) stale expectedRevision → revision-conflict');

      // (e) importFile: GeoJSON FeatureCollection (.geojson)
      const importFcFile = nodePath.join(workDir, 'import-fc.geojson');
      await fsWriteFile(importFcFile, JSON.stringify({
        type: 'FeatureCollection',
        lang: 'en-US',
        features: [
          { type: 'Feature', geometry: { type: 'Point', coordinates: [139.7, 35.68] }, properties: { name: '東京駅' } },
          { type: 'Feature', id: 'osaka', geometry: { type: 'Point', coordinates: [135.5, 34.7] }, properties: { name: { ja: '大阪駅', en: 'Osaka Sta.' } } },
        ],
      }));
      const imported = await poiSourceService.importFile({ slug: 'stations', title: '駅', filePath: importFcFile });
      assert.equal(imported.result, 'Success', 'GeoJSON import は Success のはず: ' + JSON.stringify(imported));
      const importedDoc = await poiSourceService.get(imported.uid);
      assert.equal(importedDoc.featureCount, 2);
      assert.equal(importedDoc.lang, 'en', 'top-level lang がPOI既定言語になるはず');
      assert.deepEqual(importedDoc.title, { en: '駅' }, 'import title はPOI既定言語で内部形化されるはず');
      assert.deepEqual(importedDoc.fc.features[0].properties.name, { en: '東京駅' });
      assert.ok(importedDoc.fc.features.every((f: any) => typeof f.id === 'string' && f.id !== ''), '表示IDが採番されるはず');
      assert.ok(importedDoc.fc.features.every((f: any) => UUID_PATTERN.test(f.properties._maplatUid)), '_maplatUid が採番されるはず');
      assert.deepEqual(importedDoc.fc.features[1].properties.name, { ja: '大阪駅', en: 'Osaka Sta.' });
      console.log('ok: (e) importFile GeoJSON FeatureCollection');

      // (f) importFile: 旧POIオブジェクト形式 (.json 配列)
      const importLegacyFile = nodePath.join(workDir, 'import-legacy.json');
      await fsWriteFile(importLegacyFile, JSON.stringify([
        { lat: 35.039, lng: 135.729, name: '金閣寺', image: 'kinkakuji.jpg' },
        { lnglat: [135.798, 35.027], name: '銀閣寺', url: 'https://example.com/ginkakuji' },
      ]));
      const importedLegacy = await poiSourceService.importFile({ slug: 'legacy-pois', title: '旧形式POI', filePath: importLegacyFile });
      assert.equal(importedLegacy.result, 'Success', '旧POI形式 import は Success のはず: ' + JSON.stringify(importedLegacy));
      const legacyDoc = await poiSourceService.get(importedLegacy.uid);
      assert.equal(legacyDoc.lang, 'en', 'lang無し外部GeoJSONはテスト環境UI言語を固定するはず');
      assert.equal(legacyDoc.featureCount, 2);
      assert.deepEqual(legacyDoc.fc.features[0].geometry, { type: 'Point', coordinates: [135.729, 35.039] }, 'lat/lng が正規化されるはず');
      assert.deepEqual(legacyDoc.fc.features[1].geometry, { type: 'Point', coordinates: [135.798, 35.027] }, 'lnglat が正規化されるはず');
      assert.deepEqual(legacyDoc.fc.features[0].properties.name, { en: '金閣寺' });
      assert.equal(legacyDoc.fc.features[0].properties.image, 'kinkakuji.jpg', 'image は透過されるはず');
      console.log('ok: (f) importFile legacy POI list');

      // (f2) importFile: 旧POIオブジェクト形式で whitelist 外キー(実データ実在例 start・selectedIcon)が
      //      save 後も保持される (M3-T5 AC5-1/5-2)
      const importLegacyUnknownFile = nodePath.join(workDir, 'import-legacy-unknown.json');
      await fsWriteFile(importLegacyUnknownFile, JSON.stringify([
        { lat: 39.703, lng: 141.153, name: '御堂', selectedIcon: 'builtin:temple-selected', start: 1599 },
      ]));
      const importedLegacyUnknown = await poiSourceService.importFile({
        slug: 'legacy-unknown-keys', title: '旧形式POI(未知キー)', filePath: importLegacyUnknownFile,
      });
      assert.equal(importedLegacyUnknown.result, 'Success', '旧POI未知キー import は Success のはず: ' + JSON.stringify(importedLegacyUnknown));
      const legacyUnknownDoc = await poiSourceService.get(importedLegacyUnknown.uid);
      assert.equal(legacyUnknownDoc.fc.features[0].properties.selectedIcon, 'builtin:temple-selected', 'selectedIcon が import 後も保持されるはず (M3-T5)');
      assert.equal(legacyUnknownDoc.fc.features[0].properties.start, 1599, '実データ実在キー start が import 後も保持されるはず (maps morioka_ndl 相当, M3-T5)');
      assert.ok(!('lat' in legacyUnknownDoc.fc.features[0].properties), 'lat は properties に残置されないはず');
      assert.ok(!('lng' in legacyUnknownDoc.fc.features[0].properties), 'lng は properties に残置されないはず');
      console.log('ok: (f2) importFile legacy POI preserves whitelist-external keys through get (M3-T5)');

      // (f3) feature 単位の未知 properties が save→get で round-trip する (M3-T5 AC5-4, §3.5 テストカバレッジの穴(a)の解消)
      const unknownPropsSave = await poiSourceService.save(legacyUnknownDoc.uid, {
        slug: legacyUnknownDoc.slug,
        title: legacyUnknownDoc.title,
        fc: legacyUnknownDoc.fc,
        expectedRevision: legacyUnknownDoc.revision,
      });
      assert.equal(unknownPropsSave.result, 'Success', '未知キー入り feature の再save は成功するはず: ' + JSON.stringify(unknownPropsSave));
      const afterUnknownPropsSave = await poiSourceService.get(legacyUnknownDoc.uid);
      assert.equal(afterUnknownPropsSave.fc.features[0].properties.start, 1599, 'feature 単位の未知 properties は save→get で round-trip するはず (M3-T5)');
      console.log('ok: (f3) feature-level unknown properties round-trip through save→get (M3-T5)');

      // (g) importFile: Point以外を含む → 取込拒否 (POI-104)
      const importBadFile = nodePath.join(workDir, 'import-bad.geojson');
      await fsWriteFile(importBadFile, JSON.stringify({
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { name: 'ok' } },
          { type: 'Feature', geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] }, properties: { name: 'line' } },
        ],
      }));
      const importRejected = await poiSourceService.importFile({ slug: 'bad-import', title: 'bad', filePath: importBadFile });
      assert.equal(importRejected.result, 'Invalid', 'Point以外を含む import は拒否のはず');
      assert.ok(importRejected.issues.some((i: any) => i.code === 'geometry-not-point'), 'geometry-not-point issue を返すはず');
      assert.equal(await SqliteDataService.findPoiSourceBySlug('bad-import'), null, '拒否された import でソースは作られないはず');
      assert.equal(await SqliteDataService.isSlugAvailable('bad-import'), true, '拒否された import で slug は消費されないはず');
      console.log('ok: (g) importFile rejects non-Point (POI-104)');

      // (g2) portable ZIP: 規定配置を取り込み、画像pathを永続Asset UIDへ戻す。
      const AdmZip = (await import('adm-zip')).default;
      const packageFile = nodePath.join(workDir, 'portable-poi.zip');
      const packageZip = new AdmZip();
      const packageImage = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64'
      );
      packageZip.addFile('imgs/portable-photo.png', packageImage);
      packageZip.addFile('pois/portable.geojson', Buffer.from(JSON.stringify({
        type: 'FeatureCollection', id: 'portable', features: [{
          type: 'Feature', id: 'portable-1',
          geometry: { type: 'Point', coordinates: [135.0, 35.0] },
          properties: { name: 'Portable', image: { src: 'imgs/portable-photo.png', desc: 'photo' } },
        }],
      })));
      packageZip.writeZip(packageFile);
      const importedPackage = await poiSourceService.importFile({
        slug: 'portable-import', title: 'Portable import', filePath: packageFile,
      });
      assert.equal(importedPackage.result, 'Success', 'portable ZIP import should succeed: ' + JSON.stringify(importedPackage));
      const importedPackageDoc = await poiSourceService.get(importedPackage.uid);
      const importedImageUid = importedPackageDoc.fc.features[0].properties.image.src;
      assert.match(importedImageUid, UUID_PATTERN, 'package image path must become an Asset UID');
      const importedAsset = await SqliteDataService.findAsset(importedImageUid);
      assert.equal(importedAsset.slug, 'portable-photo');

      const { inspectPoiExport, writePoiExport } = await import(${JSON.stringify(packageServicePath)});
      const exportedPackageFc = await poiSourceService.exportForm(importedPackage.uid);
      const packageInspection = await inspectPoiExport(exportedPackageFc);
      assert.equal(packageInspection.kind, 'zip', 'asset reference must select ZIP automatically');
      const roundTripZipPath = nodePath.join(workDir, 'portable-roundtrip.zip');
      await writePoiExport(packageInspection, roundTripZipPath);
      const roundTripZip = new AdmZip(roundTripZipPath);
      assert.deepEqual(
        roundTripZip.getEntries().map((entry: any) => entry.entryName).sort(),
        ['imgs/portable-photo.png', 'pois/portable-import.geojson'],
      );

      const invalidPackageFile = nodePath.join(workDir, 'portable-invalid.zip');
      const invalidPackageZip = new AdmZip();
      invalidPackageZip.addFile('imgs/cleanup-photo.png', packageImage);
      invalidPackageZip.addFile('pois/invalid.geojson', Buffer.from(JSON.stringify({
        type: 'FeatureCollection', features: [{
          type: 'Feature', id: 'bad', geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
          properties: { name: 'Bad', image: 'imgs/cleanup-photo.png' },
        }],
      })));
      invalidPackageZip.writeZip(invalidPackageFile);
      const invalidPackage = await poiSourceService.importFile({
        slug: 'portable-invalid', title: 'invalid', filePath: invalidPackageFile,
      });
      assert.equal(invalidPackage.result, 'Invalid');
      assert.equal(await SqliteDataService.findAssetBySlug('cleanup-photo'), null,
        'failed ZIP import must remove image asset registry rows');
      console.log('ok: (g2) portable ZIP import/export resolves image assets');

      // --- 使い捨てローカル HTTP サーバ (registerRemote / refreshRemote 用) ---
      let remotePayload = JSON.stringify({
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', id: 'r1', geometry: { type: 'Point', coordinates: [141.35, 43.06] }, properties: { name: '時計台' } },
        ],
      });
      const server = createServer((req, res) => {
        res.setHeader('content-type', 'application/json');
        res.setHeader('content-language', 'en-US');
        res.end(remotePayload);
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
      const port = (server.address() as any).port;
      const remoteUrl = 'http://127.0.0.1:' + port + '/poi.geojson';

      // (h) registerRemote: 成功時のみ登録、snapshot 永続
      const badScheme = await poiSourceService.registerRemote({ slug: 'bad-scheme', title: 'x', url: 'ftp://example.com/poi.geojson' });
      assert.equal(badScheme.result, 'Invalid', 'http/https 以外の scheme は拒否のはず');
      const registered = await poiSourceService.registerRemote({ slug: 'sapporo-remote', title: '札幌リモート', url: remoteUrl });
      assert.equal(registered.result, 'Success', 'registerRemote は Success のはず: ' + JSON.stringify(registered));
      const remoteDoc = await poiSourceService.get(registered.uid);
      assert.equal(remoteDoc.mode, 'remote');
      assert.equal(remoteDoc.url, remoteUrl);
      assert.equal(remoteDoc.readOnly, true, 'remote は read-only のはず');
      assert.equal(remoteDoc.lang, 'en', 'top-level lang欠落時はContent-Languageを採用するはず');
      assert.deepEqual(remoteDoc.title, { en: '札幌リモート' }, 'registerRemote titleはsource既定言語で内部形化されるはず');
      assert.equal(remoteDoc.featureCount, 1);
      assert.deepEqual(remoteDoc.fc.features[0].properties.name, { en: '時計台' }, 'fetch snapshot がsource既定言語の内部形で永続するはず');
      // 登録失敗 (unreachable) では登録しない。Error は機械可読 code を持つ
      const unreachable = await poiSourceService.registerRemote({ slug: 'unreachable-remote', title: 'x', url: 'http://127.0.0.1:1/nope.geojson' });
      assert.equal(unreachable.result, 'Error', 'fetch 失敗時は登録しないはず');
      assert.equal(unreachable.code, 'network', '到達不能は code network のはず');
      assert.equal(await SqliteDataService.findPoiSourceBySlug('unreachable-remote'), null);
      console.log('ok: (h) registerRemote persists fetched snapshot');

      // (i) remote への save は拒否
      const remoteSave = await poiSourceService.save(registered.uid, {
        slug: 'sapporo-remote', title: 'x', fc: remoteDoc.fc,
      });
      assert.equal(remoteSave.result, 'ReadOnly', 'remote ソースへの save は拒否のはず');
      assert.equal((await poiSourceService.get(registered.uid)).revision, remoteDoc.revision, 'remote save 拒否で revision 不変のはず');
      console.log('ok: (i) remote source rejects save (read-only)');

      // (j) refreshRemote: サーバ内容変更 → snapshot 更新 (POI-118)
      remotePayload = JSON.stringify({
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', id: 'r1', geometry: { type: 'Point', coordinates: [141.35, 43.06] }, properties: { name: '時計台' } },
          { type: 'Feature', id: 'r2', geometry: { type: 'Point', coordinates: [141.34, 43.05] }, properties: { name: '旧道庁' } },
        ],
      });
      const refreshed = await poiSourceService.refreshRemote(registered.uid);
      assert.equal(refreshed.result, 'Success', 'refreshRemote は Success のはず: ' + JSON.stringify(refreshed));
      const refreshedDoc = await poiSourceService.get(registered.uid);
      assert.equal(refreshedDoc.featureCount, 2, 'snapshot が更新されるはず');
      assert.ok(refreshedDoc.revision > remoteDoc.revision, 'refresh で revision が上がるはず');
      assert.deepEqual(refreshedDoc.fc.features[1].properties.name, { en: '旧道庁' });
      console.log('ok: (j) refreshRemote updates snapshot');

      // (k) refreshRemote 失敗 → Error、snapshot 無傷 (degraded cache)
      server.close();
      await new Promise((resolve) => server.on('close', resolve));
      const refreshFail = await poiSourceService.refreshRemote(registered.uid);
      assert.equal(refreshFail.result, 'Error', 'fetch 失敗時は Error のはず');
      assert.equal(refreshFail.code, 'network', 'fetch 失敗は code network のはず');
      const afterFail = await poiSourceService.get(registered.uid);
      assert.equal(afterFail.featureCount, 2, 'fetch 失敗時は snapshot が無傷のはず');
      assert.equal(afterFail.revision, refreshedDoc.revision, 'fetch 失敗時は revision 不変のはず');
      console.log('ok: (k) refreshRemote failure keeps cached snapshot');

      // (l) POI-121 サイズ閾値 (テスト用に閾値を注入した service インスタンスで検証)
      let payload2 = JSON.stringify({
        type: 'FeatureCollection',
        features: [{ type: 'Feature', id: 'big1', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { name: 'big' } }],
      });
      const server2 = createServer((req, res) => {
        if (req.url === '/404') {
          res.statusCode = 404;
          res.end('not here');
          return;
        }
        if (req.url === '/bad.json') {
          res.setHeader('content-type', 'application/json');
          res.end('this is not json');
          return;
        }
        res.setHeader('content-type', 'application/json');
        res.end(payload2);
      });
      await new Promise<void>((resolve) => server2.listen(0, '127.0.0.1', () => resolve()));
      const port2 = (server2.address() as any).port;
      const url2 = 'http://127.0.0.1:' + port2 + '/big.geojson';
      const warnService = new PoiSourceService({ remoteWarnBytes: 10, remoteMaxBytes: 1024 * 1024 });
      const warned = await warnService.registerRemote({ slug: 'warned-remote', title: 'warn', url: url2 });
      assert.equal(warned.result, 'Success', 'warn 閾値超えでも登録は成功するはず');
      assert.ok(warned.issues.some((i: any) => i.level === 'warning' && i.code === 'scale-byte-size'), 'warn 閾値超えで warning issue が付くはず');
      const maxService = new PoiSourceService({ remoteWarnBytes: 10, remoteMaxBytes: 20 });
      const tooLarge = await maxService.registerRemote({ slug: 'too-large-remote', title: 'max', url: url2 });
      assert.equal(tooLarge.result, 'Invalid', 'max 閾値超えは登録拒否のはず');
      assert.ok(tooLarge.issues.some((i: any) => i.level === 'error' && i.code === 'payload-too-large'), 'payload-too-large issue を返すはず');
      assert.equal(await SqliteDataService.findPoiSourceBySlug('too-large-remote'), null, '拒否された remote は登録されないはず');
      console.log('ok: (l) POI-121 remote payload thresholds');

      // (l2) Error taxonomy: http-status / parse
      const httpStatus = await poiSourceService.registerRemote({
        slug: 'status-remote', title: 'x', url: 'http://127.0.0.1:' + port2 + '/404',
      });
      assert.equal(httpStatus.result, 'Error', 'HTTP 非2xx は Error のはず');
      assert.equal(httpStatus.code, 'http-status', 'HTTP 非2xx は code http-status のはず');
      assert.equal(await SqliteDataService.findPoiSourceBySlug('status-remote'), null);
      const parseFail = await poiSourceService.registerRemote({
        slug: 'parse-remote', title: 'x', url: 'http://127.0.0.1:' + port2 + '/bad.json',
      });
      assert.equal(parseFail.result, 'Error', '非JSON応答は Error のはず');
      assert.equal(parseFail.code, 'parse', '非JSON応答は code parse のはず');
      assert.equal(await SqliteDataService.findPoiSourceBySlug('parse-remote'), null);
      server2.close();
      console.log('ok: (l2) error taxonomy (http-status / parse)');

      // (l3) chunked 応答 (content-length なし) の閾値超過 → stream 読みを abort し登録拒否。
      // content-length 事前チェックでは捕捉できない経路の検証
      let chunkedFinished = false;
      const chunkServer = createServer((req, res) => {
        res.setHeader('content-type', 'application/json');
        let count = 0;
        const timer = setInterval(() => {
          count += 1;
          res.write('0123456789'); // 10 bytes/chunk、閾値 20 bytes 超過で client abort が起きるはず
          if (count >= 50) {
            clearInterval(timer);
            chunkedFinished = true;
            res.end();
          }
        }, 5);
        res.on('close', () => clearInterval(timer));
      });
      await new Promise<void>((resolve) => chunkServer.listen(0, '127.0.0.1', () => resolve()));
      const chunkPort = (chunkServer.address() as any).port;
      const chunkedReject = await maxService.registerRemote({
        slug: 'chunked-remote', title: 'chunk', url: 'http://127.0.0.1:' + chunkPort + '/drip.geojson',
      });
      assert.equal(chunkedReject.result, 'Invalid', 'chunked 閾値超過は登録拒否のはず');
      assert.ok(chunkedReject.issues.some((i: any) => i.level === 'error' && i.code === 'payload-too-large'), 'payload-too-large issue を返すはず');
      assert.equal(chunkedFinished, false, '全チャンク送信完了前に abort されるはず (全量バッファしていない)');
      assert.equal(await SqliteDataService.findPoiSourceBySlug('chunked-remote'), null, '拒否された chunked remote は登録されないはず');
      chunkServer.close();
      console.log('ok: (l3) chunked over-threshold aborted mid-stream');

      // (l4) delete-race: refreshRemote が fetch を跨いで existing を保持している間に並行 delete。
      // upsert の not-found ガードが復活 (revision=1 再INSERT + registry slug 再占有) を防ぐこと
      let raceDeleteUid: string | null = null;
      const raceServer = createServer(async (req, res) => {
        if (raceDeleteUid) {
          // fetch 応答前に対象ソースを削除 → refreshRemote の後続 upsert が race に負ける状況を再現
          await SqliteDataService.deletePoiSource(raceDeleteUid);
          raceDeleteUid = null;
        }
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({
          type: 'FeatureCollection',
          features: [{ type: 'Feature', id: 'x1', geometry: { type: 'Point', coordinates: [1, 1] }, properties: { name: 'レース' } }],
        }));
      });
      await new Promise<void>((resolve) => raceServer.listen(0, '127.0.0.1', () => resolve()));
      const racePort = (raceServer.address() as any).port;
      const raceReg = await poiSourceService.registerRemote({
        slug: 'race-remote', title: 'レース', url: 'http://127.0.0.1:' + racePort + '/race.geojson',
      });
      assert.equal(raceReg.result, 'Success');
      raceDeleteUid = raceReg.uid;
      const raceRefresh = await poiSourceService.refreshRemote(raceReg.uid);
      assert.equal(raceRefresh.result, 'Error', '並行 delete 後の refresh は Error のはず');
      assert.equal(raceRefresh.code, 'not-found', '並行 delete は code not-found のはず');
      assert.equal(await SqliteDataService.findPoiSource(raceReg.uid), null, '削除済みソースが復活しないはず');
      assert.equal(await SqliteDataService.isSlugAvailable('race-remote'), true, 'registry slug が再占有されないはず');
      raceServer.close();
      console.log('ok: (l4) delete during refreshRemote does not resurrect the source');

      // (m) cloneToLocal: remote → local 複製
      const cloned = await poiSourceService.cloneToLocal(registered.uid, { slug: 'sapporo-local', title: '札幌ローカル' });
      assert.equal(cloned.result, 'Success', 'cloneToLocal は Success のはず: ' + JSON.stringify(cloned));
      assert.notEqual(cloned.uid, registered.uid);
      const clonedDoc = await poiSourceService.get(cloned.uid);
      assert.equal(clonedDoc.mode, 'local');
      assert.equal(clonedDoc.url, null, 'local 複製に url は残らないはず');
      assert.equal(clonedDoc.readOnly, false);
      assert.deepEqual(clonedDoc.title, { en: '札幌ローカル' }, 'clone titleはsource既定言語で内部形化されるはず');
      assert.equal(clonedDoc.featureCount, 2, 'features が複製されるはず');
      assert.deepEqual(
        clonedDoc.fc.features.map((f: any) => f.id),
        refreshedDoc.fc.features.map((f: any) => f.id),
      );
      // 複製先は編集可能
      const cloneSave = await poiSourceService.save(cloned.uid, {
        slug: 'sapporo-local', title: '札幌ローカル', fc: clonedDoc.fc, expectedRevision: clonedDoc.revision,
      });
      assert.equal(cloneSave.result, 'Success', '複製先 local は保存できるはず');
      console.log('ok: (m) cloneToLocal');

      // (n) findReferences → []
      const refs = await poiSourceService.findReferences(uid);
      assert.deepEqual(refs, [], 'Phase 7 まで参照は常に空のはず');
      console.log('ok: (n) findReferences returns []');

      // (q) list: blob なし + updatedAt あり + query=FTS
      const listResult = await poiSourceService.list({ query: '', page: 1, pageSize: 20 });
      assert.ok(listResult.items.length >= 4);
      const listedRow = listResult.items.find((item: any) => item.uid === uid);
      assert.ok(listedRow, 'list に対象が含まれるはず');
      assert.equal(listedRow.slug, 'kyoto-poi');
      assert.deepEqual(listedRow.title, { ja: '京都POI' });
      assert.equal(listedRow.mode, 'local');
      assert.equal(listedRow.featureCount, 2);
      assert.equal(listedRow.revision, 2);
      assert.ok(typeof listedRow.updatedAt === 'string' && listedRow.updatedAt !== '', 'list 行は updatedAt を持つはず');
      assert.ok(!('fc' in listedRow) && !('dataJson' in listedRow) && !('data_json' in listedRow), 'list 行は FC blob を含まないはず');
      // FTS: feature name でヒット (remote 本体と cloneToLocal 複製の両方が該当)
      const searchResult = await poiSourceService.list({ query: '時計台', page: 1, pageSize: 20 });
      const searchUids = searchResult.items.map((item: any) => item.uid).sort();
      assert.deepEqual(searchUids, [registered.uid, cloned.uid].sort(), 'feature name の FTS で remote と複製の両方がヒットするはず');
      // ページング
      const paged = await poiSourceService.list({ query: '', page: 1, pageSize: 2 });
      assert.equal(paged.items.length, 2);
      assert.equal(paged.hasNext, true);
      assert.equal(paged.hasPrev, false);
      console.log('ok: (q) list rows carry metadata without blob; query hits FTS');

      // (r) 仕様 §2.3: FC トップレベル layer metadata の save round-trip。id/name は保存されない
      // (slug/title 由来の独立しない概念、export 時にのみ書き込む)。icon/selectedIcon/hide/
      // poiTemplate/未知キー (customMeta) は round-trip 保持される (backend バグ修正、Phase5 Task1)。
      // M17-T1/AC17-3: patchLayerMeta で icon を変更しても、未編集の poiTemplate/customMeta 等
      // が save→get で保持されることを確認する end-to-end 検証。
      const layerMetaSave = await poiSourceService.save(uid, {
        slug: 'kyoto-poi',
        title: '京都POI',
        fc: {
          type: 'FeatureCollection',
          id: 'kyoto-poi',
          name: '京都POI (layer name)',
          icon: 'builtin:defaultpin',
          selectedIcon: 'builtin:defaultpin-selected',
          hide: false,
          poiTemplate: '<div>{{name}}</div>',
          customMeta: { future: 'extension', nested: [1, 2, 3] },
          features: [
            { type: 'Feature', id: 'kinkakuji', geometry: { type: 'Point', coordinates: [135.729, 35.039] },
              properties: { name: { ja: '金閣寺' } } },
          ],
        },
        expectedRevision: afterSave.revision,
      });
      assert.equal(layerMetaSave.result, 'Success', 'layer metadata 付き save は成功するはず: ' + JSON.stringify(layerMetaSave));
      const afterLayerMetaSave = await poiSourceService.get(uid);
      assert.equal(afterLayerMetaSave.fc.icon, 'builtin:defaultpin', 'icon は round-trip 保持されるはず (POI-111)');
      assert.equal(afterLayerMetaSave.fc.selectedIcon, 'builtin:defaultpin-selected', 'selectedIcon は round-trip 保持されるはず (POI-111)');
      assert.equal(afterLayerMetaSave.fc.hide, false, 'hide は round-trip 保持されるはず (POI-111)');
      assert.equal(afterLayerMetaSave.fc.poiTemplate, '<div>{{name}}</div>', 'poiTemplate は round-trip 保持されるはず (POI-007/111)');
      assert.deepEqual(afterLayerMetaSave.fc.customMeta, { future: 'extension', nested: [1, 2, 3] }, '未知キーも round-trip 保持されるはず (将来拡張)');
      assert.ok(!('id' in afterLayerMetaSave.fc), 'FC.id は保存されないはず (slug 由来の独立しない概念、§2.3)');
      assert.ok(!('name' in afterLayerMetaSave.fc), 'FC.name は保存されないはず (title 由来の独立しない概念、§2.3)');
      assert.equal(afterLayerMetaSave.featureCount, 1, 'layer metadata 追加で feature_count がずれないはず');
      console.log('ok: (r) FC top-level layer metadata round-trips through save; id/name are not persisted (§2.3)');

      // (r2) importFile 経路でも同様に layer metadata が round-trip する
      const importLayerMetaFile = nodePath.join(workDir, 'import-layer-meta.geojson');
      await fsWriteFile(importLayerMetaFile, JSON.stringify({
        type: 'FeatureCollection',
        id: 'ignored-fc-id',
        name: 'ignored-fc-name',
        icon: 'builtin:defaultpin',
        selectedIcon: 'builtin:defaultpin-selected',
        hide: true,
        poiTemplate: '<div>{{name}}</div>',
        iconTemplate: '<img src="{{icon}}">',
        poiStyle: { color: 'red' },
        customMeta: { future: 'extension' },
        features: [
          { type: 'Feature', geometry: { type: 'Point', coordinates: [139.0, 35.0] }, properties: { name: 'テスト地点' } },
        ],
      }));
      const importedLayerMeta = await poiSourceService.importFile({
        slug: 'layer-meta-import', title: 'レイヤーメタ', filePath: importLayerMetaFile,
      });
      assert.equal(importedLayerMeta.result, 'Success', 'layer metadata 付き importFile は成功するはず: ' + JSON.stringify(importedLayerMeta));
      const importedLayerMetaDoc = await poiSourceService.get(importedLayerMeta.uid);
      assert.equal(importedLayerMetaDoc.fc.icon, 'builtin:defaultpin', 'importFile でも icon が round-trip 保持されるはず');
      assert.equal(importedLayerMetaDoc.fc.selectedIcon, 'builtin:defaultpin-selected', 'importFile でも selectedIcon が round-trip 保持されるはず');
      assert.equal(importedLayerMetaDoc.fc.hide, true, 'importFile でも hide が round-trip 保持されるはず');
      assert.equal(importedLayerMetaDoc.fc.poiTemplate, '<div>{{name}}</div>', 'importFile でも poiTemplate が round-trip 保持されるはず');
      assert.equal(importedLayerMetaDoc.fc.iconTemplate, '<img src="{{icon}}">', 'importFile でも iconTemplate が round-trip 保持されるはず');
      assert.deepEqual(importedLayerMetaDoc.fc.poiStyle, { color: 'red' }, 'importFile でも poiStyle が round-trip 保持されるはず');
      assert.deepEqual(importedLayerMetaDoc.fc.customMeta, { future: 'extension' }, 'importFile でも未知キーが round-trip 保持されるはず');
      assert.ok(!('id' in importedLayerMetaDoc.fc), 'importFile でも FC.id は保存されないはず (§2.3)');
      assert.ok(!('name' in importedLayerMetaDoc.fc), 'importFile でも FC.name は保存されないはず (§2.3)');
      assert.equal(importedLayerMetaDoc.featureCount, 1, 'importFile の layer metadata 追加で feature_count がずれないはず');
      console.log('ok: (r2) importFile preserves FC top-level layer metadata; id/name are not persisted (§2.3)');

      // (o) delete: 本体・registry 掃除
      const deleted = await poiSourceService.delete(uid);
      assert.equal(deleted.ok, true);
      assert.ok(Array.isArray(deleted.references), 'delete は confirm フロー用の references 形を返すはず');
      assert.equal(await poiSourceService.get(uid), null);
      assert.equal(await SqliteDataService.isSlugAvailable('kyoto-poi'), true, 'delete で slug が解放されるはず');
      console.log('ok: (o) delete sweeps registry');

      // (p) 旧実装のファイルは無傷 (読みも消しもしない)
      assert.equal(await fsReadFile(legacyStoreFile, 'utf8'), legacyStoreContent, '旧 poi-sources.json は無傷のはず');
      assert.equal(await fsReadFile(legacyGeojsonFile, 'utf8'), legacyGeojsonContent, '旧 poi-sources/ 配下は無傷のはず');
      console.log('ok: (p) legacy poi-sources.json / poi-sources/ untouched');

      console.log('M9-T3 poi service smoke passed');
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
          entryFileNames: 'poi-service-smoke.mjs',
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
  console.log('M9-T3 poi service smoke passed');
} finally {
  await rm(workDir, { recursive: true, force: true });
}
