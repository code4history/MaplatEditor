// m19-t7: 0.7.0 → 1.0.0 マイグレーションの一気通貫化（中間スキーマ非通過）スモーク。
//
// タスク設計 `docs/superpowers/specs/2026-08-10-m19-t7-migration-passthrough-design.md` v1.0 §9。
//
// 本 smoke が証明すること:
//   AC-1 0.7.0 の neDB 入力から取り込んだ地図行が、**取込トランザクション直後の時点で既に**
//        凍結形（廃止属性なし・title/label が辞書形）である
//   AC-2 同じ時点で、ユーザーベースマップ行が lang / label を持つ
//   AC-3 0.7.0 fixture から migrate() を 1 回走らせた結果が、変更前実装の結果と一致する
//        （ゴールデン。ビルトイン行も比較対象に含める = 設計レビュー v1 MNR-2）
//   AC-4 0.7.0 取込後の schema_migrations に残る marker が保持 2 件だけである
//        （= 中間段を 1 つも通っていないことの直接の機械証明）
//   AC-5 SqliteDataService.ts に削除した段の残骸が無く、段数 5 / marker 定数 2 である
//
// ★「取込トランザクション直後」の観測方法（実経路を迂回しない）:
//   runLegacyMigrationIfNeeded は取込トランザクションを commit した直後に
//   sendMigrationProgress('database.archiving_legacy_files') を送る。本 smoke は electron の
//   BrowserWindow スタブに観測窓を挿し、その通知を受けた瞬間に **別コネクション**で
//   sqlite を読む。∴ 後段が 1 つも走っていない時点の行そのものを見ている
//   （中断・失敗時に中間形の行が DB に残らないこと = 設計 §3.6 (b) の直接検証）。
//
// 使い方:
//   node scripts/m19-t7-migration-passthrough-smoke.mjs            検証（既定）
//   node scripts/m19-t7-migration-passthrough-smoke.mjs --capture  ゴールデン再取得
//     ※ --capture は「変更前の実装」に対して 1 回だけ実行して固定するためのもの。
//        実装変更後に安易に取り直すとゴールデンが意味を失う。
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const CAPTURE = process.argv.includes('--capture');
const goldenFile = path.join(projectRoot, 'tests/fixtures/m19-t7-migration-passthrough/golden.json');

// ---------------------------------------------------------------------------
// 0.7.0 の入力 fixture（実データの形をそのまま写す。§3.2 / §3.3 の実測に基づく）
// ---------------------------------------------------------------------------

// 0.7.0 の MapEdit が書く地図文書。officialTitle は必ず初期化される（v0.7.0 MapEdit.vue 実読）
function legacyMapDoc(id, extra) {
  return JSON.stringify({
    _id: id,
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
    ...extra,
  }) + '\n';
}

const LEGACY_MAPS =
  // (a) 廃止属性がプレーン文字列で非空（実データ 48 件のパターン）
  legacyMapDoc('plain-exact', { title: '館林城下絵図', officialTitle: '館林城下之絵図' }) +
  // (b) 廃止属性が多言語オブジェクト（実データ 22 件のパターン）。title も多言語
  legacyMapDoc('multilingual', {
    title: { ja: '盛岡城下絵図', en: 'Morioka Castle Town' },
    officialTitle: { ja: '盛岡城下之絵図' },
  }) +
  // (c) 廃止属性が空文字（実データ 174 件のパターン。値ではなくキーの在否でゲートする根拠）
  legacyMapDoc('empty-exact', { title: '江戸切絵図', officialTitle: '' }) +
  // (d) 廃止属性のキーそのものが無い文書（設計レビュー v1 MNR-1 の境界）。
  //     0.7.0 の MapEdit はキーを必ず初期化するため実データには存在しない（実測 244/244 が保持）が、
  //     旧経路（全行無条件写像 → label を title から補充）と新経路（キー在時のみ発火 → 非補充）で
  //     結果が食い違う唯一の入力なので、仕様として固定する。下の INTENTIONAL_DIVERGENCE を参照
  legacyMapDoc('no-exact-key', { title: '甲府城下絵図' });

// 0.7.0 の settings/tmsList.json。キー語彙は実測（mapID / attr / url / maxZoom / minZoom / title）
const LEGACY_TMS_LIST = [
  { mapID: 'gsi-ortho', title: '地理院オルソ', attr: '国土地理院', url: 'https://example.test/o/{z}/{x}/{y}.png', minZoom: 2, maxZoom: 18 },
  // attr を持たないエントリ（旧経路の applyBaseMapLanguageMigration は attr: {} を生やす）
  { mapID: 'no-attr', title: 'Attr なし', url: 'https://example.test/n/{z}/{x}/{y}.png', maxZoom: 16 },
  // 同一 mapID の重複 = 取込側の **update 経路** を通す（設計レビュー v1 §2.2: insert だけでなく
  // update にも正規化を通すこと）。後勝ちで内容が更新される
  { mapID: 'gsi-ortho', title: '地理院オルソ（後勝ち）', attr: '国土地理院', url: 'https://example.test/o2/{z}/{x}/{y}.png', minZoom: 3, maxZoom: 17 },
];

// ---------------------------------------------------------------------------
// ゴールデン比較における**意図的な差分**（設計レビュー v1 MNR-1 の回答）
//
// 仕様: 廃止属性のキーを持たない文書は写像の対象外とする（label を title から補充しない）。
//   根拠: 写像は「0.7.0 の廃止属性を 1.0.0 の語彙へ移す」ものであって、
//         「label を必ず埋める」ものではない。キーが無い文書には移すものが無い。
//         title は必ず残るためデータ喪失ではなく、一覧の表示名も doc.title 由来である。
//   影響範囲: 0.7.0 の MapEdit は officialTitle を必ず初期化するため実 corpus では 0 件
//         （人間の実データ 244/244 がキーを保持）。
// ---------------------------------------------------------------------------
const INTENTIONAL_DIVERGENCE = {
  maps: {
    'no-exact-key': {
      // 変更前は label = { ja: title } が生えていた。変更後は label キー自体が無い
      label: undefined,
    },
  },
};

// ---------------------------------------------------------------------------
// Part S: 静的検査（AC-5）
// ---------------------------------------------------------------------------

const sqliteRel = 'electron/services/SqliteDataService.ts';
const sqliteText = await readFile(path.join(projectRoot, sqliteRel), 'utf8');
const sqliteLines = sqliteText.split('\n');
const isCommentLine = (line) => /^\s*(\/\/|\*|\/\*)/.test(line);

if (!CAPTURE) {
  // (a) 削除した段のシンボル・marker リテラルがコード行に 1 件も残っていない。
  //     needle は「削除されるもの」を名指しする。断片結合は使わない（本 smoke 自身は
  //     SqliteDataService.ts を走査対象にしないため自己ヒットしない）
  const REMOVED_NEEDLES = [
    'SEARCH_INDEX_BACKFILL_ID',
    'OPT_IN_VISIBILITY_FLIP_ID',
    'MAP_NAME_UNIFICATION_MIGRATION_ID',
    'PROVISIONAL_VISIBILITY_PREFIX_MIGRATION_ID',
    'BASE_MAP_ICON_MIGRATION_ID',
    'BASE_MAP_LANGUAGE_MIGRATION_ID',
    'THUMBNAIL_512_WEBP_ID',
    'applyBaseMapLanguageMigration',
    'applyMapNameUnificationMigration',
    'applyProvisionalVisibilityKeyMigration',
    'migrateBaseMapIconPaths',
    'migrateThumbnail512ToWebpIfNeeded',
    'preserveDeprecatedForMigration',
    'NormalizeMapDocumentOptions',
    'unifyMapNameFields',
    '2026-07-16-app-fts-rtree-backfill',
    '2026-07-05-opt-in-base-map-visibility',
    '2026-08-09-m19-t1-map-name-unification',
    '2026-07-09-provisional-visibility-slug-prefix',
    '2026-07-09-base-map-icon-uid-paths',
    '2026-07-14-m11-t4-basemap-language',
    '2026-08-10-thumbnail-512-webp-v1',
  ];
  const residue = [];
  sqliteLines.forEach((line, i) => {
    if (isCommentLine(line)) return;
    for (const needle of REMOVED_NEEDLES) {
      if (line.includes(needle)) residue.push(`${i + 1}: ${needle} -> ${line.trim()}`);
    }
  });
  assert.deepEqual(residue, [], `AC-5(a): 削除した段の残骸がコード行に残っている:\n${residue.join('\n')}`);
  console.log('ok: AC-5(a) 削除した段のシンボル / marker リテラルはコード行に 0 件');

  // (b) migrate() が呼ぶ段が 5 本ちょうど（設計 §5.1 の削減目標）
  const stageLines = sqliteLines.filter((l) => /^ {4}(await )?this\.(apply|migrate|run|sweep)/.test(l));
  const stageNames = stageLines.map((l) => l.trim().replace(/^await /, '').replace(/^this\./, '').replace(/\(.*$/, ''));
  assert.deepEqual(
    stageNames,
    [
      'applySearchIndexSchema',
      'applyBuiltinBaseMapSeed',
      'runLegacyMigrationIfNeeded',
      'sweepStaleProvisionalVisibility',
      'runThumbnail512MiningIfNeeded',
    ],
    `AC-5(b): migrate() の段は 5 本のはず。実際: ${stageNames.join(' / ')}`,
  );
  console.log(`ok: AC-5(b) migrate() の段は 5 本（${stageNames.join(' / ')}）`);

  // (c) marker 定数が 2 本ちょうど
  const markerConsts = sqliteLines.filter((l) => /^const .*_ID = '20/.test(l)).map((l) => l.trim());
  assert.equal(markerConsts.length, 2, `AC-5(c): marker 定数は 2 本のはず。実際:\n${markerConsts.join('\n')}`);
  console.log(`ok: AC-5(c) marker 定数は 2 本（${markerConsts.map((l) => l.split(' ')[1]).join(' / ')}）`);

  // (d) 写像の呼び出し点は adoptDeprecatedMapNames の 1 箇所だけ、かつ読み込み側から呼ばない
  //     （m19-t1 AC-18 の後継。新しい不変条件へ書き換えたもの = 設計 §6.2 / AC-6）
  const adoptHits = sqliteLines
    .map((line, i) => ({ no: i + 1, line }))
    .filter(({ line }) => line.includes('adoptDeprecatedMapNames') && !isCommentLine(line));
  assert.equal(
    adoptHits.length,
    2,
    `AC-5(d): adoptDeprecatedMapNames は import 1 行 + 呼び出し 1 行の 2 行のはず。実際: ${adoptHits
      .map((h) => h.no)
      .join(',')}`,
  );
  const callHit = adoptHits.find((h) => !/^\s*import\b/.test(h.line));
  assert.ok(callHit, 'AC-5(d): adoptDeprecatedMapNames の呼び出し行が見つかるはず');
  function bodyRangeOf(lines, signatureNeedle) {
    const startIdx = lines.findIndex((l) => l.includes(signatureNeedle));
    assert.ok(startIdx >= 0, `関数 ${signatureNeedle} が見つかるはず`);
    const indent = lines[startIdx].match(/^\s*/)[0].length;
    for (let i = startIdx + 1; i < lines.length; i++) {
      const l = lines[i];
      if (l.trim() === '') continue;
      const curIndent = l.match(/^\s*/)[0].length;
      if (curIndent === indent && l.trim().startsWith('}')) return [startIdx + 1, i + 1];
    }
    throw new Error(`関数 ${signatureNeedle} の終端が見つからない`);
  }
  const normalizeRange = bodyRangeOf(sqliteLines, 'function normalizeMapDocument(');
  assert.ok(
    callHit.no >= normalizeRange[0] && callHit.no <= normalizeRange[1],
    `AC-5(d): 写像の呼び出しは normalizeMapDocument 本体 (${normalizeRange[0]}-${normalizeRange[1]}) 内の 1 箇所だけのはず。実際: ${callHit.no}`,
  );
  const mapRowRange = bodyRangeOf(sqliteLines, 'export function mapRowToDocument(');
  assert.ok(
    !(callHit.no >= mapRowRange[0] && callHit.no <= mapRowRange[1]),
    'AC-5(d): 読み込み側 (mapRowToDocument) から写像を呼んではならない',
  );
  console.log(`ok: AC-5(d) 写像の呼び出しは normalizeMapDocument 内の 1 箇所（行 ${callHit.no}）のみ`);
}

// ---------------------------------------------------------------------------
// Part R: 実サービスを走らせる（AC-1 / AC-2 / AC-3 / AC-4）
// ---------------------------------------------------------------------------

const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'm19-t7-migration-passthrough-'));
const entryFile = path.join(workDir, 'passthrough-smoke.ts');
const electronStubFile = path.join(workDir, 'electron-stub.ts');
const electronStoreStubFile = path.join(workDir, 'electron-store-stub.ts');
const outDir = path.join(workDir, 'dist');
const bundledFile = path.join(outDir, 'passthrough-smoke.mjs');
const resultFile = path.join(workDir, 'result.json');

try {
  const dataDir = path.join(workDir, 'data');
  const settingsDir = path.join(dataDir, 'settings');
  await mkdir(settingsDir, { recursive: true });
  await writeFile(path.join(dataDir, 'nedb.db'), LEGACY_MAPS);
  await writeFile(path.join(settingsDir, 'tmsList.json'), JSON.stringify(LEGACY_TMS_LIST));

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
      // ★観測窓: 実装は BrowserWindow.getAllWindows() へ進捗を送る。ここへ窓を挿すことで
      //   「取込トランザクション commit 直後」という実行時点を掴む（迂回ではなく実経路の観測）
      export const BrowserWindow = class {
        static getAllWindows() { return (globalThis as any).__m19t7Windows ?? []; }
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
      import { DatabaseSync } from 'node:sqlite';
      import { writeFile as writeResult } from 'node:fs/promises';
      import nodePath from 'node:path';

      const dataDir = ${JSON.stringify(dataDir)};
      const sqliteFile = nodePath.join(dataDir, 'maplat.sqlite');

      // 別コネクションで現在コミット済みの状態を読む（WAL: 書き手と並行して読める）
      function snapshot() {
        const db = new DatabaseSync(sqliteFile, { readOnly: true } as any);
        try {
          const maps: Record<string, any> = {};
          for (const row of db.prepare('SELECT slug, data_json FROM maps').all() as any[]) {
            maps[String(row.slug)] = JSON.parse(String(row.data_json));
          }
          const baseMapsUser: Record<string, any> = {};
          const baseMapsBuiltin: Record<string, any> = {};
          for (const row of db.prepare('SELECT slug, scope, data_json FROM base_maps').all() as any[]) {
            const target = String(row.scope) === 'builtin' ? baseMapsBuiltin : baseMapsUser;
            target[String(row.slug)] = JSON.parse(String(row.data_json));
          }
          const markers = (db.prepare('SELECT id FROM schema_migrations ORDER BY id').all() as any[])
            .map((r) => String(r.id));
          return { maps, baseMapsUser, baseMapsBuiltin, markers };
        } finally {
          db.close();
        }
      }

      let probe: any = null;
      (globalThis as any).__m19t7Windows = [
        {
          webContents: {
            send(channel: string, payload: any) {
              // 取込トランザクションの commit 直後に送られる最初の通知
              if (channel === 'app:taskProgress' && payload?.text === 'database.archiving_legacy_files' && probe === null) {
                probe = snapshot();
              }
            },
          },
        },
      ];

      const { default: SettingsService } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/SettingsService.ts'))});
      const { default: SqliteDataService } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/SqliteDataService.ts'))});

      SettingsService.set('saveFolder', dataDir);
      await SqliteDataService.getDb();

      const final = snapshot();

      // 2 回目の起動（marker 済み DB の再オープン）。移行が再走しないこと・行が変わらないことを見る
      await SqliteDataService.reset();
      await SqliteDataService.getDb();
      const reopened = snapshot();

      // ---- Part L: 撤去した段の marker が既に立っている DB を開く ----
      // 人間の live DB は rc1 / rc2 / rc3 を実機で動かしており、撤去する 7 段すべての marker を
      // 記録済みである（行は既に 1.0.0 の凍結形）。その状態を再現し、
      //   (a) 起動が失敗しないこと
      //   (b) 撤去済みの孤児 marker が残るだけで害が無いこと（掃除もしない）
      //   (c) 行が 1 バイトも書き換わらないこと（移行が再走しない）
      // を確かめる。孤児 marker が既存 DB に残る状態は本リポジトリで前例がある。
      const REMOVED_MARKERS = [
        '2026-07-16-app-fts-rtree-backfill',
        '2026-07-05-opt-in-base-map-visibility',
        '2026-08-09-m19-t1-map-name-unification',
        '2026-07-09-provisional-visibility-slug-prefix',
        '2026-07-09-base-map-icon-uid-paths',
        '2026-07-14-m11-t4-basemap-language',
        '2026-08-10-thumbnail-512-webp-v1',
      ];
      {
        const live = new DatabaseSync(sqliteFile);
        try {
          const ins = live.prepare('INSERT OR REPLACE INTO schema_migrations (id) VALUES (?)');
          for (const id of REMOVED_MARKERS) ins.run(id);
        } finally {
          live.close();
        }
      }
      await SqliteDataService.reset();
      await SqliteDataService.getDb();
      const withOrphanMarkers = snapshot();

      if (probe === null) throw new Error('取込トランザクション直後の観測が取れなかった（進捗通知が届いていない）');

      await writeResult(
        ${JSON.stringify(resultFile)},
        JSON.stringify({ probe, final, reopened, withOrphanMarkers, removedMarkers: REMOVED_MARKERS }, null, 2),
      );
      console.log('m19-t7 runtime part done');
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
        output: { entryFileNames: 'passthrough-smoke.mjs', format: 'es' },
      },
    },
  });

  await execFileAsync(process.execPath, [bundledFile], {
    cwd: projectRoot,
    timeout: 120000,
    maxBuffer: 1024 * 1024 * 16,
  });

  const result = JSON.parse(await readFile(resultFile, 'utf8'));
  const { probe, final, reopened, withOrphanMarkers, removedMarkers } = result;

  // --- ビルトイン行は件数が多いので digest で固定する（MNR-2: 前提を機械固定する）---
  const { createHash } = await import('node:crypto');
  const digestOf = (obj) =>
    createHash('sha256')
      .update(JSON.stringify(Object.keys(obj).sort().map((k) => [k, obj[k]])))
      .digest('hex');

  const KEEP_MARKERS = [
    '2026-07-04-sqlite-write-store-legacy-import',
    '2026-07-21-thumbnail-512-mining-v2',
  ];

  // --- AC-4: marker は保持 2 件だけ -------------------------------------------
  if (!CAPTURE) {
    assert.deepEqual(
      final.markers,
      KEEP_MARKERS,
      `AC-4: 0.7.0 取込後の marker は保持 2 件だけのはず（中間段を 1 つも通っていないことの直接の証明）。実際: ${final.markers.join(', ')}`,
    );
    assert.deepEqual(reopened.markers, KEEP_MARKERS, 'AC-4: 再オープンで marker が増えてはいけない');
    console.log(`ok: AC-4 marker は保持 2 件のみ（${final.markers.join(' / ')}）`);

    // --- AC-4b: 撤去した段の marker が既に立っている DB（人間の live 相当）を開く ---
    assert.deepEqual(
      withOrphanMarkers.markers,
      [...KEEP_MARKERS, ...removedMarkers].sort(),
      'AC-4b: 撤去済み marker は孤児として残るだけで、増えも減りもしないはず（掃除もしない）',
    );
    assert.deepEqual(
      withOrphanMarkers.maps,
      final.maps,
      'AC-4b: 撤去済み marker を持つ DB を開いても地図行は 1 バイトも変わらないはず',
    );
    assert.deepEqual(
      withOrphanMarkers.baseMapsUser,
      final.baseMapsUser,
      'AC-4b: 同じくユーザーベースマップ行も変わらないはず',
    );
    console.log(
      `ok: AC-4b 撤去済み marker ${removedMarkers.length} 件を持つ DB を開いても起動でき、行は不変（移行は再走しない）`,
    );

    // --- AC-1: 取込トランザクション直後の地図行が既に凍結形 -------------------
    assert.deepEqual(
      probe.markers,
      ['2026-07-04-sqlite-write-store-legacy-import'],
      'AC-1: 観測時点ではレガシー取込の marker だけが立っているはず（後段が未実行であることの確認）',
    );
    const probeMapSlugs = Object.keys(probe.maps).sort();
    assert.deepEqual(probeMapSlugs, ['empty-exact', 'multilingual', 'no-exact-key', 'plain-exact']);
    for (const [slug, doc] of Object.entries(probe.maps)) {
      assert.ok(!('officialTitle' in doc), `AC-1: ${slug} は取込の瞬間から廃止属性を持たないはず`);
      assert.equal(typeof doc.title, 'object', `AC-1: ${slug} の title は辞書形のはず`);
      assert.ok(doc.title !== null && !Array.isArray(doc.title), `AC-1: ${slug} の title は辞書形のはず`);
      if (slug === 'no-exact-key') {
        assert.ok(!('label' in doc), 'AC-1: 廃止属性キーの無い文書は写像対象外（label を補充しない）');
      } else {
        assert.equal(typeof doc.label, 'object', `AC-1: ${slug} の label は辞書形のはず`);
      }
    }
    // 写像の中身（0.7.0 の語彙 → 1.0.0 の語彙）が取込の瞬間に済んでいること
    assert.deepEqual(probe.maps['plain-exact'].title, { ja: '館林城下之絵図' }, 'AC-1: 旧 officialTitle が title へ');
    assert.deepEqual(probe.maps['plain-exact'].label, { ja: '館林城下絵図' }, 'AC-1: 旧 title が label へ');
    assert.deepEqual(probe.maps['multilingual'].title, { ja: '盛岡城下之絵図', en: 'Morioka Castle Town' });
    assert.deepEqual(probe.maps['multilingual'].label, { ja: '盛岡城下絵図', en: 'Morioka Castle Town' });
    // 空文字の廃止属性でもキー在なら発火する（値ではなくキーの在否でゲートする）
    assert.deepEqual(probe.maps['empty-exact'].label, { ja: '江戸切絵図' });
    console.log('ok: AC-1 取込トランザクション直後の地図行が既に凍結形（中間形は DB に存在しない）');

    // --- AC-2: 同じ時点でユーザーベースマップが lang / label を持つ -----------
    const probeUserSlugs = Object.keys(probe.baseMapsUser).sort();
    assert.deepEqual(probeUserSlugs, ['gsi-ortho', 'no-attr']);
    for (const [slug, doc] of Object.entries(probe.baseMapsUser)) {
      assert.equal(typeof doc.lang, 'string', `AC-2: ${slug} は取込の瞬間から lang を持つはず`);
      assert.ok(doc.lang, `AC-2: ${slug} の lang は非空のはず`);
      assert.equal(typeof doc.label, 'object', `AC-2: ${slug} は取込の瞬間から label を持つはず`);
      assert.equal(typeof doc.title, 'object', `AC-2: ${slug} の title は辞書形のはず`);
    }
    // 重複 mapID の後勝ち（= update 経路）も正規化されていること
    assert.deepEqual(probe.baseMapsUser['gsi-ortho'].title, { ja: '地理院オルソ（後勝ち）' },
      'AC-2: 重複 mapID の後勝ち更新（update 経路）が反映されるはず');
    assert.deepEqual(probe.baseMapsUser['gsi-ortho'].label, { ja: '地理院オルソ（後勝ち）' },
      'AC-2: update 経路にも正規化が通ること（設計レビュー v1 §2.2）');
    assert.deepEqual(probe.baseMapsUser['gsi-ortho'].attr, { ja: '国土地理院' });
    assert.deepEqual(probe.baseMapsUser['no-attr'].attr, {}, 'AC-2: attr 欠落時は空の辞書が入る（旧段と等価）');
    console.log('ok: AC-2 取込トランザクション直後のユーザーベースマップが lang / label を持つ');
  }

  // --- AC-3: ゴールデン比較 ----------------------------------------------------
  const observed = {
    maps: final.maps,
    baseMapsUser: final.baseMapsUser,
    builtin: {
      count: Object.keys(final.baseMapsBuiltin).length,
      digest: digestOf(final.baseMapsBuiltin),
      // MNR-2: S3 削除後のビルトイン行の凍結形は builtin_base_maps.json 自身の正規性に依存する。
      // その前提（全件が lang / label / 辞書形 title を持つ）を機械で固定する
      allNormalized: Object.values(final.baseMapsBuiltin).every(
        (d) =>
          typeof d.lang === 'string' && d.lang &&
          d.label && typeof d.label === 'object' && !Array.isArray(d.label) &&
          d.title && typeof d.title === 'object' && !Array.isArray(d.title),
      ),
      sample: final.baseMapsBuiltin['osm'] ?? null,
    },
    markers: final.markers,
    reopenedIdentical:
      JSON.stringify(reopened.maps) === JSON.stringify(final.maps) &&
      JSON.stringify(reopened.baseMapsUser) === JSON.stringify(final.baseMapsUser),
  };

  if (CAPTURE) {
    await mkdir(path.dirname(goldenFile), { recursive: true });
    await writeFile(goldenFile, JSON.stringify(observed, null, 2) + '\n');
    console.log(`captured golden -> ${path.relative(projectRoot, goldenFile)}`);
    console.log(`  maps=${Object.keys(observed.maps).length} userBaseMaps=${Object.keys(observed.baseMapsUser).length} builtin=${observed.builtin.count} markers=${observed.markers.length}`);
  } else {
    const golden = JSON.parse(await readFile(goldenFile, 'utf8'));

    assert.ok(observed.builtin.allNormalized,
      'AC-3: ビルトインカタログの全行が lang / label / 辞書形 title を持つ前提が崩れている（S3 削除の安全性の根拠）');
    assert.equal(observed.builtin.count, golden.builtin.count, 'AC-3: ビルトイン行数がゴールデンと一致するはず');
    assert.equal(observed.builtin.digest, golden.builtin.digest,
      'AC-3: ビルトイン行の内容がゴールデン（変更前実装の結果）と一致するはず。S3 の削除はビルトイン行に対して no-op でなければならない');
    assert.deepEqual(observed.builtin.sample, golden.builtin.sample, 'AC-3: ビルトイン代表行がゴールデンと一致するはず');

    // 意図的差分をゴールデンへ適用してから比較する（差分が机上に載ることを保証する）
    const expectedMaps = JSON.parse(JSON.stringify(golden.maps));
    for (const [slug, patch] of Object.entries(INTENTIONAL_DIVERGENCE.maps)) {
      assert.ok(expectedMaps[slug], `INTENTIONAL_DIVERGENCE の対象 ${slug} がゴールデンに無い`);
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) delete expectedMaps[slug][key];
        else expectedMaps[slug][key] = value;
      }
    }
    assert.deepEqual(observed.maps, expectedMaps,
      'AC-3: 地図行が変更前実装の結果と一致するはず（意図的差分は INTENTIONAL_DIVERGENCE に限る）');
    assert.deepEqual(observed.baseMapsUser, golden.baseMapsUser,
      'AC-3: ユーザーベースマップ行が変更前実装の結果と一致するはず');
    assert.ok(observed.reopenedIdentical, 'AC-3: 再オープンで行が書き換わってはいけない');
    console.log('ok: AC-3 変更前実装の結果とゴールデン一致（地図 / ユーザーベースマップ / ビルトイン digest）');
    console.log('ok: AC-3 意図的差分は 1 件のみ（廃止属性キーを持たない文書の label 非補充）');

    console.log('m19-t7 migration passthrough smoke passed');
  }
} finally {
  await rm(workDir, { recursive: true, force: true });
}
