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
// Part H: i18n — 設計 §7 の全キーが 11 locale に存在
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
  const poiSourcesHealPath = path.join(projectRoot, 'src/utils/poiSourcesHeal.ts');
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

      // ---- Part G: heal 失敗時温存 (AC6-9) — 純関数 + AppDataService save round-trip ----
      {
        const { healPoisValue, healAppDocumentPois } = await import(${JSON.stringify(poiSourcesHealPath)});
        // 純関数: 復元不能な生値 → failed: true (AppEdit は pois:[] を document へ書かず生値を温存する)
        assert.equal(healPoisValue('{broken json'), null);
        assert.equal(healPoisValue({ layerKey: [] } as any), null, '非配列 object は復元不能');
        assert.deepEqual(healAppDocumentPois({ pois: 'https://example.com/pois.json' }), { pois: [], failed: true });
        assert.deepEqual(healAppDocumentPois({ poiSources: '{broken' }), { pois: [], failed: true });
        assert.deepEqual(healAppDocumentPois({}), { pois: [], failed: false }, '元々未設定は failed ではない');

        // save round-trip: 温存された生値 (非配列) が data_json に残存する
        const { default: AppDataService } = await import(${JSON.stringify(appDataServicePath)});
        const rawPois = 'https://example.com/legacy-pois.json'; // viewer P1 形の生値 (heal 復元不能)
        const rawPoiSources = '"[[broken"';
        const saved = await AppDataService.saveApp({
          document: {
            appID: 'heal-app', appName: { ja: 'Heal' }, title: { ja: 'Heal' }, description: {}, keywords: '',
            siteUrl: '', lang: 'ja', sources: [], httpSettings: {}, appSettings: {}, manifestSettings: {},
            pois: rawPois, poiSources: rawPoiSources,
          },
          slug: 'heal-app',
        });
        assert.equal(saved.result, 'Success', 'saveApp: ' + JSON.stringify(saved));
        const loaded = await AppDataService.getApp('heal-app');
        assert.equal(loaded.pois, rawPois, 'data_json に pois 生値が温存される');
        assert.equal(loaded.poiSources, rawPoiSources, 'data_json に poiSources 生値が温存される');
      }
      console.log('m3-t6 smoke Part G (heal 失敗時温存 AC6-9): OK');
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
      ['poiref', 'external_note'],
      ['mapedit', 'import_inline_poi_alert'],
      ['appedit', 'warn_mixed_pois'],
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
      // 更新キーが旧文言のまま残っていないこと (ja のみ厳密確認)
      if (locale === 'ja') {
        if (translation.appedit.poi_heal_failed.includes('このまま保存すると失われます')) {
          throw new Error('appedit.poi_heal_failed (ja) が旧文言のまま (heal 温存後は虚偽になる)');
        }
        if (translation.poiref.external_note.includes('順番の変更と削除のみ')) {
          throw new Error('poiref.external_note (ja) が旧文言のまま (変換導線を案内していない)');
        }
      }
    }
    console.log('m3-t6 smoke Part H (i18n 11 locale): OK');
  }
} finally {
  await rm(workDir, { recursive: true, force: true });
}
