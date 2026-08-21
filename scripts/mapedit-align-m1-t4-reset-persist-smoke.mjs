// m1-t4「リセット／キャンセルボタンとシフト値の即時永続化」の service + ソーステキスト検査。
// 設計: docs/superpowers/specs/2026-08-21-m1-t4-align-reset-persist-task-design.md v1.0
// 前例: scripts/m5-basemap-catalog-smoke.mjs（service 直叩き）/
//       scripts/mapedit-align-m1-t2-basemap-align-smoke.mjs（ソーステキスト検査）
//
// 担当 AC（スコープ限定子つき。設計 §8）:
//   m1-t4/AC4  リセット（set 0,0）は永続行を DELETE で消す（0,0 の行を残さない）
//   m1-t4/AC7  確定とキャンセルの P0 復帰が同一関数 leaveAlignEditPhases を経由する（静的）
//   m1-t4/AC8  確定値の書き込みが INSERT OR REPLACE の即時書込である（service 直叩き）
//   m1-t4/AC10 未保存地図は暫定キー slug:{slug}・初回保存で uid へ引き継がれ・7 日で掃除される
//   m1-t4/AC11 地図削除・ベースマップ削除で map_base_map_shift の行が随伴削除される
//   m1-t4/AC13 i18n キー 2 個（basemap_align_reset / basemap_align_cancel）が 11 言語に在り結線されている
//   m1-t4/AC1  第 2 ボタンが相ボタンの一つ左隣にある（静的。動的確認は e2e / 人間検証 H1）
//   （結線検査は outer rule-0012: smoke / e2e が package.json から到達できる）
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const read = (rel) => readFile(path.join(projectRoot, rel), 'utf8');
const countOf = (haystack, needle) => haystack.split(needle).length - 1;

const LANGS = ['de', 'en', 'es', 'fr', 'id', 'ja', 'ko', 'th', 'vi', 'zh', 'zh-TW'];
const NEW_KEYS = ['basemap_align_reset', 'basemap_align_cancel'];

// 生成物は scratch 配下（.tmp-smoke）に置く（既存 smoke と同一の scratch 位置・gitignore 済み）
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'mapedit-align-m1-t4-'));
const entryFile = path.join(workDir, 'reset-persist-smoke.ts');
const electronStubFile = path.join(workDir, 'electron-stub.ts');
const electronStoreStubFile = path.join(workDir, 'electron-store-stub.ts');
const outDir = path.join(workDir, 'dist');
const bundledFile = path.join(outDir, 'reset-persist-smoke.mjs');

try {
  const dataDir = path.join(workDir, 'data');
  const settingsPath = path.join(projectRoot, 'electron/services/SettingsService.ts');
  const sqlitePath = path.join(projectRoot, 'electron/services/SqliteDataService.ts');
  await mkdir(dataDir, { recursive: true });

  // electron / electron-store の stub（m5-basemap-catalog-smoke と同一の形）
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

      const { default: SettingsService } = await import(${JSON.stringify(settingsPath)});
      SettingsService.set('saveFolder', ${JSON.stringify(dataDir)});
      const { default: SqliteDataService } = await import(${JSON.stringify(sqlitePath)});

      // 検証用のユーザーベースマップを 1 枚用意する
      const addedResult = await SettingsService.saveUserBaseMap({
        slug: 'm1t4_basemap',
        tms: { title: 'm1-t4 Base Map', url: 'https://example.test/{z}/{x}/{y}.png' },
      });
      assert.equal(addedResult.result, 'Success');
      const baseUid = addedResult.uid;
      const db = await SqliteDataService.getDb();

      // ------------------------------------------------------------ [1/8]
      // m1-t4/AC8 + AC10 前段: 未保存地図への即時書込は暫定キー slug:{slug} の行になり、
      // get は base_maps join で mapID（slug）を付けて返す（未登録ベースマップは返さない = 0 扱い）
      {
        await SettingsService.setBaseMapShiftForMapID('m1t4-draft', 'm1t4_basemap', 12.5, -3.25);
        const row = db
          .prepare('SELECT map_uid, shift_x, shift_y FROM map_base_map_shift WHERE base_map_uid = ?')
          .get(baseUid);
        assert.ok(row, 'm1-t4/AC8: set が行を書かない');
        assert.equal(row.map_uid, 'slug:m1t4-draft', 'm1-t4/AC10: 未保存地図の書込が暫定キーでない');
        assert.equal(Number(row.shift_x), 12.5);
        assert.equal(Number(row.shift_y), -3.25);
        const got = await SettingsService.getBaseMapShiftsOfMapID('m1t4-draft');
        assert.deepEqual(
          got.map((r) => ({ mapID: r.mapID, x: r.x, y: r.y })),
          [{ mapID: 'm1t4_basemap', x: 12.5, y: -3.25 }],
          'm1-t4/AC8: get が mapID キー付きで保持値を返さない'
        );
        console.log('[1/8] m1-t4/AC8+AC10: 未保存地図への即時書込と暫定キー OK');
      }

      // ------------------------------------------------------------ [2/8]
      // m1-t4/AC4: set(0,0) は行 DELETE（0,0 の行を残さない。メモリの「未登録 = 0 扱い」と表現一致）
      {
        await SettingsService.setBaseMapShiftForMapID('m1t4-draft', 'm1t4_basemap', 0, 0);
        const count = db
          .prepare('SELECT count(*) AS count FROM map_base_map_shift WHERE base_map_uid = ?')
          .get(baseUid);
        assert.equal(Number(count.count), 0, 'm1-t4/AC4: set(0,0) が行を DELETE しない（0,0 行が残った）');
        const got = await SettingsService.getBaseMapShiftsOfMapID('m1t4-draft');
        assert.deepEqual(got, [], 'm1-t4/AC4: リセット後の get が空でない');
        console.log('[2/8] m1-t4/AC4: 0,0 の行 DELETE OK');
      }

      // ------------------------------------------------------------ [3/8]
      // m1-t4/AC8: 上書きは INSERT OR REPLACE の置換（加算しない・行は 1 本のまま）。
      // 未知の baseMapRef は warn のみで throw しない（visibility 前例と同じ耐性）
      {
        await SettingsService.setBaseMapShiftForMapID('m1t4-draft', 'm1t4_basemap', 100, 200);
        await SettingsService.setBaseMapShiftForMapID('m1t4-draft', 'm1t4_basemap', -7, 8);
        const rows = db
          .prepare('SELECT shift_x, shift_y FROM map_base_map_shift WHERE base_map_uid = ?')
          .all(baseUid);
        assert.equal(rows.length, 1, 'm1-t4/AC8: 上書きで行が増殖した');
        assert.equal(Number(rows[0].shift_x), -7, 'm1-t4/AC8: 上書きが置換になっていない');
        assert.equal(Number(rows[0].shift_y), 8);
        await SettingsService.setBaseMapShiftForMapID('m1t4-draft', 'no-such-base-map', 1, 2);
        const after = db.prepare('SELECT count(*) AS count FROM map_base_map_shift').get();
        assert.equal(Number(after.count), 1, '未知ベースマップへの set が行を書いた');
        console.log('[3/8] m1-t4/AC8: 置換書込と未知参照の耐性 OK');
      }

      // ------------------------------------------------------------ [4/8]
      // m1-t4/AC10: 初回保存（createMap）で暫定行が uid キーへ引き継がれる（adopt の相似形）
      {
        const { uid: mapUid } = await SqliteDataService.createMap('m1t4-draft', { title: 'm1-t4 下書き地図' });
        const keys = db
          .prepare('SELECT map_uid FROM map_base_map_shift WHERE base_map_uid = ?')
          .all(baseUid)
          .map((row) => row.map_uid);
        assert.deepEqual(keys, [mapUid], 'm1-t4/AC10: 暫定行が uid キーへ移動していない（slug: 行の残留か未移動）');
        const got = await SettingsService.getBaseMapShiftsOfMapID(mapUid);
        assert.deepEqual(
          got.map((r) => ({ mapID: r.mapID, x: r.x, y: r.y })),
          [{ mapID: 'm1t4_basemap', x: -7, y: 8 }],
          'm1-t4/AC10: uid キーでの読み出しが引き継がれていない'
        );

        // m1-t4/AC11 前半: 地図削除で shift 行が随伴削除される
        await SqliteDataService.deleteMap(mapUid);
        const count = db
          .prepare('SELECT count(*) AS count FROM map_base_map_shift WHERE map_uid = ?')
          .get(mapUid);
        assert.equal(Number(count.count), 0, 'm1-t4/AC11: deleteMap が shift 行を随伴削除しない');
        console.log('[4/8] m1-t4/AC10+AC11(deleteMap): uid 引き継ぎと随伴削除 OK');
      }

      // ------------------------------------------------------------ [5/8]
      // m1-t4/AC10: 放棄された暫定行（slug: キー・7 日超）は再起動の sweep で掃除され、新しい行は残る
      {
        db.prepare(
          "INSERT INTO map_base_map_shift (map_uid, base_map_uid, shift_x, shift_y, updated_at) VALUES ('slug:m1t4-abandoned', ?, 5, 5, datetime('now', '-8 days'))"
        ).run(baseUid);
        await SettingsService.setBaseMapShiftForMapID('m1t4-fresh', 'm1t4_basemap', 9, 9);
        await SqliteDataService.reset();
        const reopenedDb = await SqliteDataService.getDb();
        const keys = reopenedDb
          .prepare("SELECT map_uid FROM map_base_map_shift WHERE map_uid LIKE 'slug:%'")
          .all()
          .map((row) => row.map_uid);
        assert.ok(!keys.includes('slug:m1t4-abandoned'), 'm1-t4/AC10: 7 日超の暫定 shift 行が掃除されない');
        assert.ok(keys.includes('slug:m1t4-fresh'), 'm1-t4/AC10: 新しい暫定 shift 行が誤って掃除された');

        // m1-t4/AC11 後半 + AC12 の裏面: ベースマップ削除で shift 行が随伴削除され、
        // visibility の行操作と独立している（visibility 行はここまで一度も書いていない = 0 件のまま）
        const visCount = reopenedDb.prepare('SELECT count(*) AS count FROM map_base_map_visibility').get();
        assert.equal(Number(visCount.count), 0, 'shift の書込が visibility 行を汚した');
        await SettingsService.deleteUserBaseMap(baseUid);
        const count = reopenedDb
          .prepare('SELECT count(*) AS count FROM map_base_map_shift WHERE base_map_uid = ?')
          .get(baseUid);
        assert.equal(Number(count.count), 0, 'm1-t4/AC11: deleteUserBaseMap が shift 行を随伴削除しない');
        console.log('[5/8] m1-t4/AC10(sweep)+AC11(deleteBaseMap): TTL 掃除と随伴削除 OK');
      }

      console.log('m1-t4 service part passed');
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
          entryFileNames: 'reset-persist-smoke.mjs',
          format: 'es',
        },
      },
    },
  });

  const { stdout } = await execFileAsync(process.execPath, [bundledFile], {
    cwd: projectRoot,
    timeout: 60000,
    maxBuffer: 1024 * 1024 * 8,
  });
  process.stdout.write(stdout);

  // ------------------------------------------------------------ [6/8]
  // m1-t4/AC7: 確定とキャンセルの P0 復帰が同一関数 leaveAlignEditPhases を経由し、
  // 後始末（interaction 再有効化・マーカー消去）が共通関数の外に重複していない
  const mapEdit = await read('src/views/MapEdit.vue');
  {
    const defs = mapEdit.match(/const leaveAlignEditPhases\s*=/g) || [];
    assert.equal(defs.length, 1, 'm1-t4/AC7: leaveAlignEditPhases の定義が 1 本でない');
    const fnOf = (name) => {
      const start = mapEdit.indexOf('const ' + name);
      assert.ok(start >= 0, name + ' が定義されていない');
      return mapEdit.slice(start, mapEdit.indexOf('\nconst ', start + 1));
    };
    const finishBody = fnOf('finishGroundTruthPhase');
    const cancelBody = fnOf('cancelBasemapAlign');
    assert.ok(countOf(finishBody, 'leaveAlignEditPhases(') >= 1,
      'm1-t4/AC7: 確定（finishGroundTruthPhase）が共通後始末を経由していない');
    assert.ok(countOf(cancelBody, 'leaveAlignEditPhases(') >= 1,
      'm1-t4/AC7: キャンセル（cancelBasemapAlign）が共通後始末を経由していない');
    // 後始末の実体は共通関数の中の 1 箇所だけ（挙動を似せた別実装の禁止 = 恒久指示）
    const leaveBody = fnOf('leaveAlignEditPhases');
    assert.equal(countOf(mapEdit, 'setIllstMapInteractive(true)'), countOf(leaveBody, 'setIllstMapInteractive(true)'),
      'm1-t4/AC7: interaction 再有効化が共通関数の外に重複している');
    // 定義は「const clearAlignMarkers = () =>」であり呼び出しトークン clearAlignMarkers() を含まない
    // ∴ 全出現 = 共通関数内の呼び出しだけであるべき
    assert.equal(countOf(mapEdit, 'clearAlignMarkers()'), countOf(leaveBody, 'clearAlignMarkers()'),
      'm1-t4/AC7: マーカー消去の呼び出しが共通関数の外に重複している');
    // キャンセルはシフト計算・上書き・永続化を行わない（HR-5.3）
    for (const forbidden of ['computeMercatorShift', 'applyShiftOverwrite', 'persistBaseMapShift']) {
      assert.equal(countOf(cancelBody, forbidden), 0,
        'm1-t4/AC7(HR-5.3): キャンセルが ' + forbidden + ' に触れている');
    }
    console.log('[6/8] m1-t4/AC7: 共通後始末 leaveAlignEditPhases OK');
  }

  // ------------------------------------------------------------ [7/8]
  // m1-t4/AC1（静的）: 第 2 ボタンが相ボタンの一つ左隣。
  // HR-6: 書込 site は確定とリセットの 2 箇所だけ（persistBaseMapShift 経由）
  {
    const second = mapEdit.indexOf('mapedit-align-second-button');
    const phase = mapEdit.indexOf('mapedit-align-phase-button');
    assert.ok(second >= 0, 'm1-t4/AC1: 第 2 ボタン（mapedit-align-second-button）が無い');
    assert.ok(phase >= 0, 'mapedit-align-phase-button が無い');
    assert.ok(second < phase, 'm1-t4/AC1: 第 2 ボタンが相ボタンより後にある（一つ左隣でない）');
    const between = mapEdit.slice(second, phase);
    assert.equal((between.match(/col-md-/g) || []).length, 1,
      'm1-t4/AC1: 第 2 ボタンと相ボタンの間に別のカラムが挟まっている（一つ左隣でない）');
    // 書込 site: setBaseMapShiftForMapID は persistBaseMapShift の中だけ・呼び出しは確定とリセットの 2 箇所
    const persistStart = mapEdit.indexOf('const persistBaseMapShift');
    assert.ok(persistStart >= 0, 'persistBaseMapShift が定義されていない');
    const persistBody = mapEdit.slice(persistStart, mapEdit.indexOf('\nconst ', persistStart + 1));
    assert.equal(countOf(mapEdit, 'setBaseMapShiftForMapID'), countOf(persistBody, 'setBaseMapShiftForMapID'),
      'HR-6: 書込 IPC が persistBaseMapShift の外から呼ばれている');
    // 定義は「const persistBaseMapShift = (…」で呼び出しトークンに一致しない ∴ 出現 = 呼び出しの数
    const persistCalls = (mapEdit.match(/persistBaseMapShift\(/g) || []).length;
    assert.equal(persistCalls, 2, // 確定 1 + リセット 1
      'HR-6: 書込 site が確定・リセットの 2 箇所でない（実際 ' + persistCalls + ' 箇所）');
    // 読込は loadBaseMapShifts が担い、loadBaseMapVisibility と同じ 2 箇所から呼ばれる
    const loadCalls = (mapEdit.match(/loadBaseMapShifts\(\)/g) || []).length;
    assert.ok(loadCalls >= 2, 'HR-6: loadBaseMapShifts の呼び出しが 2 箇所未満');
    console.log('[7/8] m1-t4/AC1+HR-6: 第 2 ボタン配置と読み書き site OK');
  }

  // ------------------------------------------------------------ [8/8]
  // m1-t4/AC13: i18n キー 2 個 × 11 言語（空値なし・末尾改行保持・common.reset/cancel と同一文言）+
  // package.json 結線（outer rule-0012）
  {
    for (const lang of LANGS) {
      const raw = await read(`public/locales/${lang}/translation.json`);
      assert.ok(raw.endsWith('\n'), `m1-t4/AC13: ${lang}/translation.json の末尾改行が失われた`);
      const json = JSON.parse(raw);
      for (const key of NEW_KEYS) {
        const val = json.mapedit?.[key];
        assert.equal(typeof val, 'string', `m1-t4/AC13: ${lang} の mapedit.${key} が無い`);
        assert.ok(val.length > 0, `m1-t4/AC13: ${lang} の mapedit.${key} が空`);
      }
      assert.equal(json.mapedit.basemap_align_reset, json.common.reset,
        `m1-t4/AC13: ${lang} の basemap_align_reset が common.reset と別文言（同一概念は同一語）`);
      assert.equal(json.mapedit.basemap_align_cancel, json.common.cancel,
        `m1-t4/AC13: ${lang} の basemap_align_cancel が common.cancel と別文言`);
    }
    // 結線されている（UI から到達する）こと
    assert.ok(countOf(mapEdit, 'basemap_align_reset') >= 1, 'm1-t4/AC13: basemap_align_reset が UI に結線されていない');
    assert.ok(countOf(mapEdit, 'basemap_align_cancel') >= 1, 'm1-t4/AC13: basemap_align_cancel が UI に結線されていない');
    const pkg = JSON.parse(await read('package.json'));
    assert.equal(typeof pkg.scripts['smoke:mapedit-align-m1-t4-reset-persist'], 'string',
      'outer rule-0012: smoke が package.json に結線されていない');
    assert.equal(typeof pkg.scripts['test:e2e:mapedit-align-m1-t4'], 'string',
      'outer rule-0012: e2e が package.json に結線されていない');
    assert.ok(pkg.scripts['test:e2e:mapedit-align-m1-t4'].includes('mapedit-align-m1-t4-reset-persist.spec.ts'),
      'outer rule-0012: e2e script が本タスクの spec を指していない');
    console.log('[8/8] m1-t4/AC13: i18n 全 11 言語と package.json 結線 OK');
  }

  console.log('mapedit-align-m1-t4-reset-persist-smoke: ALL OK');
} catch (err) {
  console.error('mapedit-align-m1-t4-reset-persist-smoke: FAILED');
  console.error(err);
  process.exitCode = 1;
}
// 生成物（workDir）は残置する（破壊的操作 gate: 一時領域は消さない。m1-t2 smoke と同じ扱い。
// .tmp-smoke は gitignore 済み）
