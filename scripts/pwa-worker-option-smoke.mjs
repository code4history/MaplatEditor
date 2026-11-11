// #106: PWA が有効でキャッシュが無効なとき、ビューアに Service Worker を登録させない（pwaWorker: false）スモーク。
//
//   (a) 判定の純関数 resolveViewerPwaWorker（src/utils/appHttpSettings.ts）の表
//   (b) 書き出し: AppExportService.renderIndexHtml の `var option = {…};` と manifest の link
//       - PWA オン・キャッシュオフ → pwaWorker === false・manifest の link あり
//       - PWA オン・キャッシュオン → pwaWorker のキーが無い・manifest の link あり
//       - PWA オフ（キャッシュの値によらず） → pwaWorker のキーも manifest の link も無い
//   (c) プレビュー: AppPreviewService.createViewerOption で (b) と同じ 3 通り
//   (d) 設定名の言い換え（11 言語の appedit.pwa_manifest・pwa_manifest_note・cache_ui・cache_ui_note）
//       - ja・en は決めた文と完全一致
//       - 他の 9 言語は空でない・キーの文字列でない・ja の写しでない・言い換える前の値
//         （scripts/fixtures/pwa-cache-wording-before.json）と違う（言い換えの漏れを赤にする）
//
// harness は他の書き出しのスモークと同じ（vite SSR ビルド + electron/electron-store スタブ + saveFolder=一時 dir）。
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { build } from 'vite';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const LANGS = ['de', 'en', 'es', 'fr', 'id', 'ja', 'ko', 'th', 'vi', 'zh', 'zh-TW'];
const KEYS = ['pwa_manifest', 'pwa_manifest_note', 'cache_ui', 'cache_ui_note'];

const failures = [];
const check = async (label, fn) => {
  try { await fn(); console.log(`ok: ${label}`); }
  catch (e) { failures.push(label); console.log(`FAIL: ${label}\n  ${String(e?.message || e).split('\n').join('\n  ')}`); }
};

// ---- (d) 文言（ホスト側。ビルド不要） ----
const EXPECTED = {
  ja: {
    pwa_manifest: 'ホーム画面に追加（PWA）',
    pwa_manifest_note: 'エクスポートしたアプリを、スマートフォンなどのホーム画面に追加して単独のアプリのように開けるようにします。オンにすると Web App Manifest とアイコンを出力し、下に「マニフェスト設定」欄が現れます。オフのときは「オフライン表示（キャッシュ）」も使えません。',
    cache_ui: 'オフライン表示（キャッシュ）',
    cache_ui_note: '一度読み込んだタイルを端末に残し、次からはオフラインでも表示できるようにします。オンにするとエクスポートに Service Worker を含め、ブラウザに登録させます。オフにすると Service Worker を含めず、登録もさせません（ホーム画面への追加はそのまま使えます）。「ホーム画面に追加（PWA）」がオフのときは使えません。',
  },
  en: {
    pwa_manifest: 'Add to home screen (PWA)',
    pwa_manifest_note: 'Lets the exported app be added to the home screen of a smartphone or other device and opened like a standalone app. When on, a Web App Manifest and icons are emitted and the Manifest Settings section appears below. While it is off, Offline viewing (cache) cannot be used either.',
    cache_ui: 'Offline viewing (cache)',
    cache_ui_note: 'Keeps tiles that have been loaded once on the device so they can be shown next time, even offline. When on, a Service Worker is included in the export and the browser is made to register it. When off, no Service Worker is included or registered (adding to the home screen still works). It cannot be used while Add to home screen (PWA) is off.',
  },
};
const before = JSON.parse(await readFile(path.join(projectRoot, 'scripts/fixtures/pwa-cache-wording-before.json'), 'utf8'));
const locales = {};
for (const lang of LANGS) {
  locales[lang] = JSON.parse(await readFile(path.join(projectRoot, `public/locales/${lang}/translation.json`), 'utf8')).appedit || {};
}
for (const lang of ['ja', 'en']) {
  await check(`(d) ${lang}: 4 キーが決めた文と一致`, () => {
    for (const key of KEYS) assert.equal(locales[lang][key], EXPECTED[lang][key], `${lang} appedit.${key}`);
  });
}
for (const lang of LANGS.filter((l) => l !== 'ja' && l !== 'en')) {
  await check(`(d) ${lang}: 4 キーが言い換えてある（空でない・キーでない・ja の写しでない・前の値と違う）`, () => {
    for (const key of KEYS) {
      const value = locales[lang][key];
      assert.equal(typeof value, 'string', `${lang} appedit.${key} が無い`);
      assert.ok(value.trim().length > 0, `${lang} appedit.${key} が空`);
      assert.notEqual(value, key, `${lang} appedit.${key} がキーの文字列`);
      assert.notEqual(value, `appedit.${key}`, `${lang} appedit.${key} がキーの文字列`);
      assert.notEqual(value, locales.ja[key], `${lang} appedit.${key} が ja の写し`);
      assert.notEqual(value, before[lang][key], `${lang} appedit.${key} が言い換える前のまま`);
    }
  });
}

// ---- (a)(b)(c) 本体（vite SSR ビルド） ----
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'pwa-worker-option-'));
const entryFile = path.join(workDir, 'entry.ts');
const electronStubFile = path.join(workDir, 'electron-stub.ts');
const electronStoreStubFile = path.join(workDir, 'electron-store-stub.ts');
const outDir = path.join(workDir, 'dist');
const bundledFile = path.join(outDir, 'pwa-worker-option-smoke.mjs');
const p = (rel) => JSON.stringify(path.join(projectRoot, rel));

try {
  await writeFile(electronStubFile, `
    export const app = {
      getPath(name: string) { return ${JSON.stringify(workDir)} + '/' + name; },
      getName() { return 'MaplatEditorSmoke'; },
      getAppPath() { return ${JSON.stringify(projectRoot)}; },
      isPackaged: false,
      whenReady() { return Promise.resolve(); },
      exit() {},
    };
    export const ipcMain = { handle() {}, removeHandler() {} };
    export const dialog = {
      async showOpenDialog() { return { canceled: true, filePaths: [] }; },
      async showSaveDialog() { return { canceled: true, filePath: undefined }; },
      async showMessageBox() { return { response: 0 }; },
    };
    export const BrowserWindow = class {
      constructor() { throw new Error('BrowserWindow is not available in the smoke sandbox'); }
      static fromWebContents() { return { webContents: { send() {} } }; }
      static getAllWindows() { return []; }
    };
    export const session = { defaultSession: { clearStorageData() { return Promise.resolve(); }, webRequest: { onBeforeRequest: () => {} } } };
    export const shell = { trashItem() { return Promise.resolve(); } };
  `);
  await writeFile(electronStoreStubFile, `
    export default class Store<T extends Record<string, any>> {
      store: T;
      constructor(options: { defaults?: T } = {}) { this.store = { ...(options.defaults || {}) } as T; }
      get(key: string) { return this.store[key]; }
      set(key: string, value: any) { this.store[key as keyof T] = value; }
      has(key: string) { return Object.prototype.hasOwnProperty.call(this.store, key); }
    }
  `);
  await writeFile(entryFile, `
    import assert from 'node:assert/strict';
    import nodePath from 'node:path';
    import fs from 'node:fs/promises';
    import * as httpSettingsMod from ${p('src/utils/appHttpSettings.ts')};
    const failures: string[] = [];
    const check = async (label: string, fn: () => any) => {
      try { await fn(); console.log('ok: ' + label); }
      catch (e: any) { failures.push(label); console.log('FAIL: ' + label + '\\n  ' + String(e && e.message || e).split('\\n').join('\\n  ')); }
    };

    const resolve = (httpSettingsMod as any).resolveViewerPwaWorker;
    await check('(a) resolveViewerPwaWorker の表', () => {
      assert.equal(typeof resolve, 'function', 'src/utils/appHttpSettings.ts に resolveViewerPwaWorker が無い');
      assert.equal(resolve({ pwaManifest: true, enableCache: false }), false);
      assert.equal(resolve({ pwaManifest: true }), false, 'キャッシュの値が無い（偽）');
      assert.equal(resolve({ pwaManifest: true, enableCache: true }), undefined);
      assert.equal(resolve({ pwaManifest: false, enableCache: false }), undefined);
      assert.equal(resolve({ pwaManifest: false, enableCache: true }), undefined);
      assert.equal(resolve({}), undefined);
      assert.equal(resolve(undefined), undefined);
    });

    const svcDir = nodePath.join(${JSON.stringify(workDir)}, 'svc');
    await fs.mkdir(svcDir, { recursive: true });
    const { default: SettingsService } = await import(${p('electron/services/SettingsService.ts')});
    SettingsService.set('saveFolder', svcDir);
    SettingsService.set('lang', 'ja');
    const { default: AppExportService } = await import(${p('electron/services/AppExportService.ts')});
    const { default: AppPreviewService } = await import(${p('electron/services/AppPreviewService.ts')});

    const doc = (httpSettings: any) => ({ appID: 'pwa_app', title: { ja: 'PWA の試験' }, lang: 'ja', sources: [], pois: [], httpSettings, appSettings: {}, manifestSettings: {} });
    const CASES = [
      { name: 'PWA オン・キャッシュオフ', http: { pwaManifest: true, enableCache: false }, worker: false, manifest: true },
      { name: 'PWA オン・キャッシュオン', http: { pwaManifest: true, enableCache: true }, worker: undefined, manifest: true },
      { name: 'PWA オフ・キャッシュオフ', http: { pwaManifest: false, enableCache: false }, worker: undefined, manifest: false },
      { name: 'PWA オフ・キャッシュオン', http: { pwaManifest: false, enableCache: true }, worker: undefined, manifest: false },
    ];

    await check('(b) 書き出し: index.html の viewerOption と manifest の link', () => {
      for (const c of CASES) {
        const html: string = (AppExportService as any).renderIndexHtml(doc(c.http), 'pwa_app', {}, true, [], undefined, undefined, undefined);
        const m = /var option = (\\{[\\s\\S]*?\\n {4}\\});/.exec(html);
        assert.ok(m, c.name + ': var option が見つからない');
        const option = JSON.parse(m[1]);
        if (c.worker === false) assert.equal(option.pwaWorker, false, c.name + ': pwaWorker が false でない');
        else assert.equal(Object.prototype.hasOwnProperty.call(option, 'pwaWorker'), false, c.name + ': pwaWorker のキーがある');
        assert.equal(html.includes('<link rel="manifest" href="pwa/pwa_app_manifest.json">'), c.manifest, c.name + ': manifest の link');
        assert.equal(option.pwaManifest, c.manifest, c.name + ': pwaManifest');
      }
    });

    await check('(c) プレビュー: createViewerOption の値', () => {
      for (const c of CASES) {
        const option = (AppPreviewService as any).createViewerOption('tok', doc(c.http), true);
        if (c.worker === false) assert.equal(option.pwaWorker, false, c.name + ': pwaWorker が false でない');
        else assert.equal(Object.prototype.hasOwnProperty.call(option, 'pwaWorker'), false, c.name + ': pwaWorker のキーがある');
        assert.equal(option.pwaManifest, c.manifest, c.name + ': pwaManifest');
      }
    });

    if (failures.length) {
      console.log('pwa-worker-option smoke (bundle) FAILED: ' + failures.length + ' check(s): ' + failures.join(' / '));
      process.exit(1);
    }
    process.exit(0);
  `);

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
        external: ['@jsquash/webp', 'pwa-asset-generator', 'jimp', 'adm-zip', '@maplat/tin', '@maplat/transform'],
        output: { entryFileNames: 'pwa-worker-option-smoke.mjs', format: 'es' },
      },
    },
  });
  const r = spawnSync(process.execPath, [bundledFile], { cwd: projectRoot, stdio: 'inherit', timeout: 300000 });
  if (r.status !== 0) failures.push('bundle checks');
} catch (e) {
  failures.push('build');
  console.log(`FAIL: バンドルできない: ${String(e?.message || e).split('\n')[0]}`);
} finally {
  await rm(workDir, { recursive: true, force: true });
}

if (failures.length) {
  console.log(`pwa-worker-option smoke FAILED: ${failures.join(' / ')}`);
  process.exit(1);
}
console.log('pwa-worker-option smoke passed');
