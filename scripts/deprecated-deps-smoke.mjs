/**
 * deprecated 依存パッケージの是正
 *
 * case 1: package.json の devDependencies に @types/file-url が存在しない
 * case 8: file-url import の**直上行**に @ts-ignore が復活していない
 *
 * case 8 の検査を「import 直上」限定にする理由（軸4 / 以前のレビュー）:
 *   前例 `prohibit-raw-ipc-smoke.mjs:80-84` は MapList.vue に対して
 *   「ファイル全体に @ts-ignore が無い」を検査している。しかし本タスクの対象
 *   `electron/ipc/mapedit.ts` には csv-parser / proj4 / @maplat/tin の**正当な**
 *   @ts-ignore が現存する（それらは本当に型定義を持たない）。∴ ファイル全体検査に
 *   すると恒常 RED になる。file-url は本体が index.d.ts を同梱するため、
 *   **file-url の import 直上に限って** @ts-ignore を禁止する。
 *
 * 追随（#105）:
 *   ローカルタイル URL の生成は file-url（file://）から `electron/utils/appScheme.ts` の
 *   `localFileUrl`（app://local）へ移り、下記 5 ファイルから file-url の import が消えた
 *   （webSecurity:true の下で renderer は file:// を読めない ∴ file:// 生成器の復活は契約違反）。
 *   case 8 の検査対象（import 行）を置換先の appScheme import へ移し、
 *   (a) file-url の import が復活していないこと、(b) 置換先 appScheme の import が実在し、
 *   その直上に @ts-ignore が無いこと（型検査を抑止しない趣旨の継承）を断言する。
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);

// 表 #1〜#3。撤去対象だった3ファイル（#105 以降は appScheme の import を持つ）
const FILE_URL_IMPORTERS = [
  'electron/ipc/mapedit.ts',
  'electron/services/MapEditService.ts',
  'electron/services/draftTilePaths.ts',
  // #4/#5（もともとガード無し）も検査対象に含める。将来 @ts-ignore が足されるのを防ぐ
  'electron/utils/runtimeTileUrl.ts',
  'electron/services/MapUploadService.ts'
];

// --- case 1: @types/file-url が devDependencies から消えている ---
{
  const pkg = JSON.parse(
    await readFile(path.join(projectRoot, 'package.json'), 'utf8')
  );
  assert.equal(
    pkg.devDependencies?.['@types/file-url'],
    undefined,
    'case 1: @types/file-url が devDependencies に残存している'
    + '（file-url@4 は index.d.ts を同梱するため、このスタブは不要）'
  );
  // file-url 本体は残っていること（誤って本体を消していないことの裏返し検査）
  assert.ok(
    pkg.dependencies?.['file-url'],
    'case 1: file-url 本体が dependencies から失われている'
  );
  console.log('  [1/2] case 1 @types/file-url の除去: PASS');
}

// --- case 8: 旧 file-url 利用箇所の import 行に型検査の抑止が無い（#105 以降は置換先 appScheme） ---
{
  let checked = 0;
  for (const rel of FILE_URL_IMPORTERS) {
    const source = await readFile(path.join(projectRoot, rel), 'utf8');
    const lines = source.split('\n');
    // (a) #105 で撤去された file-url（file:// 生成器）の import が復活していない
    assert.equal(
      lines.findIndex((l) => /from ['"]file-url['"]/.test(l)), -1,
      `case 8: ${rel} に file-url の import が復活している（#105 でローカル URL は app://local の appScheme へ移行済み）`
    );
    // (b) 置換先 appScheme の import が実在する（検査対象の前提）
    const importIdx = lines.findIndex((l) => /from ['"](?:\.\.\/utils|\.)\/appScheme['"]/.test(l));
    assert.notEqual(
      importIdx, -1,
      `case 8: ${rel} に appScheme の import が見つからない（検査対象の前提が崩れている）`
    );
    // 直上行のみを見る。同ファイル内の他 import に付いた正当な @ts-ignore は対象外
    const above = importIdx > 0 ? lines[importIdx - 1] : '';
    assert.doesNotMatch(
      above, /\/\/\s*@ts-ignore/,
      `case 8: ${rel}:${importIdx} の appScheme import 直上に @ts-ignore がある。`
      + ' appScheme.ts は型付きの .ts であり型検査の抑止は不要'
    );
    checked++;
  }
  assert.equal(
    checked, FILE_URL_IMPORTERS.length,
    'case 8: 検査対象ファイルの全数を見ていない'
  );
  console.log(`  [2/2] case 8 file-url import の不在と appScheme import 直上の @ts-ignore 不在（${checked} ファイル）: PASS`);
}

console.log('\ndeprecated-deps smoke: すべて成功');
