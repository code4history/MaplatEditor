/**
 * m18-t8: 配布パッケージの依存解決健全化の受け入れ検査。
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
 *     休眠し、DuckDB 固有の能力を一切使っていなかった（ADR-0001 の 2026-08-09 追記）。
 *
 * この種の欠陥は **ビルドが成功しても検出できない**（起動して初めて落ちる）。∴ 静的検査に加え、
 * ビルド済み asar が存在する場合はその中身を直接読む。
 *
 * 実行: pnpm smoke:m18-t8-packaging
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
const SELF = 'scripts/m18-t8-packaging-smoke.mjs';
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
// AC1 / AC2: 依存宣言
// ───────────────────────────────────────────────
{
  const eb = pkg.devDependencies?.['electron-builder'] ?? '';
  assert.match(
    eb, /^\^?26\./,
    `AC1: electron-builder は 26 系であること（現在: ${eb}）。`
      + ' 24 系・25 系は pnpm の isolated レイアウトを辿れず、推移依存が asar から丸ごと欠落する'
  );
  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies };
  const duck = Object.keys(allDeps).filter((k) => k.startsWith('@duckdb/'));
  assert.deepEqual(duck, [], `AC2: @duckdb/* が依存に残っている: ${duck.join(', ')}`);
  console.log('  [1/8] AC1/AC2 依存宣言（electron-builder 26 / @duckdb 不在）: PASS');
}

// ───────────────────────────────────────────────
// AC3 / AC4: DuckDB 経路の残骸が無い
// ───────────────────────────────────────────────
{
  const imports = grepRepo("@duckdb", ['electron', 'src']);
  assert.deepEqual(
    imports, [],
    `AC3: electron/ src/ に @duckdb 参照が残っている:\n${imports.join('\n')}`
  );
  // 判定 env はコード・smoke から消えていること（ADR の記述は対象外＝outer リポジトリ）
  const envRefs = grepRepo('MAPLAT_SEARCH_ENGINE', ['electron', 'src', 'scripts', 'tests']);
  assert.deepEqual(
    envRefs, [],
    `AC4: MAPLAT_SEARCH_ENGINE の参照が残っている:\n${envRefs.join('\n')}`
  );
  console.log('  [2/8] AC3/AC4 DuckDB 経路の残骸なし: PASS');
}

// ───────────────────────────────────────────────
// AC5: SearchDataService の公開 API が不変
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
    assert.match(src, re, `AC5: SearchDataService の公開 API が変わっている: ${re}`);
  }
  // searchExtent は SQLite 委譲になり、旧 DuckDB 経路の機能欠損（kind!=='map' で空配列）が消えたこと
  assert.doesNotMatch(
    src, /kind !== 'map'/,
    'AC5: kind!==map を空配列で返す旧 DuckDB 経路の欠損が残っている'
  );
  console.log('  [3/8] AC5 公開 API の不変性: PASS');
}

// ───────────────────────────────────────────────
// AC10: ADR-0001 に撤去が記録されている（outer リポジトリ）
// ───────────────────────────────────────────────
{
  const adr = path.resolve(projectRoot, '../docs/adr/0001-sqlite-write-store-with-duckdb-search.md');
  if (existsSync(adr)) {
    const txt = readFileSync(adr, 'utf8');
    assert.match(txt, /Update \(2026-08-09, m18-t8\): the DuckDB path is removed\./,
      'AC10: ADR-0001 に撤去の追記が無い');
    console.log('  [4/8] AC10 ADR-0001 の追記: PASS');
  } else {
    console.log(`  [4/8] AC10 ADR-0001: SKIP（outer が見えない実行位置: ${adr}）`);
  }
}

// ───────────────────────────────────────────────
// AC7 / AC8: ビルド済み asar の中身
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
    // 黙って通さない。何が未検証かを明示する（AC7/AC8 は root でのビルド後に確定させる）
    console.log('  [5/8] AC7/AC8 asar の中身: **SKIP — ビルド生成物が無い**');
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
    // AC7: 直接依存ではない＝推移依存であるものが実在すること
    const TRANSITIVE = ['@jimp/js-bmp', '@jimp/core', 'graceful-fs', 'jsonfile', 'universalify', 'conf', 'ajv'];
    const missing = TRANSITIVE.filter((n) => !has(n));
    assert.deepEqual(
      missing, [],
      `AC7: 推移依存が asar に入っていない: ${missing.join(', ')}\n`
        + `  （asar: ${path.relative(projectRoot, asar)}／electron-builder が pnpm レイアウトを辿れていない）`
    );
    // AC8: DuckDB が消えていること
    assert.ok(!('@duckdb' in nm), 'AC8: asar に @duckdb が残っている');

    const count = Object.entries(nm).reduce(
      (n, [k, v]) => n + (k.startsWith('@') ? Object.keys(v.files ?? {}).length : 1), 0
    );
    assert.ok(
      count > 100,
      `AC7: asar の node_modules が ${count} 件しかない（直接依存のみ＝29 件前後なら収集が壊れている）`
    );
    console.log(`  [5/8] AC7/AC8 asar の中身: PASS（${count} パッケージ／@duckdb 不在）`);
  }
}

// ───────────────────────────────────────────────
// AC12: 単独 lockfile が package.json と一致すること
//
// CI は monorepo ではなく**各リポジトリを単独 clone** し、リポジトリ自身の
// pnpm-lock.yaml を frozen-lockfile で使う。∴ ワークスペースルートの lock だけを
// 再解決しても CI は直らない。実際 m18-t8 の実装で本ファイルの更新を落とし、
// Linux ジョブが ERR_PNPM_OUTDATED_LOCKFILE で落ちた（2026-08-09）。
// 更新手段: outer で `node scripts/m1-t2/refresh-standalone-locks.mjs MaplatEditor`
// ───────────────────────────────────────────────
{
  const lock = read('pnpm-lock.yaml');
  // importers の "." ブロックだけを切り出す（他 importer があっても混ざらないように）
  const impStart = lock.indexOf('\nimporters:');
  assert.ok(impStart >= 0, 'AC12: pnpm-lock.yaml に importers セクションが無い');
  const dotStart = lock.indexOf('\n  .:', impStart);
  assert.ok(dotStart >= 0, 'AC12: pnpm-lock.yaml に importers["."] が無い');
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

  const missing = Object.keys(manifest).filter((k) => !lockSpecs.has(k));
  const extra = [...lockSpecs.keys()].filter((k) => !(k in manifest));
  const mismatched = Object.entries(manifest)
    .filter(([k, v]) => lockSpecs.has(k) && lockSpecs.get(k) !== v)
    .map(([k, v]) => `${k}（manifest: ${v} / lock: ${lockSpecs.get(k)}）`);

  assert.deepEqual(missing, [], `AC12: lockfile に無い依存: ${missing.join(', ')}`);
  assert.deepEqual(extra, [], `AC12: package.json から消えたのに lockfile に残る依存: ${extra.join(', ')}`);
  assert.deepEqual(mismatched, [], `AC12: specifier 不一致: ${mismatched.join(' / ')}`);
  console.log(`  [6/8] AC12 単独 lockfile の整合（${lockSpecs.size} 依存）: PASS`);
}

// ───────────────────────────────────────────────
// AC13: override と依存の宣言範囲が衝突していないこと（jimp × file-type）
//
// m1-t3 のセキュリティ override `file-type: "^21.3.1"` は、宣言範囲を無視して
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
  assert.ok(m, 'AC13: 単独 lockfile に jimp の解決が見つからない');
  const [maj, min, pat] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ge161 = maj > 1 || (maj === 1 && (min > 6 || (min === 6 && pat >= 1)));
  assert.ok(
    ge161,
    `AC13: jimp が ${maj}.${min}.${pat} に解決されている。`
      + ' 1.6.0 は file-type ^16 前提で file-type/core.js を import するため、'
      + ' m1-t3 の override（file-type ^21.3.1）と衝突して起動時に'
      + ' ERR_PACKAGE_PATH_NOT_EXPORTED で落ちる。1.6.1 以上であること'
  );
  // 対になる前提: override が 21.x を当てていること（外れたら本検査の根拠も変わる）
  const ft = lock.match(/\n {2}file-type@(\d+)\./);
  assert.ok(ft && Number(ft[1]) >= 21,
    `AC13: file-type の解決が 21.x でない（${ft?.[1] ?? '不明'}）。override の前提が変わっている`);
  console.log(`  [7/8] AC13 override 衝突なし（jimp ${maj}.${min}.${pat} / file-type ${ft[1]}.x）: PASS`);
}

// ───────────────────────────────────────────────
// AC6 の補助: 本 smoke が package.json へ結線されていること（rule-0012）
// ───────────────────────────────────────────────
{
  const scripts = pkg.scripts ?? {};
  const wired = Object.entries(scripts).find(([, v]) => v.includes('m18-t8-packaging-smoke.mjs'));
  assert.ok(wired, 'rule-0012: 本 smoke が package.json の scripts から呼ばれていない');
  assert.equal(wired[0], 'smoke:m18-t8-packaging', 'rule-0012: 命名規約 smoke:<task-id> に従うこと');
  console.log('  [8/8] rule-0012 package.json への結線: PASS');
}

console.log('\nm18-t8 packaging smoke: すべて成功');
