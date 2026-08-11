// M12-T31 構造 smoke: goBack の router.back()/history.go() 撤去 + 共通ヘルパ
// navigateBackToList への3画面（AppEdit/MapEdit/PoiEdit）統一を機械的に検証する
// （設計 §7.2）。m12-t30-pois-write-shape-smoke.mjs Part C（countOccurrences =
// content.includes によるコメント込み生文字列一致）と同文法。
//
// 設計レビュー v1.0 Major-1 の解消（v1.1）: この生一致方式は変更しない。§6.1 の新規ヘルパ
// コメント側を禁止対象そのものの文字列を含まない言い回しへ書き換えることで、smoke が
// 設計自身のヘルパで自己矛盾 fail する問題を解消した（採用: 方式(a)）。
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);

async function walkFiles(dir, exts) {
  const out = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.tmp-smoke' || entry.name === 'dist') continue;
      out.push(...(await walkFiles(full, exts)));
    } else if (exts.some((ext) => entry.name.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

async function countOccurrences(dirs, exts, needle) {
  let count = 0;
  const hits = [];
  for (const dir of dirs) {
    const files = await walkFiles(dir, exts);
    for (const file of files) {
      const content = await readFile(file, 'utf8');
      if (content.includes(needle)) {
        count += 1;
        hits.push(file);
      }
    }
  }
  return { count, hits };
}

const srcDir = path.join(projectRoot, 'src');
const helperPath = path.join(srcDir, 'utils/listBackNavigation.ts');

// --- renderer 全域（src/）に router.back( / history.go( / history.back( が 0件（コメント込み生一致） ---
for (const needle of ['router.back(', 'history.go(', 'history.back(']) {
  const hits = await countOccurrences([srcDir], ['.ts', '.vue'], needle);
  assert.equal(
    hits.count,
    0,
    `src/ に禁止文字列 "${needle}" が残存している（joint session history 汚染の再発を招く）: ${JSON.stringify(hits.hits)}`,
  );
}
console.log('ok: src/ 全域で router.back(/history.go(/history.back( が 0件');

// --- ヘルパ実在 + router.push( を含む ---
assert.equal(existsSync(helperPath), true, 'src/utils/listBackNavigation.ts が存在しない');
const helperSrc = await readFile(helperPath, 'utf8');
assert.match(helperSrc, /router\.push\(/, 'listBackNavigation.ts に router.push( が含まれていない');
assert.match(
  helperSrc,
  /export\s+(async\s+)?function\s+navigateBackToList/,
  'listBackNavigation.ts に navigateBackToList のエクスポートが定義されていない',
);
console.log('ok: src/utils/listBackNavigation.ts が存在し、navigateBackToList を export している');

// --- 3画面すべてが listBackNavigation を import し、navigateBackToList( を呼んでいる ---
const views = [
  { file: path.join(srcDir, 'views/AppEdit.vue'), listPath: '/applist' },
  { file: path.join(srcDir, 'views/MapEdit.vue'), listPath: '/maplist' },
  { file: path.join(srcDir, 'views/PoiEdit.vue'), listPath: '/poisources' },
];
for (const { file, listPath } of views) {
  const src = await readFile(file, 'utf8');
  assert.match(
    src,
    /from\s+["']\.\.\/utils\/listBackNavigation["']/,
    `${path.basename(file)} が ../utils/listBackNavigation を import していない`,
  );
  assert.match(
    src,
    /navigateBackToList\(/,
    `${path.basename(file)} が navigateBackToList( を呼び出していない`,
  );
  const callWithListPath = new RegExp(`navigateBackToList\\([^)]*["']${listPath.replace(/\//g, '\\/')}["']`);
  assert.match(
    src,
    callWithListPath,
    `${path.basename(file)} の navigateBackToList 呼び出しが listPath "${listPath}" を渡していない`,
  );
}
console.log('ok: AppEdit.vue / MapEdit.vue / PoiEdit.vue が navigateBackToList を import/呼び出ししている');

console.log('M12-T31 back-navigation smoke passed');
