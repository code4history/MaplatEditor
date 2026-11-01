// MapLibre GL JS の ESM 注入（link・import map・動的 import()）と Mapbox GL JS のピン留め版のスモーク。
//
// ネットワークを使わない。2 部構成:
//   (1) providerGlCdn.ts の単体の性質（ピン留め版・断片の形・起動スクリプトの形）
//   (2) 実サービス（AppExportService.exportApp・AppPreviewService の HTML 生成）が出す HTML の検査。
//       fixture のアプリは 7 つ:
//         N1 tms だけ / N2 builtin の osm だけ / N3 maplat の地図だけ /
//         N4 tms ＋ PWA・キャッシュ・overlay 等の httpSettings を有効にしたもの /
//         M1 Mapbox だけ / L1 MapLibre だけ / B1 MapLibre と Mapbox の両方
//
// 各アプリを、版の値（文書の最上位の maplibreMajorVersion）が 無い・5・6 の 3 通りで書き出す。
// `--dump <dir>` を付けると、各アプリの書き出しの index.html とプレビューの HTML（版ごとに 14 個）を
// <dir>/<unset|v5|v6>/<アプリ>-export.html・-preview.html に書き出す。書き出しは検査より先に行う
// （検査が赤でも採れる）。変更の前後の出力をバイト単位で比べるのに使う。
//
// 他のスモークと同じ sandbox 方式（vite の SSR ビルド＋ electron・electron-store のスタブ＋
// saveFolder を一時ディレクトリに）で、実サービスを直接呼ぶ。
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'vite';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);

const dumpArgIndex = process.argv.indexOf('--dump');
const dumpDir = dumpArgIndex >= 0 ? path.resolve(process.argv[dumpArgIndex + 1] || '') : '';
if (dumpArgIndex >= 0 && !process.argv[dumpArgIndex + 1]) {
  console.error('usage: node scripts/provider-gl-esm-smoke.mjs [--dump <dir>]');
  process.exit(2);
}

const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'provider-gl-esm-'));
const entryFile = path.join(workDir, 'provider-gl-esm-smoke.ts');
const electronStubFile = path.join(workDir, 'electron-stub.ts');
const electronStoreStubFile = path.join(workDir, 'electron-store-stub.ts');
const outDir = path.join(workDir, 'dist');
const bundledFile = path.join(outDir, 'provider-gl-esm-smoke.mjs');

let exitCode = 0;
try {
  const dataDir = path.join(workDir, 'data');
  const exportDir = path.join(workDir, 'export-out');
  await mkdir(dataDir, { recursive: true });
  await mkdir(exportDir, { recursive: true });

  const p = (rel) => JSON.stringify(path.join(projectRoot, rel));

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
        getName() { return 'MaplatEditorSmoke'; },
        getVersion() { return '0.0.0-smoke'; },
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
        constructor() { throw new Error('BrowserWindow is not available in the smoke sandbox'); }
        static fromWebContents() { return { webContents: { send() {} } }; }
        static getAllWindows() { return []; }
      };
      export const session = { defaultSession: { clearStorageData() { return Promise.resolve(); } } };
      export const shell = { trashItem(_path: string) { return Promise.resolve(); } };
    `,
  );
  await writeFile(
    electronStoreStubFile,
    `
      export default class Store<T extends Record<string, any>> {
        store: T;
        constructor(options: { defaults?: T } = {}) { this.store = { ...(options.defaults || {}) } as T; }
        get(key: string) { return this.store[key]; }
        set(key: string, value: any) { this.store[key as keyof T] = value; }
        has(key: string) { return Object.prototype.hasOwnProperty.call(this.store, key); }
      }
    `,
  );

  await writeFile(
    entryFile,
    `
      import assert from 'node:assert/strict';
      import path from 'node:path';
      import { readFile, writeFile, mkdir } from 'node:fs/promises';
      import AdmZip from 'adm-zip';

      // 名前空間で読む: 変更の前（関数がまだ無い）でも HTML の採取ができるように、名前付きの import にしない
      const gl: any = await import(${p('electron/services/providerGlCdn.ts')});
      const { default: SettingsService } = await import(${p('electron/services/SettingsService.ts')});
      SettingsService.set('saveFolder', ${JSON.stringify(dataDir)});
      const { default: SqliteDataService } = await import(${p('electron/services/SqliteDataService.ts')});
      const { default: AppExportService } = await import(${p('electron/services/AppExportService.ts')});
      const { default: AppPreviewService } = await import(${p('electron/services/AppPreviewService.ts')});

      await SqliteDataService.getDb();
      const fakeWin = { webContents: { send() {} } };
      const dumpDir = ${JSON.stringify(dumpDir)};

      // ---------------- fixture ----------------
      const master = (extra: Record<string, unknown>) => ({
        lang: 'ja', title: { ja: 'T' }, label: { ja: 'T' }, attr: { ja: '© T' }, dataAttr: {},
        license: '', dataLicense: '', licenseNote: {}, dataLicenseNote: {},
        url: '', minZoom: 0, maxZoom: 20, thumbnail: '', coverageLngLats: null,
        tileJsonSourceUrl: null, sourceMapUid: null, ...extra,
      });
      const TMS_UID = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
      const ML_UID = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
      const MB_UID = 'cccccccc-3333-4333-8333-cccccccccccc';
      await SqliteDataService.saveUserBaseMap({ uid: TMS_UID, slug: 'glesm-tms', create: true,
        tms: master({ kind: 'tms', url: 'https://tiles.example.test/{z}/{x}/{y}.png', minZoom: 5, maxZoom: 18 }) });
      await SqliteDataService.saveUserBaseMap({ uid: ML_UID, slug: 'glesm-maplibre', create: true,
        tms: master({ kind: 'maplibre', maptype: 'maplibre', style: 'https://tiles.example.test/style.json' }) });
      await SqliteDataService.saveUserBaseMap({ uid: MB_UID, slug: 'glesm-mapbox', create: true,
        tms: master({ kind: 'mapbox', maptype: 'mapbox', style: 'mapbox://styles/mapbox/streets-v12' }) });
      const { uid: maplatUid } = await SqliteDataService.createMap('glesm-maplat', {
        title: { ja: '地図' }, width: 400, height: 300, strictMode: 'loose', vertexMode: 'plain',
        // プレビューの compiled の生成に GCP が 3 点以上要る
        gcps: [[[0, 0], [135.0, 35.1]], [[400, 0], [135.1, 35.1]], [[200, 300], [135.05, 35.0]]],
      });
      assert.ok(maplatUid, 'fixture: maplat の地図を作れない');

      const src = (uid: string, slug: string, startFrom = false) =>
        ({ sourceType: 'tms', mapUid: slug, baseMapUid: uid, role: 'base', startFrom, overrides: {} });
      const tms = src(TMS_UID, 'glesm-tms', true);
      const ml = src(ML_UID, 'glesm-maplibre', true);
      const mb = src(MB_UID, 'glesm-mapbox');
      const MAPBOX_TOKEN = 'pk.smoke-fake-token';
      const apps: Record<string, any> = {
        N1: { sources: [tms] },
        N2: { sources: [{ mapUid: 'osm', role: 'base' }] },
        N3: { sources: [{ sourceType: 'maplat', mapID: 'glesm-maplat', role: 'maplat', startFrom: true,
          data: { mapID: 'glesm-maplat', maptype: 'maplat', noload: true } }], startFrom: 'glesm-maplat' },
        N4: { sources: [tms], siteUrl: 'https://example.test/app/', description: { ja: '説明' }, keywords: 'a,b',
          httpSettings: { pwaManifest: true, enableCache: true, overlay: true, enableHideMarker: true,
            enableMarkerList: true, enableBorder: true, stateUrl: true, enableShare: true } },
        M1: { sources: [{ ...mb, startFrom: true }], httpSettings: { mapboxToken: MAPBOX_TOKEN } },
        L1: { sources: [ml] },
        B1: { sources: [ml, mb], httpSettings: { mapboxToken: MAPBOX_TOKEN } },
      };

      // 版の値（文書の最上位の maplibreMajorVersion）の 3 通り: 値が無い（移行の前の読む道）・5（明示）・6
      const VARIANTS: Array<[string, number | undefined]> = [['unset', undefined], ['v5', 5], ['v6', 6]];
      const html: Record<string, Record<string, { exp: string; prev: string }>> = {};
      for (const [variant, major] of VARIANTS) {
        html[variant] = {};
        for (const [name, a] of Object.entries(apps)) {
          const appID = 'glesm_' + name.toLowerCase();
          const doc: any = {
            appID, title: { ja: name }, appName: { ja: name }, lang: 'ja', pois: [],
            appSettings: { homeLng: 139.767, homeLat: 35.681, defaultZoom: 15 },
            manifestSettings: {}, ...a, httpSettings: { ...(a.httpSettings || {}) },
          };
          if (major !== undefined) doc.maplibreMajorVersion = major;
          (globalThis as any).__nextDialogResult = { canceled: false, filePath: path.join(${JSON.stringify(exportDir)}, variant + '-' + appID + '.zip') };
          const exported = await AppExportService.exportApp(fakeWin as any, doc);
          assert.equal(exported.result, 'Success', name + ': exportApp: ' + JSON.stringify(exported));
          const exp = new AdmZip(exported.outDir).getEntry('index.html').getData().toString('utf8');
          // token は固定値。プレビューの HTML は実サービスの生成関数をそのまま呼ぶ
          const session = await (AppPreviewService as any).createSession('tok-' + name.toLowerCase(), doc);
          const prev = (AppPreviewService as any).renderHtml(session);
          html[variant][name] = { exp, prev };
        }
      }
      if (dumpDir) {
        for (const [variant] of VARIANTS) {
          await mkdir(path.join(dumpDir, variant), { recursive: true });
          for (const [name, h] of Object.entries(html[variant])) {
            await writeFile(path.join(dumpDir, variant, name + '-export.html'), h.exp);
            await writeFile(path.join(dumpDir, variant, name + '-preview.html'), h.prev);
          }
        }
        console.log('dumped 3 x 14 HTML files to ' + dumpDir + '/{unset,v5,v6}');
      }

      // ---------------- 検査 ----------------
      const failures: string[] = [];
      const check = (label: string, fn: () => void) => {
        try { fn(); console.log('ok: ' + label); }
        catch (e: any) { failures.push(label); console.log('FAIL: ' + label + '\\n  ' + String(e && e.message || e).split('\\n').join('\\n  ')); }
      };
      const PIN = gl.PROVIDER_GL_CDN;
      const parseV = (v: string) => String(v).split('.').map(Number);
      const geV = (a: string, b: string) => {
        const x = parseV(a), y = parseV(b);
        for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
        return true;
      };
      const SRI = /^sha384-[A-Za-z0-9+/]{64}$/;
      // 5 系の固定は、版を選べるようにする前の出力と同じ値（URL と SRI）
      const V5_JS = 'https://cdn.jsdelivr.net/npm/maplibre-gl@5.6.2/dist/maplibre-gl.js';
      const V5_CSS = 'https://cdn.jsdelivr.net/npm/maplibre-gl@5.6.2/dist/maplibre-gl.css';
      const V5_JS_SRI = 'sha384-1qC0PnXk2fgMDybOtZF1ui4LM5Sxm7o0TbEkwfxTTVdlZvuNENNGCKUub7d644HP';
      const V5_CSS_SRI = 'sha384-gNYNsUmuZqDYiT3gbirWTV5K7rt71RoveS/yXAaU09d4ZUmeDVTD3XoqB6uJAIFR';

      check('AC1 ピン留め版: MapLibre は 5 系 5.6.2 と 6 系、Mapbox は 3 系の 3.33.0 以上。URL に版が入り、SRI は sha384 の 64 字', () => {
        assert.equal('maplibre' in PIN, false, 'どちらの版かを名前で示さない PROVIDER_GL_CDN.maplibre が残っている');
        const m5 = PIN.maplibre5, m = PIN.maplibre6, b = PIN.mapbox;
        assert.ok(m5 && m, 'maplibre5・maplibre6 が無い');
        assert.deepEqual({ ...m5 }, { version: '5.6.2', js: V5_JS, css: V5_CSS, jsIntegrity: V5_JS_SRI, cssIntegrity: V5_CSS_SRI });
        assert.equal(parseV(m.version)[0], 6, 'MapLibre の 6 系の版が 6 系でない: ' + m.version);
        assert.equal(parseV(b.version)[0], 3, 'Mapbox の版が 3 系でない: ' + b.version);
        assert.ok(geV(b.version, '3.33.0'), 'Mapbox の版が 3.33.0 より古い: ' + b.version);
        assert.equal(m.module, 'https://cdn.jsdelivr.net/npm/maplibre-gl@' + m.version + '/dist/maplibre-gl.mjs');
        assert.equal(m.css, 'https://cdn.jsdelivr.net/npm/maplibre-gl@' + m.version + '/dist/maplibre-gl.css');
        assert.equal(b.js, 'https://api.mapbox.com/mapbox-gl-js/v' + b.version + '/mapbox-gl.js');
        assert.equal(b.css, 'https://api.mapbox.com/mapbox-gl-js/v' + b.version + '/mapbox-gl.css');
        for (const v of [m.moduleIntegrity, m.cssIntegrity, b.jsIntegrity, b.cssIntegrity]) assert.match(String(v), SRI);
        assert.equal('js' in m, false, 'MapLibre 6 系に UMD の js の項目がある');
        assert.equal(gl.MAPLIBRE_IMPORT_SPECIFIER, 'maplibre-gl');
      });

      check('AC16 resolveMaplibreMajor は最上位の 6 だけを 6 とし、無い・5・"6"・7・null・httpSettings の中の 6 を 5 とする', () => {
        assert.equal(typeof gl.resolveMaplibreMajor, 'function', 'resolveMaplibreMajor が無い');
        assert.equal(gl.resolveMaplibreMajor({ maplibreMajorVersion: 6 }), 6);
        for (const doc of [{}, { maplibreMajorVersion: 5 }, { maplibreMajorVersion: '6' }, { maplibreMajorVersion: 7 }, { maplibreMajorVersion: null }, { httpSettings: { maplibreMajorVersion: 6 } }, null, undefined]) {
          assert.equal(gl.resolveMaplibreMajor(doc), 5, JSON.stringify(doc));
        }
      });

      check('AC2 MapLibre の断片: 6 なら link と import map の 2 行、5 なら 5.6.2 の link と <script src> の 2 行', () => {
        const m = PIN.maplibre6;
        const frag = gl.renderProviderGlCdnTags(new Set(['maplibre']), 6);
        const importmap = JSON.stringify({ imports: { 'maplibre-gl': m.module }, integrity: { [m.module]: m.moduleIntegrity } });
        assert.equal(frag,
          '  <link rel="stylesheet" href="' + m.css + '" integrity="' + m.cssIntegrity + '" crossorigin="anonymous">\\n' +
          '  <script type="importmap">' + importmap + '</script>\\n');
        assert.doesNotMatch(frag, /<script src/);
        const json = JSON.parse(/<script type="importmap">(.*)<\\/script>/.exec(frag)![1]);
        assert.deepEqual(Object.keys(json.integrity), [json.imports['maplibre-gl']], 'imports と integrity のキーが同じ URL でない');
        assert.match(json.integrity[json.imports['maplibre-gl']], SRI);
        assert.equal(gl.renderProviderGlCdnTags(new Set(['maplibre']), 5),
          '  <link rel="stylesheet" href="' + V5_CSS + '" integrity="' + V5_CSS_SRI + '" crossorigin="anonymous">\\n' +
          '  <script src="' + V5_JS + '" integrity="' + V5_JS_SRI + '" crossorigin="anonymous"></script>\\n');
      });

      check('AC3(a) 起動スクリプト: MapLibre を含まない集合と、5 を選んだときは従来の <script>。断片は空集合で空', () => {
        const body = '    var option = {};\\n    MaplatApp.createObject(option);';
        assert.equal(typeof gl.renderViewerStartupScript, 'function', 'renderViewerStartupScript が無い');
        for (const major of [5, 6]) {
          for (const set of [new Set(), new Set(['mapbox'])]) {
            assert.equal(gl.renderViewerStartupScript(set, body, major), '  <script>\\n' + body + '\\n  </script>');
          }
          assert.equal(gl.renderProviderGlCdnTags(new Set(), major), '');
        }
        assert.equal(gl.renderViewerStartupScript(new Set(['maplibre', 'mapbox']), body, 5), '  <script>\\n' + body + '\\n  </script>');
        const withMl = gl.renderViewerStartupScript(new Set(['maplibre', 'mapbox']), body, 6);
        assert.ok(withMl.startsWith('  <script type="module">\\n'), withMl);
        assert.ok(withMl.endsWith('\\n' + body + '\\n  </script>'), withMl);
        assert.ok(withMl.indexOf("await import('maplibre-gl')") < withMl.indexOf(body));
      });

      const lastScriptOpen = (h: string) => h.lastIndexOf('<script');
      check('AC3(c) GL を使わないアプリ（N1〜N4）の実際の出力: どの版の値でも GL の字面が無く、起動は従来の <script>', () => {
        for (const [variant] of VARIANTS) {
          for (const name of ['N1', 'N2', 'N3', 'N4']) {
            for (const [kind, h, lead] of [['export', html[variant][name].exp, '    var option = '], ['preview', html[variant][name].prev, '    const option = ']] as const) {
              const tag = variant + '/' + name + '/' + kind;
              for (const needle of ['importmap', 'type="module"', 'maplibre-gl@', 'mapbox-gl-js']) {
                assert.equal(h.includes(needle), false, tag + ' に ' + needle + ' がある');
              }
              const at = lastScriptOpen(h);
              assert.ok(h.slice(at - 2).startsWith('  <script>\\n' + lead), tag + ': 起動の開きタグと次の行が従来と違う: ' + JSON.stringify(h.slice(at - 2, at + 40)));
            }
          }
        }
      });

      check('AC15 5 系（値なし・5）の L1・B1 は 5.6.2 の <script src> で、import map もモジュールの起動も無い', () => {
        for (const variant of ['unset', 'v5']) {
          for (const name of ['L1', 'B1']) {
            for (const [kind, h] of [['export', html[variant][name].exp], ['preview', html[variant][name].prev]] as const) {
              const tag = variant + '/' + name + '/' + kind + ': ';
              assert.ok(h.includes('<script src="' + V5_JS + '"'), tag + '5.6.2 の <script src> が無い');
              assert.equal(h.includes('importmap'), false, tag + 'import map がある');
              assert.equal(h.includes('type="module"'), false, tag + 'モジュールの起動がある');
            }
          }
        }
      });

      check('M1 Mapbox だけのアプリ: どの版の値でも Mapbox の 2 行が入り、起動は従来の <script>', () => {
        for (const [variant, major] of VARIANTS) {
          for (const [kind, h, lead] of [['export', html[variant].M1.exp, '    var option = '], ['preview', html[variant].M1.prev, '    const option = ']] as const) {
            assert.ok(h.includes(gl.renderProviderGlCdnTags(new Set(['mapbox']), major ?? 5)), variant + '/M1/' + kind + ': Mapbox の断片が無い');
            for (const needle of ['importmap', 'type="module"', 'maplibre-gl@']) assert.equal(h.includes(needle), false, variant + '/M1/' + kind + ' に ' + needle);
            const at = lastScriptOpen(h);
            assert.ok(h.slice(at - 2).startsWith('  <script>\\n' + lead), variant + '/M1/' + kind);
          }
        }
      });

      check('AC4 起動の順序（6 を選んだ L1・B1 の書き出しとプレビュー）', () => {
        for (const name of ['L1', 'B1']) {
          for (const [kind, h] of [['export', html.v6[name].exp], ['preview', html.v6[name].prev]] as const) {
            const tag = 'v6/' + name + '/' + kind + ': ';
            const imap = h.indexOf('<script type="importmap">');
            const mod = h.indexOf('<script type="module">');
            assert.ok(imap >= 0, tag + 'import map が無い');
            assert.ok(mod >= 0, tag + '<script type="module"> が無い');
            assert.equal(h.split('<script type="module">').length - 1, 1, tag + 'モジュールのスクリプトが 1 つでない');
            assert.equal(lastScriptOpen(h), mod, tag + 'モジュールのスクリプトが最後のスクリプトでない');
            assert.ok(imap < h.indexOf('assets/ol.js') && imap < mod, tag + 'import map がスクリプトより前にない');
            const imp = h.indexOf("await import('maplibre-gl')", mod);
            const create = h.indexOf('createObject(', mod);
            assert.ok(imp > mod && create > imp, tag + 'import() が createObject より前にない');
            if (name === 'B1') assert.ok(h.indexOf('mapbox-gl-js/v' + PIN.mapbox.version) > 0, tag + 'Mapbox の断片が無い');
            if (kind === 'preview') {
              assert.ok(h.indexOf('createObject(option).then(', mod) > imp, tag + 'then がモジュールの中にない');
              assert.ok(h.indexOf('window.__maplatPreview = previewApp', mod) > imp, tag + '__maplatPreview がモジュールの中にない');
            } else {
              assert.ok(h.indexOf('    var option = ', mod) > imp, tag + 'var option がモジュールの中にない');
            }
          }
        }
      });

      {
        const exp = await readFile(${JSON.stringify(path.join(projectRoot, 'electron/services/AppExportService.ts'))}, 'utf8');
        const prev = await readFile(${JSON.stringify(path.join(projectRoot, 'electron/services/AppPreviewService.ts'))}, 'utf8');
        check('AC5 共通化: 両生成器は providerGlCdn の 3 関数を呼び、モジュール起動の字面を自分で書かない (source)', () => {
          for (const [name, s] of [['AppExportService', exp], ['AppPreviewService', prev]] as const) {
            for (const fn of ['renderViewerStartupScript', 'renderProviderGlCdnTags', 'resolveMaplibreMajor']) {
              assert.match(s, new RegExp('import \\\\{[^}]*\\\\b' + fn + '\\\\b[^}]*\\\\} from [\\'"]\\\\./providerGlCdn[\\'"]'), name + ' が ' + fn + ' を import していない');
              assert.match(s, new RegExp(fn + '\\\\('), name + ' が ' + fn + ' を呼んでいない');
            }
            assert.equal(s.split('resolveMaplibreMajor(').length - 1, 1, name + ' は resolveMaplibreMajor を 1 回だけ呼ぶ');
            for (const needle of ['type="module"', 'importmap', "import('maplibre-gl')", 'cdn.jsdelivr.net']) {
              assert.equal(s.includes(needle), false, name + ' に ' + needle + ' の字面がある');
            }
          }
        });
      }

      check('AC8(a) Mapbox の断片の URL が v<ピン留め版> で 3.33.0 以上', () => {
        const frag = gl.renderProviderGlCdnTags(new Set(['mapbox']), 5);
        assert.ok(frag.includes('https://api.mapbox.com/mapbox-gl-js/v' + PIN.mapbox.version + '/mapbox-gl.js'), frag);
        assert.ok(frag.includes('integrity="' + PIN.mapbox.jsIntegrity + '"'), frag);
        assert.equal(gl.renderProviderGlCdnTags(new Set(['mapbox']), 6), frag, 'Mapbox の行が版の値で変わる');
        assert.ok(geV(PIN.mapbox.version, '3.33.0'));
      });

      {
        const pkg = JSON.parse(await readFile(${JSON.stringify(path.join(projectRoot, 'package.json'))}, 'utf8'));
        const src = await readFile(${JSON.stringify(path.join(projectRoot, 'electron/services/providerGlCdn.ts'))}, 'utf8');
        check('AC12 結線: package.json に smoke:provider-gl-esm がある', () => {
          assert.equal(pkg.scripts?.['smoke:provider-gl-esm'], 'node scripts/provider-gl-esm-smoke.mjs');
        });
        check('AC13(a) providerGlCdn.ts の冒頭の注記: 6 系の ESM 注入・CSP・版の選択と既定 5', () => {
          const head = src.slice(0, 3500);
          assert.equal(src.includes('UMD がある **5.6.2** をピンする'), false, '5.6.2 に固定する旧注記が残っている');
          assert.match(head, /importmap|import map/, '冒頭の注記に import map の説明が無い');
          assert.match(head, /worker-src blob:/, '冒頭の注記に CSP の許可（worker-src blob:）が無い');
          assert.match(head, /maplibreMajorVersion/, '冒頭の注記に版の選択（maplibreMajorVersion）が無い');
          assert.match(head, /既定は 5/, '冒頭の注記に既定 5 が無い');
        });
      }

      if (failures.length) {
        console.log('provider-gl-esm smoke FAILED: ' + failures.length + ' check(s): ' + failures.join(' / '));
        process.exit(1);
      }
      console.log('provider-gl-esm smoke passed');
      process.exit(0);
    `,
  );

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
        output: { entryFileNames: 'provider-gl-esm-smoke.mjs', format: 'es' },
      },
    },
  });

  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(process.execPath, [bundledFile], { cwd: projectRoot, stdio: 'inherit', timeout: 300000 });
  exitCode = r.status ?? 1;
} finally {
  await rm(workDir, { recursive: true, force: true });
}
process.exit(exitCode);
