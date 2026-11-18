// smoke: サムネイル置換の永続化セマンティクス統一（静的照合）。
//
// 本 smoke は S1-S4 を実装する。いずれも絶対数 assert であり、
// 誰がいつどこで走らせても同じ判定になる。
//
//   S1  追加 i18n キー 2 本が 11 ロケール全部に非空で存在する
//   S2  replaceThumbnail の実装本体が repo 内に 1 つだけ
//   S3  512px パスのインライン組み立てが無い
//   S4  BaseMapEdit の updateField("thumbnail", …) が 1 件（selectKind のみ）
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const projectRoot = path.resolve(new URL("..", import.meta.url).pathname);
const read = (rel) => readFile(path.join(projectRoot, rel), "utf8");

const LOCALES = ["de", "en", "es", "fr", "id", "ja", "ko", "th", "vi", "zh", "zh-TW"];
const MAP_EDIT = "src/views/MapEdit.vue";
const BASE_MAP_EDIT = "src/components/basemap/BaseMapEdit.vue";
const COMPOSABLE = "src/composables/useThumbnailReplace.ts";

// ---------------------------------------------------------------------------
// S1 : 追加 i18n キー 2 本が 11 ロケール全部に非空で存在する
// ---------------------------------------------------------------------------
const ADDED_KEYS = [
  ["editor_ui", "thumbnail_immediate_note"], // 規則 T1 の注記（両画面で共用）
  ["mapedit", "thumbnail_requires_save"], // 規則 T3 の理由（地図の未保存新規）
];

const localeDirs = (await readdir(path.join(projectRoot, "public/locales"), { withFileTypes: true }))
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();
assert.deepEqual(localeDirs, [...LOCALES].sort(),
  `S1: ロケールの集合が想定と異なる。実測: ${JSON.stringify(localeDirs)}`);

for (const loc of LOCALES) {
  const doc = JSON.parse(await read(`public/locales/${loc}/translation.json`));
  for (const [ns, key] of ADDED_KEYS) {
    const value = doc?.[ns]?.[key];
    assert.equal(typeof value, "string",
      `S1: ${loc} に ${ns}.${key} が無い（11 ロケール全部に要る）`);
    assert.ok(value.trim() !== "",
      `S1: ${loc} の ${ns}.${key} が空`);
  }
}
// 規則 T1 の注記は「両画面で同一の i18n キー」であることが要点なので、
// 2 名前空間へ同文言を複製していないことも見る（本タスクが是正している構図そのものを防ぐ）
for (const loc of LOCALES) {
  const doc = JSON.parse(await read(`public/locales/${loc}/translation.json`));
  for (const ns of ["mapedit", "basemap"]) {
    assert.equal(doc?.[ns]?.thumbnail_immediate_note, undefined,
      `S1: ${loc} の ${ns} に thumbnail_immediate_note の複製がある（editor_ui へ一本化すること）`);
  }
}
console.log(`smoke S1: OK（${LOCALES.length} ロケール × ${ADDED_KEYS.length} キーが非空・複製なし）`);

// ---------------------------------------------------------------------------
// S2 : replaceThumbnail の実装本体が repo 内に 1 つだけ
//   人間の恒久指示「同一扱いの処理は共通実装へ寄せる」の機械証明。
//   before = 2（MapEdit.vue / BaseMapEdit.vue） / after = 1（useThumbnailReplace.ts）
// ---------------------------------------------------------------------------
async function collectSourceFiles(dir, acc = []) {
  for (const ent of await readdir(path.join(projectRoot, dir), { withFileTypes: true })) {
    const rel = `${dir}/${ent.name}`;
    if (ent.isDirectory()) {
      if (ent.name === "node_modules") continue;
      await collectSourceFiles(rel, acc);
    } else if (/\.(ts|tsx|js|mjs|vue)$/.test(ent.name)) {
      acc.push(rel);
    }
  }
  return acc;
}
const SRC_FILES = await collectSourceFiles("src");
const SRC_TEXT = new Map();
for (const rel of SRC_FILES) SRC_TEXT.set(rel, await read(rel));

const IMPL_PATTERN = /\bfunction\s+replaceThumbnail\b/g;
const implSites = [];
for (const [rel, text] of SRC_TEXT) {
  const count = (text.match(IMPL_PATTERN) ?? []).length;
  if (count > 0) implSites.push({ rel, count });
}
assert.deepEqual(implSites, [{ rel: COMPOSABLE, count: 1 }],
  "S2: replaceThumbnail の実装本体は useThumbnailReplace.ts の 1 つだけであること。\n"
  + `  実測: ${JSON.stringify(implSites)}\n`
  + "  2 画面へ並行実装を戻すことは人間の恒久指示（同一扱いの処理は共通実装へ寄せる）に反する。");

// 2 画面が composable を経由していること（「実装を消しただけ」を弾く）
for (const rel of [MAP_EDIT, BASE_MAP_EDIT]) {
  const text = SRC_TEXT.get(rel);
  assert.ok(/useThumbnailReplace\s*\(/.test(text),
    `S2: ${rel} が useThumbnailReplace を呼んでいない`);
  assert.ok(/from ["'][^"']*composables\/useThumbnailReplace["']/.test(text),
    `S2: ${rel} が useThumbnailReplace を import していない`);
}
console.log("smoke S2: OK（実装本体 1 件 / 呼び出し 2 画面）");

// ---------------------------------------------------------------------------
// S3 : 512px パスのインライン組み立てが無い（WebP 化の単一変化点を迂回しない）
//   before = 0 / after = 0（この 0 を守る。派生は thumb512PathFor だけを通す）
// ---------------------------------------------------------------------------
const GUARDED_FILES = [MAP_EDIT, BASE_MAP_EDIT, COMPOSABLE];
// クォート内に `_512` を含む文字列リテラル（testid・i18n キーの …replace-512 / …replace_512 は除く）
const INLINE_512 = /['"`][^'"`]*_512/;
const inlineHits = [];
for (const rel of GUARDED_FILES) {
  const text = SRC_TEXT.get(rel);
  assert.ok(text !== undefined, `S3: ${rel} が見つからない`);
  text.split("\n").forEach((line, i) => {
    if (!INLINE_512.test(line)) return;
    if (/testid|thumbnail_replace_512|thumbnail-replace-512/.test(line)) return;
    inlineHits.push(`${rel}:${i + 1}: ${line.trim()}`);
  });
}
assert.deepEqual(inlineHits, [],
  "S3: 512px パスのインライン組み立てが混入した。\n"
  + `  実測:\n    ${inlineHits.join("\n    ")}\n`
  + "  派生は utils/thumbnailPaths.ts の thumb512PathFor だけを通すこと（WebP 化の単一変化点）。");

// THUMB_512_EXT の再代入・写しが無いこと（コメント言及のみ可）
for (const rel of GUARDED_FILES) {
  const text = SRC_TEXT.get(rel);
  text.split("\n").forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, "");
    assert.ok(!/THUMB_512_EXT/.test(code),
      `S3: ${rel}:${i + 1} が THUMB_512_EXT をコード中で参照している（写し。再代入を作らない）`);
  });
}
// 512px 派生の入口が composable の 1 か所であること（2 画面は直接呼ばない。コメント言及は可）
for (const rel of [MAP_EDIT, BASE_MAP_EDIT]) {
  SRC_TEXT.get(rel).split("\n").forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, "");
    assert.ok(!/\bthumb512PathFor\b/.test(code),
      `S3: ${rel}:${i + 1} が thumb512PathFor を直接使っている（512px 派生は composable の内部不変条件へ移した）`);
  });
}
assert.ok(/\bthumb512PathFor\b/.test(SRC_TEXT.get(COMPOSABLE)),
  "S3: useThumbnailReplace.ts が thumb512PathFor を使っていない（唯一の派生源であること）");
console.log("smoke S3: OK（インライン派生 0 件 / THUMB_512_EXT の写し 0 件）");

// ---------------------------------------------------------------------------
// S4 : BaseMapEdit の updateField("thumbnail", …) が 1 件だけ（selectKind のみ）
//   before = 3（selectKind / replaceThumbnail / generateIcon）
//   after  = 1（selectKind のみ）
//   selectKind の 1 件は「プリセット種別を選ぶとバンドル既定アイコンを指す」純粋な文書編集で
//   あり、ファイルを 1 バイトも書かない。∴ 規則 T1 の対象外で undo 可能なままが正しい。
// ---------------------------------------------------------------------------
const baseMapEditLines = SRC_TEXT.get(BASE_MAP_EDIT).split("\n");
const updateFieldThumbnailLines = [];
baseMapEditLines.forEach((line, i) => {
  if (/updateField\(\s*"thumbnail"/.test(line)) updateFieldThumbnailLines.push(i + 1);
});
assert.equal(updateFieldThumbnailLines.length, 1,
  "S4: BaseMapEdit.vue の updateField(\"thumbnail\", …) は 1 件（selectKind）だけであること。\n"
  + `  実測行: ${JSON.stringify(updateFieldThumbnailLines)}\n`
  + "  置換・生成は rebaseThumbnailPointer を通す（規則 指し先の移動は undo の対象にしない）。");

// 残った 1 件が selectKind の中であることを確認する（名指しで固定する）
const selectKindStart = baseMapEditLines.findIndex((l) => /function selectKind\(/.test(l));
assert.ok(selectKindStart >= 0, "S4: selectKind が見つからない");
let selectKindEnd = baseMapEditLines.length;
for (let i = selectKindStart + 1; i < baseMapEditLines.length; i++) {
  if (baseMapEditLines[i] === "}") { selectKindEnd = i + 1; break; }
}
const [only] = updateFieldThumbnailLines;
assert.ok(only > selectKindStart && only <= selectKindEnd,
  `S4: 残った updateField("thumbnail") が selectKind の外にある（実測 ${only} 行目 / selectKind = ${selectKindStart + 1}-${selectKindEnd} 行）`);

// 置換・生成が rebase 経路へ移っていること
assert.ok(/function rebaseThumbnailPointer\(/.test(SRC_TEXT.get(BASE_MAP_EDIT)),
  "S4: rebaseThumbnailPointer が無い（規則 T2 の実装）");
const rebaseCalls = (SRC_TEXT.get(BASE_MAP_EDIT).match(/rebaseThumbnailPointer\(/g) ?? []).length;
assert.equal(rebaseCalls, 3,
  "S4: rebaseThumbnailPointer は定義 1 + 呼び出し 2（置換の onPointerMoved / generateIcon）の 3 出現であること。\n"
  + `  実測: ${rebaseCalls}`);
// 全段 rebase の要（markDirty を落とすと指し先が保存されず、書いた 512px が再オープン後に見えない）
assert.ok(/history\.markDirty\(\)/.test(SRC_TEXT.get(BASE_MAP_EDIT)),
  "S4: rebase 後の markDirty() が無い（落とすと指し先が保存ゲートに載らない）");
console.log("smoke S4: OK（updateField(\"thumbnail\") 1 件 = selectKind / rebase 経路 2 呼び出し）");

console.log("smoke: ALL OK");
