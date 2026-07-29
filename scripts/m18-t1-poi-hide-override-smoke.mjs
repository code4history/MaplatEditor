// m18-t1: 地図管理 > POI 編集の hide 上書き UI
//
// 設計 docs/superpowers/specs/2026-07-29-m18-t1-map-poi-hide-override-ui-design.md v1.3 §6.1 準拠。
// PoiReferenceEditor.vue は SFC のため純関数の直接 import ができない（既存の POI 系 smoke も同方式）。
// ソーステキスト read + 構造 assert で、UI 配置・2状態の書き込み契約・readOnly・i18n を検証する。
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const editorPath = path.join(projectRoot, 'src/components/PoiReferenceEditor.vue');
const editor = await readFile(editorPath, 'utf8');

// 参照要素の「上書き欄ブロック」と、対になる非参照要素の注記ブロックの範囲を切り出す。
// 注意: `v-if="poiUidOf(entry) !== null"` はカード内の小さい表示行にも使われているため
// （PoiReferenceEditor.vue の :110 付近）、上書き欄は class="row g-2 mt-1" 付きの方で特定する。
const OVERRIDE_BLOCK_MARK = 'v-if="poiUidOf(entry) !== null" class="row g-2 mt-1"';
const NOTE_BLOCK_MARK = '<div v-else class="mb-0">';
const refBlockStart = editor.indexOf(OVERRIDE_BLOCK_MARK);
assert.ok(refBlockStart > 0, `参照要素の上書き欄ブロック（${OVERRIDE_BLOCK_MARK}）が存在する`);
const elseIdx = editor.indexOf(NOTE_BLOCK_MARK, refBlockStart);
assert.ok(elseIdx > refBlockStart, '非参照要素の注記ブロック（v-else）が上書き欄ブロックの後にある');
const refBlock = editor.slice(refBlockStart, elseIdx);
const afterElse = editor.slice(elseIdx);

// --- [1/6] AC1-1: hide チェックボックスが参照要素の上書き欄ブロック内にある ---
assert.match(
  refBlock,
  /data-testid="poiref-hide-override"/,
  'AC1-1: 参照要素ブロック内に data-testid="poiref-hide-override" が存在する',
);
assert.match(refBlock, /type="checkbox"/, 'AC1-1: チェックボックスとして実装されている');
assert.match(
  refBlock,
  /t\("poiref\.hide_override"\)|t\('poiref\.hide_override'\)/,
  'AC1-1: ラベルに poiref.hide_override を使う',
);
console.log('  [1/6] AC1-1 hide チェックボックスが参照要素の上書き欄内にある: PASS');

// --- [2/6] AC1-2: 非参照要素（v-else 側）には現れない ---
assert.doesNotMatch(
  afterElse,
  /poiref-hide-override/,
  'AC1-2: 非参照要素ブロック（v-else 以降）に hide チェックボックスが現れない',
);
console.log('  [2/6] AC1-2 非参照要素には hide UI を出さない: PASS');

// --- [3/6] AC1-3/AC1-4: 2状態の書き込み契約（ON=true セット / OFF=キー削除・false を書かない） ---
const setHideStart = editor.indexOf('function setHideOverride');
assert.ok(setHideStart > 0, 'setHideOverride が定義されている');
// 関数本体（次の関数定義または script 末尾まで）を粗く切り出す
const setHideBody = editor.slice(setHideStart, setHideStart + 900);
assert.match(setHideBody, /updated\.hide\s*=\s*true/, 'AC1-3: ON で hide = true をセットする');
assert.match(setHideBody, /delete\s+updated\.hide/, 'AC1-4: OFF で hide キーを削除する');
assert.doesNotMatch(
  setHideBody,
  /(updated|record)\.hide\s*=\s*false/,
  'AC1-4: false を書き込む経路が存在しない（t3 v1.3 §5.3 の2状態契約）',
);
console.log('  [3/6] AC1-3/4 2状態の書き込み契約（true セット / キー削除・false 不使用）: PASS');

// --- [4/6] AC1-5: 変化がなければ emit しない（early return） ---
assert.match(
  setHideBody,
  /if\s*\(\s*\(\s*record\.hide\s*===\s*true\s*\)\s*===\s*checked\s*\)\s*return/,
  'AC1-5: 現在値と同じなら early return して emit しない',
);
console.log('  [4/6] AC1-5 変化なしでは update:pois を emit しない: PASS');

// --- [5/6] AC1-6: readOnly でチェックボックスが disabled ---
const hideIdx = refBlock.indexOf('data-testid="poiref-hide-override"');
const hideInput = refBlock.slice(hideIdx, hideIdx + 500);
assert.match(hideInput, /:disabled="readOnly"/, 'AC1-6: readOnly のとき disabled になる');
console.log('  [5/6] AC1-6 readOnly 対応: PASS');

// --- [6/6] AC1-11 補: i18n 2キーが 11 locale すべてに存在する（parity スクリプトとは独立の二重チェック） ---
const localesDir = path.join(projectRoot, 'public/locales');
const { readdir } = await import('node:fs/promises');
const langs = (await readdir(localesDir, { withFileTypes: true }))
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();
assert.equal(langs.length, 11, `locale は 11 言語（実測: ${langs.join(',')}）`);
for (const lang of langs) {
  const raw = await readFile(path.join(localesDir, lang, 'translation.json'), 'utf8');
  const json = JSON.parse(raw);
  const poiref = json.poiref ?? {};
  assert.ok(
    typeof poiref.hide_override === 'string' && poiref.hide_override.length > 0,
    `AC1-11: ${lang} に poiref.hide_override がある`,
  );
  assert.ok(
    typeof poiref.hide_override_note === 'string' && poiref.hide_override_note.length > 0,
    `AC1-11: ${lang} に poiref.hide_override_note がある`,
  );
  assert.ok(raw.endsWith('\n'), `${lang}/translation.json は末尾改行を保つ（設計 §7.1）`);
}
console.log(`  [6/6] AC1-11 i18n 2キー × ${langs.length} locale + 末尾改行: PASS`);

console.log('M18-T1 POI hide override smoke passed');
