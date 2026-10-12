// m19-t11: 存在範囲 / 利用範囲 / アプリ対象範囲 / 絞り込み範囲 の語彙と提示の統一。
//
// 設計書: docs/superpowers/specs/2026-08-10-m19-t11-range-vocabulary-unification-design.md
// 本 smoke は §12.3 の MC2-a / MC2-b / MC3 / MC4 / MC5 / MC6-a / MC6-b を実装する。
//
// **MC5 は m19 §4.6.2-1 の凍結契約（範囲を保持する 3 属性の名前を変更しない）の
//   機械証明の単独手段である**（設計 §12.1 / レビュー v2 §1.5 が「MC5 単独で十分」と判定）。
//   nov26-m6-t1 で絶対数 assert から性質の検査（宣言の錨・識別子の集合）へ改めた（MC5 の節を参照）。
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const projectRoot = path.resolve(new URL("..", import.meta.url).pathname);
const read = (rel) => readFile(path.join(projectRoot, rel), "utf8");

const LOCALES = ["de", "en", "es", "fr", "id", "ja", "ko", "th", "vi", "zh", "zh-TW"];

const translations = {};
for (const loc of LOCALES) {
  translations[loc] = JSON.parse(await read(`public/locales/${loc}/translation.json`));
}
assert.equal(Object.keys(translations).length, 11, "11 言語ちょうどであること（設計 §11 C7）");

const dig = (obj, dotted) => dotted.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);

// ---------------------------------------------------------------------------
// 走査対象のソース集合（src / electron を全数）
// ---------------------------------------------------------------------------
async function collectFiles(dir, acc = []) {
  for (const ent of await readdir(path.join(projectRoot, dir), { withFileTypes: true })) {
    const rel = `${dir}/${ent.name}`;
    if (ent.isDirectory()) {
      if (ent.name === "node_modules" || ent.name === "locales" || ent.name === "preview") continue;
      await collectFiles(rel, acc);
    } else if (/\.(ts|tsx|js|mjs|cjs|vue|json)$/.test(ent.name)) {
      acc.push(rel);
    }
  }
  return acc;
}
const SRC_FILES = [...(await collectFiles("src")), ...(await collectFiles("electron"))];
const SRC_TEXT = new Map();
for (const rel of SRC_FILES) SRC_TEXT.set(rel, await read(rel));

// ---------------------------------------------------------------------------
// §4.1 呼称確定表（本 smoke の唯一の語彙定義。他の検査はすべてこれを参照する）
// ---------------------------------------------------------------------------
const CONFIRMED_JA = {
  coverage: "存在範囲",        // ① ベースマップのタイルが実在する範囲
  usage: "利用範囲",           // ② アプリがその地図を実際に使う範囲（viewer が見る唯一の範囲）
  appTarget: "アプリ対象範囲",  // ③ アプリが対象とするおおよその範囲（参考値）
  filter: "絞り込み範囲",      // ④ 一覧・選択を表示側で絞り込む一時的な範囲
};

// ---------------------------------------------------------------------------
// MC2-a (AC3): 概念ごとのラベル系キーの ja 値に、他概念の呼称が混入していない
// ---------------------------------------------------------------------------
// 各概念を「名指しする」キー（ラベル・モーダルタイトル・状態表示・説明文）。
// allowlist は概念間の**関係**を述べるキーで、他概念の語を含むことが目的そのもの。
const CONCEPT_KEYS = {
  coverage: [
    "basemap.coverage",
    "basemap.coverage_modal_title",
    "basemap.coverage_modal_help",
    "basemap.generate_icon",
  ],
  usage: [
    "appedit.envelope",
    "appedit.envelope_modal_title",
    "appedit.envelope_modal_help",
  ],
  appTarget: [
    "appedit.app_coverage",
    "appedit.app_coverage_modal_title",
    "appedit.app_coverage_modal_help",
    "resource_selector.context_app_coverage",
  ],
  filter: [
    "range_filter.button",
    "range_filter.clear",
    "range_filter.active_auto",
    "range_filter.active_manual",
    "range_filter.modal_title",
    "range_filter.modal_help",
    "range_filter.guide_badge",
  ],
};

// 設計 §12.1 AC3 の allowlist（関係説明キー 5 件）。
// ＋ appedit.envelope_copy_coverage は「②の名前空間にある①への操作ボタン」であり
//    §4.2 が確定表と一致すると明記した据置語のため、CONCEPT_KEYS に載せていない
//    （設計逸脱ではなく、そもそも概念を名指すラベルではない）。
const RELATION_ALLOWLIST = [
  "basemap.coverage_help",
  "appedit.envelope_help",
  "appedit.app_coverage_note",
  "appedit.envelope_modal_help_with_coverage",
  "range_filter.modal_help_basemap",
];
for (const key of RELATION_ALLOWLIST) {
  assert.ok(dig(translations.ja, key) != null, `MC2-a: allowlist キー ${key} が ja に存在しない`);
}
for (const [concept, keys] of Object.entries(CONCEPT_KEYS)) {
  for (const key of keys) {
    assert.ok(!RELATION_ALLOWLIST.includes(key), `MC2-a: ${key} が概念キーと allowlist に二重登録`);
    const value = dig(translations.ja, key);
    assert.ok(value != null, `MC2-a: ${key} が ja に存在しない`);
    for (const [other, name] of Object.entries(CONFIRMED_JA)) {
      if (other === concept) continue;
      assert.ok(
        !value.includes(name),
        `MC2-a: ${key}（概念 ${concept}）の ja 値に他概念の呼称「${name}」が混入している: ${value}`,
      );
    }
  }
}
console.log("m19-t11 smoke MC2-a: OK（概念ごとのラベル系キーに他概念の呼称なし）");

// ---------------------------------------------------------------------------
// MC2-b (AC4): ③の呼称が 11 言語すべてで 2 キー間で完全一致
// ---------------------------------------------------------------------------
for (const loc of LOCALES) {
  const a = dig(translations[loc], "appedit.app_coverage");
  const b = dig(translations[loc], "resource_selector.context_app_coverage");
  assert.ok(a, `MC2-b: appedit.app_coverage が ${loc} に無い`);
  assert.equal(
    b, a,
    `MC2-b: ${loc} で appedit.app_coverage(${a}) と resource_selector.context_app_coverage(${b}) が不一致`,
  );
}
assert.equal(translations.ja.appedit.app_coverage, CONFIRMED_JA.appTarget,
  "MC2-b: ja の③は「アプリ対象範囲」であること（§4.1 確定表）");
console.log("m19-t11 smoke MC2-b: OK（③の呼称が 11 言語で 2 キー間一致）");

// ---------------------------------------------------------------------------
// MC3 (AC2): 廃止呼称 5 文字列が ja locale / src / electron に 0 件
// ---------------------------------------------------------------------------
// 設計 §11 C11 の baseline は「アプリ提供範囲 7 / 他 4 文字列 0」。本 smoke は実装後の 0 を要求する。
const DEPRECATED = ["地図提供範囲", "アプリ提供範囲", "有効範囲ガイド", "絞り込む地域", "利用範囲(経緯度)"];
const jaLocaleText = await read("public/locales/ja/translation.json");
for (const needle of DEPRECATED) {
  assert.ok(
    !jaLocaleText.includes(needle),
    `MC3: 廃止呼称「${needle}」が public/locales/ja/translation.json に残っている`,
  );
  const hits = [];
  for (const [rel, text] of SRC_TEXT) {
    if (!text.includes(needle)) continue;
    text.split("\n").forEach((line, i) => {
      if (line.includes(needle)) hits.push(`${rel}:${i + 1}`);
    });
  }
  assert.deepEqual(hits, [], `MC3: 廃止呼称「${needle}」が src / electron に残っている`);
}
console.log("m19-t11 smoke MC3: OK（廃止呼称 5 文字列が ja locale / src / electron に 0 件）");

// ---------------------------------------------------------------------------
// MC4 (AC5): ④のモーダルへ①のキーを渡す画面が BaseMapEdit.vue だけ
// ---------------------------------------------------------------------------
// EnvelopeEditorModal を使う 8 ホスト（設計 §11 C6）。
const MODAL_HOSTS = [
  "src/components/AppSourceEditor.vue",
  "src/components/basemap/BaseMapEdit.vue",
  "src/views/AppEdit.vue",
  "src/views/AppList.vue",
  "src/views/BaseMapList.vue",
  "src/views/MapEdit.vue",
  "src/views/MapList.vue",
  "src/views/PoiSourceList.vue",
];
const hostsFound = SRC_FILES.filter(
  (rel) => rel.endsWith(".vue")
    && !rel.endsWith("EnvelopeEditorModal.vue")
    && SRC_TEXT.get(rel).includes("EnvelopeEditorModal"),
).sort();
assert.deepEqual(hostsFound, [...MODAL_HOSTS].sort(),
  "MC4: EnvelopeEditorModal のホスト集合が設計 §11 C6 の 8 件と一致しない");
const coverageModalHosts = MODAL_HOSTS.filter(
  (rel) => SRC_TEXT.get(rel).includes("basemap.coverage_modal_"),
);
assert.deepEqual(coverageModalHosts, ["src/components/basemap/BaseMapEdit.vue"],
  "MC4: basemap.coverage_modal_* を渡してよいのは BaseMapEdit.vue だけ（④が①のキーを借りない）");
console.log("m19-t11 smoke MC4: OK（①のモーダルキーの参照は BaseMapEdit.vue 単独）");

// ---------------------------------------------------------------------------
// MC6-a (AC6): 削除 11 キーが 11 言語すべてに不在
// ---------------------------------------------------------------------------
const DELETED_KEYS = [
  "basemap.master_detail.range_filter",
  "basemap.master_detail.clear_range_filter",
  "mapedit.range_filter_gcp_active",
  "mapedit.range_filter_manual_active",
  "mapedit.range_filter_none",
  "mapedit.base_map_region_modal_title",
  "mapedit.base_map_region_modal_help",
  "mapedit.base_map_region_guide",
  "mapedit.base_map_filter_region",
  "mapedit.base_map_filter_gcp_auto",
  "resource_selector.context_map",
];
assert.equal(DELETED_KEYS.length, 11, "MC6-a: 削除キーは 11 件（設計 §11 C3）");
for (const loc of LOCALES) {
  for (const key of DELETED_KEYS) {
    assert.equal(dig(translations[loc], key), undefined,
      `MC6-a: 削除キー ${key} が ${loc} に残っている`);
  }
}
// 削除キーは製品コードからも参照されない
for (const key of DELETED_KEYS) {
  const hits = [...SRC_TEXT].filter(([, text]) => text.includes(key)).map(([rel]) => rel);
  assert.deepEqual(hits, [], `MC6-a: 削除キー ${key} が src / electron から参照されている`);
}
console.log("m19-t11 smoke MC6-a: OK（削除 11 キーが 11 言語・製品コードの双方に不在）");

// ---------------------------------------------------------------------------
// MC6-b (AC7): 新設 9 キーが 11 言語に非空で存在し、src / electron から 1 回以上参照される
// ---------------------------------------------------------------------------
const NEW_KEYS = [
  "range_filter.button",
  "range_filter.clear",
  "range_filter.active_auto",
  "range_filter.active_manual",
  "range_filter.modal_title",
  "range_filter.modal_help",
  "range_filter.modal_help_basemap",
  "range_filter.guide_badge",
  "appedit.envelope_help",
];
assert.equal(NEW_KEYS.length, 9, "MC6-b: 新設キーは 9 件（設計 §11 C4）");
for (const loc of LOCALES) {
  for (const key of NEW_KEYS) {
    const v = dig(translations[loc], key);
    assert.ok(typeof v === "string" && v.trim() !== "",
      `MC6-b: 新設キー ${key} が ${loc} で欠落または空`);
  }
}
for (const key of NEW_KEYS) {
  const hits = [...SRC_TEXT].filter(([, text]) => text.includes(key)).map(([rel]) => rel);
  assert.ok(hits.length >= 1, `MC6-b: 新設キー ${key} が src / electron から 1 度も参照されていない（死語キー）`);
}
// range_filter セクションの挿入位置（設計 §7.5）: resource_selector の直後
for (const loc of LOCALES) {
  const sections = Object.keys(translations[loc]);
  const i = sections.indexOf("resource_selector");
  assert.ok(i >= 0, `MC6-b: ${loc} に resource_selector セクションが無い`);
  assert.equal(sections[i + 1], "range_filter",
    `MC6-b: ${loc} の range_filter は resource_selector の直後でなければならない（設計 §7.5。`
    + `m19-t5 の database 編集帯から離す配置）`);
}
console.log("m19-t11 smoke MC6-b: OK（新設 9 キーが 11 言語に非空・全キー参照あり・挿入位置固定）");

// ---------------------------------------------------------------------------
// MC5 (AC12): 属性名の凍結証明。**単独手段**（設計 §12.1 / §12.3）
// ---------------------------------------------------------------------------
// nov26-m6-t1 (#117 S2) で「全出現数の絶対値（473 / 43 / 6）」から**性質の検査**へ置き換えた。
// 絶対数は、後のタスクが属性を**使う**行を足しただけで動き（m20-t6・m22-t1 で実際に動いた）、
// 凍結契約（名前を変えない）の違反ではないのに赤になっていた。性質は次の 2 つ:
//   (a) 宣言箇所の固定表: 3 属性名がそれぞれ、型宣言・キー表の錨（下の FREEZE_ANCHORS）に在る
//   (b) 識別子の集合: `coverage`／`envelope(p)`／`appCoverage` で始まり `Lng`／`Lon`／`Lat` を含む
//       識別子（大小文字を区別しない）の集合が、3 つの凍結名と、場所を限った既知の別名
//       （FREEZE_ALIASES）にちょうど等しい。宣言以外の箇所だけの改名（例: 書き込み側だけ
//       `…LonLats`・`…_lnglats` にする）も (b) で赤になる。後の正当な使用の追加では動かない。
// 走査範囲は src / electron / scripts / tests / public（preview 除く）。
//
// **本ファイル自身が凍結属性名・別名を literal で含んではならない。**
// 走査範囲に scripts/ が入るため、検査器が名前を書くと自分の記述が (b) の集合に入る。
// ∴ 名前は下のように断片から組み立てる（自己検査の fixture も同じ）。
const LNGLATS = "Lng" + "Lats";
const ATTR_COVERAGE = "coverage" + LNGLATS;
const ATTR_ENVELOPE = "envelope" + LNGLATS;
const ATTR_APP_COVERAGE = "app" + "Coverage" + LNGLATS;
const FROZEN_ATTRS = [ATTR_COVERAGE, ATTR_ENVELOPE, ATTR_APP_COVERAGE];

const FREEZE_ROOTS = ["src", "electron", "scripts", "tests", "public"];

// (a) 宣言箇所の固定表（nov26-m6-t1 の実装時に `git grep -n -E "<名>\??:" -- src electron` で測った）。
//     envelope 側は TS の型宣言を持たない（override の文字列キーで扱う）ため、キー表と書き込みの錨を使う。
const FREEZE_ANCHORS = [
  { attr: ATTR_COVERAGE, file: "electron/services/TileJsonImportService.ts", needle: `${ATTR_COVERAGE}?: [number, number][];` },
  { attr: ATTR_COVERAGE, file: "electron/utils/searchSpatial.ts", needle: `${ATTR_COVERAGE}?: [number, number][] | null` },
  { attr: ATTR_COVERAGE, file: "src/components/EnvelopeEditorModal.vue", needle: `  ${ATTR_COVERAGE}?: [number, number][] | null;` },
  { attr: ATTR_COVERAGE, file: "src/electron.d.ts", needle: `    ${ATTR_COVERAGE}?: [number, number][];` },
  { attr: ATTR_APP_COVERAGE, file: "src/components/EnvelopeEditorModal.vue", needle: `  ${ATTR_APP_COVERAGE}?: [number, number][] | null;` },
  { attr: ATTR_APP_COVERAGE, file: "src/components/AppSourceEditor.vue", needle: `  ${ATTR_APP_COVERAGE}?: [number, number][] | null;` },
  { attr: ATTR_ENVELOPE, file: "src/utils/appSourceModel.ts", needle: `  "${ATTR_ENVELOPE}",` },
  { attr: ATTR_ENVELOPE, file: "src/components/AppSourceEditor.vue", needle: `writeOverride("${ATTR_ENVELOPE}", ` },
];

// (b) 場所を限った既知の別名（凍結名ではない綴りが、凍結名へ正規化するためだけに現れる箇所）。
//     ここに無い綴り・ここに無いファイルでの出現は赤。
const FREEZE_ALIASES = [
  // core の normalizeArg が拒否する旧キーを凍結名へ写す runtimeKeyMap のキー
  { name: "envelope" + "_lnglats", files: ["src/utils/appSourceModel.ts"] },
  { name: "envelop" + LNGLATS, files: ["src/utils/appSourceModel.ts", "scripts/m6-app-source-model-smoke.mjs"] }, // smoke は旧キーの正規化を検査する
  { name: "coverage" + "_lnglats", files: ["src/utils/appSourceModel.ts"] },
  // e2e の fixture 定数（値を凍結名のキーへ入れて使う）
  { name: "COVERAGE" + "_LNG_LATS", files: ["tests/e2e/m6-t10-app-source-diff-model.spec.ts"] },
];

const FREEZE_IDENT_RE = /(?<![A-Za-z0-9_$])(?:app)?(?:coverage|envelope?)[A-Za-z0-9_$]*?(?:lng|lon|lat)[A-Za-z0-9_$]*/gi;

// texts: Map<rel, text>。問題の一覧（空なら合格）を返す純関数（自己検査で fixture にも使う）。
function checkFreezeAnchors(texts) {
  const problems = [];
  for (const { attr, file, needle } of FREEZE_ANCHORS) {
    const text = texts.get(file);
    if (text == null) problems.push(`(a) ${file} が無い（${attr} の宣言の錨）`);
    else if (!text.includes(needle)) problems.push(`(a) ${file} に ${attr} の宣言の錨 ${JSON.stringify(needle)} が無い`);
  }
  return problems;
}

function checkFreezeIdentifiers(texts) {
  const problems = [];
  const aliasFiles = new Map(FREEZE_ALIASES.map(({ name, files }) => [name, new Set(files)]));
  const seen = new Set();
  for (const [rel, text] of texts) {
    for (const m of text.matchAll(FREEZE_IDENT_RE)) {
      const ident = m[0];
      seen.add(ident);
      if (FROZEN_ATTRS.includes(ident)) continue;
      const allowed = aliasFiles.get(ident);
      if (allowed && allowed.has(rel)) continue;
      problems.push(`(b) 凍結名でない綴り ${ident} が ${rel} にある（改名・近縁綴りの疑い）`);
    }
  }
  for (const attr of FROZEN_ATTRS) {
    if (!seen.has(attr)) problems.push(`(b) 凍結名 ${attr} が走査範囲のどこにも無い`);
  }
  return [...new Set(problems)];
}

// 自己検査 (T1-2): 宣言箇所から名前を 1 つ消す・別綴りを 1 つ混ぜると赤になること
{
  const baseTexts = new Map(FREEZE_ANCHORS.map(({ file }) => [file, ""]));
  for (const { file, needle } of FREEZE_ANCHORS) baseTexts.set(file, baseTexts.get(file) + needle + "\n");
  assert.deepEqual(checkFreezeAnchors(baseTexts), [], "T1-2: 錨だけの fixture が (a) を通らない");
  assert.deepEqual(checkFreezeIdentifiers(baseTexts), [], "T1-2: 錨だけの fixture が (b) を通らない");

  const removed = new Map(baseTexts);
  const victim = FREEZE_ANCHORS[0];
  removed.set(victim.file, removed.get(victim.file).replace(victim.needle, ""));
  assert.ok(checkFreezeAnchors(removed).length > 0, "T1-2: 宣言箇所から名前を消しても (a) が赤にならない");

  for (const variant of [
    "coverage" + "LonLats",
    "coverage" + "_lnglats", // 別名だが許可されたファイルの外
    "app" + "coverage" + LNGLATS,
    "envelope" + "LngLat",
  ]) {
    const mixed = new Map(baseTexts);
    mixed.set("src/views/AppEdit.vue", `const x = doc.${variant};\n`);
    assert.ok(checkFreezeIdentifiers(mixed).length > 0, `T1-2: 別綴り ${variant} を混ぜても (b) が赤にならない`);
  }
  console.log("ok: (MC5 self-check T1-2) 宣言の削除・別綴り 4 種の混入はいずれも赤になる");
}

const freezeTexts = new Map();
async function collectFilesAll(dir, acc = []) {
  for (const ent of await readdir(path.join(projectRoot, dir), { withFileTypes: true })) {
    const rel = `${dir}/${ent.name}`;
    if (ent.isDirectory()) {
      if (ent.name === "node_modules" || ent.name === "preview") continue;
      await collectFilesAll(rel, acc);
    } else {
      acc.push(rel);
    }
  }
  return acc;
}
for (const dir of FREEZE_ROOTS) {
  for (const rel of await collectFilesAll(dir)) {
    try {
      freezeTexts.set(rel, await read(rel));
    } catch {
      // 読めないものは飛ばす
    }
  }
}

const freezeProblems = [...checkFreezeAnchors(freezeTexts), ...checkFreezeIdentifiers(freezeTexts)];
assert.deepEqual(freezeProblems, [],
  `MC5: 範囲を保持する 3 属性の凍結契約（m19 §4.6.2-1「名前を変えない」）に違反した可能性がある。\n`
  + freezeProblems.map((p) => `  - ${p}`).join("\n"));
console.log("m19-t11 smoke MC5: OK（3 属性の宣言の錨が在り、近縁の識別子は凍結名と既知の別名だけ — 凍結契約 §4.6.2-1）");

console.log("m19-t11 smoke: ALL OK");
