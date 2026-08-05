// M6-T2 スモーク (AC10): MaplatEditor の実保存経路で map data_json の
// licenseNote / dataLicenseNote が永続化されること。
//
// なぜ必要か: MaplatEditor/electron/utils/store_handler.ts の keys 配列に
// licenseNote / dataLicenseNote を足さないと、MapEditService.save (histMap2Store) で
// 保存した瞬間に data_json から消える。これは m10-t3 が pois で踏んだ穴 (store_handler の
// keys 落ち) と同型であり、同じ harness (m10-t3-mapedit-pois-save-smoke.mjs) を踏襲する。
//
// シナリオ:
//   ① mapObject.licenseNote / dataLicenseNote (LangResource) を保存 → findMapByRef の
//      data_json に残る
//   ② MapEditService.request(uid) の読込方向 (store2HistMap) でも保持される
//   ③ Note を持たない mapObject の保存では data_json に Note キーが生えない
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'm6-t2-map-license-note-roundtrip-'));
const entryFile = path.join(workDir, 'map-license-note-roundtrip-smoke.ts');
const electronStubFile = path.join(workDir, 'electron-stub.ts');
const electronStoreStubFile = path.join(workDir, 'electron-store-stub.ts');
const outDir = path.join(workDir, 'dist');
const bundledFile = path.join(outDir, 'map-license-note-roundtrip-smoke.mjs');

try {
  const dataDir = path.join(workDir, 'data');
  await mkdir(dataDir, { recursive: true });

  const settingsPath = path.join(projectRoot, 'electron/services/SettingsService.ts');
  const sqlitePath = path.join(projectRoot, 'electron/services/SqliteDataService.ts');
  const mapEditServicePath = path.join(projectRoot, 'electron/services/MapEditService.ts');

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

      const { default: SettingsService } = await import(${JSON.stringify(settingsPath)});
      SettingsService.set('saveFolder', ${JSON.stringify(dataDir)});

      const { default: SqliteDataService } = await import(${JSON.stringify(sqlitePath)});
      const { default: MapEditService } = await import(${JSON.stringify(mapEditServicePath)});
      await SqliteDataService.getDb();

      const NOTE_FIXTURE = { ja: '出典: 国土地理院' };
      const DATA_NOTE_FIXTURE = { ja: 'データ補足', en: 'Data note' };

      // gcps < 3 の最小 mapObject (m10-t3 と同じ)。
      const mapObject: any = {
        mapID: 'license-note-map',
        title: 'ライセンス補足テスト地図',
        attr: '',
        officialTitle: '',
        dataAttr: '',
        author: '',
        createdAt: '',
        era: '',
        license: 'All right reserved',
        dataLicense: 'CC BY-SA',
        licenseNote: NOTE_FIXTURE,
        dataLicenseNote: DATA_NOTE_FIXTURE,
        contributor: '',
        mapper: '',
        reference: '',
        description: '',
        url: '',
        lang: 'ja',
        imageExtension: 'jpg',
        width: 400,
        height: 300,
        gcps: [],
        edges: [],
        sub_maps: [],
        strictMode: 'strict',
        vertexMode: 'plain',
        homePosition: [135.0, 35.0],
        mercZoom: 15,
      };

      // --- ① 実保存経路 (histMap2Store 経由) で Note が data_json に残る ---
      const saveResult = await MapEditService.save({
        mapObject,
        tins: [],
        slug: 'license-note-map',
      });
      assert.equal(saveResult.result, 'Success', 'save は Success のはず: ' + JSON.stringify(saveResult));
      const savedUid = saveResult.uid;

      const stored = await SqliteDataService.findMapByRef('license-note-map');
      assert.ok(stored, '保存した地図が findMapByRef で見つかるはず');
      assert.deepEqual(
        stored.licenseNote,
        NOTE_FIXTURE,
        '保存経路 (histMap2Store) で data_json の licenseNote が保持されるはず (keys に無いと落ちる)'
      );
      assert.deepEqual(
        stored.dataLicenseNote,
        DATA_NOTE_FIXTURE,
        '保存経路 (histMap2Store) で data_json の dataLicenseNote が保持されるはず'
      );
      console.log('ok: (1) MapEditService.save persists licenseNote/dataLicenseNote');

      // --- ② 読込方向 (request = store2HistMap 経由) でも保持される ---
      const loaded = await MapEditService.request(savedUid);
      assert.deepEqual(
        loaded.licenseNote,
        NOTE_FIXTURE,
        '読込経路 (store2HistMap) でも licenseNote が保持されるはず'
      );
      assert.deepEqual(
        loaded.dataLicenseNote,
        DATA_NOTE_FIXTURE,
        '読込経路 (store2HistMap) でも dataLicenseNote が保持されるはず'
      );
      console.log('ok: (2) MapEditService.request returns licenseNote/dataLicenseNote after reload');

      // --- ③ Note なし保存で data_json に Note キーが生えない ---
      const { licenseNote: _ln, dataLicenseNote: _dln, ...noNoteObject } = mapObject;
      const saveResult2 = await MapEditService.save({
        mapObject: { ...noNoteObject, mapID: 'no-note-map' },
        tins: [],
        slug: 'no-note-map',
      });
      assert.equal(saveResult2.result, 'Success', '2つ目の save は Success のはず: ' + JSON.stringify(saveResult2));
      const stored2 = await SqliteDataService.findMapByRef('no-note-map');
      assert.ok(stored2, '2つ目の地図が見つかるはず');
      // 空 Note は内部形 {} (空オブジェクト) へ正規化される (ADR-0005 / MAP_LANG_ATTRS 言語別フィールド)。
      // undefined/null が data_json へ漏れないこと・未入力が {}/欠落として扱われることを見張る。
      const noNote = stored2.licenseNote === undefined ? {} : stored2.licenseNote;
      assert.deepEqual(
        noNote, {},
        'licenseNote を持たない保存では data_json の licenseNote は {} か欠落のはず (undefined 漏れなし)。実際: ' + JSON.stringify(stored2.licenseNote)
      );
      const noDataNote = stored2.dataLicenseNote === undefined ? {} : stored2.dataLicenseNote;
      assert.deepEqual(
        noDataNote, {},
        'dataLicenseNote を持たない保存では data_json の dataLicenseNote は {} か欠落のはず (undefined 漏れなし)'
      );
      assert.ok(
        !(JSON.stringify(stored2).includes('"licenseNote":undefined')) &&
        !(JSON.stringify(stored2).includes('"dataLicenseNote":undefined')),
        'undefined リテラルが data_json に混入しないはず'
      );
      console.log('ok: (3) maps without notes normalize empty notes to {} (no undefined leak)');

      console.log('M6-T2 map license-note roundtrip smoke passed');
      process.exit(0);
    `,
  );

  await build({
    root: projectRoot,
    configFile: false,
    logLevel: 'error',
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
        ],
        output: {
          entryFileNames: 'map-license-note-roundtrip-smoke.mjs',
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
  console.log('M6-T2 map license-note roundtrip smoke passed');
} finally {
  await rm(workDir, { recursive: true, force: true });
}
