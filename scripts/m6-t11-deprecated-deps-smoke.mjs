/**
 * m6-t11: deprecated 依存パッケージの是正
 *
 * AC1: package.json の devDependencies に @types/file-url が存在しない
 * AC8: file-url import の**直上行**に @ts-ignore が復活していない
 *
 * AC8 の検査を「import 直上」限定にする理由（設計 §3 軸4 / レビュー round2 Info 1）:
 *   前例 `m2-t3-prohibit-raw-ipc-smoke.mjs:80-84` は MapList.vue に対して
 *   「ファイル全体に @ts-ignore が無い」を検査している。しかし本タスクの対象
 *   `electron/ipc/mapedit.ts` には csv-parser / proj4 / @maplat/tin の**正当な**
 *   @ts-ignore が現存する（それらは本当に型定義を持たない）。∴ ファイル全体検査に
 *   すると恒常 RED になる。file-url は本体が index.d.ts を同梱するため、
 *   **file-url の import 直上に限って** @ts-ignore を禁止する。
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);

// 設計 §1 の表 #1〜#3。撤去対象だった3ファイル
const FILE_URL_IMPORTERS = [
  'electron/ipc/mapedit.ts',
  'electron/services/MapEditService.ts',
  'electron/services/draftTilePaths.ts',
  // #4/#5（もともとガード無し）も検査対象に含める。将来 @ts-ignore が足されるのを防ぐ
  'electron/utils/runtimeTileUrl.ts',
  'electron/services/MapUploadService.ts'
];

// --- AC1: @types/file-url が devDependencies から消えている ---
{
  const pkg = JSON.parse(
    await readFile(path.join(projectRoot, 'package.json'), 'utf8')
  );
  assert.equal(
    pkg.devDependencies?.['@types/file-url'],
    undefined,
    'AC1: @types/file-url が devDependencies に残存している'
    + '（file-url@4 は index.d.ts を同梱するため、このスタブは不要）'
  );
  // file-url 本体は残っていること（誤って本体を消していないことの裏返し検査）
  assert.ok(
    pkg.dependencies?.['file-url'],
    'AC1: file-url 本体が dependencies から失われている'
  );
  console.log('  [1/2] AC1 @types/file-url の除去: PASS');
}

// --- AC8: file-url import の直上行に @ts-ignore が無い ---
{
  let checked = 0;
  for (const rel of FILE_URL_IMPORTERS) {
    const source = await readFile(path.join(projectRoot, rel), 'utf8');
    const lines = source.split('\n');
    const importIdx = lines.findIndex((l) => /from ['"]file-url['"]/.test(l));
    assert.notEqual(
      importIdx, -1,
      `AC8: ${rel} に file-url の import が見つからない（検査対象の前提が崩れている）`
    );
    // 直上行のみを見る。同ファイル内の他 import に付いた正当な @ts-ignore は対象外
    const above = importIdx > 0 ? lines[importIdx - 1] : '';
    assert.doesNotMatch(
      above, /\/\/\s*@ts-ignore/,
      `AC8: ${rel}:${importIdx} の file-url import 直上に @ts-ignore が復活している。`
      + ' file-url@4 は index.d.ts を同梱するため型検査の抑止は不要（設計 §1）'
    );
    checked++;
  }
  assert.equal(
    checked, FILE_URL_IMPORTERS.length,
    'AC8: 検査対象ファイルの全数を見ていない'
  );
  console.log(`  [2/2] AC8 file-url import 直上の @ts-ignore 不在（${checked} ファイル）: PASS`);
}

console.log('\nm6-t11 deprecated-deps smoke: すべて成功');
