// M3-T6 スモーク: inline POI の保全パネル完成と GeoJSON 変換（設計 §11.2）。
// m9 系と同じ sandbox 方式 (vite SSR ビルド + electron/electron-store スタブ)。
// Part A: slug 共通ヘルパ (slugCandidate/findAvailableSlug) の旧 reserveCopySlug candidate 同値性・
//         suggestSlug 拡張子非対称解消・Asset 互換ケース表 (§6.3 方針(i) 確定挙動)
// Part B: reserveSequencedSlug / reserveCopySlug wrapper の挙動不変 (予約系列・失敗値)
// Part C: PoiSourceService.importFile 同名 2 回 → foo/foo2 自動採番 (zip・geojson 両経路)、
//         レース相当 (予約先取り) は Exist
// Part D: convertInlineEntries (旧オブジェクト群 → 1 FC・キー保持 (t5 whitelist 撤廃の実効確認,
//         AC6-5)・layerMeta round-trip・非 Point → hasError)
// Part E: 変換フロー失敗系 (検証エラー・20MB 超・put 失敗) で document/draft 不変 + 予約解放 (AC6-10)
// Part F: resolvePoisArray 混在警告 (FC + 非 FC object → warn_mixed_pois / 文字列は数えない) (AC6-7)
// Part G: heal 失敗時温存 (純関数 + AppDataService save round-trip で data_json に生値残存) (AC6-9)
// Part H: i18n — 設計 §7 の全キーが 11 locale に存在 + 削除キー (external_data/external_note) の残置なし
// Part I: poisLayerStructure (§4.2 完全分割表の機械導出 — クラス転記表 + 341 通り全域列挙 +
//         hasPoisLayerKey) (AC6-12)
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'm3-t6-convert-'));
const entryFile = path.join(workDir, 'm3-t6-smoke.ts');
const electronStubFile = path.join(workDir, 'electron-stub.ts');
const electronStoreStubFile = path.join(workDir, 'electron-store-stub.ts');
const outDir = path.join(workDir, 'dist');
const bundledFile = path.join(outDir, 'm3-t6-smoke.mjs');

try {
  const dataDir = path.join(workDir, 'data');
  await mkdir(dataDir, { recursive: true });
  const slugSequencePath = path.join(projectRoot, 'src/utils/slugSequence.ts');
  const poiSourceSlugPath = path.join(projectRoot, 'src/utils/poiSourceSlug.ts');
  const useResourceDuplicatePath = path.join(projectRoot, 'src/composables/useResourceDuplicate.ts');
  const inlinePoiConvertPath = path.join(projectRoot, 'src/utils/inlinePoiConvert.ts');
  const poiReferenceUiPath = path.join(projectRoot, 'src/utils/poiReferenceUi.ts');
  const appPoisFormatPath = path.join(projectRoot, 'src/utils/appPoisFormat.ts');
  const poisLayerStructurePath = path.join(projectRoot, 'src/utils/poisLayerStructure.ts');
  const settingsPath = path.join(projectRoot, 'electron/services/SettingsService.ts');
  const sqlitePath = path.join(projectRoot, 'electron/services/SqliteDataService.ts');
  const poiServicePath = path.join(projectRoot, 'electron/services/PoiSourceService.ts');
  const resolverPath = path.join(projectRoot, 'electron/services/poiReferenceResolver.ts');
  const appDataServicePath = path.join(projectRoot, 'electron/services/AppDataService.ts');

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
      import { writeFile as fsWriteFile } from 'node:fs/promises';
      import nodePath from 'node:path';
      import { slugCandidate, findAvailableSlug, SLUG_MAX, SEQUENCE_MAX_INDEX } from ${JSON.stringify(slugSequencePath)};
      import { suggestSlug } from ${JSON.stringify(poiSourceSlugPath)};

      // ---- Part A1: slugCandidate 系列が旧 reserveCopySlug の candidate 実装と同値 (表駆動) ----
      // 旧実装: candidate = (suffix) => base.slice(0, SLUG_MAX - suffix.length) + suffix
      //         系列 = "-copy" → "-copy2".."-copy100"
      const legacyCandidate = (base: string, suffix: string): string => base.slice(0, 100 - suffix.length) + suffix;
      const bases = [
        'foo',
        'a'.repeat(100),
        'a'.repeat(96),
        'a'.repeat(95),
        'x'.repeat(120),
        'poi-source',
      ];
      for (const base of bases) {
        assert.equal(
          slugCandidate(base, 1, { suffix: '-copy' }),
          legacyCandidate(base, '-copy'),
          'n=1 candidate must equal legacy for base ' + base,
        );
        for (const n of [2, 3, 9, 10, 42, 99, 100]) {
          assert.equal(
            slugCandidate(base, n, { suffix: '-copy' }),
            legacyCandidate(base, '-copy' + n),
            'n=' + n + ' candidate must equal legacy for base ' + base,
          );
        }
      }
      assert.equal(SLUG_MAX, 100, 'SLUG_MAX default must be 100');
      assert.equal(SEQUENCE_MAX_INDEX, 100, 'SEQUENCE_MAX_INDEX default must be 100');
      // suffix 既定 "" 系列: base, base2, base3...
      assert.equal(slugCandidate('foo', 1), 'foo');
      assert.equal(slugCandidate('foo', 2), 'foo2');
      assert.equal(slugCandidate('a'.repeat(100), 2), 'a'.repeat(99) + '2');
      // "-poi" 系列
      assert.equal(slugCandidate('nagoya', 1, { suffix: '-poi' }), 'nagoya-poi');
      assert.equal(slugCandidate('nagoya', 2, { suffix: '-poi' }), 'nagoya-poi2');
      console.log('m3-t6 smoke Part A1 (slugCandidate 同値性): OK');

      // ---- Part A2: findAvailableSlug — 候補順に tryAcquire、最初の true を返す。全枯渇は null ----
      {
        const tried: string[] = [];
        const got = await findAvailableSlug('foo', async (slug) => { tried.push(slug); return slug === 'foo3'; });
        assert.equal(got, 'foo3');
        assert.deepEqual(tried, ['foo', 'foo2', 'foo3']);
      }
      {
        let calls = 0;
        const got = await findAvailableSlug('foo', async () => { calls++; return false; }, { suffix: '-copy' });
        assert.equal(got, null, '全候補枯渇は null');
        assert.equal(calls, 100, '候補は 100 件 (suffix → suffix2..suffix100)');
      }
      console.log('m3-t6 smoke Part A2 (findAvailableSlug): OK');

      // ---- Part A3: suggestSlug — 拡張子非対称解消 + NFKD + fallback 引数 ----
      assert.equal(suggestSlug('foo.zip'), 'foo', 'foo.zip → foo (旧: foo-zip)');
      assert.equal(suggestSlug('foo.geojson'), 'foo');
      assert.equal(suggestSlug('foo.tar.gz'), 'foo-tar', '最後の拡張子のみ除去');
      assert.equal(suggestSlug('日本語.geojson'), 'poi-source', '空は fallback 既定 poi-source');
      assert.equal(suggestSlug('日本語.geojson', ''), '', 'fallback 引数指定');
      assert.equal(suggestSlug('Café Menu.geojson'), 'cafe-menu', 'NFKD + 空白ハイフン化');
      console.log('m3-t6 smoke Part A3 (suggestSlug): OK');

      // ---- Part A4: Asset 互換ケース (§11.2 表駆動 — AssetEdit と同じ前処理つき呼び出し形) ----
      const assetSuggest = (name: string) => suggestSlug(name.normalize('NFKD').replace(/[^A-Za-z0-9._\\s-]+/g, '-'), '');
      const legacyAssetSuggest = (name: string) => name.normalize('NFKD').replace(/\\.[^.]+$/, '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
      const assetCases: [string, string, string][] = [
        // [入力, 期待値(統合後), 旧局所実装期待値]
        ['foo@bar.png', 'foo-bar', 'foo-bar'],
        ['map(1).png', 'map-1', 'map-1'],
        ['25%off.png', '25-off', '25-off'],
        ['café.png', 'cafe', 'cafe'],
        ['foo bar.png', 'foo-bar', 'foo-bar'],
        ['foo.tar.gz', 'foo-tar', 'foo-tar'],
        ['a-@b.png', 'a-b', 'a--b'], // 容認差分 D2 (ハイフン連続圧縮)
        ['b'.repeat(120) + '.png', 'b'.repeat(100), 'b'.repeat(120)], // 容認差分 D3 (100 切詰め)
        ['日本語.png', '', ''],
      ];
      for (const [input, expected, legacyExpected] of assetCases) {
        assert.equal(assetSuggest(input), expected, 'asset 統合後: ' + input);
        assert.equal(legacyAssetSuggest(input), legacyExpected, '旧局所実装の前提確認: ' + input);
      }
      console.log('m3-t6 smoke Part A4 (Asset 互換ケース): OK');

      // ---- Part B: reserveSequencedSlug / reserveCopySlug wrapper 挙動不変 ----
      // window.slugReservations を予約表スタブで差し込み、系列・切詰め・失敗値を検証する
      {
        const reserved = new Set<string>(); // 予約表 + registry の合成 (check がどちらも見る想定)
        (globalThis as any).window = {
          slugReservations: {
            async check({ slug }: { slug: string }) { return reserved.has(slug) ? 'taken' : 'available'; },
            async reserve({ slug }: { slug: string }) {
              if (reserved.has(slug)) return { result: 'conflict' };
              reserved.add(slug);
              return { result: 'ok' };
            },
            async release({ slug }: { slug: string }) { reserved.delete(slug); },
          },
        };
        const { reserveCopySlug, reserveSequencedSlug } = await import(${JSON.stringify(useResourceDuplicatePath)});
        // (1) -copy 系列: 空き → -copy
        const r1 = await reserveCopySlug('foo', 'poi-source', 'poi-source');
        assert.ok(r1 && r1.slug === 'foo-copy' && typeof r1.uid === 'string', '-copy 採番: ' + JSON.stringify(r1));
        // (2) -copy 埋まり → -copy2
        const r2 = await reserveCopySlug('foo', 'poi-source', 'poi-source');
        assert.ok(r2 && r2.slug === 'foo-copy2', '-copy2 採番: ' + JSON.stringify(r2));
        // (3) baseSlug undefined → fallbackBase
        const r3 = await reserveCopySlug(undefined, 'poi-source', 'fallback-base');
        assert.ok(r3 && r3.slug === 'fallback-base-copy', 'fallback 基底: ' + JSON.stringify(r3));
        // (4) 100 文字 base の切詰め (旧 candidate 実装と同じ)
        const longBase = 'c'.repeat(100);
        const r4 = await reserveCopySlug(longBase, 'poi-source', 'poi-source');
        assert.ok(r4 && r4.slug === 'c'.repeat(95) + '-copy', '切詰め: ' + JSON.stringify(r4));
        // (5) 全候補枯渇 → null
        for (let i = 1; i <= 100; i++) reserved.add('full-copy' + (i === 1 ? '' : String(i)));
        const r5 = await reserveCopySlug('full', 'poi-source', 'poi-source');
        assert.equal(r5, null, '全候補枯渇は null');
        // (6) 変換系列 (-poi): reserveSequencedSlug 直呼び
        const r6 = await reserveSequencedSlug('nagoya', '-poi', 'poi-source', 'poi-source');
        assert.ok(r6 && r6.slug === 'nagoya-poi', '-poi 採番: ' + JSON.stringify(r6));
        const r7 = await reserveSequencedSlug('nagoya', '-poi', 'poi-source', 'poi-source');
        assert.ok(r7 && r7.slug === 'nagoya-poi2', '-poi2 採番: ' + JSON.stringify(r7));
        delete (globalThis as any).window;
      }
      console.log('m3-t6 smoke Part B (reserveCopySlug wrapper 挙動不変): OK');

      // ---- Part C: importFile 自動採番 (main 側 sandbox) ----
      {
        const { default: SettingsService } = await import(${JSON.stringify(settingsPath)});
        SettingsService.set('saveFolder', ${JSON.stringify(dataDir)});
        const { default: SqliteDataService } = await import(${JSON.stringify(sqlitePath)});
        const { default: poiSourceService } = await import(${JSON.stringify(poiServicePath)});
        await SqliteDataService.getDb();

        const fcJson = JSON.stringify({
          type: 'FeatureCollection',
          features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [139.7, 35.6] }, properties: { name: 'P' } }],
        });
        const fileA = nodePath.join(${JSON.stringify(workDir)}, 'foo.geojson');
        await fsWriteFile(fileA, fcJson);
        // geojson 経路: 同名 2 回 → foo / foo2
        const c1 = await poiSourceService.importFile({ slug: 'foo', title: { ja: 'Foo' }, filePath: fileA });
        assert.equal(c1.result, 'Success', 'import 1 回目: ' + JSON.stringify(c1));
        assert.equal(c1.slug, 'foo');
        const c2 = await poiSourceService.importFile({ slug: 'foo', title: { ja: 'Foo' }, filePath: fileA });
        assert.equal(c2.result, 'Success', 'import 2 回目: ' + JSON.stringify(c2));
        assert.equal(c2.slug, 'foo2', '同名 2 回目は foo2 へ自動採番');
        // zip 経路: 同名 2 回 → bar / bar2 (importPoiZip が期待する pois/*.geojson 構成で生成)
        const { default: AdmZip } = await import('adm-zip');
        const zipA = nodePath.join(${JSON.stringify(workDir)}, 'bar.zip');
        const zipBuilder = new AdmZip();
        zipBuilder.addFile('pois/bar.geojson', Buffer.from(fcJson));
        await fsWriteFile(zipA, zipBuilder.toBuffer());
        const z1 = await poiSourceService.importFile({ slug: 'bar', title: { ja: 'Bar' }, filePath: zipA });
        assert.equal(z1.result, 'Success', 'zip import 1 回目: ' + JSON.stringify(z1));
        assert.equal(z1.slug, 'bar');
        const z2 = await poiSourceService.importFile({ slug: 'bar', title: { ja: 'Bar' }, filePath: zipA });
        assert.equal(z2.result, 'Success', 'zip import 2 回目: ' + JSON.stringify(z2));
        assert.equal(z2.slug, 'bar2', 'zip 同名 2 回目は bar2 へ自動採番');
        // レース相当: findAvailableSlug 通過後に createSource 側 isSlugAvailable が false になるケース。
        // 予約表に先取り予約を入れる (isSlugAvailable は予約表も見る) → Exist
        const raceUid = crypto.randomUUID();
        await SqliteDataService.reserveSlug({ slug: 'race', assetUid: raceUid, assetKind: 'poi-source', draftUid: raceUid });
        for (let i = 2; i <= 100; i++) {
          const uid = crypto.randomUUID();
          await SqliteDataService.reserveSlug({ slug: 'race' + i, assetUid: uid, assetKind: 'poi-source', draftUid: uid });
        }
        const raced = await poiSourceService.importFile({ slug: 'race', title: { ja: 'R' }, filePath: fileA });
        assert.equal(raced.result, 'Exist', '全候補予約済み (枯渇) は Exist: ' + JSON.stringify(raced));
      }
      console.log('m3-t6 smoke Part C (importFile 自動採番): OK');

      // ---- Part D: convertInlineEntries / toPoiEditState / isNonReferenceObjectEntry ----
      {
        const { convertInlineEntries, resolveConvertTitle } = await import(${JSON.stringify(inlinePoiConvertPath)});
        const { toPoiEditState } = await import(${JSON.stringify(path.join(projectRoot, 'src/composables/usePoiEditSession.ts'))});
        const { isNonReferenceObjectEntry, poiUidOf } = await import(${JSON.stringify(poiReferenceUiPath)});

        // isNonReferenceObjectEntry (§5.2): 非参照 object のみ true
        assert.equal(isNonReferenceObjectEntry({ name: 'p', lat: 1, lng: 2 }), true, '旧オブジェクト');
        assert.equal(isNonReferenceObjectEntry({ type: 'FeatureCollection', features: [] }), true, '生FC');
        assert.equal(isNonReferenceObjectEntry({ poiUid: 'not-a-uuid' }), true, '非UUID poiUid object');
        assert.equal(isNonReferenceObjectEntry({ poiUid: '01234567-89ab-4cde-8f01-23456789abcd' }), false, '参照要素');
        assert.equal(isNonReferenceObjectEntry('https://example.com/poi.json'), false, 'URL文字列');
        assert.equal(isNonReferenceObjectEntry([1, 2]), false, '配列junk');
        assert.equal(isNonReferenceObjectEntry(42), false, '数値junk');
        // poiUidOf との整合 (再定義していない)
        assert.equal(poiUidOf({ poiUid: '01234567-89ab-4cde-8f01-23456789abcd' }), '01234567-89ab-4cde-8f01-23456789abcd');

        // 旧オブジェクト群 → 1 FC。whitelist 外キー (実在例 start — morioka_ndl 相当) も保持 (AC6-5, t5 実効確認)
        const legacyGroup = [
          { name: '三ツ石神社', lat: 39.7052, lng: 141.1592, image: 'mitsuishi_jinja.jpg', start: 1599, url: 'https://example.com/a' },
          { type: 'Feature', geometry: { type: 'Point', coordinates: [141.15, 39.70] }, properties: { name: '生Feature', customKey: 'kept' } },
        ];
        const g = convertInlineEntries(legacyGroup, 'ja');
        assert.equal(g.hasError, false, '旧オブジェクト群は error なし: ' + JSON.stringify(g.issues));
        assert.equal(g.fc.type, 'FeatureCollection');
        assert.equal(g.fc.features.length, 2);
        const f0 = g.fc.features[0];
        assert.deepEqual(f0.geometry.coordinates, [141.1592, 39.7052], 'lat/lng → coordinates');
        assert.equal((f0.properties as any).start, 1599, 'whitelist 外キー start を保持 (t5)');
        assert.equal((f0.properties as any).image, 'mitsuishi_jinja.jpg', 'image 旧相対ファイル名形は透過');
        assert.ok((f0.properties as any).name, 'name 保持');
        assert.equal((g.fc.features[1].properties as any).customKey, 'kept', 'Feature properties 透過');

        // 生 FC 要素 → layerMeta round-trip (type/features/id/name/lang 以外のトップレベル保持)
        const rawFc = {
          type: 'FeatureCollection', name: 'FC名', icon: 'builtin:defaultpin', poiTemplate: { a: 1 },
          features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [135.0, 35.0] }, properties: { name: 'X' } }],
        };
        const r = convertInlineEntries(rawFc, 'ja');
        assert.equal(r.hasError, false);
        assert.equal((r.fc as any).icon, 'builtin:defaultpin', 'layerMeta icon round-trip');
        assert.deepEqual((r.fc as any).poiTemplate, { a: 1 }, 'layerMeta poiTemplate round-trip');
        assert.equal((r.fc as any).name, undefined, 'FC.name は layerMeta に残さない (title 側で扱う)');

        // 非 Point 混入 → hasError (POI-104)
        const badFc = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] }, properties: {} }] };
        assert.equal(convertInlineEntries(badFc, 'ja').hasError, true, '非 Point は error');

        // resolveConvertTitle: FC.name 非空 → FC.name / 空 → hostTitle / 群 → hostTitle
        assert.equal(resolveConvertTitle(rawFc, { ja: 'ホスト' }), 'FC名');
        assert.deepEqual(resolveConvertTitle({ type: 'FeatureCollection', features: [] }, { ja: 'ホスト' }), { ja: 'ホスト' });
        assert.deepEqual(resolveConvertTitle(legacyGroup, { ja: 'ホスト' }), { ja: 'ホスト' }, '群 (配列) は hostTitle');

        // toPoiEditState: load() と同一実装 (fc の features 以外を layerMeta へ、type/lang 除外)
        const st = toPoiEditState({ lang: 'ja', slug: 's', title: { ja: 'T' }, fc: r.fc });
        assert.equal(st.slug, 's');
        assert.equal(st.lang, 'ja');
        assert.equal(st.features.length, 1);
        assert.equal((st.layerMeta as any).icon, 'builtin:defaultpin');
        assert.equal((st.layerMeta as any).type, undefined, 'layerMeta に type を含めない');
        assert.equal((st.layerMeta as any).lang, undefined, 'layerMeta に lang を含めない');
        assert.equal((st.layerMeta as any).features, undefined);
      }
      console.log('m3-t6 smoke Part D (convertInlineEntries/toPoiEditState): OK');

      // ---- Part E: 変換フロー (convertInlineEntriesToDraft) — 成功系 + 失敗系で予約解放 (AC6-10) ----
      {
        const { convertInlineEntriesToDraft } = await import(${JSON.stringify(inlinePoiConvertPath)});
        const makeEnv = () => {
          const reserved = new Set<string>();
          const released: string[] = [];
          const puts: any[] = [];
          let putBehavior: 'ok' | 'reject' = 'ok';
          (globalThis as any).window = {
            slugReservations: {
              async check({ slug }: { slug: string }) { return reserved.has(slug) ? 'taken' : 'available'; },
              async reserve({ slug }: { slug: string }) {
                if (reserved.has(slug)) return { result: 'conflict' };
                reserved.add(slug);
                return { result: 'ok' };
              },
              async release({ slug }: { slug: string }) { released.push(slug); reserved.delete(slug); },
            },
            assetDrafts: {
              async put(envelope: any) {
                if (putBehavior === 'reject') throw new Error('put failed');
                puts.push(envelope);
              },
            },
          };
          return { reserved, released, puts, setPut: (b: 'ok' | 'reject') => { putBehavior = b; } };
        };
        const goodInput = [{ name: 'p1', lat: 35.0, lng: 135.0, start: 1600 }];

        // 成功系: -poi 採番・kind 'poi'・baseRevision null・payload = PoiEditState
        {
          const env = makeEnv();
          const res = await convertInlineEntriesToDraft({ input: goodInput, hostSlug: 'nagoya', hostTitle: { ja: '名古屋地図' }, lang: 'ja' });
          assert.ok(res.ok, '成功: ' + JSON.stringify(res));
          assert.equal(res.ok && res.slug, 'nagoya-poi');
          assert.equal(env.puts.length, 1);
          const envl = env.puts[0];
          assert.equal(envl.kind, 'poi');
          assert.equal(envl.schemaVersion, 1);
          assert.equal(envl.baseRevision, null, '新規下書き = baseRevision null');
          assert.equal(envl.payload.slug, 'nagoya-poi');
          assert.deepEqual(envl.payload.title, { ja: '名古屋地図' });
          assert.equal(envl.payload.features.length, 1);
          assert.equal(envl.payload.features[0].properties.start, 1600, 'payload にも whitelist 外キー保持');
          assert.equal(env.released.length, 0, '成功時は予約解放しない (promote まで保持)');
          // 2 回目 → -poi2
          const res2 = await convertInlineEntriesToDraft({ input: goodInput, hostSlug: 'nagoya', hostTitle: { ja: '名古屋地図' }, lang: 'ja' });
          assert.equal(res2.ok && res2.slug, 'nagoya-poi2', '衝突時 -poi2');
        }
        // 検証エラー → 予約解放 + put なし + reason invalid
        {
          const env = makeEnv();
          const res = await convertInlineEntriesToDraft({
            input: { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] }, properties: {} }] },
            hostSlug: 'host', hostTitle: { ja: 'H' }, lang: 'ja',
          });
          assert.deepEqual(res, { ok: false, reason: 'invalid' });
          assert.deepEqual(env.released, ['host-poi'], '検証エラーで予約解放');
          assert.equal(env.puts.length, 0);
        }
        // 20MB 超 → 予約解放 + put なし + reason too-large
        {
          const env = makeEnv();
          const big = [{ name: 'big', lat: 35, lng: 135, blob: 'x'.repeat(21 * 1024 * 1024) }];
          const res = await convertInlineEntriesToDraft({ input: big, hostSlug: 'host', hostTitle: { ja: 'H' }, lang: 'ja' });
          assert.deepEqual(res, { ok: false, reason: 'too-large' });
          assert.deepEqual(env.released, ['host-poi']);
          assert.equal(env.puts.length, 0);
        }
        // put 失敗 → 予約解放 + reason failed
        {
          const env = makeEnv();
          env.setPut('reject');
          const res = await convertInlineEntriesToDraft({ input: goodInput, hostSlug: 'host', hostTitle: { ja: 'H' }, lang: 'ja' });
          assert.deepEqual(res, { ok: false, reason: 'failed' });
          assert.deepEqual(env.released, ['host-poi'], 'put 失敗で予約解放');
        }
        // slug 全候補枯渇 → reason slug-exhausted (解放対象なし)
        {
          const env = makeEnv();
          env.reserved.add('host-poi');
          for (let i = 2; i <= 100; i++) env.reserved.add('host-poi' + i);
          const res = await convertInlineEntriesToDraft({ input: goodInput, hostSlug: 'host', hostTitle: { ja: 'H' }, lang: 'ja' });
          assert.deepEqual(res, { ok: false, reason: 'slug-exhausted' });
          assert.equal(env.puts.length, 0);
          assert.equal(env.released.length, 0, '予約が成立していないので解放なし');
        }
        delete (globalThis as any).window;
      }
      console.log('m3-t6 smoke Part E (変換フロー失敗系 AC6-10): OK');

      // ---- Part F: resolvePoisArray 混在警告 (AC6-7) — Part C と同一 sandbox DB を共有 ----
      {
        const { default: poiSourceService } = await import(${JSON.stringify(poiServicePath)});
        const { resolvePoisArray } = await import(${JSON.stringify(resolverPath)});
        const created = await poiSourceService.createLocal({ slug: 'mixed-src', title: { ja: '混在検証' }, lang: 'ja' });
        assert.equal(created.result, 'Success', 'createLocal: ' + JSON.stringify(created));
        await poiSourceService.save(created.uid, {
          slug: 'mixed-src', title: { ja: '混在検証' },
          fc: { type: 'FeatureCollection', features: [{ type: 'Feature', id: 'p1', geometry: { type: 'Point', coordinates: [139.7, 35.6] }, properties: { name: { ja: 'F' } } }] },
        });
        const legacyObj = { name: '旧POI', lat: 35.6, lng: 139.7 };
        // 旧オブジェクト + 参照 (解決後 FC) の混在 → warn_mixed_pois
        const mixed = await resolvePoisArray([legacyObj, { poiUid: created.uid }]);
        assert.ok(mixed.warnings.includes('appedit.warn_mixed_pois'), '混在で警告: ' + JSON.stringify(mixed.warnings));
        // 参照のみ → 非発行
        const refOnly = await resolvePoisArray([{ poiUid: created.uid }]);
        assert.ok(!refOnly.warnings.includes('appedit.warn_mixed_pois'), '参照のみは警告なし');
        // URL 文字列 + 参照 → 非発行 (文字列は数えない — §8.1 出口側判定)
        const withUrl = await resolvePoisArray(['https://example.com/pois.geojson', { poiUid: created.uid }]);
        assert.ok(!withUrl.warnings.includes('appedit.warn_mixed_pois'), 'URL 文字列は数えない: ' + JSON.stringify(withUrl.warnings));
        // 旧オブジェクトのみ (FC なし) → 非発行
        const legacyOnly = await resolvePoisArray([legacyObj]);
        assert.ok(!legacyOnly.warnings.includes('appedit.warn_mixed_pois'), '旧オブジェクトのみは警告なし');
      }
      console.log('m3-t6 smoke Part F (resolver 混在警告 AC6-7): OK');

      // ---- Part G: 未対応形式時温存 (AC6-9) — 純関数 + AppDataService save round-trip ----
      // M12-T30: healPoisValue/healAppDocumentPois (bounded reparse 復元) は sp-0006 に基づき
      // 撤去され、単一実装 readAppDocumentPois (形式判定のみ・復元なし) へ置き換えられた。
      // 生値温存 round-trip (旧 :459-474) は契約継続のため無変更で維持する。
      {
        const { readAppDocumentPois } = await import(${JSON.stringify(appPoisFormatPath)});
        // 純関数: 配列でない生値 → unsupported: true (AppEdit は pois:[] を document へ書かず生値を温存する)
        // M4-T4: pois の単独形（レイヤ1つを配列に包まず直接置く形）は viewer 正本が受容するので
        // supported へ変わった。unsupported のまま残るのは viewer も受容しない形だけである。
        assert.deepEqual(
          readAppDocumentPois({ pois: '{broken json' }),
          { pois: [], unsupported: true },
          'JSON 文字列化の破損は URL ではない（多重 stringify バグの後始末はしない — sp-0006）',
        );
        assert.deepEqual(readAppDocumentPois({ pois: { layerKey: [] } }), { pois: [], unsupported: true }, 'レイヤ名キー object は unsupported');
        assert.deepEqual(
          readAppDocumentPois({ pois: 'https://example.com/pois.json' }),
          { pois: ['https://example.com/pois.json'], unsupported: false },
          '単独形 URL は supported（viewer の nodesLoader が fetch して1レイヤにする）',
        );
        assert.deepEqual(readAppDocumentPois({}), { pois: [], unsupported: false }, '元々未設定は unsupported ではない');

        // save round-trip: 温存された生値 (非配列) が data_json に残存する
        const { default: AppDataService } = await import(${JSON.stringify(appDataServicePath)});
        const rawPois = 'https://example.com/legacy-pois.json'; // viewer P1 形の生値 (heal 復元不能)
        const saved = await AppDataService.saveApp({
          document: {
            appID: 'heal-app', appName: { ja: 'Heal' }, title: { ja: 'Heal' }, description: {}, keywords: '',
            siteUrl: '', lang: 'ja', sources: [], httpSettings: {}, appSettings: {}, manifestSettings: {},
            pois: rawPois,
          },
          slug: 'heal-app',
        });
        assert.equal(saved.result, 'Success', 'saveApp: ' + JSON.stringify(saved));
        const loaded = await AppDataService.getApp('heal-app');
        assert.equal(loaded.pois, rawPois, 'data_json に pois 生値が温存される');
      }
      console.log('m3-t6 smoke Part G (未対応形式時温存 AC6-9): OK');

      // ---- Part I: poisLayerStructure — §4.2 完全分割表のテスト機械導出 (AC6-12, v1.3) ----
      {
        const { poisEntryShape, poisLayerMode, hasMixedPoisShapes, hasPoisLayerKey } =
          await import(${JSON.stringify(poisLayerStructurePath)});
        type Shape = 'fc' | 'object' | 'string' | 'junk';

        // (I-1) poisEntryShape の入力代表 (unknown 全域で 4 値排他の全域関数であることの確認)
        const shapeCases: [unknown, Shape, string][] = [
          [{ type: 'FeatureCollection', features: [] }, 'fc', 'FC object'],
          [{ type: 'Feature', geometry: null, properties: {} }, 'object', '生 Feature'],
          [{ name: '旧POI', lat: 1, lng: 2 }, 'object', '旧 POI オブジェクト'],
          [{ poiUid: 'not-a-uuid' }, 'object', '非 UUID poiUid object'],
          ['https://example.com/pois.json', 'string', 'URL 文字列'],
          ['', 'string', '空文字列'],
          [[1, 2], 'junk', '配列'],
          [42, 'junk', '数値'],
          [null, 'junk', 'null'],
          [undefined, 'junk', 'undefined'],
          [true, 'junk', 'boolean'],
        ];
        for (const [input, expected, label] of shapeCases) {
          assert.equal(poisEntryShape(input), expected, 'poisEntryShape: ' + label);
        }

        // (I-2) §4.2 表の 10 行の定義条件を「各行独立の述語」として実装する。
        // 決定木を if/else の逐次分岐で転記すると「ちょうど1クラスに分類される」assert が
        // 構成上常に真になり網羅・排他の検証が vacuous になる (v1.3 レビュー Minor-1)。
        // 各述語は他の行の否定 (else) に依存しない独立式であり、任意の入力に対して真になる
        // 述語がちょうど 1 個であることを classify / (I-4) で毎回検証する
        const tail = (seq: readonly Shape[]): readonly Shape[] => seq.slice(1);
        const CLASS_PREDICATES: Record<string, (seq: readonly Shape[]) => boolean> = {
          // C1: 空配列
          C1: (seq) => seq.length === 0,
          // C2a: 先頭 fc・tail も全て fc (tail 空含む)
          C2a: (seq) => seq.length > 0 && seq[0] === 'fc' && tail(seq).every((s) => s === 'fc'),
          // C2b: 先頭 fc・tail に object なし・string または junk あり
          C2b: (seq) => seq.length > 0 && seq[0] === 'fc' && !tail(seq).includes('object')
            && (tail(seq).includes('string') || tail(seq).includes('junk')),
          // C3: 先頭 fc・tail に object あり (string / junk 共存可)
          C3: (seq) => seq.length > 0 && seq[0] === 'fc' && tail(seq).includes('object'),
          // C4: 先頭 object・fc を含まない
          C4: (seq) => seq.length > 0 && seq[0] === 'object' && !seq.includes('fc'),
          // C5: 先頭 object・fc を含む
          C5: (seq) => seq.length > 0 && seq[0] === 'object' && seq.includes('fc'),
          // C6a: 先頭 string・fc と object の両方は揃わない (tail 判定)
          C6a: (seq) => seq.length > 0 && seq[0] === 'string'
            && !(tail(seq).includes('fc') && tail(seq).includes('object')),
          // C6b: 先頭 string・tail に fc と object の両方あり
          C6b: (seq) => seq.length > 0 && seq[0] === 'string'
            && tail(seq).includes('fc') && tail(seq).includes('object'),
          // C7a: 先頭 junk・fc と object の両方は揃わない
          C7a: (seq) => seq.length > 0 && seq[0] === 'junk'
            && !(seq.includes('fc') && seq.includes('object')),
          // C7b: 先頭 junk・fc と object の両方あり
          C7b: (seq) => seq.length > 0 && seq[0] === 'junk'
            && seq.includes('fc') && seq.includes('object'),
        };
        // クラス → 期待 (mode / warning)。警告列は hasMixedPoisShapes の値の転記 (mode ゲートなし — §4.2)
        const CLASS_EXPECT: Record<string, { mode: string; warning: boolean }> = {
          C1: { mode: 'empty', warning: false },
          C2a: { mode: 'multi', warning: false },
          C2b: { mode: 'multi', warning: false },
          C3: { mode: 'multi', warning: true },
          C4: { mode: 'single', warning: false },
          C5: { mode: 'single', warning: true },
          C6a: { mode: 'indeterminate', warning: false },
          C6b: { mode: 'indeterminate', warning: true },
          C7a: { mode: 'single', warning: false },
          C7b: { mode: 'single', warning: true },
        };
        // 全述語を評価し「ちょうど 1 個が真」を assert してからそのクラス ID を返す
        // (網羅 = 0 個ならここで fail / 排他 = 2 個以上でもここで fail)
        const classify = (seq: readonly Shape[]): string => {
          const hits = Object.keys(CLASS_PREDICATES).filter((id) => CLASS_PREDICATES[id](seq));
          assert.equal(hits.length, 1,
            'ちょうど1クラスに分類: [' + seq.join(',') + '] → ' + JSON.stringify(hits));
          return hits[0];
        };

        // M4-T4: poisLayerMode は (shapes, entries) の両引数必須になった。shapes だけでは
        // 上書きレイヤ ({layer:…}) と旧 POI オブジェクトを区別できず (どちらも "object")、
        // viewer は前者が先頭ならレイヤ配列モードへ入るためである (normalize_pois.ts:106-109)。
        // 本表が検証するのは §4.2 の **shape ベースの完全分割** なので、"object" の代表値には
        // 上書きレイヤでない旧 POI オブジェクトを与える。上書きレイヤ先頭の判定 (→ multi) は
        // m4-t4 smoke Part B が viewer 正本との一致として担当する。
        const SHAPE_SAMPLE: Record<Shape, unknown> = {
          fc: { type: 'FeatureCollection', id: 'x', features: [] },
          object: { name: 'p', lnglat: [1, 2] },
          string: 'https://example.com/pois.geojson',
          junk: 42,
        };
        const entriesOf = (seq: Shape[]): unknown[] => seq.map((s) => SHAPE_SAMPLE[s]);

        // (I-3) クラス転記表: §4.2 の代表フィクスチャ列 (E2E フィクスチャの shape 列含む) を
        // クラス ID 1対1で assert する。§4.2 の表に行を追加・変更した場合は本表を同時更新する
        const TABLE: [Shape[], string, string][] = [
          [[], 'C1', '§4.2 C1 空配列'],
          [['fc', 'fc'], 'C2a', '§4.2 C2a [FC(id:a), FC(id:b)] / E2E 手順4b'],
          [['fc'], 'C2a', '§4.2 C2a [参照] (参照 → fc 写像)'],
          [['fc', 'string'], 'C2b', '§4.2 C2b [FC(id:a), "https://…"]'],
          [['fc', 'junk'], 'C2b', '§4.2 C2b [FC(id:a), 42]'],
          [['fc', 'object'], 'C3', '§4.2 C3 [FC(id:a), 旧POI]'],
          [['fc', 'object', 'string'], 'C3', '§4.2 C3 [FC(id:a), 旧POI, "url"]'],
          [['fc', 'fc', 'object'], 'C3', 'E2E 手順4b 拡張 (複層 + key 無し旧POI 追加で C3 へ遷移)'],
          [['object', 'object'], 'C4', '§4.2 C4 [旧POI, 旧POI] / E2E 手順1 seed'],
          [['object', 'string'], 'C4', '§4.2 C4 [旧POI, "https://…"] (変換 disabled だが警告なし)'],
          [['object', 'object', 'fc', 'string'], 'C5', '§4.2 C5 [旧POI, 旧POI, 生FC, "url"] / E2E 手順4c'],
          [['string'], 'C6a', '§4.2 C6a ["url"]'],
          [['string', 'object'], 'C6a', '§4.2 C6a ["url", 旧POI]'],
          [['string', 'fc'], 'C6a', '§4.2 C6a ["url", FC]'],
          [['string', 'object', 'fc'], 'C6b', '§4.2 C6b ["url", 旧POI, 生FC] / E2E 手順4d'],
          [['junk'], 'C7a', '§4.2 C7a [42]'],
          [['junk', 'object'], 'C7a', '§4.2 C7a [null, 旧POI]'],
          [['junk', 'fc', 'object'], 'C7b', '§4.2 C7b [[], 生FC, 旧POI]'],
        ];
        for (const [seq, classId, label] of TABLE) {
          assert.equal(classify(seq), classId, 'クラス転記表: ' + label);
          const expected = CLASS_EXPECT[classId];
          assert.equal(poisLayerMode(seq, entriesOf(seq)), expected.mode, 'クラス転記表 mode: ' + label);
          assert.equal(hasMixedPoisShapes(seq), expected.warning, 'クラス転記表 warning: ' + label);
        }

        // (I-4) 完全分割の全域列挙検証: shape 4 値 × 長さ 0〜4 の全列 (4^0+…+4^4 = 341 通り)。
        // (i) すべての列で真になる述語がちょうど 1 個 (網羅・排他 = 完全分割) — classify 内 assert
        // (ii) 各列でクラスの期待 (mode / warning) が共有述語の実出力と一致
        const SHAPES: Shape[] = ['fc', 'object', 'string', 'junk'];
        const allSeqs: Shape[][] = [[]];
        let frontier: Shape[][] = [[]];
        for (let len = 1; len <= 4; len++) {
          const next: Shape[][] = [];
          for (const seq of frontier) for (const s of SHAPES) next.push([...seq, s]);
          allSeqs.push(...next);
          frontier = next;
        }
        assert.equal(allSeqs.length, 341, '列挙数 = 341');
        const classCounts: Record<string, number> = {};
        for (const seq of allSeqs) {
          const classId = classify(seq);
          classCounts[classId] = (classCounts[classId] ?? 0) + 1;
          const expected = CLASS_EXPECT[classId];
          assert.equal(poisLayerMode(seq, entriesOf(seq)), expected.mode,
            '全域列挙 mode: [' + seq.join(',') + '] (' + classId + ')');
          assert.equal(hasMixedPoisShapes(seq), expected.warning,
            '全域列挙 warning: [' + seq.join(',') + '] (' + classId + ')');
        }
        // 10 クラスすべてが実際に出現する (定義が空集合の行 = 死に行がないこと)
        for (const classId of Object.keys(CLASS_PREDICATES)) {
          assert.ok((classCounts[classId] ?? 0) > 0, 'クラス ' + classId + ' が全域列挙に出現する');
        }

        // (I-5) hasPoisLayerKey — viewer normalize_pois.ts:30 の key 導出
        // (layer.id || (layer.properties && layer.properties.id)) の truthy 判定との一致
        assert.equal(hasPoisLayerKey({ type: 'FeatureCollection', id: 'layer-a', features: [] }), true, 'id あり FC');
        assert.equal(hasPoisLayerKey({ type: 'FeatureCollection', properties: { id: 'layer-b' }, features: [] }), true, 'properties.id のみの FC');
        assert.equal(hasPoisLayerKey({ type: 'FeatureCollection', features: [] }), false, 'id 無し FC');
        assert.equal(hasPoisLayerKey({ name: '旧POI', lat: 1, lng: 2 }), false, 'id 無し object');
        assert.equal(hasPoisLayerKey({ id: '' }), false, 'falsy id ("") は key なし (viewer truthy 判定)');
        assert.equal(hasPoisLayerKey({ id: 0 }), false, 'falsy id (0) は key なし');
        assert.equal(hasPoisLayerKey({ id: '', properties: { id: 'x' } }), true, 'id falsy でも properties.id が truthy なら key あり');
        assert.equal(hasPoisLayerKey(42), false, 'junk (数値)');
        assert.equal(hasPoisLayerKey(null), false, 'junk (null)');
        assert.equal(hasPoisLayerKey([1]), false, 'junk (配列)');
        assert.equal(hasPoisLayerKey('https://example.com'), false, '文字列は対象外');
      }
      console.log('m3-t6 smoke Part I (poisLayerStructure 完全分割): OK');
      console.log('m3-t6 smoke: ALL OK');
    `
  );

  await build({
    configFile: false,
    logLevel: 'error',
    build: {
      target: 'node22',
      outDir,
      emptyOutDir: true,
      ssr: entryFile,
      rollupOptions: {
        output: { entryFileNames: 'm3-t6-smoke.mjs', format: 'es' },
        external: [/^node:/],
      },
    },
    resolve: {
      alias: {
        electron: electronStubFile,
        'electron-store': electronStoreStubFile,
      },
    },
  });

  const { stdout } = await execFileAsync(process.execPath, [bundledFile], {
    cwd: projectRoot,
    maxBuffer: 16 * 1024 * 1024,
  });
  process.stdout.write(stdout);

  // ---- Part H: i18n — 設計 §7 の全キーが 11 locale に存在 (AC6-11 の i18n 面) ----
  {
    const LOCALES = ['de', 'en', 'es', 'fr', 'id', 'ja', 'ko', 'th', 'vi', 'zh', 'zh-TW'];
    const REQUIRED = [
      ['poiref', 'external_item_count'],
      ['poiref', 'convert_action'],
      ['poiref', 'convert_group_action'],
      ['poiref', 'convert_success'],
      ['poiref', 'convert_failed'],
      ['poiref', 'convert_invalid'],
      ['poiref', 'convert_too_large'],
      ['poiref', 'add_blocked_note'],
      ['poiref', 'delete_external_body'],
      // v1.2/v1.3 (G3): バッジ/注記2種化 + レイヤ警告の新規 7 キー (§5.11 / §7)
      ['poiref', 'inline_data'],
      ['poiref', 'external_url'],
      ['poiref', 'inline_note'],
      ['poiref', 'external_url_note'],
      ['poiref', 'mixed_layer_warning'],
      ['poiref', 'convert_blocked_note'],
      ['poiref', 'layer_key_missing_warning'],
      ['mapedit', 'import_inline_poi_alert'],
      ['appedit', 'warn_mixed_pois'],
      // M12-T30: poi_heal_failed → poi_format_unsupported へ改名（意味も「復元失敗」→「正準形式でない」へ変更）
      ['appedit', 'poi_format_unsupported'],
    ];
    // v1.2 (G3): 旧キーは 11 locale から削除済みであること (旧契約の残置禁止 — §5.11)
    // M12-T30: poi_heal_failed も同様に旧契約として削除済みであること
    const REMOVED = [
      ['poiref', 'external_data'],
      ['poiref', 'external_note'],
      ['appedit', 'poi_heal_failed'],
    ];
    for (const locale of LOCALES) {
      const translation = JSON.parse(
        await readFile(path.join(projectRoot, `public/locales/${locale}/translation.json`), 'utf8'),
      );
      for (const [section, key] of REQUIRED) {
        const value = translation?.[section]?.[key];
        if (typeof value !== 'string' || value.trim() === '') {
          throw new Error(`i18n key missing: ${locale} ${section}.${key}`);
        }
      }
      for (const [section, key] of REMOVED) {
        if (translation?.[section] && key in translation[section]) {
          throw new Error(`i18n key must be removed: ${locale} ${section}.${key} (§5.11 旧契約の残置禁止)`);
        }
      }
      // 新キーが「復元失敗」語彙（旧意味）のまま残っていないこと (ja のみ厳密確認)。
      // M12-T30: 意味が「復元に失敗した」→「正準形式（配列）でない」へ変わったため、
      // 「復元」という語自体が新文言に残っていると意味が虚偽になる
      if (locale === 'ja') {
        if (translation.appedit.poi_format_unsupported.includes('このまま保存すると失われます')) {
          throw new Error('appedit.poi_format_unsupported (ja) が旧 (heal 失敗) 文言のまま');
        }
        if (translation.appedit.poi_format_unsupported.includes('復元')) {
          throw new Error('appedit.poi_format_unsupported (ja) に「復元」語彙が残っている (heal 温存後は意味が虚偽になる)');
        }
      }
    }
    console.log('m3-t6 smoke Part H (i18n 11 locale): OK');
  }
} finally {
  await rm(workDir, { recursive: true, force: true });
}
