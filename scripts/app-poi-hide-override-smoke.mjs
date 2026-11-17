// アプリ管理 > POI 編集の hide 上書き UI（AppEdit 側の配線検証）
//
// t1 smoke が共用コンポーネント PoiReferenceEditor.vue の実装を検証済み。
// 本 smoke は AppEdit.vue 側の配線存在を独立に確認する。
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const appEditPath = path.join(projectRoot, 'src/views/AppEdit.vue');
const appEdit = await readFile(appEditPath, 'utf8');

// --- [1/4] case 2-1: AppEdit が PoiReferenceEditor を使用し、update:pois 配線がある ---
assert.match(
  appEdit,
  /PoiReferenceEditor/,
  'case 2-1: AppEdit.vue が PoiReferenceEditor を使用している',
);
assert.match(
  appEdit,
  /@update:pois="onPoisChange"/,
  'case 2-1: PoiReferenceEditor に @update:pois="onPoisChange" が配線されている',
);
assert.match(
  appEdit,
  /data-testid="app-pois-tab-pane"/,
  'case 2-1: AppEdit の POI タブペイン（data-testid="app-pois-tab-pane"）が存在する',
);
console.log('  [1/4] case 2-1 AppEdit が PoiReferenceEditor を使用 + update:pois 配線: PASS');

// --- [2/4] case 2-5: onPoisChange が配列を appData.pois へ代入し recordHistory を呼ぶ ---
// 本体に書き込みガードと空時のキー削除が入り、200文字窓では recordHistory() が
// 窓外へ出るため窓を広げた（検査意図は不変。窓長の調整ではなく本体構成に合わせた更新）。
const onPoisChangeIdx = appEdit.indexOf('function onPoisChange');
assert.ok(onPoisChangeIdx > 0, 'onPoisChange 関数が定義されている');
const onPoisChangeBody = appEdit.slice(onPoisChangeIdx, onPoisChangeIdx + 420);
// 代入そのものは共通の書き込み関所 writeDocumentPois へ移った。素の `= next` では
// 単独形の文書が配列へ書き換わってしまうため、View から直接代入する形は撤去した。
// 検査意図（update:pois の配列が appData の pois へ届くこと）は関所呼び出しで担保される。
assert.match(
  onPoisChangeBody,
  /writeDocumentPois\(appData\.value, next, appData\.value\.pois\)/,
  'case 2-5: update:pois の配列を書き込み関所 writeDocumentPois 経由で appData へ反映する'
);
assert.match(onPoisChangeBody, /recordHistory\(\)/, 'case 2-5: recordHistory() を呼び出す');
assert.match(onPoisChangeBody, /acceptsWrite\(\)/, '未対応形式を弾く書き込みガードがある');
console.log('  [2/4] case 2-5 onPoisChange の配線（代入 + recordHistory）: PASS');

// --- [3/4] case 2-6: poisUnsupported が :read-only へ渡されている ---
assert.match(
  appEdit,
  /:read-only="poisUnsupported"/,
  'case 2-6: PoiReferenceEditor に :read-only="poisUnsupported" が設定されている',
);
console.log('  [3/4] case 2-6 poisUnsupported が :read-only へ渡されている: PASS');

// --- [4/4] case 2-11 補: i18n 2キーが 11 locale すべてに存在する（poi-hide-override-smoke と同一検証の二重チェック） ---
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
    `case 2-11: ${lang} に poiref.hide_override がある`,
  );
  assert.ok(
    typeof poiref.hide_override_note === 'string' && poiref.hide_override_note.length > 0,
    `case 2-11: ${lang} に poiref.hide_override_note がある`,
  );
  assert.ok(raw.endsWith('\n'), `${lang}/translation.json は末尾改行を保つ`);
}
console.log(`  [4/4] case 2-11 i18n 2キー × ${langs.length} locale + 末尾改行: PASS`);

console.log('AppEdit POI hide override smoke passed');
