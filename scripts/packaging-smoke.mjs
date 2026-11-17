/**
 * 配布パッケージの依存解決健全化の受け入れ検査。
 *
 * 守っている不変条件は2つある。
 *
 * (1) **推移的依存が asar に入ること**。electron-builder 24.13.3 は pnpm の isolated
 *     レイアウト（実体が `.pnpm/<name>@<ver>/node_modules/<name>` に置かれ、依存は同階層の
 *     兄弟として並ぶ）を辿れず、app 直下に実在する**直接依存だけ**を拾っていた。結果、
 *     署名・公証まで通った 1.0.0-rc1 が起動時に
 *     `Cannot find package '@jimp/js-bmp'` で落ちた（2026-08-09 実測）。
 *     pnpm 対応コレクタは 26.x が初出で、24 系・25 系にバックポートは無い
 *     （各版の tarball を取得して `out/node-module-collector/` の有無で確認）。
 *
 * (2) **DuckDB 経路が復活しないこと**。asar の 108MB を占めていた割に、既定から外れて
 *     休眠し、DuckDB 固有の能力を一切使っていなかった（書き込みは SQLite の Write Store に集め、検索は別の層で行う決まりの 2026-08-09 追記）。
 *
 * この種の欠陥は **ビルドが成功しても検出できない**（起動して初めて落ちる）。∴ 静的検査に加え、
 * ビルド済み asar が存在する場合はその中身を直接読む。
 *
 * 実行: pnpm smoke:packaging
 */
import { readFileSync, existsSync, readdirSync, openSync, readSync, closeSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const read = (rel) => readFileSync(path.join(projectRoot, rel), 'utf8');
const pkg = JSON.parse(read('package.json'));

// 変更ファイルを参照する側を機械列挙するための共通 grep（コード軸）。
// 本ファイル自身は needle を含む（検査の材料として書いてあるだけ）ため除外する。
const SELF = 'scripts/packaging-smoke.mjs';
function grepRepo(pattern, dirs) {
  try {
    const out = execFileSync('grep', ['-rn', '--include=*.ts', '--include=*.vue', '--include=*.mjs', pattern, ...dirs], {
      cwd: projectRoot, encoding: 'utf8',
    });
    return out.trim().split('\n').filter(Boolean).filter((l) => !l.startsWith(`${SELF}:`));
  } catch {
    return []; // grep はヒット0で exit 1
  }
}

// ───────────────────────────────────────────────
// case 1 / case 2: 依存宣言
// ───────────────────────────────────────────────
{
  const eb = pkg.devDependencies?.['electron-builder'] ?? '';
  assert.match(
    eb, /^\^?26\./,
    `case 1: electron-builder は 26 系であること（現在: ${eb}）。`
      + ' 24 系・25 系は pnpm の isolated レイアウトを辿れず、推移依存が asar から丸ごと欠落する'
  );
  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies };
  const duck = Object.keys(allDeps).filter((k) => k.startsWith('@duckdb/'));
  assert.deepEqual(duck, [], `case 2: @duckdb/* が依存に残っている: ${duck.join(', ')}`);
  console.log('  [1/8] case 1/case 2 依存宣言（electron-builder 26 / @duckdb 不在）: PASS');
}

// ───────────────────────────────────────────────
// case 3 / case 4: DuckDB 経路の残骸が無い
// ───────────────────────────────────────────────
{
  const imports = grepRepo("@duckdb", ['electron', 'src']);
  assert.deepEqual(
    imports, [],
    `case 3: electron/ src/ に @duckdb 参照が残っている:\n${imports.join('\n')}`
  );
  // 判定 env はコード・smoke から消えていること（ADR の記述は対象外＝outer リポジトリ）
  const envRefs = grepRepo('MAPLAT_SEARCH_ENGINE', ['electron', 'src', 'scripts', 'tests']);
  assert.deepEqual(
    envRefs, [],
    `case 4: MAPLAT_SEARCH_ENGINE の参照が残っている:\n${envRefs.join('\n')}`
  );
  // ビルド設定とスクリプトに死んだ
  // @duckdb の external を残さない（復活させない）恒久の不在検査。vite.config.ts の external は
  // 1 行の配列で、他タスク（自動更新のための electron-updater 追加など）の rebase で旧い行が戻り得る。
  // grep に頼らず読む（grep はヒット 0 と失敗の区別が付かない）。本ファイル自身は不在の断言のため除く。
  const NEEDLE = '@' + 'duckdb';
  const buildConfigs = ['vite.config.ts'];
  for (const rel of buildConfigs) {
    assert.ok(!read(rel).includes(NEEDLE), `case 3: ${rel} に ${NEEDLE} が残っている（死んだ external）`);
  }
  const scriptHits = readdirSync(path.join(projectRoot, 'scripts'), { recursive: true })
    .map((p) => path.join('scripts', String(p)))
    .filter((rel) => rel !== SELF && /\.(mjs|cjs|js|ts)$/.test(rel))
    .filter((rel) => read(rel).includes(NEEDLE));
  assert.deepEqual(scriptHits, [], `case 3: scripts/ に ${NEEDLE} 参照が残っている:\n${scriptHits.join('\n')}`);
  console.log('  [2/8] case 3/case 4 DuckDB 経路の残骸なし（electron/ src/ scripts/ vite.config.ts）: PASS');
}

// ───────────────────────────────────────────────
// case 5: SearchDataService の公開 API が不変
//
// 撤去は「内部実装の入れ替え」であって「契約の変更」ではない。呼び出し側
// （MapDataService / AppDataService / ipc 経由）を壊していないことを、
// シグネチャの実在で担保する。
// ───────────────────────────────────────────────
{
  const src = read('electron/services/SearchDataService.ts');
  const CONTRACT = [
    /async reset\(\): Promise<void>/,
    /async listMaps\(query: string = '', page: number = 1, pageSize: number = 20\): Promise<MapListResult>/,
    /async listApps\(query: string = '', page: number = 1, pageSize: number = 20\): Promise<AppListResult>/,
    /async searchExtent\(extent: number\[\], kind: 'map' \| 'poi-source' \| 'app' = 'map'\): Promise<string\[\]>/,
  ];
  for (const re of CONTRACT) {
    assert.match(src, re, `case 5: SearchDataService の公開 API が変わっている: ${re}`);
  }
  // searchExtent は SQLite 委譲になり、旧 DuckDB 経路の機能欠損（kind!=='map' で空配列）が消えたこと
  assert.doesNotMatch(
    src, /kind !== 'map'/,
    'case 5: kind!==map を空配列で返す旧 DuckDB 経路の欠損が残っている'
  );
  console.log('  [3/8] case 5 公開 API の不変性: PASS');
}

// ───────────────────────────────────────────────
// case 10: 書き込みは SQLite の Write Store に集め、検索は別の層で行う決まりに撤去が記録されている（outer リポジトリ）
// ───────────────────────────────────────────────
{
  const adr = path.resolve(projectRoot, '../docs/adr/0001-sqlite-write-store-with-duckdb-search.md');
  if (existsSync(adr)) {
    const txt = readFileSync(adr, 'utf8');
    assert.match(txt, /Update \(2026-08-09, m18-t8\): the DuckDB path is removed\./,
      'case 10: 書き込みは SQLite の Write Store に集め、検索は別の層で行う決まりに撤去の追記が無い');
    console.log('  [4/8] case 10 書き込みは SQLite の Write Store に集め、検索は別の層で行う決まりの追記: PASS');
  } else {
    console.log(`  [4/8] case 10 書き込みは SQLite の Write Store に集め、検索は別の層で行う決まり: SKIP（outer が見えない実行位置: ${adr}）`);
  }
}

// ───────────────────────────────────────────────
// case 7 / case 8: ビルド済み asar の中身
//
// **ここが本丸**である。上の静的検査は「そう書いたこと」しか証明しない。
// 実際に推移依存が同梱されるかは、生成物を開いて確かめるほかない。
// ───────────────────────────────────────────────
// asar は 300MB を超える。ヘッダ（先頭の JSON）だけを部分読みする
// （readFileSync だと全体をメモリへ載せてしまう）。
// 形式: UInt32LE ×3（pickle のサイズ情報）→ UInt32LE headerSize → header JSON
function readAsarHeader(file) {
  const fd = openSync(file, 'r');
  try {
    const head = Buffer.alloc(16);
    readSync(fd, head, 0, 16, 0);
    const jsonLen = head.readUInt32LE(12);
    const body = Buffer.alloc(jsonLen);
    readSync(fd, body, 0, jsonLen, 16);
    return JSON.parse(body.toString('utf8').replace(/\0+$/, ''));
  } finally {
    closeSync(fd);
  }
}

function findAsar() {
  const relDir = path.join(projectRoot, 'release');
  if (!existsSync(relDir)) return null;
  const stack = [relDir];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.name === 'app.asar') return full;
    }
  }
  return null;
}

{
  const asar = findAsar();
  if (!asar) {
    // 黙って通さない。何が未検証かを明示する（case 7/case 8 は root でのビルド後に確定させる）
    console.log('  [5/8] case 7/case 8 asar の中身: **SKIP — ビルド生成物が無い**');
    console.log('        推移依存の同梱は静的検査では証明できない。root（完全 workspace）で');
    console.log('        `pnpm run dist:mac:arm64` 等を実行してから本 smoke を再実行すること。');
  } else {
    const hdr = readAsarHeader(asar);
    const nm = hdr.files?.node_modules?.files ?? {};
    const has = (name) => {
      if (!name.includes('/')) return name in nm;
      const [scope, rest] = name.split('/');
      return rest in (nm[scope]?.files ?? {});
    };
    // case 7: 直接依存ではない＝推移依存であるものが実在すること
    const TRANSITIVE = ['@jimp/js-bmp', '@jimp/core', 'graceful-fs', 'jsonfile', 'universalify', 'conf', 'ajv'];
    const missing = TRANSITIVE.filter((n) => !has(n));
    assert.deepEqual(
      missing, [],
      `case 7: 推移依存が asar に入っていない: ${missing.join(', ')}\n`
        + `  （asar: ${path.relative(projectRoot, asar)}／electron-builder が pnpm レイアウトを辿れていない）`
    );
    // case 8: DuckDB が消えていること
    assert.ok(!('@duckdb' in nm), 'case 8: asar に @duckdb が残っている');

    const count = Object.entries(nm).reduce(
      (n, [k, v]) => n + (k.startsWith('@') ? Object.keys(v.files ?? {}).length : 1), 0
    );
    assert.ok(
      count > 100,
      `case 7: asar の node_modules が ${count} 件しかない（直接依存のみ＝29 件前後なら収集が壊れている）`
    );
    console.log(`  [5/8] case 7/case 8 asar の中身: PASS（${count} パッケージ／@duckdb 不在）`);
  }
}

// ───────────────────────────────────────────────
// case 12: 単独 lockfile が package.json と一致すること
//
// CI は monorepo ではなく**各リポジトリを単独 clone** し、リポジトリ自身の
// pnpm-lock.yaml を frozen-lockfile で使う。∴ ワークスペースルートの lock だけを
// 再解決しても CI は直らない。実際、DuckDB の撤去の実装で本ファイルの更新を落とし、
// Linux ジョブが ERR_PNPM_OUTDATED_LOCKFILE で落ちた（2026-08-09）。
// 更新手段: 親の作業場所にある単独 clone の lock の更新スクリプトを MaplatEditor を指定して走らせる
// ───────────────────────────────────────────────
{
  const lock = read('pnpm-lock.yaml');
  // importers の "." ブロックだけを切り出す（他 importer があっても混ざらないように）
  const impStart = lock.indexOf('\nimporters:');
  assert.ok(impStart >= 0, 'case 12: pnpm-lock.yaml に importers セクションが無い');
  const dotStart = lock.indexOf('\n  .:', impStart);
  assert.ok(dotStart >= 0, 'case 12: pnpm-lock.yaml に importers["."] が無い');
  // 次の同階層 importer（2スペース + 非空白）またはトップレベルキーまで
  const rest = lock.slice(dotStart + 1);
  const endRel = rest.slice(1).search(/\n(?:  \S|\S)/);
  const dotBlock = endRel < 0 ? rest : rest.slice(0, endRel + 1);

  // "      <name>:\n        specifier: <spec>" を全数拾う
  const lockSpecs = new Map(
    [...dotBlock.matchAll(/\n {6}('?[^'\n:]+'?):\n {8}specifier: (.+)/g)]
      .map((m) => [m[1].replace(/^'|'$/g, ''), m[2].trim()])
  );
  const manifest = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies };

  // CI の pnpm-workspace.yaml の overrides で直接の依存を差し替えたときは、lock の specifier が
  // overrides の値になる（package.json の範囲ではない）。その組は lock の overrides と突き合わせる
  const overridesBlock = lock.match(/\noverrides:\n((?: {2}.+\n)+)/);
  const lockOverrides = new Map(
    overridesBlock
      ? [...overridesBlock[1].matchAll(/^ {2}('?[^'\n]+'?): (.+)$/gm)].map((m) => [m[1].replace(/^'|'$/g, ''), m[2].trim()])
      : []
  );
  const specOf = (k, v) => (lockOverrides.has(k) ? lockOverrides.get(k) : v);

  const missing = Object.keys(manifest).filter((k) => !lockSpecs.has(k));
  const extra = [...lockSpecs.keys()].filter((k) => !(k in manifest));
  const mismatched = Object.entries(manifest)
    .filter(([k, v]) => lockSpecs.has(k) && lockSpecs.get(k) !== specOf(k, v))
    .map(([k, v]) => `${k}（manifest: ${specOf(k, v)} / lock: ${lockSpecs.get(k)}）`);

  assert.deepEqual(missing, [], `case 12: lockfile に無い依存: ${missing.join(', ')}`);
  assert.deepEqual(extra, [], `case 12: package.json から消えたのに lockfile に残る依存: ${extra.join(', ')}`);
  assert.deepEqual(mismatched, [], `case 12: specifier 不一致: ${mismatched.join(' / ')}`);
  console.log(`  [6/8] case 12 単独 lockfile の整合（${lockSpecs.size} 依存）: PASS`);
}

// ───────────────────────────────────────────────
// case 13: override と依存の宣言範囲が衝突していないこと（jimp × file-type）
//
// 以前に入れたセキュリティ override `file-type: "^21.3.1"` は、宣言範囲を無視して
// 全経路へ 21.x を強制する。ところが:
//   @jimp/core@1.6.0 → file-type ^16.0.0 を宣言し `file-type/core.js` を import
//   file-type@21.x   → exports は '.' / './core' / './node'（`./core.js` は無い）
// ∴ jimp 1.6.0 のまま 21.x を当てると、起動時に
//    ERR_PACKAGE_PATH_NOT_EXPORTED: Package subpath './core.js' is not defined
// で落ちる（2026-08-09 に公証済み配布物で実測）。@jimp/core@1.6.1 が file-type ^21.3.3
// 対応に直したので、jimp は 1.6.1 以上を要求する。
//
// この欠陥は **install も build も通る**。override が解決を書き換えた結果、
// 実行時に初めて露見する種類である。∴ 版の下限を機械で固定する。
// ───────────────────────────────────────────────
{
  const lock = read('pnpm-lock.yaml');
  const m = lock.match(/\n {2}jimp@(\d+)\.(\d+)\.(\d+)[^\n:]*:/);
  assert.ok(m, 'case 13: 単独 lockfile に jimp の解決が見つからない');
  const [maj, min, pat] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ge161 = maj > 1 || (maj === 1 && (min > 6 || (min === 6 && pat >= 1)));
  assert.ok(
    ge161,
    `case 13: jimp が ${maj}.${min}.${pat} に解決されている。`
      + ' 1.6.0 は file-type ^16 前提で file-type/core.js を import するため、'
      + ' セキュリティの override（file-type ^21.3.1）と衝突して起動時に'
      + ' ERR_PACKAGE_PATH_NOT_EXPORTED で落ちる。1.6.1 以上であること'
  );
  // 対になる前提: override が 21.x を当てていること（外れたら本検査の根拠も変わる）
  const ft = lock.match(/\n {2}file-type@(\d+)\./);
  assert.ok(ft && Number(ft[1]) >= 21,
    `case 13: file-type の解決が 21.x でない（${ft?.[1] ?? '不明'}）。override の前提が変わっている`);
  console.log(`  [7/8] case 13 override 衝突なし（jimp ${maj}.${min}.${pat} / file-type ${ft[1]}.x）: PASS`);
}

// ───────────────────────────────────────────────
// case 6 の補助: 本 smoke が package.json へ結線されていること
// ───────────────────────────────────────────────
{
  const scripts = pkg.scripts ?? {};
  const wired = Object.entries(scripts).find(([, v]) => v.includes('packaging-smoke.mjs'));
  assert.ok(wired, '結線の規則: 本 smoke が package.json の scripts から呼ばれていない');
  assert.equal(wired[0], 'smoke:packaging', '結線の規則: 命名規約 smoke:<task-id> に従うこと');
  console.log('  [8/8] package.json への結線: PASS');
}

console.log('\nm18-t8 packaging smoke: すべて成功');
