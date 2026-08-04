// レガシー移行 v2 (ADR-0007) スモーク:
//   - nedb.db の地図に uid 採番 + slug=旧ID
//   - ユーザーベースマップの slug 衝突は数値サフィックスで解消され report に記録される
//   - tmbs/{旧ID}.jpg / tiles/{旧ID}/ は commit 後に uid パスへリネームされ report に記録される
//   - report は {saveFolder}/migration-report-v2.json に書かれる(移行を実行した時のみ)
//   - 退避名入力(_nedb.db/_settings)からも同じ結果になる
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'legacy-migration-'));
const entryFile = path.join(workDir, 'legacy-migration-smoke.ts');
const electronStubFile = path.join(workDir, 'electron-stub.ts');
const electronStoreStubFile = path.join(workDir, 'electron-store-stub.ts');
const outDir = path.join(workDir, 'dist');
const bundledFile = path.join(outDir, 'legacy-migration-smoke.mjs');

function legacyMapDoc(id, title) {
  return JSON.stringify({
    _id: id,
    title,
    officialTitle: '',
    description: 'Migrated from NeDB',
    attr: '',
    author: '',
    createdAt: '',
    license: '',
    lang: 'ja',
    imageExtension: 'jpg',
    width: 320,
    height: 200,
    gcps: [],
    edges: [],
    sub_maps: [],
    homePosition: [0, 0],
    mercZoom: 0,
    strictMode: 'strict',
    vertexMode: 'plain',
  }) + '\n';
}

// 地図とID衝突するユーザーベースマップを含むレガシー入力一式を作る
async function writeLegacyFixture(dataDir, { retiredNames }) {
  const nedbName = retiredNames ? '_nedb.db' : 'nedb.db';
  const settingsName = retiredNames ? '_settings' : 'settings';
  const settingsDir = path.join(dataDir, settingsName);
  await mkdir(settingsDir, { recursive: true });
  await writeFile(
    path.join(dataDir, nedbName),
    legacyMapDoc('tatebayashi', '館林城下町絵図') + legacyMapDoc('morioka', '盛岡城下絵図')
  );
  await writeFile(
    path.join(settingsDir, 'tmsList.json'),
    JSON.stringify([
      { mapID: 'tatebayashi', title: 'Tatebayashi TMS', url: 'https://example.test/{z}/{x}/{y}.png' },
    ])
  );
  await mkdir(path.join(dataDir, 'tmbs'), { recursive: true });
  await mkdir(path.join(dataDir, 'tiles', 'tatebayashi', '0', '0'), { recursive: true });
  await writeFile(path.join(dataDir, 'tmbs', 'tatebayashi.jpg'), 'dummy-jpeg');
  await writeFile(path.join(dataDir, 'tiles', 'tatebayashi', '0', '0', '0.png'), 'dummy-png');
}

try {
  const dataDir = path.join(workDir, 'data');
  const retiredDataDir = path.join(workDir, 'data-retired');
  const settingsPath = path.join(projectRoot, 'electron/services/SettingsService.ts');
  const sqlitePath = path.join(projectRoot, 'electron/services/SqliteDataService.ts');
  const mapDataPath = path.join(projectRoot, 'electron/services/MapDataService.ts');

  await writeLegacyFixture(dataDir, { retiredNames: false });
  await writeLegacyFixture(retiredDataDir, { retiredNames: true });

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
      // M12-T18: バンドルに含まれる MapDeleteTrashService が shell を named import するため
      // export が必要 (本 smoke は trashItem を呼ばないので no-op で可)
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
      import { access, readFile } from 'node:fs/promises';
      import nodePath from 'node:path';

      const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      const exists = async (p: string) => access(p).then(() => true, () => false);

      const { default: SettingsService } = await import(${JSON.stringify(settingsPath)});
      const { default: SqliteDataService } = await import(${JSON.stringify(sqlitePath)});
      const { default: MapDataService } = await import(${JSON.stringify(mapDataPath)});

      async function verifyMigratedFolder(dataDir: string, label: string) {
        // 地図: uid採番 + slug=旧ID
        const tatebayashi = await SqliteDataService.findMapBySlug('tatebayashi');
        const morioka = await SqliteDataService.findMapBySlug('morioka');
        assert.ok(tatebayashi, label + ': tatebayashi が移行されるはず');
        assert.ok(morioka, label + ': morioka が移行されるはず');
        assert.match(tatebayashi.uid, UUID_PATTERN);
        assert.match(morioka.uid, UUID_PATTERN);
        assert.equal(tatebayashi.slug, 'tatebayashi');
        assert.equal(tatebayashi.revision, 1);

        // ベースマップ: 地図とslug衝突 → tatebayashi-2 へサフィックス
        // (M5-T10: 生成部は正本 slugSequence の "-" 始まり規則。旧 tatebayashi_2 から変更)
        const catalog = await SqliteDataService.listBaseMaps();
        const userBase = catalog.find((item: any) => item.scope === 'user');
        assert.ok(userBase, label + ': ユーザーベースマップが移行されるはず');
        assert.equal(userBase.mapID, 'tatebayashi-2');
        assert.equal(userBase.data.mapID, 'tatebayashi-2');
        assert.ok(!catalog.some((item: any) => item.scope === 'user' && item.mapID === 'tatebayashi'));

        // report: renamedSlugs 1件 + tmbs/tiles のリネーム記録
        const reportPath = nodePath.join(dataDir, 'migration-report-v2.json');
        const report = JSON.parse(await readFile(reportPath, 'utf8'));
        assert.deepEqual(report.renamedSlugs, [
          { kind: 'base_map', from: 'tatebayashi', to: 'tatebayashi-2' },
        ]);
        assert.ok(Array.isArray(report.warnings));
        const renamedFroms = report.renamedFiles.map((entry: any) => entry.from).sort();
        assert.deepEqual(renamedFroms, ['tiles/tatebayashi', 'tmbs/tatebayashi.jpg']);
        for (const entry of report.renamedFiles) {
          assert.ok(entry.to.includes(tatebayashi.uid), label + ': リネーム先はuidパスのはず');
        }

        // ファイル実体: uidパスに存在し、旧パスは無い
        assert.ok(await exists(nodePath.join(dataDir, 'tmbs', tatebayashi.uid + '.jpg')));
        assert.ok(await exists(nodePath.join(dataDir, 'tiles', tatebayashi.uid, '0', '0', '0.png')));
        assert.ok(!(await exists(nodePath.join(dataDir, 'tmbs', 'tatebayashi.jpg'))));
        assert.ok(!(await exists(nodePath.join(dataDir, 'tiles', 'tatebayashi'))));

        // 消費済みレガシー入力は退避名になる(既に退避名ならそのまま)
        assert.ok(await exists(nodePath.join(dataDir, '_nedb.db')));
        assert.ok(await exists(nodePath.join(dataDir, '_settings')));
        assert.ok(!(await exists(nodePath.join(dataDir, 'nedb.db'))));
        assert.ok(!(await exists(nodePath.join(dataDir, 'settings'))));

        // 一覧サムネイルはuidパスから読まれる
        const listed = await MapDataService.requestMaps('', 1, 0);
        const listedTatebayashi = listed.docs.find((doc: any) => doc.mapID === 'tatebayashi');
        assert.ok(listedTatebayashi.image, label + ': サムネイルが解決されるはず');
        assert.ok(listedTatebayashi.image.includes(tatebayashi.uid + '.jpg'));

        return tatebayashi.uid;
      }

      // シナリオ1: 生きたレガシー入力(nedb.db / settings/)
      SettingsService.set('saveFolder', ${JSON.stringify(dataDir)});
      await SqliteDataService.getDb();
      const liveUid = await verifyMigratedFolder(${JSON.stringify(dataDir)}, 'live');
      const liveReportPath = nodePath.join(${JSON.stringify(dataDir)}, 'migration-report-v2.json');
      const liveReportBefore = JSON.parse(await readFile(liveReportPath, 'utf8'));
      console.log('ok: live legacy inputs migrated with uid/slug/report');

      // 再オープンで移行が再実行されないこと(地図の重複取込なし・uid安定・reportも書き直されない)
      await SqliteDataService.reset();
      await SqliteDataService.getDb();
      const reopenedMaps = await SqliteDataService.readAllMaps();
      assert.equal(reopenedMaps.length, 2, '再オープンで地図が重複取込されてはいけない');
      const reopenedTatebayashi = await SqliteDataService.findMapBySlug('tatebayashi');
      assert.equal(reopenedTatebayashi.uid, liveUid, '再オープンで地図のuidが変わってはいけない');
      const liveReportAfter = JSON.parse(await readFile(liveReportPath, 'utf8'));
      // レガシー移行(nedb→sqlite)が管轄する3フィールドは、reopen で書き直されてはいけない(元の検証意図を維持)
      assert.deepEqual(
        { renamedSlugs: liveReportAfter.renamedSlugs, renamedFiles: liveReportAfter.renamedFiles, warnings: liveReportAfter.warnings },
        { renamedSlugs: liveReportBefore.renamedSlugs, renamedFiles: liveReportBefore.renamedFiles, warnings: liveReportBefore.warnings },
        '再オープンでレガシー移行(renamedSlugs/renamedFiles/warnings)は書き直されてはいけない',
      );
      // M13-T3: originalsUuidMigration は marker を持たず起動毎に idempotent 再計算されるため
      // lastRunAt は変わってよいが、fixture に originals ファイルが無いため再計算結果(summary)は
      // 安定しているはず
      assert.ok(liveReportBefore.originalsUuidMigration, 'originalsUuidMigration が付与されるはず');
      assert.ok(liveReportAfter.originalsUuidMigration, 'reopen 後も originalsUuidMigration が付与されるはず');
      assert.deepEqual(
        liveReportAfter.originalsUuidMigration.summary,
        liveReportBefore.originalsUuidMigration.summary,
        '再オープンでの再計算結果(summary)は不変のはず(fixture に originals ファイルが無く両地図とも skip_source_missing)',
      );
      assert.notEqual(
        liveReportAfter.originalsUuidMigration.lastRunAt,
        liveReportBefore.originalsUuidMigration.lastRunAt,
        'lastRunAt は再走のたびに更新されるはず(no-marker idempotent re-run の意図どおり)',
      );
      const reopenReport = liveReportAfter;
      assert.deepEqual(reopenReport.renamedSlugs, [
        { kind: 'base_map', from: 'tatebayashi', to: 'tatebayashi-2' },
      ]);
      console.log('ok: reopen does not re-run legacy migration');

      // シナリオ2: 退避済み入力(_nedb.db / _settings)
      SettingsService.set('saveFolder', ${JSON.stringify(retiredDataDir)});
      await MapDataService.switchDataFolder();
      await verifyMigratedFolder(${JSON.stringify(retiredDataDir)}, 'retired');
      console.log('ok: retired-name legacy inputs migrated with uid/slug/report');

      console.log('M8-T3 legacy migration smoke passed');
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
          entryFileNames: 'legacy-migration-smoke.mjs',
          format: 'es',
        },
      },
    },
  });

  await execFileAsync(process.execPath, [bundledFile], {
    cwd: projectRoot,
    timeout: 60000,
    maxBuffer: 1024 * 1024 * 8,
  });
  console.log('M8-T3 legacy migration smoke passed');
} finally {
  await rm(workDir, { recursive: true, force: true });
}
