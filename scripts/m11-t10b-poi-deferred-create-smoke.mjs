// M11-T10b smoke: POI 遅延作成統一。
// Part 1 (service): createLocal の fc 拡張 — 内容入り単一作成 / lang 解決 / Invalid 拒否 / 後方互換。
// Part 2 (静的検査): PoiSourceList が行作成 IPC を直接呼ばないこと、PoiEdit が未作成モード契約を持つこと、
//   11 locale に editor_ui.busy_importing があること。
// 設計: docs/superpowers/specs/2026-07-18-m11-t10b-poi-deferred-create-design.md v1.2
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'm11-t10b-'));
const entryFile = path.join(workDir, 'm11-t10b-smoke.ts');
const electronStubFile = path.join(workDir, 'electron-stub.ts');
const electronStoreStubFile = path.join(workDir, 'electron-store-stub.ts');
const outDir = path.join(workDir, 'dist');
const bundledFile = path.join(outDir, 'm11-t10b-smoke.mjs');

try {
  const dataDir = path.join(workDir, 'data');
  const sqlitePath = path.join(projectRoot, 'electron/services/SqliteDataService.ts');
  const servicePath = path.join(projectRoot, 'electron/services/PoiSourceService.ts');

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

      const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

      const { default: SettingsService } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/SettingsService.ts'))});
      SettingsService.set('saveFolder', ${JSON.stringify(dataDir)});
      SettingsService.set('lang', 'ja');

      const { default: SqliteDataService } = await import(${JSON.stringify(sqlitePath)});
      const { default: poiSourceService } = await import(${JSON.stringify(servicePath)});
      await SqliteDataService.getDb();

      const validFeature = {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [139.7, 35.6] },
        properties: { name: { ja: '遅延作成POI' } },
      };

      // (a) createLocal with fc: 内容入り単一作成（遅延作成の保存経路そのもの）
      const presetUid = crypto.randomUUID();
      const withContent = await poiSourceService.createLocal({
        slug: 'deferred-poi',
        title: { ja: '遅延作成' },
        lang: 'ja',
        uid: presetUid,
        fc: { type: 'FeatureCollection', lang: 'ja', features: [validFeature] },
      });
      assert.equal(withContent.result, 'Success', 'fc 指定 createLocal は Success のはず: ' + JSON.stringify(withContent));
      assert.equal(withContent.uid, presetUid, 'preset uid が採用されるはず');
      assert.equal(withContent.revision, 1, '新規作成は revision=1 のはず');
      const gotContent = await poiSourceService.get(presetUid);
      assert.equal(gotContent.featureCount, 1, 'feature 1 件で作成されるはず');
      assert.equal(gotContent.fc.lang, 'ja');
      assert.equal(gotContent.fc.features.length, 1);
      assert.ok(typeof gotContent.fc.features[0].id === 'string' && gotContent.fc.features[0].id !== '', '表示IDが採番されるはず');
      assert.match(gotContent.fc.features[0].properties._maplatUid, UUID_PATTERN, '_maplatUid が採番されるはず');
      assert.deepEqual(gotContent.fc.features[0].properties.name, { ja: '遅延作成POI' }, 'name は内部形のまま保持されるはず');
      console.log('ok: (a) createLocal with fc creates content in one write');

      // (b1) lang: fc.lang が input.lang より優先
      const fcLangWins = await poiSourceService.createLocal({
        slug: 'lang-fc-wins',
        title: { ja: 'lang' },
        lang: 'ja',
        fc: { type: 'FeatureCollection', lang: 'en', features: [] },
      });
      assert.equal(fcLangWins.result, 'Success');
      const gotEn = await poiSourceService.get(fcLangWins.uid);
      assert.equal(gotEn.lang, 'en', 'fc.lang が input.lang より優先されるはず');
      console.log('ok: (b1) fc.lang wins over input.lang');

      // (b2) lang: fc.lang 無し + input.lang='ja' → 'ja'
      const inputLangUsed = await poiSourceService.createLocal({
        slug: 'lang-input',
        title: { ja: 'lang' },
        lang: 'ja',
        fc: { type: 'FeatureCollection', features: [] },
      });
      assert.equal(inputLangUsed.result, 'Success');
      const gotJa = await poiSourceService.get(inputLangUsed.uid);
      assert.equal(gotJa.lang, 'ja', 'fc.lang 無しの場合 input.lang が使われるはず');
      console.log('ok: (b2) input.lang is used when fc.lang is absent');

      // (b3) lang: 両方無し → SettingsService.get('lang')
      const settingsLangUsed = await poiSourceService.createLocal({
        slug: 'lang-settings',
        title: { ja: 'lang' },
        fc: { type: 'FeatureCollection', features: [] },
      });
      assert.equal(settingsLangUsed.result, 'Success');
      const gotSettings = await poiSourceService.get(settingsLangUsed.uid);
      assert.equal(gotSettings.lang, 'ja', '両方無しの場合 settings lang (ja) が使われるはず');
      console.log('ok: (b3) settings lang is the final fallback');

      // (c) Invalid fc (name 欠落 = level error) は拒否され、行も残らない
      const invalid = await poiSourceService.createLocal({
        slug: 'invalid-fc',
        title: { ja: 'invalid' },
        fc: {
          type: 'FeatureCollection',
          features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [139.7, 35.6] }, properties: {} }],
        },
      });
      assert.equal(invalid.result, 'Invalid', 'error 含有 fc は Invalid 拒否のはず: ' + JSON.stringify(invalid));
      const missingRow = await poiSourceService.get('invalid-fc');
      assert.equal(missingRow, null, 'Invalid 拒否時に行が残らないはず');
      console.log('ok: (c) invalid fc is rejected without creating a row');

      // (d) 後方互換: fc 省略は従来どおり空ソース作成
      const legacy = await poiSourceService.createLocal({ slug: 'legacy-empty', title: '空', lang: 'ja' });
      assert.equal(legacy.result, 'Success', 'fc 省略の従来 createLocal は Success のはず');
      const gotLegacy = await poiSourceService.get(legacy.uid);
      assert.equal(gotLegacy.featureCount, 0, 'fc 省略は空ソースのはず');
      assert.deepEqual(gotLegacy.fc.features, []);
      console.log('ok: (d) createLocal without fc keeps backward compatibility');

      console.log('m11-t10b service smoke: PASS');
    `
  );

  // vite build (ssr/node target) で stub を alias してバンドル
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
          entryFileNames: 'm11-t10b-smoke.mjs',
          format: 'es',
        },
      },
    },
  });

  const { stdout, stderr } = await execFileAsync(process.execPath, [bundledFile], {
    cwd: projectRoot,
    timeout: 120000,
    maxBuffer: 1024 * 1024 * 8,
  });
  process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);

  // Part 2: 静的検査（設計 §イベント契約表 のコードアンカー）
  const poiSourceListSrc = await readFile(path.join(projectRoot, 'src/views/PoiSourceList.vue'), 'utf8');
  assert.ok(!poiSourceListSrc.includes('poiSources.createLocal('), 'PoiSourceList が createLocal を直接呼ばないこと');
  assert.ok(!poiSourceListSrc.includes('poiSources.importFile('), 'PoiSourceList が importFile を直接呼ばないこと');
  assert.ok(!poiSourceListSrc.includes('poiSources.save('), 'PoiSourceList が save を直接呼ばないこと');
  assert.ok(poiSourceListSrc.includes('ResourceDraftCard'), 'PoiSourceList が下書きカードを描画すること');
  assert.ok(poiSourceListSrc.includes('duplicateEditorPath'), 'PoiSourceList の複製が duplicateEditorPath 経由であること');
  assert.ok(poiSourceListSrc.includes("'/poisources/new?import=1'") || poiSourceListSrc.includes('"/poisources/new?import=1"'), 'PoiSourceList の Import が /poisources/new?import=1 遷移であること');
  console.log('ok: Part2-1 PoiSourceList は遷移と予約のみを担う');

  const poiEditSrc = await readFile(path.join(projectRoot, 'src/views/PoiEdit.vue'), 'utf8');
  assert.ok(poiEditSrc.includes('"new"') && poiEditSrc.includes('newPoiUid'), 'PoiEdit が new 未作成モード分岐を持つこと');
  assert.ok(poiEditSrc.includes('duplicateFrom'), 'PoiEdit が duplicateFrom 初期化を持つこと');
  assert.ok(poiEditSrc.includes('importAutoRun'), 'PoiEdit が import 自動起動を持つこと');
  assert.ok(poiEditSrc.includes('draftDirty'), 'PoiEdit が draftDirty を持つこと');
  assert.ok(poiEditSrc.includes('createLocal('), 'PoiEdit の保存分岐が createLocal を呼ぶこと');
  assert.ok(poiEditSrc.includes('slugField.value?.release()'), 'PoiEdit の予約 teardown が slugField.release() を呼ぶこと');
  console.log('ok: Part2-2 PoiEdit は未作成モード契約を持つ');

  const locales = ['ja', 'en', 'de', 'es', 'fr', 'id', 'ko', 'th', 'vi', 'zh', 'zh-TW'];
  for (const locale of locales) {
    const translation = JSON.parse(await readFile(path.join(projectRoot, `public/locales/${locale}/translation.json`), 'utf8'));
    assert.ok(translation.editor_ui?.busy_importing, `${locale} に editor_ui.busy_importing があること`);
  }
  console.log('ok: Part2-3 editor_ui.busy_importing は 11 locale に存在');

  console.log('m11-t10b smoke: ALL PASS');
} finally {
  await rm(workDir, { recursive: true, force: true });
}
