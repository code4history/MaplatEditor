// m5-t5 AC13: 採番の生成部は必ず "-" で始まる（タスク設計 v1.4 §2.1）。
//
// 人間指示（2026-08-03）:
//   「base(-[付与文字列]) がいい。base との間にハイフンがないと、
//     元々の名前か生成した名前か判定しにくい」
//
// 固定する受け入れ条件:
//   AC13(a) 表駆動 — slugCandidate(base,2)='base-2' / suffix 付きは無変化
//   AC13(b) 長さ切詰が "-" 込みで効く
//   AC13(c) 実経路 — POI import が base-2、POI 搬出のファイル名が pois/x-2.geojson
//   AC13(d) 旧規則を書いた docstring/コメントが追随している
//
// 【n=1 に "-" は付かない】
// n=1 は衝突がなく **base をそのまま使う** ケースであり、生成部が存在しない。
// 「"-" があれば生成名」という判定は、この非対称があってこそ成立する。
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'm5-t5-slug-rule-'));
const entryFile = path.join(workDir, 'entry.ts');
const outDir = path.join(workDir, 'dist');
const bundled = path.join(outDir, 'entry.mjs');

try {
  // --- AC13(d): 旧規則を書いた docstring/コメントの追随（ソーステキスト assert）---
  // 規則を変えてコメントを置き去りにすると、次に読む人が旧規則を正しいと信じる。
  const docTargets = [
    { file: 'src/utils/slugSequence.ts', label: '正本の冒頭コメント' },
    { file: 'src/utils/poiExportFileName.ts', label: 'reservePoiFileBase の docstring' },
    { file: 'electron/services/PoiSourceService.ts', label: 'import 自動採番の根拠コメント' },
  ];
  for (const { file, label } of docTargets) {
    const src = await readFile(path.join(projectRoot, file), 'utf8');
    const comments = src.split('\n').filter((l) => /^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    assert.equal(/base2|base3|base100/.test(comments), false,
      `AC13(d): ${file}（${label}）のコメントに旧規則 base2/base3/base100 が残っている`);
    console.log(`ok AC13(d): ${file} のコメントが新規則へ追随している`);
  }

  await writeFile(entryFile, `
    import assert from 'node:assert/strict';
    const { slugCandidate, findAvailableSlug, SLUG_MAX, SEQUENCE_MAX_INDEX } =
      await import(${JSON.stringify(path.join(projectRoot, 'src/utils/slugSequence.ts'))});
    const { reservePoiFileBase } =
      await import(${JSON.stringify(path.join(projectRoot, 'src/utils/poiExportFileName.ts'))});

    // ---- AC13(a): 表駆動 ----
    // 不変条件は1つ: **生成部は必ず "-" で始まる**。
    // suffix（"-copy" / "-poi" / "-local"）は既に "-" 始まりなので変化しない。
    const table = [
      // [base, n, opts, expected, 意図]
      ['foo', 1, undefined,            'foo',        'n=1 は衝突なし＝元の名前そのもの ∴ "-" は付かない'],
      ['foo', 2, undefined,            'foo-2',      '素の連番に "-" が入る（旧: foo2）'],
      ['foo', 3, undefined,            'foo-3',      '同上'],
      ['foo', 100, undefined,          'foo-100',    '上限側も同じ'],
      ['foo', 1, { suffix: '-copy' },  'foo-copy',   '複製系は無変化'],
      ['foo', 2, { suffix: '-copy' },  'foo-copy2',  '複製系は無変化（連番は suffix に直付け）'],
      ['foo', 1, { suffix: '-poi' },   'foo-poi',    'inline POI 系は無変化'],
      ['foo', 2, { suffix: '-poi' },   'foo-poi2',   'inline POI 系は無変化'],
      ['foo', 1, { suffix: '-local' }, 'foo-local',  'clone 系（後続タスクで寄せる）も無変化'],
      ['foo', 2, { suffix: '-local' }, 'foo-local2', '同上'],
    ];
    for (const [base, n, opts, expected, why] of table) {
      assert.equal(slugCandidate(base, n, opts), expected,
        'AC13(a): slugCandidate(' + JSON.stringify(base) + ', ' + n + ', ' + JSON.stringify(opts)
          + ') は ' + expected + ' であること — ' + why);
    }
    console.log('ok AC13(a): 生成部が必ず "-" 始まり（suffix 系は無変化）');

    // ---- AC13(b): 長さ切詰が "-" 込みで効く ----
    // 生成部が1文字伸びる ∴ base の切詰も1文字増える。SLUG_MAX を超えてはならない。
    const long = 'a'.repeat(120);
    const c2 = slugCandidate(long, 2);
    assert.equal(c2.length, SLUG_MAX, 'AC13(b): 切詰後も SLUG_MAX ちょうど（実際: ' + c2.length + '）');
    assert.equal(c2, 'a'.repeat(SLUG_MAX - 2) + '-2',
      'AC13(b): 末尾が "-2" で base が2文字ぶん削られること（実際末尾: ' + c2.slice(-6) + '）');
    const c100 = slugCandidate(long, 100);
    assert.equal(c100.length, SLUG_MAX, 'AC13(b): 3桁連番でも SLUG_MAX ちょうど');
    assert.equal(c100.slice(-4), '-100', 'AC13(b): 末尾が "-100"（実際: ' + c100.slice(-4) + '）');
    const cCopy = slugCandidate(long, 2, { suffix: '-copy' });
    assert.equal(cCopy, 'a'.repeat(SLUG_MAX - 6) + '-copy2',
      'AC13(b): suffix 系の切詰は無変化（実際末尾: ' + cCopy.slice(-8) + '）');
    console.log('ok AC13(b): 長さ切詰が "-" 込みで効く');

    // ---- AC13(c)-1: findAvailableSlug の候補列 ----
    {
      const tried = [];
      const got = await findAvailableSlug('foo', async (s) => { tried.push(s); return s === 'foo-3'; });
      assert.equal(got, 'foo-3', 'AC13(c): 3番目の候補が採れること');
      assert.deepEqual(tried, ['foo', 'foo-2', 'foo-3'],
        'AC13(c): 候補列が base → base-2 → base-3 であること（実際: ' + JSON.stringify(tried) + '）');
      const none = await findAvailableSlug('foo', async () => false);
      assert.equal(none, null, 'AC13(c): 枯渇は null');
    }
    console.log('ok AC13(c): findAvailableSlug の候補列が base → base-2 → base-3');

    // ---- AC13(c)-2: POI 搬出のファイル名（顧客可視の出力）----
    // reservePoiFileBase は正本 slugCandidate の利用側 ∴ 正本を直せば自動的に揃う。
    {
      const taken = new Set();
      assert.equal(reservePoiFileBase('x', taken), 'x',   'AC13(c): 1件目は素の名前');
      assert.equal(reservePoiFileBase('x', taken), 'x-2', 'AC13(c): 2件目は x-2（旧: x2）');
      assert.equal(reservePoiFileBase('x', taken), 'x-3', 'AC13(c): 3件目は x-3');
      assert.deepEqual([...taken].sort(), ['x', 'x-2', 'x-3'], 'AC13(c): 確保した名前が taken に記録される');
      // 枯渇（上限を下げず実際に埋める）
      const full = new Set();
      for (let n = 1; n <= SEQUENCE_MAX_INDEX; n++) full.add(slugCandidate('y', n));
      assert.equal(reservePoiFileBase('y', full), null, 'AC13(c): 全候補が埋まっていれば null');
    }
    console.log('ok AC13(c): POI 搬出ファイル名が pois/x-2.geojson 相当へ揃う');

    console.log('m5-t5 slug rule hyphen OK');
  `);

  await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      emptyOutDir: true, outDir, ssr: entryFile, target: 'node22',
      rollupOptions: { output: { entryFileNames: 'entry.mjs', format: 'es' } },
    },
  });

  const { stdout } = await execFileAsync(process.execPath, [bundled], {
    cwd: projectRoot, timeout: 60000, maxBuffer: 1024 * 1024 * 8,
  });
  process.stdout.write(stdout);   // 子プロセスの ok 行を証跡として残す
  console.log('m5-t5 slug rule hyphen smoke passed');
} finally {
  await rm(workDir, { recursive: true, force: true });
}
