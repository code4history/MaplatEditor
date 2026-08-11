// M13-T1 スモーク: 搬出/発行 strict policy 分離と export UI 回帰修正 (milestone v2.1 T1)。
// m9/m10 系と同じ sandbox 方式 (vite SSR ビルド + electron スタブ + saveFolder/tmpFolder=一時dir) で、
// mapedit:download-saved の strict-free 搬出 (AC-T1-1)、App save/preview/export の共通 strict guard
// (AC-T1-2)、export の pre-dialog/post-dialog 二重判定 (AC-T1-3) を behavioral に検証する。
// AC-T1-4 (ProgressModal 二重翻訳の是正) は MapEdit.vue のソースを静的 grep で検証する。
import { mkdtemp, rm, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'm13-t1-strict-export-guard-'));
const entryFile = path.join(workDir, 'm13-t1-strict-export-guard-smoke.ts');
const electronStubFile = path.join(workDir, 'electron-stub.ts');
const electronStoreStubFile = path.join(workDir, 'electron-store-stub.ts');
const outDir = path.join(workDir, 'dist');
const bundledFile = path.join(outDir, 'm13-t1-strict-export-guard-smoke.mjs');

try {
  const dataDir = path.join(workDir, 'data');
  const tmpDir = path.join(workDir, 'tmp');
  const exportDir = path.join(workDir, 'export-out');
  await mkdir(dataDir, { recursive: true });
  await mkdir(tmpDir, { recursive: true });
  await mkdir(exportDir, { recursive: true });

  const settingsPath = path.join(projectRoot, 'electron/services/SettingsService.ts');
  const sqlitePath = path.join(projectRoot, 'electron/services/SqliteDataService.ts');
  const appDataServicePath = path.join(projectRoot, 'electron/services/AppDataService.ts');
  const appPreviewServicePath = path.join(projectRoot, 'electron/services/AppPreviewService.ts');
  const appExportServicePath = path.join(projectRoot, 'electron/services/AppExportService.ts');
  const mapeditIpcPath = path.join(projectRoot, 'electron/ipc/mapedit.ts');

  await writeFile(
    electronStubFile,
    `
      const handlers = new Map();
      export const __handlers = handlers;
      export const app = {
        getPath(name: string) {
          if (name === 'documents') return ${JSON.stringify(path.join(workDir, 'documents'))};
          if (name === 'temp') return ${JSON.stringify(path.join(workDir, 'temp'))};
          if (name === 'appData') return ${JSON.stringify(path.join(workDir, 'appData'))};
          return ${JSON.stringify(workDir)};
        },
        getName() { return 'MaplatEditorSmoke'; },
        whenReady() { return Promise.resolve(); },
        exit(code?: number) { if (code && code !== 0) process.exitCode = code; },
      };
      export const ipcMain = {
        handle: (ch: string, fn: any) => handlers.set(ch, fn),
        removeHandler: (ch: string) => handlers.delete(ch),
      };
      // AC-T1-3: showSaveDialog 呼び出し時に (globalThis as any).__beforeDialogResolve を
      // 一度だけ実行してから解決する。dialog 待ち中のDB変更 (strict flip) をシミュレートする
      export const dialog = {
        async showSaveDialog(_win: any, _opts: any) {
          (globalThis as any).__showSaveDialogCallCount = ((globalThis as any).__showSaveDialogCallCount || 0) + 1;
          const beforeResolve = (globalThis as any).__beforeDialogResolve;
          if (beforeResolve) {
            (globalThis as any).__beforeDialogResolve = null;
            await beforeResolve();
          }
          return (globalThis as any).__nextDialogResult || { canceled: true, filePath: undefined };
        },
        async showMessageBox() { return { response: 0 }; },
        async showOpenDialog() { return { canceled: true, filePaths: [] }; },
      };
      export const BrowserWindow = class {
        static fromWebContents() { return { webContents: { send() {} } }; }
        static getAllWindows() { return []; }
      };
      export const session = {
        defaultSession: {
          clearStorageData() { return Promise.resolve(); },
        },
      };
      // M12-T18: バンドルに含まれる MapDeleteTrashService が shell を named import するため
      // export が必要 (本 smoke は trashItem を呼ばないので no-op で可)
      export const shell = {
        trashItem(_path: string) { return Promise.resolve(); },
      };
    `,
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
    `,
  );

  await writeFile(
    entryFile,
    `
      import assert from 'node:assert/strict';
      import path from 'node:path';
      import fs from 'node:fs/promises';
      import AdmZip from 'adm-zip';

      const { default: SettingsService } = await import(${JSON.stringify(settingsPath)});
      SettingsService.set('saveFolder', ${JSON.stringify(dataDir)});
      SettingsService.set('tmpFolder', ${JSON.stringify(tmpDir)});

      const { default: SqliteDataService } = await import(${JSON.stringify(sqlitePath)});
      const { default: AppDataService } = await import(${JSON.stringify(appDataServicePath)});
      const { default: AppPreviewService } = await import(${JSON.stringify(appPreviewServicePath)});
      const { default: AppExportService } = await import(${JSON.stringify(appExportServicePath)});
      const { registerMapEditHandlers } = await import(${JSON.stringify(mapeditIpcPath)});
      const { __handlers } = await import(${JSON.stringify(electronStubFile)});
      await SqliteDataService.getDb();
      registerMapEditHandlers();

      const downloadSavedHandler = __handlers.get('mapedit:download-saved');
      assert.ok(downloadSavedHandler, 'mapedit:download-saved ハンドラが登録されているはず');
      const fakeEvent = { sender: {} };
      const fakeWin: any = { webContents: { send() {} } };
      const exportDir = ${JSON.stringify(exportDir)};

      function maplatSource(mapRef: string) {
        return {
          sourceType: 'maplat', mapID: mapRef, role: 'maplat', startFrom: true,
          data: { mapID: mapRef, maptype: 'maplat', noload: true },
        };
      }

      // --- AC-T1-1: strict_error 地図でも mapedit:download-saved(mapRef) は成功する ---
      const { uid: strictMapUid } = await SqliteDataService.createMap('strict-export-map', {
        title: 'Strict Export Map',
        compiled: { strict_status: 'strict_error' },
        gcps: [], edges: [], sub_maps: [],
        strictMode: 'strict', vertexMode: 'plain',
      });
      const zipPath1 = path.join(exportDir, 'strict-export-map.zip');
      (globalThis as any).__nextDialogResult = { canceled: false, filePath: zipPath1 };
      const result1 = await downloadSavedHandler(fakeEvent, strictMapUid);
      assert.equal(result1, 'Success', 'strict_error 地図の download-saved は Success のはず: ' + result1);
      const zipStat = await fs.stat(zipPath1);
      assert.ok(zipStat.size > 0, '生成された ZIP のサイズが0を超えるはず');
      const zip1 = new AdmZip(zipPath1);
      const mapEntry = zip1.getEntry('maps/strict-export-map.json');
      assert.ok(mapEntry, 'ZIP に maps/strict-export-map.json が含まれるはず');
      const mapJson = JSON.parse(zip1.readAsText(mapEntry));
      assert.equal(
        mapJson.compiled.strict_status, 'strict_error',
        'ZIP 内の地図 JSON も strict_error compiled のまま出力されるはず (strict-free 搬出)'
      );
      console.log('ok: AC-T1-1 strict_error map exports via mapedit:download-saved without rejection');

      // AC-T1-1 (§2.5 既知の限界): GCP<3・compiled 欠落の保存地図は現行 previewSource と
      // 同一挙動 (too_less_gcps) で 'Error' に収束する (M13 対象外の確認事項、非回帰)
      const { uid: tooLessGcpsUid } = await SqliteDataService.createMap('too-less-gcps-map', {
        title: 'Too Less Gcps Map', gcps: [], edges: [], sub_maps: [],
        strictMode: 'strict', vertexMode: 'plain',
      });
      (globalThis as any).__nextDialogResult = {
        canceled: false, filePath: path.join(exportDir, 'too-less-gcps-map.zip'),
      };
      const result1b = await downloadSavedHandler(fakeEvent, tooLessGcpsUid);
      assert.equal(
        result1b, 'Error',
        'GCP<3・compiled欠落の保存地図は too_less_gcps で失敗するはず (現行 previewSource と同一挙動、M13対象外)'
      );
      console.log('ok: AC-T1-1 too_less_gcps saved map (compiled missing) resolves to Error (non-regression)');

      // download-saved は不在参照でも reject せず 'Error' に収束する
      const missingRef = '99999999-9999-4999-8999-999999999998';
      (globalThis as any).__nextDialogResult = {
        canceled: false, filePath: path.join(exportDir, 'missing.zip'),
      };
      const result1c = await downloadSavedHandler(fakeEvent, missingRef);
      assert.equal(result1c, 'Error', '不在 mapRef の download-saved も reject せず Error に収束するはず');
      console.log('ok: AC-T1-1 missing mapRef resolves to Error without throwing (§2.1 resolve-only contract)');

      // --- AC-T1-2: App save / preview / export は strict_error / missing map を共通拒否する ---

      // (a) AppDataService.saveApp
      for (const [label, ref] of [['strict', strictMapUid], ['missing', missingRef]] as const) {
        const doc = {
          appID: 'guard_save_' + label, title: { ja: 'ガード検証' }, lang: 'ja',
          sources: [maplatSource(ref)],
        };
        const saved = await AppDataService.saveApp({ document: doc, slug: 'guard_save_' + label });
        assert.equal(saved.result, 'Error', 'saveApp (' + label + ') は strict guard で拒否されるはず: ' + JSON.stringify(saved));
      }
      console.log('ok: AC-T1-2(a) AppDataService.saveApp rejects strict_error and missing maplat refs');

      // (b) AppPreviewService.prepare — guard は ensureServer() (副作用) より前に reject するはず
      let ensureServerCalls = 0;
      const originalEnsureServer = (AppPreviewService as any).ensureServer;
      (AppPreviewService as any).ensureServer = async function (this: any, ...args: any[]) {
        ensureServerCalls++;
        return originalEnsureServer.apply(this, args);
      };
      try {
        for (const [label, ref] of [['strict', strictMapUid], ['missing', missingRef]] as const) {
          const doc = {
            appID: 'guard_preview_' + label, title: { ja: 'ガード検証' }, lang: 'ja',
            sources: [maplatSource(ref)],
          };
          await assert.rejects(
            () => AppPreviewService.prepare(doc),
            /appedit\\.preview\\.strict_error/,
            'prepare (' + label + ') は strict guard で reject されるはず'
          );
        }
        assert.equal(
          ensureServerCalls, 0,
          'assertViewerRuntimeAllowed は ensureServer() / purgePreviewStorage() の副作用より前に reject するはず'
        );
      } finally {
        (AppPreviewService as any).ensureServer = originalEnsureServer;
      }
      console.log('ok: AC-T1-2(b) AppPreviewService.prepare rejects before starting preview server side effects');

      // (c) AppExportService.exportApp — pre-dialog: dialog を開かずに拒否する
      for (const [label, ref] of [['strict', strictMapUid], ['missing', missingRef]] as const) {
        (globalThis as any).__showSaveDialogCallCount = 0;
        const doc = {
          appID: 'guard_export_' + label, title: { ja: 'ガード検証' }, lang: 'ja',
          sources: [maplatSource(ref)],
        };
        const exported = await AppExportService.exportApp(fakeWin, doc);
        assert.equal(exported.result, 'Error', 'exportApp (' + label + ') は pre-dialog guard で拒否されるはず: ' + JSON.stringify(exported));
        assert.equal(exported.message, 'appedit.preview.strict_error');
        assert.equal(
          (globalThis as any).__showSaveDialogCallCount, 0,
          'exportApp (' + label + ') は pre-dialog で reject し dialog を開かないはず'
        );
      }
      console.log('ok: AC-T1-2(c) AppExportService.exportApp pre-dialog guard rejects without opening the save dialog');

      // --- AC-T1-3: post-dialog revalidation。dialog 待ち中の strict flip を古い判定で通さない ---
      const { uid: flipMapUid } = await SqliteDataService.createMap('flip-map', {
        title: 'Flip Map', gcps: [], edges: [], sub_maps: [],
        strictMode: 'strict', vertexMode: 'plain',
      });
      const flipMapDoc = await SqliteDataService.findMap(flipMapUid);
      const flipDocument = {
        appID: 'guard_export_flip', title: { ja: 'ガード検証' }, lang: 'ja',
        sources: [maplatSource(flipMapUid)],
      };
      (globalThis as any).__nextDialogResult = {
        canceled: false, filePath: path.join(exportDir, 'flip.zip'),
      };
      (globalThis as any).__beforeDialogResolve = async () => {
        // dialog 確定待ち中 (main.jsが同期的にshowSaveDialogを解決する直前) に、
        // 参照地図を strict_error へ書き換える (pre-dialog チェック単独では検出できない)
        await SqliteDataService.upsertMap(
          flipMapUid, 'flip-map',
          { ...flipMapDoc, compiled: { strict_status: 'strict_error' } },
          flipMapDoc.revision,
        );
      };
      const exportedFlip = await AppExportService.exportApp(fakeWin, flipDocument);
      assert.equal(
        exportedFlip.result, 'Error',
        'post-dialog revalidation は dialog 待ち中の strict flip を検出して拒否するはず (AC-T1-3)'
      );
      assert.equal(exportedFlip.message, 'appedit.preview.strict_error');
      console.log('ok: AC-T1-3 post-dialog revalidation rejects a map that flips to strict_error during the dialog wait');

      console.log('M13-T1 strict export guard smoke passed');
      process.exit(0);
    `,
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
          '@duckdb/node-api',
          '@duckdb/node-bindings',
          /^@duckdb\/node-bindings-.*/,
          'jimp',
          'pwa-asset-generator',
          '@maplat/tin',
          '@maplat/transform',
          'adm-zip',
        ],
        output: {
          entryFileNames: 'm13-t1-strict-export-guard-smoke.mjs',
          format: 'es',
        },
      },
    },
  });

  await execFileAsync(process.execPath, [bundledFile], {
    cwd: projectRoot,
    timeout: 180000,
    maxBuffer: 1024 * 1024 * 8,
  });

  // --- AC-T1-4: export/upload/WMTS 進捗は i18n key 契約で統一され、ProgressModal の
  //     missingKey を出さない。MapEdit.vue ファイル全体で modalShow(t(/modalFinish(t( が
  //     ゼロ件であることを静的 grep で検証する ---
  const mapEditSource = await readFile(path.join(projectRoot, 'src/views/MapEdit.vue'), 'utf8');
  assert.doesNotMatch(
    mapEditSource, /modalShow\(t\(/,
    'MapEdit.vue に modalShow(t(... という二重翻訳 call site が残存している (AC-T1-4)'
  );
  assert.doesNotMatch(
    mapEditSource, /modalFinish\(t\(/,
    'MapEdit.vue に modalFinish(t(... という二重翻訳 call site が残存している (AC-T1-4)'
  );
  // 新IPC channel への切替と、renderer からの previewSource+download 2段呼び出しの消滅を確認
  assert.match(mapEditSource, /window\.mapedit\.downloadSaved\(mapUid\.value\)/);
  assert.doesNotMatch(mapEditSource, /window\.mapedit\.previewSource\(mapUid\.value\)/);
  console.log('ok: AC-T1-4 MapEdit.vue has zero modalShow(t(/modalFinish(t( double-translation call sites');

  console.log('M13-T1 strict export guard smoke passed');
} finally {
  await rm(workDir, { recursive: true, force: true });
}
