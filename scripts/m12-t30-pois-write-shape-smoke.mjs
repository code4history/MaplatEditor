// M12-T30 スモーク: pois の多重 stringify 復元撤去 + 書き込み側回帰テスト（設計 §5.3）。
// sp-0006（絶対遵守）: 読み込み側の正規化に入れてよいのは「過去の正規形式の受容」のみ。
// 多重 stringify 復元（healPoisValue の bounded reparse ループ）と poiSources フォールバックは
// 実装ミスの後始末であり撤去する。撤去後の単一実装 src/utils/appPoisFormat.ts の
// readAppDocumentPois が「配列のみ正準」という形式仕様を判定する（parse ゼロ）。
//
// Part A: 純関数 readAppDocumentPois の全分岐表（表駆動） — 深さ1を含む全文字列形が
//         unsupported: true になること（= parse 復元が存在しないことの behavioral 証明）
// Part B: 永続化層 round-trip（実 AppDataService） — 正常配列の維持 + 未対応形式の生値温存
// Part C: 構造 assert（撤去の恒久ガード） — 撤去ファイル不在 / MAX_REPARSE_DEPTH 0件 /
//         appPoisFormat.ts に JSON.parse 不在 / preview・export の poiSources 読み撤去 /
//         AppEdit.vue の新配線
import { mkdtemp, rm, writeFile, mkdir, readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'm12-t30-pois-'));
const entryFile = path.join(workDir, 'm12-t30-smoke.ts');
const electronStubFile = path.join(workDir, 'electron-stub.ts');
const electronStoreStubFile = path.join(workDir, 'electron-store-stub.ts');
const outDir = path.join(workDir, 'dist');
const bundledFile = path.join(outDir, 'm12-t30-smoke.mjs');

// ---- Part C 補助: ディレクトリを再帰走査して .ts/.vue ファイル中の文字列出現を数える ----
async function walkFiles(dir, exts) {
  const out = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.tmp-smoke' || entry.name === 'dist') continue;
      out.push(...(await walkFiles(full, exts)));
    } else if (exts.some((ext) => entry.name.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

async function countOccurrences(dirs, exts, needle) {
  let count = 0;
  const hits = [];
  for (const dir of dirs) {
    const files = await walkFiles(dir, exts);
    for (const file of files) {
      const content = await readFile(file, 'utf8');
      if (content.includes(needle)) {
        count += 1;
        hits.push(file);
      }
    }
  }
  return { count, hits };
}

try {
  const dataDir = path.join(workDir, 'data');
  const appDataServicePath = path.join(projectRoot, 'electron/services/AppDataService.ts');
  const settingsPath = path.join(projectRoot, 'electron/services/SettingsService.ts');
  const appPoisFormatPath = path.join(projectRoot, 'src/utils/appPoisFormat.ts');

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

      const { readAppDocumentPois } = await import(${JSON.stringify(appPoisFormatPath)});

      // ---- Part A: 純関数 readAppDocumentPois の全分岐表 ----
      const fixture = [
        { poiUid: '11111111-1111-4111-8111-111111111111', cachedTitle: '京都POI', icon: 'builtin:defaultpin-red' },
        'https://example.com/pois.geojson',
      ];
      const depth1 = JSON.stringify(fixture);
      const depth2 = JSON.stringify(depth1);
      let depth6 = fixture;
      for (let i = 0; i < 6; i++) depth6 = JSON.stringify(depth6);

      const cases = [
        { label: '配列', input: { pois: fixture }, expected: { pois: fixture, unsupported: false } },
        { label: '未設定 (pois/poiSources とも undefined)', input: {}, expected: { pois: [], unsupported: false } },
        { label: 'null (pois/poiSources とも null)', input: { pois: null, poiSources: null }, expected: { pois: [], unsupported: false } },
        { label: '深さ1 stringify', input: { pois: depth1 }, expected: { pois: [], unsupported: true } },
        { label: '深さ2 stringify', input: { pois: depth2 }, expected: { pois: [], unsupported: true } },
        { label: '深さ6 stringify', input: { pois: depth6 }, expected: { pois: [], unsupported: true } },
        { label: 'URL 文字列', input: { pois: 'https://example.com/pois.geojson' }, expected: { pois: [], unsupported: true } },
        { label: '空文字列', input: { pois: '' }, expected: { pois: [], unsupported: true } },
        { label: 'レイヤ名キー object', input: { pois: { main: [], id1: [] } }, expected: { pois: [], unsupported: true } },
        { label: 'poiSources のみ残存', input: { poiSources: '[]' }, expected: { pois: [], unsupported: true } },
        { label: '配列 + poiSources 併存 (配列採用)', input: { pois: fixture, poiSources: 'junk' }, expected: { pois: fixture, unsupported: false } },
      ];
      for (const { label, input, expected } of cases) {
        const actual = readAppDocumentPois(input);
        assert.deepEqual(actual, expected, \`readAppDocumentPois: \${label} — got \${JSON.stringify(actual)}\`);
      }
      console.log('ok: readAppDocumentPois 全分岐表（深さ1を含む全文字列形が unsupported: true）');

      // ---- Part B: 永続化層 round-trip ----
      const { default: SettingsService } = await import(${JSON.stringify(settingsPath)});
      SettingsService.set('saveFolder', ${JSON.stringify(dataDir)});
      const { default: AppDataService } = await import(${JSON.stringify(appDataServicePath)});

      function baseAppDoc(overrides) {
        return {
          appID: overrides.appID, appName: { ja: 'T30' }, title: { ja: 'T30' }, description: {}, keywords: '',
          siteUrl: '', lang: 'ja', sources: [], httpSettings: {}, appSettings: {}, manifestSettings: {},
          ...overrides,
        };
      }

      // (i) 正常配列 pois: 保存→読込→再保存→再読込しても配列のまま deep-equal を維持する
      {
        const created = await AppDataService.saveApp({ document: baseAppDoc({ appID: 't30-normal', pois: fixture }), slug: 't30-normal' });
        assert.equal(created.result, 'Success', 'saveApp (normal): ' + JSON.stringify(created));
        const loaded = await AppDataService.getApp(created.uid);
        assert.deepEqual(loaded.pois, fixture, '往復1: pois が配列のまま維持されるはず');
        assert.notEqual(typeof loaded.pois, 'string', '往復1: pois が文字列化していないはず');
        const resaved = await AppDataService.saveApp({ document: baseAppDoc({ appID: 't30-normal', pois: loaded.pois }), uid: created.uid, slug: 't30-normal' });
        assert.equal(resaved.result, 'Success', 'saveApp (再保存): ' + JSON.stringify(resaved));
        const reloaded = await AppDataService.getApp(created.uid);
        assert.deepEqual(reloaded.pois, fixture, '往復2: pois が配列のまま維持されるはず（深さが増えない）');
        assert.notEqual(typeof reloaded.pois, 'string', '往復2: pois が文字列化していないはず');
      }
      console.log('ok: AppDataService round-trip（正常配列 pois の deep-equal 維持）');

      // (ii) 未対応形式（URL 文字列 pois + junk poiSources）: 保存→読込で生値が逐語温存される
      {
        const rawPois = 'https://example.com/legacy-pois.json';
        const rawPoiSources = '"[[broken"';
        const saved = await AppDataService.saveApp({
          document: baseAppDoc({ appID: 't30-unsupported', pois: rawPois, poiSources: rawPoiSources }),
          slug: 't30-unsupported',
        });
        assert.equal(saved.result, 'Success', 'saveApp (unsupported): ' + JSON.stringify(saved));
        const loaded = await AppDataService.getApp(saved.uid);
        assert.equal(loaded.pois, rawPois, 'data_json に pois 生値が逐語温存される');
        assert.equal(loaded.poiSources, rawPoiSources, 'data_json に poiSources 生値が逐語温存される');
      }
      console.log('ok: AppDataService round-trip（未対応形式の生値温存）');

      console.log('M12-T30 pois write-shape smoke passed');
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
          entryFileNames: 'm12-t30-smoke.mjs',
          format: 'es',
        },
      },
    },
  });

  await execFileAsync(process.execPath, [bundledFile], {
    cwd: projectRoot,
    timeout: 30000,
    maxBuffer: 1024 * 1024 * 8,
  });

  // ---- Part C: 構造 assert（撤去の恒久ガード） ----
  const poiSourcesHealPath = path.join(projectRoot, 'src/utils/poiSourcesHeal.ts');
  const jsonArrayPath = path.join(projectRoot, 'electron/utils/jsonArray.ts');
  assert.equal(existsSync(poiSourcesHealPath), false, 'src/utils/poiSourcesHeal.ts が撤去されていない（多重 stringify 復元ループの残存）');
  assert.equal(existsSync(jsonArrayPath), false, 'electron/utils/jsonArray.ts が撤去されていない（1段 parse の残存）');

  const maxReparseHits = await countOccurrences(
    [path.join(projectRoot, 'src'), path.join(projectRoot, 'electron')],
    ['.ts', '.vue'],
    'MAX_REPARSE_DEPTH',
  );
  assert.equal(maxReparseHits.count, 0, `MAX_REPARSE_DEPTH がコードベースに残存している: ${JSON.stringify(maxReparseHits.hits)}`);

  const appPoisFormatSrc = await readFile(appPoisFormatPath, 'utf8');
  assert.doesNotMatch(appPoisFormatSrc, /JSON\.parse/, 'appPoisFormat.ts に JSON.parse が含まれている（復元ロジックの再混入）');
  assert.match(appPoisFormatSrc, /export function readAppDocumentPois/, 'appPoisFormat.ts に readAppDocumentPois が定義されていない');

  const appExportServiceSrc = await readFile(path.join(projectRoot, 'electron/services/AppExportService.ts'), 'utf8');
  const appPreviewServiceSrc = await readFile(path.join(projectRoot, 'electron/services/AppPreviewService.ts'), 'utf8');
  assert.doesNotMatch(appExportServiceSrc, /document\.poiSources/, 'AppExportService.ts に document.poiSources 読みが残存している');
  assert.doesNotMatch(appPreviewServiceSrc, /document\.poiSources/, 'AppPreviewService.ts に document.poiSources 読みが残存している');
  assert.match(appExportServiceSrc, /readAppDocumentPois/, 'AppExportService.ts が readAppDocumentPois を import/使用していない');
  assert.match(appPreviewServiceSrc, /readAppDocumentPois/, 'AppPreviewService.ts が readAppDocumentPois を import/使用していない');
  assert.doesNotMatch(appExportServiceSrc, /normalizeJsonArray/, 'AppExportService.ts に normalizeJsonArray への参照が残存している');
  assert.doesNotMatch(appPreviewServiceSrc, /normalizeJsonArray/, 'AppPreviewService.ts に normalizeJsonArray への参照が残存している');

  const appEditView = await readFile(path.join(projectRoot, 'src/views/AppEdit.vue'), 'utf8');
  assert.match(
    appEditView,
    /import \{ readAppDocumentPois \} from "\.\.\/utils\/appPoisFormat"/,
    'AppEdit.vue が readAppDocumentPois (appPoisFormat) を import していない',
  );
  assert.match(appEditView, /poisUnsupported/, 'AppEdit.vue に poisUnsupported の配線がない');
  assert.doesNotMatch(appEditView, /poiHealFailed/, 'AppEdit.vue に旧 poiHealFailed の残存がある');
  assert.doesNotMatch(appEditView, /healAppDocumentPois|healPoisValue/, 'AppEdit.vue に旧 heal 関数への参照が残存している');
  assert.match(
    appEditView,
    /v-if="poisUnsupported"[\s\S]{0,120}?appedit\.poi_format_unsupported/,
    'AppEdit.vue が未対応形式の警告 (appedit.poi_format_unsupported) を配線していない',
  );

  // 11 locale すべてに poi_format_unsupported が存在し、旧キー poi_heal_failed が残存しない
  const LOCALES = ['de', 'en', 'es', 'fr', 'id', 'ja', 'ko', 'th', 'vi', 'zh', 'zh-TW'];
  for (const locale of LOCALES) {
    const translation = JSON.parse(
      await readFile(path.join(projectRoot, `public/locales/${locale}/translation.json`), 'utf8'),
    );
    const newValue = translation?.appedit?.poi_format_unsupported;
    assert.equal(typeof newValue, 'string', `i18n key missing: ${locale} appedit.poi_format_unsupported`);
    assert.notEqual(newValue.trim(), '', `i18n key empty: ${locale} appedit.poi_format_unsupported`);
    assert.equal(
      translation?.appedit && 'poi_heal_failed' in translation.appedit,
      false,
      `i18n key must be removed: ${locale} appedit.poi_heal_failed`,
    );
  }
  console.log('ok: i18n poi_format_unsupported が 11 locale すべてに存在し、poi_heal_failed が残存しない');

  console.log('M12-T30 pois write-shape smoke (Part C 構造 assert) passed');
} finally {
  await rm(workDir, { recursive: true, force: true });
}
