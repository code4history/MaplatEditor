// m6-t10 スモーク: 書き出しとプレビューの新しい出力文法（ADR-0017）。
// タスク設計 `docs/superpowers/specs/2026-08-07-m6-t10-app-source-diff-model-design.md` §6 準拠。
//
// 対象 AC:
//   AC8  書き出しパッケージに maps/<slug>.json がベースマップ分だけ増え、
//        apps/<id>.json の sources が全要素 settingFile を持つ
//   AC9  maps/ の出力パス衝突を検出して throw する
//   AC10 マスタ欠落ソースが書き出し・プレビューから除外され warning が出る。
//        startFrom が除外ソースを指さない
//   AC11 プレビューが maps/<slug>.json をベースマップにも配信する
//   AC17 マスタ側の Google プリセット変更が既存アプリの書き出しへ反映される（本タスクの発端要件）
//
// m9/m10/m13系と同じ sandbox 方式（vite SSR ビルド + electron/electron-store スタブ +
// saveFolder=一時dir）で、実サービス（AppExportService / AppPreviewService）を直接呼ぶ。
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'vite';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'm6-t10-export-preview-'));
const entryFile = path.join(workDir, 'm6-t10-export-preview-smoke.ts');
const electronStubFile = path.join(workDir, 'electron-stub.ts');
const electronStoreStubFile = path.join(workDir, 'electron-store-stub.ts');
const outDir = path.join(workDir, 'dist');
const bundledFile = path.join(outDir, 'm6-t10-export-preview-smoke.mjs');

try {
  const dataDir = path.join(workDir, 'data');
  const exportDir = path.join(workDir, 'export-out');
  await mkdir(dataDir, { recursive: true });
  await mkdir(exportDir, { recursive: true });

  const settingsPath = path.join(projectRoot, 'electron/services/SettingsService.ts');
  const sqlitePath = path.join(projectRoot, 'electron/services/SqliteDataService.ts');
  const appExportServicePath = path.join(projectRoot, 'electron/services/AppExportService.ts');
  const appPreviewServicePath = path.join(projectRoot, 'electron/services/AppPreviewService.ts');
  const providerKeysPath = path.join(projectRoot, 'electron/services/providerKeyResolution.ts');

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
      import { readFile } from 'node:fs/promises';
      import fse from 'fs-extra';
      import AdmZip from 'adm-zip';

      const { default: SettingsService } = await import(${JSON.stringify(settingsPath)});
      SettingsService.set('saveFolder', ${JSON.stringify(dataDir)});

      const { default: SqliteDataService } = await import(${JSON.stringify(sqlitePath)});
      const { default: AppExportService, assertNoMapJsonCollision } = await import(${JSON.stringify(appExportServicePath)});
      const { default: AppPreviewService } = await import(${JSON.stringify(appPreviewServicePath)});
      const { BASE_MAP_MASTER_MISSING_WARNING } = await import(${JSON.stringify(providerKeysPath)});

      await SqliteDataService.getDb();

      const fakeWin = { webContents: { send() {} } };
      const TMS_UID = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
      const GOOGLE_UID = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';

      await SqliteDataService.saveUserBaseMap({
        uid: TMS_UID, slug: 'diff-tms', create: true,
        tms: {
          kind: 'tms', lang: 'ja', title: { ja: 'タイル地図', en: 'Tile Map' }, label: { ja: 'タイル' },
          attr: { ja: '作者' }, dataAttr: {}, license: 'CC BY', dataLicense: 'ODbL',
          licenseNote: {}, dataLicenseNote: {},
          url: 'https://tiles.example.test/{z}/{x}/{y}.png',
          minZoom: 5, maxZoom: 18, thumbnail: '', coverageLngLats: null,
          tileJsonSourceUrl: null, sourceMapUid: null,
        },
      });
      await SqliteDataService.saveUserBaseMap({
        uid: GOOGLE_UID, slug: 'diff-google', create: true,
        tms: {
          kind: 'google', lang: 'ja', title: { ja: 'Google' }, label: { ja: 'Google' },
          attr: { ja: 'Google' }, dataAttr: {}, license: '', dataLicense: '',
          licenseNote: {}, dataLicenseNote: {},
          url: '', minZoom: 0, maxZoom: 20, thumbnail: '', coverageLngLats: null,
          tileJsonSourceUrl: null, sourceMapUid: null,
          maptype: 'google_roadmap',
        },
      });

      const tmsSource = { sourceType: 'tms', mapUid: 'diff-tms', baseMapUid: TMS_UID, role: 'base', startFrom: true, overrides: {} };

      // ============ AC8: maps/<slug>.json と settingFile 参照 ============
      {
        const zipPath = path.join(${JSON.stringify(exportDir)}, 'ac8.zip');
        (globalThis as any).__nextDialogResult = { canceled: false, filePath: zipPath };
        const doc = { appID: 'ac8_app', title: { ja: 'AC8' }, lang: 'ja', sources: [tmsSource], appSettings: {}, httpSettings: {} };
        const exported = await AppExportService.exportApp(fakeWin, doc);
        assert.equal(exported.result, 'Success', JSON.stringify(exported));
        const zip = new AdmZip(exported.outDir);
        const names = zip.getEntries().map((e) => e.entryName);
        assert.ok(names.includes('maps/diff-tms.json'), 'AC8: ベースマップ分の maps/<slug>.json が出るはず: ' + JSON.stringify(names));
        const appJson = JSON.parse(zip.getEntry('apps/ac8_app.json').getData().toString('utf8'));
        assert.equal(appJson.sources.length, 1);
        for (const source of appJson.sources) {
          assert.ok(typeof source === 'object', 'AC8: 全要素がオブジェクト（文字列出力の廃止）');
          assert.ok('settingFile' in source, 'AC8: 全要素が settingFile を持つ: ' + JSON.stringify(source));
          assert.equal('maptype' in source, false, 'AC8: maptype を出さない（source_ex.ts:126 対策）');
        }
        const settingFile = JSON.parse(zip.getEntry('maps/diff-tms.json').getData().toString('utf8'));
        assert.equal(settingFile.maptype, 'base');
        assert.equal(settingFile.url, 'https://tiles.example.test/{z}/{x}/{y}.png');
        assert.equal(settingFile.license, 'CC BY');
        console.log('ok: AC8 maps/<slug>.json と settingFile 参照');
      }

      // ============ AC10: マスタ欠落は除外 + warning + startFrom を引き継がない ============
      {
        const zipPath = path.join(${JSON.stringify(exportDir)}, 'ac10.zip');
        (globalThis as any).__nextDialogResult = { canceled: false, filePath: zipPath };
        const orphan = { sourceType: 'tms', mapUid: 'gone', baseMapUid: 'cccccccc-3333-4333-8333-cccccccccccc', role: 'base', startFrom: true, overrides: {} };
        const doc = {
          appID: 'ac10_app', title: { ja: 'AC10' }, lang: 'ja',
          // 欠落ソースが startFrom を持つ状態で、生きているソースと混ぜる
          sources: [orphan, { ...tmsSource, startFrom: false }],
          startFrom: 'gone',
          appSettings: {}, httpSettings: {},
        };
        const exported = await AppExportService.exportApp(fakeWin, doc);
        assert.equal(exported.result, 'Success', JSON.stringify(exported));
        assert.ok(
          exported.warnings.includes(BASE_MAP_MASTER_MISSING_WARNING),
          'AC10: マスタ欠落で warning が出るはず: ' + JSON.stringify(exported.warnings),
        );
        const zip = new AdmZip(exported.outDir);
        const appJson = JSON.parse(zip.getEntry('apps/ac10_app.json').getData().toString('utf8'));
        assert.equal(appJson.sources.length, 1, 'AC10: 欠落ソースは除外されるはず');
        assert.equal(appJson.sources[0].mapID, 'diff-tms');
        assert.notEqual(appJson.startFrom, 'gone', 'AC10: startFrom が除外ソースを指さないはず: ' + appJson.startFrom);
        const names = zip.getEntries().map((e) => e.entryName);
        assert.ok(!names.includes('maps/gone.json'), 'AC10: 欠落ソースの設定ファイルは出ないはず');
        console.log('ok: AC10 マスタ欠落の除外・警告・startFrom');
      }

      // ============ AC9: maps/ の出力パス衝突は throw ============
      {
        // 衝突は asset_registry の UNIQUE（ADR-0007）により正常系では起こり得ない。
        // ∴ 通常経路でフィクスチャを作ることはできないため、exportApp が実際に呼ぶ
        // ガード関数そのものを直接検査する（実経路を回避したテストにしない）。
        const written = new Set(['maplat-map-slug']);
        assert.throws(
          () => assertNoMapJsonCollision(written, 'maplat-map-slug'),
          (err) => String(err.message).includes('maps/maplat-map-slug.json の出力が衝突しました'),
          'AC9: 既出の slug では throw するはず',
        );
        assert.doesNotThrow(
          () => assertNoMapJsonCollision(written, 'other-slug'),
          'AC9: 未出の slug では throw しないはず',
        );
        // ガードが書き出し経路に実際に組み込まれていること（ソーステキストで固定）
        const exportSrc = await readFile(${JSON.stringify(path.join(projectRoot, 'electron/services/AppExportService.ts'))}, 'utf8');
        assert.ok(
          exportSrc.includes('assertNoMapJsonCollision(writtenMapJsonSlugs, slug)'),
          'AC9: 書き出しループがガードを呼んでいること',
        );
        console.log('ok: AC9 maps/ 出力パス衝突ガード（throw）');
      }

      // ============ AC17: マスタの Google プリセット変更が既存アプリへ反映される ============
      {
        const googleSource = { sourceType: 'tms', mapUid: 'diff-google', baseMapUid: GOOGLE_UID, role: 'base', startFrom: true, overrides: {} };
        const doc = {
          appID: 'ac17_app', title: { ja: 'AC17' }, lang: 'ja',
          sources: [googleSource], appSettings: {},
          httpSettings: { googleApiKey: 'test-key' },
        };
        const readMaptype = async (label) => {
          const zipPath = path.join(${JSON.stringify(exportDir)}, 'ac17-' + label + '.zip');
          (globalThis as any).__nextDialogResult = { canceled: false, filePath: zipPath };
          const exported = await AppExportService.exportApp(fakeWin, doc);
          assert.equal(exported.result, 'Success', label + ': ' + JSON.stringify(exported));
          const zip = new AdmZip(exported.outDir);
          return JSON.parse(zip.getEntry('maps/diff-google.json').getData().toString('utf8')).maptype;
        };
        assert.equal(await readMaptype('before'), 'google_roadmap', 'AC17: 変更前は roadmap');

        // マスタ側でプリセットを satellite へ変更する（アプリ文書には一切触れない）
        const current = await SqliteDataService.findBaseMapByUid(GOOGLE_UID);
        await SqliteDataService.saveUserBaseMap({
          uid: GOOGLE_UID, slug: 'diff-google', expectedRevision: current.revision,
          tms: {
            kind: 'google', lang: 'ja', title: { ja: 'Google' }, label: { ja: 'Google' },
            attr: { ja: 'Google' }, dataAttr: {}, license: '', dataLicense: '',
            licenseNote: {}, dataLicenseNote: {},
            url: '', minZoom: 0, maxZoom: 20, thumbnail: '', coverageLngLats: null,
            tileJsonSourceUrl: null, sourceMapUid: null,
            maptype: 'google_satellite',
          },
        });
        assert.equal(
          await readMaptype('after'), 'google_satellite',
          'AC17: マスタの変更が、アプリ文書を触らずに書き出しへ反映されるはず（本タスクの発端要件）',
        );
        console.log('ok: AC17 マスタ変更の既存アプリへの反映');
      }

      // ============ AC11: プレビューがベースマップの設定ファイルを配信する ============
      {
        const previewService = AppPreviewService;
        const doc = { appID: 'ac11_app', title: { ja: 'AC11' }, lang: 'ja', sources: [tmsSource], appSettings: {}, httpSettings: {} };
        const session = await previewService.createSession('tok-ac11', doc);
        assert.ok(session.maps['diff-tms'], 'AC11: maps に設定ファイルが載るはず: ' + JSON.stringify(Object.keys(session.maps)));
        assert.equal(session.maps['diff-tms'].maptype, 'base');
        assert.equal(session.maps['diff-tms'].url, 'https://tiles.example.test/{z}/{x}/{y}.png');
        const composed = session.viewerSources[0];
        assert.equal(typeof composed, 'object', 'AC11: builtin/tms とも文字列ではなくオブジェクト');
        assert.equal(composed.settingFile, 'maps/diff-tms.json');
        assert.equal('maptype' in composed, false);
        console.log('ok: AC11 プレビューの設定ファイル配信');
      }

      // ============ AC10（プレビュー側）: 欠落ソースの除外と警告 ============
      {
        const orphan = { sourceType: 'tms', mapUid: 'gone2', baseMapUid: 'eeeeeeee-5555-4555-8555-eeeeeeeeeeee', role: 'base', overrides: {} };
        const doc = { appID: 'ac10p_app', title: { ja: 'AC10p' }, lang: 'ja', sources: [orphan, tmsSource], appSettings: {}, httpSettings: {} };
        const session = await AppPreviewService.createSession('tok-ac10p', doc);
        assert.ok(
          session.warnings.includes(BASE_MAP_MASTER_MISSING_WARNING),
          'AC10: プレビューでもマスタ欠落で warning が出るはず: ' + JSON.stringify(session.warnings),
        );
        assert.equal(session.viewerSources.length, 1, 'AC10: 欠落ソースはプレビューからも除外されるはず');
        console.log('ok: AC10 プレビュー側の除外・警告');
      }

      console.log('M6-T10 export/preview smoke passed');
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
        external: [
          '@duckdb/node-api',
          '@duckdb/node-bindings',
          /^@duckdb\/node-bindings-.*/,
          'jimp',
          'adm-zip',
          'pwa-asset-generator',
          '@maplat/tin',
          '@maplat/transform',
        ],
        output: { entryFileNames: 'm6-t10-export-preview-smoke.mjs', format: 'es' },
      },
    },
  });

  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);
  const { stdout } = await execFileAsync(process.execPath, [bundledFile], {
    cwd: projectRoot,
    timeout: 300000,
    maxBuffer: 1024 * 1024 * 8,
  });
  process.stdout.write(stdout);
} finally {
  await rm(workDir, { recursive: true, force: true });
}
