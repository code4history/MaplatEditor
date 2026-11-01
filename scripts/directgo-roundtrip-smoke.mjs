// directgo 往復スモーク: 手で書いた POI の `directgo`（ビューアで情報窓を出さずに遷移する属性）が、
// Editor のサービス層の保存・変換・取り込み・書き出しの各経路で残るかを確かめる。
// 方式は他の POI 系スモークと同じ（vite SSR ビルド + electron / electron-store のスタブ +
// saveFolder を一時ディレクトリへ）。
//
// 入力: tests/e2e/fixtures/directgo/
//   directgo-pois.geojson     P1（文字列）・P2（{href, blank}）・P3（name だけ + 同じアプリ内の相対 URL）
//   directgo-inline.json      同じ P1〜P3 を地図の inline の旧オブジェクト形にしたもの
//   directgo-rejected.geojson P4（javascript: の値）。保存と取り込みが content-mode-link-format の error で拒まれる
//
// 経路（いずれも「開く → 何も変えずに保存 → 読む」と「開く → name だけ変えて保存 → 読む」の 2 通り）:
//   E1 POI ソースの保存と再読込          PoiSourceService.save → get
//   E2 地図の inline の POI              MapEditService.save → request（地図データ）と
//                                         convertInlineEntries → PoiSourceService.createLocal → get
//   E5 GeoJSON / JSON ファイルの取り込み  PoiSourceService.importFile → get
//   E6 書き出し                          composeDownloadMapJson（アプリ書き出しと同じ externalizeMapDocumentPois）
//   E7 プレビュー                        externalizePoisArray（AppPreviewService と同じ）と exportForm
// 画面の操作が要る E3（内容の形の切替）と E4（生 JSON の窓）は tests/e2e/directgo-roundtrip.spec.ts。
//
// 出力: `result: <経路> <操作> <POI> <kept|missing|changed|rejected>` の行を全件出し、
// P1〜P3 に kept 以外が 1 件でもあれば失敗する。P4 が拒まれなければ失敗する。P3 単独のソースの検証結果は `record:` 行で出す。
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const fixtureDir = path.join(projectRoot, 'tests/e2e/fixtures/directgo');
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'directgo-roundtrip-'));
const entryFile = path.join(workDir, 'directgo-roundtrip-smoke.ts');
const electronStubFile = path.join(workDir, 'electron-stub.ts');
const electronStoreStubFile = path.join(workDir, 'electron-store-stub.ts');
const outDir = path.join(workDir, 'dist');
const bundledFile = path.join(outDir, 'directgo-roundtrip-smoke.mjs');

let failed = false;
try {
  const dataDir = path.join(workDir, 'data');
  await mkdir(dataDir, { recursive: true });

  const paths = {
    settings: path.join(projectRoot, 'electron/services/SettingsService.ts'),
    sqlite: path.join(projectRoot, 'electron/services/SqliteDataService.ts'),
    mapEdit: path.join(projectRoot, 'electron/services/MapEditService.ts'),
    poiSource: path.join(projectRoot, 'electron/services/PoiSourceService.ts'),
    resolver: path.join(projectRoot, 'electron/services/poiReferenceResolver.ts'),
    mapDownloadZip: path.join(projectRoot, 'electron/utils/mapDownloadZip.ts'),
    inlineConvert: path.join(projectRoot, 'src/utils/inlinePoiConvert.ts'),
    poisFixture: path.join(fixtureDir, 'directgo-pois.geojson'),
    inlineFixture: path.join(fixtureDir, 'directgo-inline.json'),
    rejectedFixture: path.join(fixtureDir, 'directgo-rejected.geojson'),
  };

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
        static fromWebContents() { return null; }
      };
      export const session = {
        defaultSession: {
          clearStorageData() { return Promise.resolve(); },
        },
      };
      export const shell = {
        trashItem(_path: string) { return Promise.resolve(); },
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
      import { readFile } from 'node:fs/promises';

      const { default: SettingsService } = await import(${JSON.stringify(paths.settings)});
      SettingsService.set('saveFolder', ${JSON.stringify(dataDir)});

      const { default: SqliteDataService } = await import(${JSON.stringify(paths.sqlite)});
      const { default: MapEditService } = await import(${JSON.stringify(paths.mapEdit)});
      const { default: PoiSourceService } = await import(${JSON.stringify(paths.poiSource)});
      const { externalizePoisArray, createPoiExternalizationContext } =
        await import(${JSON.stringify(paths.resolver)});
      const { composeDownloadMapJson } = await import(${JSON.stringify(paths.mapDownloadZip)});
      const { convertInlineEntries } = await import(${JSON.stringify(paths.inlineConvert)});
      await SqliteDataService.getDb();

      const poisFixture = JSON.parse(await readFile(${JSON.stringify(paths.poisFixture)}, 'utf8'));
      const inlineFixture = JSON.parse(await readFile(${JSON.stringify(paths.inlineFixture)}, 'utf8'));
      const rejectedFixture = JSON.parse(await readFile(${JSON.stringify(paths.rejectedFixture)}, 'utf8'));

      // 期待値: POI の id → 入力の directgo（P1〜P3）
      const expected: Record<string, unknown> = {};
      for (const f of poisFixture.features) expected[f.id] = f.properties.directgo;
      for (const o of inlineFixture) {
        assert.deepStrictEqual(o.directgo, expected[o.id], 'fixture の inline と GeoJSON の directgo が一致するはず: ' + o.id);
      }
      const POI_IDS = Object.keys(expected);

      type Outcome = 'kept' | 'missing' | 'changed' | 'rejected';
      const rows: { route: string; op: string; poi: string; outcome: Outcome; detail: string }[] = [];

      function classify(actual: unknown, want: unknown): Outcome {
        if (actual === undefined) return 'missing';
        try {
          assert.deepStrictEqual(actual, want);
          return 'kept';
        } catch {
          return 'changed';
        }
      }

      // items: id → properties（または旧オブジェクトそのもの）
      function recordAll(route: string, op: string, items: Map<string, Record<string, unknown>>): void {
        for (const id of POI_IDS) {
          const props = items.get(id);
          const outcome: Outcome = props ? classify(props.directgo, expected[id]) : 'missing';
          const detail = props ? JSON.stringify(props.directgo) : '(POI not found)';
          rows.push({ route, op, poi: id.toUpperCase(), outcome, detail });
          console.log('result: ' + route + ' ' + op + ' ' + id.toUpperCase() + ' ' + outcome + ' ' + detail);
        }
      }
      function recordRejected(route: string, op: string, reason: string): void {
        for (const id of POI_IDS) {
          rows.push({ route, op, poi: id.toUpperCase(), outcome: 'rejected', detail: reason });
          console.log('result: ' + route + ' ' + op + ' ' + id.toUpperCase() + ' rejected ' + reason);
        }
      }

      function featureMap(fc: any): Map<string, Record<string, unknown>> {
        const map = new Map<string, Record<string, unknown>>();
        for (const f of (fc?.features ?? [])) map.set(String(f.id), f.properties ?? {});
        return map;
      }
      function legacyMap(list: any): Map<string, Record<string, unknown>> {
        const map = new Map<string, Record<string, unknown>>();
        for (const o of (Array.isArray(list) ? list : [])) {
          if (o && typeof o === 'object' && !Array.isArray(o) && o.id !== undefined) map.set(String(o.id), o);
        }
        return map;
      }
      // 内部形の name（LangResource）を変える。他の properties は触らない
      function renameInternal(fc: any): any {
        const next = structuredClone(fc);
        for (const f of next.features) f.properties.name = { ja: 'renamed ' + f.id };
        return next;
      }
      function issuesText(result: any): string {
        return JSON.stringify(result?.issues ?? []);
      }

      // E1 / E2b / E5 で共通: ソースを読み → そのまま保存 → 読む → name を変えて保存 → 読む
      async function roundTripSource(route: string, uid: string): Promise<void> {
        const opened = await PoiSourceService.get(uid);
        assert.ok(opened, route + ': 作ったソースが読めるはず');
        recordAll(route, 'load', featureMap(opened.fc));

        const unchanged = await PoiSourceService.save(uid, {
          slug: opened.slug, title: opened.title, fc: opened.fc, expectedRevision: opened.revision,
        });
        if (unchanged.result !== 'Success') {
          recordRejected(route, 'save-unchanged', JSON.stringify(unchanged));
        } else {
          console.log('record: ' + route + ' save-unchanged issues ' + issuesText(unchanged));
          recordAll(route, 'save-unchanged', featureMap((await PoiSourceService.get(uid)).fc));
        }

        const reopened = await PoiSourceService.get(uid);
        const renamed = await PoiSourceService.save(uid, {
          slug: reopened.slug, title: reopened.title, fc: renameInternal(reopened.fc),
          expectedRevision: reopened.revision,
        });
        if (renamed.result !== 'Success') {
          recordRejected(route, 'save-renamed', JSON.stringify(renamed));
        } else {
          console.log('record: ' + route + ' save-renamed issues ' + issuesText(renamed));
          const after = await PoiSourceService.get(uid);
          for (const f of after.fc.features) {
            assert.deepStrictEqual(f.properties.name, { ja: 'renamed ' + f.id }, route + ': name の変更が保存されたはず');
          }
          recordAll(route, 'save-renamed', featureMap(after.fc));
        }
      }

      // ---------------- E1 POI ソースの保存と再読込 ----------------
      const e1Created = await PoiSourceService.createLocal({ slug: 'directgo-e1', title: { ja: 'directgo E1' }, lang: 'ja' });
      assert.equal(e1Created.result, 'Success', 'E1 createLocal: ' + JSON.stringify(e1Created));
      const e1First = await PoiSourceService.save(e1Created.uid, {
        slug: 'directgo-e1', title: { ja: 'directgo E1' }, fc: poisFixture, expectedRevision: e1Created.revision,
      });
      if (e1First.result !== 'Success') {
        recordRejected('E1', 'save-fixture', JSON.stringify(e1First));
      } else {
        console.log('record: E1 save-fixture issues ' + issuesText(e1First));
        await roundTripSource('E1', e1Created.uid);
      }

      // P3 だけのソース: 内容（desc 等）の無い POI だけだと検証がどう出るか（記録）
      const p3Only = { type: 'FeatureCollection', features: poisFixture.features.filter((f: any) => f.id === 'p3') };
      const p3Created = await PoiSourceService.createLocal({ slug: 'directgo-p3-only', title: { ja: 'directgo P3' }, lang: 'ja' });
      const p3Saved = await PoiSourceService.save(p3Created.uid, {
        slug: 'directgo-p3-only', title: { ja: 'directgo P3' }, fc: p3Only, expectedRevision: p3Created.revision,
      });
      console.log('record: P3-only save result ' + JSON.stringify(p3Saved));
      if (p3Saved.result === 'Success') {
        const p3After = await PoiSourceService.get(p3Created.uid);
        const kept = classify(p3After.fc.features[0]?.properties?.directgo, expected.p3);
        console.log('record: P3-only directgo after save ' + kept);
        assert.equal(kept, 'kept', 'P3 だけのソースでも directgo が残るはず');
      }

      // ---------------- E2a 地図の inline の POI（地図データの保存と再読込）----------------
      const mapBase: any = {
        mapID: 'directgo-map', title: 'directgo 地図', attr: '', officialTitle: '', dataAttr: '',
        author: '', createdAt: '', era: '', license: 'All right reserved', dataLicense: 'CC BY-SA',
        contributor: '', mapper: '', reference: '', description: '', url: '', lang: 'ja',
        imageExtension: 'jpg', width: 400, height: 300, gcps: [], edges: [], sub_maps: [],
        strictMode: 'strict', vertexMode: 'plain', homePosition: [135.77, 35.01], mercZoom: 15,
      };
      const e2aSave = await MapEditService.save({
        mapObject: { ...mapBase, pois: structuredClone(inlineFixture) }, tins: [], slug: 'directgo-map',
      });
      if (e2aSave.result !== 'Success') {
        recordRejected('E2a', 'save-unchanged', JSON.stringify(e2aSave));
      } else {
        const loaded = await MapEditService.request(e2aSave.uid);
        recordAll('E2a', 'save-unchanged', legacyMap(loaded.pois));
        const renamedPois = structuredClone(loaded.pois).map((o: any) => ({ ...o, name: 'renamed ' + o.id }));
        const e2aRenamed = await MapEditService.save({
          mapObject: { ...loaded, pois: renamedPois }, tins: [], slug: 'directgo-map', uid: e2aSave.uid,
        } as any);
        if (e2aRenamed.result !== 'Success') {
          recordRejected('E2a', 'save-renamed', JSON.stringify(e2aRenamed));
        } else {
          const reloaded = await MapEditService.request(e2aRenamed.uid);
          for (const o of reloaded.pois) assert.equal(o.name, 'renamed ' + o.id, 'E2a: name の変更が保存されたはず');
          recordAll('E2a', 'save-renamed', legacyMap(reloaded.pois));
        }
      }

      // ---------------- E2b inline の POI を POI ソースへ変換 ----------------
      const converted = convertInlineEntries(structuredClone(inlineFixture), 'ja');
      console.log('record: E2b convert issues ' + JSON.stringify(converted.issues) + ' hasError ' + converted.hasError);
      recordAll('E2b', 'convert', featureMap(converted.fc));
      const e2bCreated = await PoiSourceService.createLocal({
        slug: 'directgo-e2b', title: { ja: 'directgo E2b' }, lang: 'ja', fc: converted.fc,
      });
      if (e2bCreated.result !== 'Success') {
        recordRejected('E2b', 'create', JSON.stringify(e2bCreated));
      } else {
        await roundTripSource('E2b', e2bCreated.uid);
      }

      // ---------------- E5 ファイルの取り込み（GeoJSON と旧オブジェクト形の JSON）----------------
      const e5Geo = await PoiSourceService.importFile({
        slug: 'directgo-e5', title: { ja: 'directgo E5' }, filePath: ${JSON.stringify(paths.poisFixture)}, lang: 'ja',
      });
      if (e5Geo.result !== 'Success') {
        recordRejected('E5-geojson', 'import', JSON.stringify(e5Geo));
      } else {
        console.log('record: E5-geojson import issues ' + issuesText(e5Geo));
        await roundTripSource('E5-geojson', e5Geo.uid);
      }
      const e5Legacy = await PoiSourceService.importFile({
        slug: 'directgo-e5-legacy', title: { ja: 'directgo E5 legacy' }, filePath: ${JSON.stringify(paths.inlineFixture)}, lang: 'ja',
      });
      if (e5Legacy.result !== 'Success') {
        recordRejected('E5-legacy', 'import', JSON.stringify(e5Legacy));
      } else {
        console.log('record: E5-legacy import issues ' + issuesText(e5Legacy));
        await roundTripSource('E5-legacy', e5Legacy.uid);
      }

      // ---------------- E6 書き出し（POI ソース参照 + inline の旧オブジェクト形を持つ地図）----------------
      const e1Uid = e1Created.uid;
      const e6Save = await MapEditService.save({
        mapObject: { ...mapBase, mapID: 'directgo-export-map', pois: [{ poiUid: e1Uid }, ...structuredClone(inlineFixture)] },
        tins: [], slug: 'directgo-export-map',
      });
      assert.equal(e6Save.result, 'Success', 'E6 地図の保存: ' + JSON.stringify(e6Save));
      const e6MapObject = await MapEditService.request(e6Save.uid);
      const { compiled: e6Compiled, documents: e6Documents, warnings: e6Warnings } =
        await composeDownloadMapJson(e6MapObject, []);
      console.log('record: E6 warnings ' + JSON.stringify(e6Warnings) + ' documents ' + JSON.stringify(e6Documents.map((d: any) => d.dest)));
      const e6Doc = e6Documents.find((d: any) => d.dest === 'pois/directgo-e1.geojson');
      assert.ok(e6Doc, 'E6: POI ソースの実体 pois/directgo-e1.geojson が書き出されるはず');
      recordAll('E6-source', 'export', featureMap(e6Doc.json));
      recordAll('E6-inline', 'export', legacyMap(e6Compiled.pois));

      // ---------------- E7 プレビュー（AppPreviewService と同じ外部化 + exportForm）----------------
      const e7Ctx = createPoiExternalizationContext();
      const e7 = await externalizePoisArray([{ poiUid: e1Uid }, ...structuredClone(inlineFixture)], e7Ctx);
      console.log('record: E7 warnings ' + JSON.stringify(e7.warnings) + ' documents ' + JSON.stringify(e7.documents.map((d: any) => d.dest)));
      const e7Doc = e7.documents.find((d: any) => d.dest === 'pois/directgo-e1.geojson');
      assert.ok(e7Doc, 'E7: POI ソースの実体 pois/directgo-e1.geojson が配られるはず');
      recordAll('E7-source', 'preview', featureMap(e7Doc.json));
      recordAll('E7-inline', 'preview', legacyMap(e7.pois));
      recordAll('E7-exportForm', 'exportForm', featureMap(await PoiSourceService.exportForm(e1Uid)));

      // ---------------- P4（javascript: の値）: 保存も取り込みも拒まれる ----------------
      const isLinkFormatRejection = (r: any) => r?.result === 'Invalid'
        && Array.isArray(r.issues)
        && r.issues.some((i: any) => i.level === 'error' && i.code === 'content-mode-link-format');
      const p4Created = await PoiSourceService.createLocal({ slug: 'directgo-p4', title: { ja: 'directgo P4' }, lang: 'ja' });
      const p4Saved = await PoiSourceService.save(p4Created.uid, {
        slug: 'directgo-p4', title: { ja: 'directgo P4' }, fc: rejectedFixture, expectedRevision: p4Created.revision,
      });
      console.log('result: P4 E1 save ' + (isLinkFormatRejection(p4Saved) ? 'rejected' : 'accepted') + ' ' + JSON.stringify(p4Saved));
      assert.ok(isLinkFormatRejection(p4Saved), 'P4: javascript: の directgo は保存で content-mode-link-format の error になるはず');
      const p4Stored = await PoiSourceService.get(p4Created.uid);
      assert.ok(
        !(p4Stored?.fc?.features ?? []).some((f: any) => f?.properties?.directgo !== undefined),
        'P4: 拒まれた保存の値は残らないはず',
      );
      const p4Import = await PoiSourceService.importFile({
        slug: 'directgo-p4-import', title: { ja: 'directgo P4 import' }, filePath: ${JSON.stringify(paths.rejectedFixture)}, lang: 'ja',
      });
      console.log('result: P4 E5 import ' + (isLinkFormatRejection(p4Import) ? 'rejected' : 'accepted') + ' ' + JSON.stringify(p4Import));
      assert.ok(isLinkFormatRejection(p4Import), 'P4: javascript: の directgo は取り込みで content-mode-link-format の error になるはず');

      // ---------------- 判定 ----------------
      const bad = rows.filter((r) => r.outcome !== 'kept');
      console.log('summary: ' + rows.length + ' checks, ' + (rows.length - bad.length) + ' kept, ' + bad.length + ' not kept');
      assert.deepStrictEqual(
        bad, [],
        'P1〜P3 の directgo はすべての経路で入力と同じ値のまま残るはず: ' + JSON.stringify(bad),
      );
      console.log('directgo roundtrip smoke passed');
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
        external: [
          'jimp',
          'pwa-asset-generator',
          '@maplat/tin',
          '@maplat/transform',
        ],
        output: {
          entryFileNames: 'directgo-roundtrip-smoke.mjs',
          format: 'es',
        },
      },
    },
  });

  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [bundledFile], {
      cwd: projectRoot,
      timeout: 180000,
      maxBuffer: 1024 * 1024 * 8,
    });
    process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
  } catch (error) {
    failed = true;
    if (error.stdout) process.stdout.write(error.stdout);
    if (error.stderr) process.stderr.write(error.stderr);
    console.error('directgo roundtrip smoke failed');
  }
} finally {
  await rm(workDir, { recursive: true, force: true });
}
if (failed) process.exit(1);
