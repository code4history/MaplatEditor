// nov26-m6-t11 スモーク: 書き出したアプリの index.html が URL のクエリから読むキーを
// lang・overlay・appid の 3 つに限り、形の合わない値を無視すること。
//
// A. 実際に書き出した index.html の起動スクリプトを vm で走らせ、createObject に渡る option を見る
// B. electron/services/exportedAppQuery.ts の生成物の単体の検査（A とは別の vite ビルド）
// C. 陽性対照: 以前の取り込み方（6 行を文字どおり写したもの）では許可していないキーが入ることを示す。
//    C が緑でなければ、A の緑は道具の空振りかもしれないので失敗とする
//
// 書き出しは m6-t10 スモークと同じ sandbox 方式（vite SSR ビルド + electron/electron-store スタブ +
// saveFolder=一時dir）で、実サービス AppExportService.exportApp を直接呼ぶ。
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'nov26-m6-t11-query-'));

const BASE_URL = 'https://example.test/app/index.html';

// 以前の書き出しの起動スクリプトの取り込み部分（AppExportService.ts の 6 行を文字どおり写したもの）
const LEGACY_QUERY_LOOP = `    var hashes = (window.location.href.split('#!'))[0];
    hashes = hashes.slice(window.location.href.indexOf('?') + 1).split('&');
    for (var i = 0; i < hashes.length; i++) {
      var hash = hashes[i].split('=');
      option[hash[0]] = hash[1] == 'true' ? true : hash[1] == 'false' ? false : hash[1];
    }`;

const electronStub = (dir) => `
  export const app = {
    getPath(name: string) {
      if (name === 'documents') return ${JSON.stringify(path.join(dir, 'documents'))};
      if (name === 'temp') return ${JSON.stringify(path.join(dir, 'temp'))};
      if (name === 'appData') return ${JSON.stringify(path.join(dir, 'appData'))};
      return ${JSON.stringify(dir)};
    },
    getName() { return 'MaplatEditorSmoke'; },
    whenReady() { return Promise.resolve(); },
    exit() {},
  };
  export const ipcMain = { handle() {}, removeHandler() {} };
  export const dialog = {
    async showSaveDialog(_win: any, _opts: any) {
      return (globalThis as any).__nextDialogResult || { canceled: true, filePath: undefined };
    },
    async showMessageBox() { return { response: 0 }; },
    async showOpenDialog() { return { canceled: true, filePaths: [] }; },
  };
  export const BrowserWindow = class {
    static fromWebContents() { return { webContents: { send() {} } }; }
    static getAllWindows() { return []; }
  };
  export const session = { defaultSession: { clearStorageData() { return Promise.resolve(); } } };
  export const shell = { trashItem(_path: string) { return Promise.resolve(); } };
`;

const electronStoreStub = `
  export default class Store<T extends Record<string, any>> {
    store: T;
    constructor(options: { defaults?: T } = {}) { this.store = { ...(options.defaults || {}) } as T; }
    get(key: string) { return this.store[key]; }
    set(key: string, value: any) { this.store[key as keyof T] = value; }
    has(key: string) { return Object.prototype.hasOwnProperty.call(this.store, key); }
  }
`;

async function bundleAndRun(name, entrySource) {
  const dir = path.join(workDir, name);
  await mkdir(dir, { recursive: true });
  const entryFile = path.join(dir, `${name}.ts`);
  const electronStubFile = path.join(dir, 'electron-stub.ts');
  const electronStoreStubFile = path.join(dir, 'electron-store-stub.ts');
  const outDir = path.join(dir, 'dist');
  await writeFile(electronStubFile, electronStub(dir));
  await writeFile(electronStoreStubFile, electronStoreStub);
  await writeFile(entryFile, entrySource);
  await build({
    root: projectRoot,
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
        external: ['jimp', 'adm-zip', 'pwa-asset-generator', '@maplat/tin', '@maplat/transform'],
        output: { entryFileNames: `${name}.mjs`, format: 'es' },
      },
    },
  });
  await execFileAsync(process.execPath, [path.join(outDir, `${name}.mjs`)], {
    cwd: projectRoot,
    timeout: 300000,
    maxBuffer: 1024 * 1024 * 8,
  });
}

// 起動スクリプトを、window.location と MaplatUi.createObject だけを持つ文脈で走らせる
function runBoot(scriptText, url) {
  const u = new URL(url);
  let captured;
  let calls = 0;
  const context = vm.createContext({
    window: {
      location: { href: u.href, search: u.search, hash: u.hash },
      MaplatUi: {
        createObject(o) {
          calls += 1;
          captured = o;
          return Promise.resolve({});
        },
      },
    },
    URLSearchParams,
  });
  vm.runInContext(scriptText, context);
  const protoOk = vm.runInContext(
    'typeof option === "object" && Object.getPrototypeOf(option) === Object.prototype && ({}).k0 === undefined',
    context,
  );
  return { captured, calls, protoOk };
}

const shorten = (v) => {
  const s = String(v);
  return s.length > 40 ? `${s.slice(0, 8)}…(長さ ${s.length})` : s;
};
const describe = (obj, keys) => keys.map((k) => `${shorten(k)}=${shorten(obj[k])}`).join(' ');

try {
  // ============ 書き出し ============
  const exportOut = path.join(workDir, 'exported-index.html');
  const settingsPath = path.join(projectRoot, 'electron/services/SettingsService.ts');
  const sqlitePath = path.join(projectRoot, 'electron/services/SqliteDataService.ts');
  const appExportServicePath = path.join(projectRoot, 'electron/services/AppExportService.ts');
  const dataDir = path.join(workDir, 'data');
  const zipDir = path.join(workDir, 'export-out');
  await mkdir(dataDir, { recursive: true });
  await mkdir(zipDir, { recursive: true });
  await bundleAndRun(
    'export',
    `
      import path from 'node:path';
      import { writeFile } from 'node:fs/promises';
      import AdmZip from 'adm-zip';

      const { default: SettingsService } = await import(${JSON.stringify(settingsPath)});
      SettingsService.set('saveFolder', ${JSON.stringify(dataDir)});
      const { default: SqliteDataService } = await import(${JSON.stringify(sqlitePath)});
      const { default: AppExportService } = await import(${JSON.stringify(appExportServicePath)});
      await SqliteDataService.getDb();

      const TMS_UID = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
      await SqliteDataService.saveUserBaseMap({
        uid: TMS_UID, slug: 'allowlist-tms', create: true,
        tms: {
          kind: 'tms', lang: 'ja', title: { ja: 'タイル地図', en: 'Tile Map' }, label: { ja: 'タイル' },
          attr: { ja: '作者' }, dataAttr: {}, license: 'CC BY', dataLicense: 'ODbL',
          licenseNote: {}, dataLicenseNote: {},
          url: 'https://tiles.example.test/{z}/{x}/{y}.png',
          minZoom: 5, maxZoom: 18, thumbnail: '', coverageLngLats: null,
          tileJsonSourceUrl: null, sourceMapUid: null,
        },
      });
      const tmsSource = { sourceType: 'tms', mapUid: 'allowlist-tms', baseMapUid: TMS_UID, role: 'base', startFrom: true, overrides: {} };
      const zipPath = path.join(${JSON.stringify(zipDir)}, 'allowlist.zip');
      (globalThis as any).__nextDialogResult = { canceled: false, filePath: zipPath };
      const doc = { appID: 'allowlist_app', title: { ja: 'Allowlist' }, lang: 'ja', sources: [tmsSource], appSettings: {}, httpSettings: { overlay: true } };
      const exported = await AppExportService.exportApp({ webContents: { send() {} } }, doc);
      if (exported.result !== 'Success') throw new Error('export failed: ' + JSON.stringify(exported));
      const html = new AdmZip(exported.outDir).getEntry('index.html').getData().toString('utf8');
      await writeFile(${JSON.stringify(exportOut)}, html);
    `,
  );
  const html = await readFile(exportOut, 'utf8');

  // src を持たない最後の <script> の本文
  const inlineScripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const bootScript = inlineScripts[inlineScripts.length - 1];
  if (!bootScript || !bootScript.includes('var option =')) {
    throw new Error('書き出した index.html から var option = を含む <script> を取り出せない');
  }
  const optionMatch = bootScript.match(/var option = (\{[\s\S]*?\n {4}\});/);
  if (!optionMatch) throw new Error('var option = の JSON を取り出せない');
  const exported = JSON.parse(optionMatch[1]);
  if (exported.overlay !== true) throw new Error('前提: 書き出しの overlay が true でない: ' + JSON.stringify(exported));
  if (exported.appid !== 'allowlist_app') throw new Error('前提: 書き出しの appid が違う: ' + JSON.stringify(exported));
  for (const k of ['enableCache', 'stateUrl', 'pwaManifest', 'enableShare']) {
    if (exported[k] !== false) throw new Error(`前提: 書き出しの ${k} が false でない`);
  }
  if (Object.prototype.hasOwnProperty.call(exported, 'mapboxToken')) throw new Error('前提: 書き出しに mapboxToken がある');

  // ============ A. 書き出した実物を走らせる ============
  const a256 = 'a'.repeat(256);
  const a257 = 'a'.repeat(257);
  const cases = [
    { id: 'A-1', b: '?lang=en', accept: { lang: 'en' } },
    { id: 'A-2', b: '?appid=other_app-1', accept: { appid: 'other_app-1' } },
    { id: 'A-3', b: '?overlay=false', accept: { overlay: false } },
    { id: 'A-4', b: '?lang=en&appid=x2&overlay=false', accept: { lang: 'en', appid: 'x2', overlay: false } },
    { id: 'A-5a', b: '?lang=en#!s:abc', accept: { lang: 'en' } },
    { id: 'A-5b(無し)', b: '', accept: {} },
    { id: 'A-5b(#!)', b: '#!s:abc', accept: {} },
    { id: 'A-6', b: '?notAllowed=1', accept: {} },
    { id: 'A-7(enableCache)', b: '?enableCache=true', accept: {} },
    { id: 'A-7(stateUrl)', b: '?stateUrl=true', accept: {} },
    { id: 'A-7(pwaManifest)', b: '?pwaManifest=true', accept: {} },
    { id: 'A-7(enableShare)', b: '?enableShare=true', accept: {} },
    { id: 'A-7(mapboxToken)', b: '?mapboxToken=abc', accept: {} },
    { id: 'A-8(__proto__)', b: '?__proto__=x', accept: {} },
    { id: 'A-8(constructor)', b: '?constructor=x', accept: {} },
    { id: 'A-8(prototype)', b: '?prototype=x', accept: {} },
    { id: 'A-9(appid ../x)', b: '?appid=../x', accept: {} },
    { id: 'A-9(appid a/b)', b: '?appid=a/b', accept: {} },
    { id: 'A-9(appid a.json)', b: '?appid=a.json', accept: {} },
    { id: 'A-9(appid %2e%2e)', b: '?appid=%2e%2e', accept: {} },
    { id: 'A-9(appid 空)', b: '?appid=', accept: {} },
    { id: 'A-9(appid a×257)', b: `?appid=${a257}`, accept: {} },
    { id: 'A-9(lang e)', b: '?lang=e', accept: {} },
    { id: 'A-9(lang ja%22x)', b: '?lang=ja%22x', accept: {} },
    { id: 'A-9(lang ja-)', b: '?lang=ja-', accept: {} },
    { id: 'A-9(lang toolonglang1)', b: '?lang=toolonglang1', accept: {} },
    { id: 'A-9(overlay 1)', b: '?overlay=1', accept: {} },
    { id: 'A-9(overlay TRUE)', b: '?overlay=TRUE', accept: {} },
    { id: 'A-9(overlay 空)', b: '?overlay=', accept: {} },
    { id: 'A-10', b: `?appid=${a256}`, accept: { appid: a256 } },
    { id: 'A-11(a1&b1)', b: '?appid=a1&appid=b1', accept: { appid: 'a1' } },
    { id: 'A-11(../x&b1)', b: '?appid=../x&appid=b1', accept: {} },
    { id: 'A-12', b: '#?lang=en', accept: {} },
  ];

  const exportedKeys = Object.keys(exported);
  let aGreen = 0;
  for (const c of cases) {
    const problems = [];
    let result;
    try {
      result = runBoot(bootScript, BASE_URL + c.b);
    } catch (e) {
      problems.push('実行時エラー: ' + (e && e.message));
    }
    if (result) {
      if (result.calls !== 1) problems.push(`createObject の呼び出し ${result.calls} 回`);
      if (!result.protoOk) problems.push('option の原型が Object.prototype でない');
      const captured = result.captured || {};
      const capturedKeys = Object.keys(captured);
      const expectedKeys = new Set([...exportedKeys, ...Object.keys(c.accept)]);
      const extra = capturedKeys.filter((k) => !expectedKeys.has(k));
      const missing = [...expectedKeys].filter((k) => !capturedKeys.includes(k));
      const changed = exportedKeys.filter(
        (k) => !Object.prototype.hasOwnProperty.call(c.accept, k) && capturedKeys.includes(k) && !Object.is(captured[k], exported[k]),
      );
      const wrongAccepted = Object.keys(c.accept).filter((k) => !Object.is(captured[k], c.accept[k]));
      if (extra.length) problems.push('入ったキー: ' + describe(captured, extra));
      if (changed.length) problems.push('変わったキー: ' + describe(captured, changed));
      if (wrongAccepted.length) problems.push('受け付けるはずの値と違う: ' + describe(captured, wrongAccepted));
      if (missing.length) problems.push('消えたキー: ' + missing.join(' '));
    }
    if (problems.length === 0) {
      aGreen += 1;
      console.log(`緑 ${c.id}`);
    } else {
      console.log(`赤 ${c.id}: ${problems.join(' / ')}`);
    }
  }

  // ============ B. 新しいモジュールの単体の検査 ============
  const B_TOTAL = 4;
  let bGreen = 0;
  const genOut = path.join(workDir, 'generated.json');
  const modulePath = path.join(projectRoot, 'electron/services/exportedAppQuery.ts');
  let generated = null;
  try {
    await bundleAndRun(
      'module',
      `
        import { writeFile } from 'node:fs/promises';
        import { EXPORTED_APP_APPID_PATTERN, EXPORTED_APP_LANG_PATTERN, renderExportedAppQueryScript } from ${JSON.stringify(modulePath)};
        await writeFile(${JSON.stringify(genOut)}, JSON.stringify({
          withOverlay: renderExportedAppQueryScript(true),
          withoutOverlay: renderExportedAppQueryScript(false),
          appidSource: EXPORTED_APP_APPID_PATTERN.source,
          langSource: EXPORTED_APP_LANG_PATTERN.source,
        }));
      `,
    );
    generated = JSON.parse(await readFile(genOut, 'utf8'));
  } catch (e) {
    console.log('B: 未実装（' + String(e && e.message).split('\n')[0] + '）');
  }
  if (generated) {
    const count = (s, needle) => s.split(needle).length - 1;
    const both = [generated.withOverlay, generated.withoutOverlay];
    const check = (id, ok, detail) => {
      if (ok) {
        bGreen += 1;
        console.log(`緑 ${id}`);
      } else {
        console.log(`赤 ${id}: ${detail}`);
      }
    };
    check(
      'B-1',
      count(generated.withOverlay, generated.appidSource) === 1 && count(generated.withOverlay, generated.langSource) === 1,
      '正規表現の定義がちょうど 1 回ずつ埋まっていない',
    );
    let b2 = false;
    let b2detail = '生成物に overlay が含まれる';
    if (!generated.withoutOverlay.includes('overlay')) {
      try {
        const r = runBoot(
          'var option = {"overlay": false};\n' + generated.withoutOverlay + '\nwindow.MaplatUi.createObject(option);',
          BASE_URL + '?overlay=true',
        );
        b2 = r.calls === 1 && r.captured.overlay === false;
        b2detail = 'overlay=' + String(r.captured && r.captured.overlay);
      } catch (e) {
        b2detail = '実行時エラー: ' + (e && e.message);
      }
    }
    check('B-2', b2, b2detail);
    const forbidden = ['option[', 'forEach', 'for (', 'Object.assign', 'fromEntries'];
    const hits = forbidden.filter((n) => both.some((s) => s.includes(n)));
    check('B-3', hits.length === 0, '含んではいけない語: ' + hits.join(' '));
    const indentBad = both.some((s) => s.split('\n').some((line) => line.trim() !== '' && !line.startsWith('    ')));
    const trailingNewline = both.some((s) => s.endsWith('\n'));
    check('B-4', !indentBad && !trailingNewline, `字下げの不一致=${indentBad} 末尾の改行=${trailingNewline}`);
  }

  // ============ C. 陽性対照 ============
  let cGreen = 0;
  try {
    const legacyScript = `    var option = ${JSON.stringify(exported)};\n${LEGACY_QUERY_LOOP}\n    window.MaplatUi.createObject(option);`;
    const r = runBoot(legacyScript, BASE_URL + '?notAllowed=1');
    if (r.calls === 1 && r.captured.notAllowed === '1') {
      cGreen = 1;
      console.log('緑 C（以前の取り込み方では notAllowed=1 が入る）');
    } else {
      console.log('赤 C: 以前の取り込み方で notAllowed が入らない（道具が漏れを見分けられていない）');
    }
  } catch (e) {
    console.log('赤 C: 実行時エラー: ' + (e && e.message));
  }

  console.log(
    `nov26-m6-t11 export query allowlist smoke: A ${aGreen}/${cases.length} B ${bGreen}/${B_TOTAL} C ${cGreen}/1`,
  );
  if (aGreen !== cases.length || bGreen !== B_TOTAL || cGreen !== 1) process.exitCode = 1;
} finally {
  await rm(workDir, { recursive: true, force: true });
}
