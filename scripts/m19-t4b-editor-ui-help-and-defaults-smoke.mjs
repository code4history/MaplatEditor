// m19-t4b: 地図 / ベースマップ / アプリ管理の画面内 UI 微修正。
// 設計書 docs/superpowers/specs/2026-08-10-m19-t4b-editor-ui-help-and-defaults-design.md §8
//
//   S1  (AC5)  defaultApp() の httpSettings は現行値のまま（②読み込み時の欠落補完を動かさない）
//   S2  (AC6)  新既定は NEW_APP_HTTP_OVERRIDES 1 箇所に集約され、適用点は newAppDocument() だけ
//   S3  (AC8)  AppEdit.vue の <ContextHelp タグ数 = 13
//   S4  (AC9)  MapEdit.vue の merc <p> 廃止 / <ContextHelp タグ数 = 18
//   S5  (AC10) BaseMapEdit.vue の <ContextHelp タグ数 = 10
//   S6  (AC11) 共通 7 説明の field_help.* への 1 本化（移送元 7 キーは 11 言語から消滅・値は不変）
//   S7  (AC12) appedit.manifest_settings がラテン語 manifest を含まない（ja/ko/zh/zh-TW/th）
//   S8  (AC13) 新設 10 キーが 11 言語すべてに非空で存在する
//   S9  (AC15) .preview-lang の絶対配置 CSS が残っていない
//   S10 (AC16) 人間検証ハーネスの案内文が凍結後 UI に合っている
//   S11 (AC17) 本タスクが新設する 2 ファイルに凍結属性名のリテラルが 0 件
//   S12 (AC18) データスキーマ属性の増減がゼロ（httpSettings のキー集合不変 + MC7b の件数不変）
//   S13 (AC4)  キャッシュの PWA 従属が watch ではなく onPwaToggle 内の recordHistory 前にある
//
// 属性名について: 本ファイルは scripts/ 配下にあり、m19-t11 smoke の凍結カウント（MC5）が
// src / electron / scripts / tests / public を走査して属性名の絶対数を assert する。
// ∴ **凍結属性名を literal で書かない**。断片から組み立てる（下の FROZEN_RANGE_ATTRS）。
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const projectRoot = path.resolve(new URL("..", import.meta.url).pathname);
const readSrc = (rel) => readFile(path.join(projectRoot, rel), "utf8");
const count = (haystack, needle) => haystack.split(needle).length - 1;

// 凍結属性名（m19-t11 の走査に引っかからないよう断片から組み立てる。上のコメント参照）
const FROZEN_RANGE_ATTRS = [
  "coverage" + "LngLats",
  "envelope" + "LngLats",
  "appCoverage" + "LngLats",
];

const APP_EDIT = "src/views/AppEdit.vue";
const MAP_EDIT = "src/views/MapEdit.vue";
const BASE_MAP_EDIT = "src/components/basemap/BaseMapEdit.vue";
const HUMAN_CHECK = "tests/e2e/m6-t10-human-check.spec.ts";
const SELF_SMOKE = "scripts/m19-t4b-editor-ui-help-and-defaults-smoke.mjs";
const SELF_E2E = "tests/e2e/m19-t4b-editor-ui-help-and-defaults.spec.ts";

const appEditVue = await readSrc(APP_EDIT);
const mapEditVue = await readSrc(MAP_EDIT);
const baseMapEditVue = await readSrc(BASE_MAP_EDIT);

const localesDir = path.join(projectRoot, "public/locales");
const langs = (await readdir(localesDir, { withFileTypes: true }))
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();
assert.equal(langs.length, 11, `expected 11 locale directories, found ${langs.length}: ${langs.join(",")}`);
const locales = Object.fromEntries(
  await Promise.all(langs.map(async (l) => [l, JSON.parse(await readSrc(`public/locales/${l}/translation.json`))])),
);

// ---------------------------------------------------------------------------
// S1 (AC5): defaultApp() の httpSettings は現行値のまま
//   ②（読み込み時の欠落キー補完 AppEdit.vue:718 以降）を兼ねているため、ここを動かすと
//   既存アプリ・取り込みアプリの解釈が変わる（設計 §4.2.2。tests/e2e/m11-t3-editor-shell.spec.ts が依存）
// ---------------------------------------------------------------------------
/** defaultApp() の中の httpSettings: { ... } ブロックを取り出す */
function extractDefaultAppHttpSettings(source) {
  const fnStart = source.indexOf("const defaultApp = (): AppDocument => ({");
  assert.notEqual(fnStart, -1, "AppEdit.vue must keep `const defaultApp = (): AppDocument => ({`");
  const httpStart = source.indexOf("httpSettings: {", fnStart);
  assert.notEqual(httpStart, -1, "defaultApp() must keep an httpSettings block");
  const bodyStart = source.indexOf("{", httpStart + "httpSettings:".length);
  let depth = 0;
  for (let i = bodyStart; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(bodyStart + 1, i);
    }
  }
  throw new Error("defaultApp().httpSettings block is unbalanced");
}

const DEFAULT_HTTP_SETTINGS = {
  previewPort: "41781",
  pwaManifest: "true",
  overlay: "true",
  enableHideMarker: "true",
  enableMarkerList: "false",
  enableBorder: "true",
  enableCache: "true",
  stateUrl: "true",
  enableShare: "true",
  mapboxToken: '""',
  googleApiKey: '""',
};

const defaultHttpBlock = extractDefaultAppHttpSettings(appEditVue);
{
  for (const [key, value] of Object.entries(DEFAULT_HTTP_SETTINGS)) {
    const m = defaultHttpBlock.match(new RegExp(`(^|\\n)\\s*${key}\\s*:\\s*([^,\\n]+)`));
    assert.ok(m, `S1/AC5: defaultApp().httpSettings must keep the key ${key}`);
    assert.equal(
      m[2].trim(),
      value,
      `S1/AC5: defaultApp().httpSettings.${key} must stay ${value} (② 読み込み時の欠落補完を動かさない)`,
    );
  }
  console.log("  [S1/AC5] defaultApp().httpSettings が現行値のまま（11 キー）: PASS");
}

// ---------------------------------------------------------------------------
// S2 (AC6): 新既定は 1 箇所に集約、適用点は newAppDocument() だけ
// ---------------------------------------------------------------------------
{
  assert.equal(
    count(appEditVue, "const NEW_APP_HTTP_OVERRIDES"),
    1,
    "S2/AC6: NEW_APP_HTTP_OVERRIDES must be declared exactly once",
  );
  assert.equal(
    count(appEditVue, "const newAppDocument"),
    1,
    "S2/AC6: newAppDocument() must be declared exactly once",
  );
  assert.equal(
    count(appEditVue, "ref<AppDocument>(newAppDocument())"),
    2,
    "S2/AC6: newAppDocument() must be the initializer of both appData and originalAppData",
  );
  assert.equal(
    count(appEditVue, "ref<AppDocument>(defaultApp())"),
    0,
    "S2/AC6: no ref<AppDocument>(defaultApp()) may remain (新既定の適用点は newAppDocument() だけ)",
  );
  // 新既定の 3 値（要望 B: PWA/キャッシュ 既定オフ・要望 C: マーカー一覧 既定オン）
  const ovStart = appEditVue.indexOf("const NEW_APP_HTTP_OVERRIDES");
  const ovEnd = appEditVue.indexOf("}", ovStart);
  const ovBlock = appEditVue.slice(ovStart, ovEnd);
  for (const [key, value] of [["pwaManifest", "false"], ["enableCache", "false"], ["enableMarkerList", "true"]]) {
    assert.match(
      ovBlock,
      new RegExp(`${key}\\s*:\\s*${value}\\b`),
      `S2/AC6: NEW_APP_HTTP_OVERRIDES.${key} must be ${value}`,
    );
  }
  console.log("  [S2/AC6] 新既定 3 値が NEW_APP_HTTP_OVERRIDES 1 箇所へ集約 / 適用点は newAppDocument() のみ: PASS");
}

// ---------------------------------------------------------------------------
// S3 / S4 / S5 (AC8 / AC9 / AC10): <ContextHelp タグ数
//   変更前: MapEdit 17 / AppEdit 3 / BaseMapEdit 3（設計 §16 MC1）
//   変更後: MapEdit 18 (+1 merc) / AppEdit 13 (+2 説明・他情報 +8 HTTP トグル) / BaseMapEdit 10 (+7)
// ---------------------------------------------------------------------------
{
  const cases = [
    [APP_EDIT, appEditVue, 13, "S3/AC8"],
    [MAP_EDIT, mapEditVue, 18, "S4/AC9"],
    [BASE_MAP_EDIT, baseMapEditVue, 10, "S5/AC10"],
  ];
  for (const [rel, source, expected, label] of cases) {
    const actual = count(source, "<ContextHelp");
    assert.equal(actual, expected, `${label}: ${rel} must have ${expected} <ContextHelp> tags (got ${actual})`);
  }
  // src 全体 34 → 52
  let total = 0;
  const walk = async (dir) => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.name.endsWith(".vue")) total += count(await readFile(p, "utf8"), "<ContextHelp");
    }
  };
  await walk(path.join(projectRoot, "src"));
  assert.equal(total, 52, `S3-S5: src 全体の <ContextHelp タグ数は 52 であること (got ${total})`);
  console.log("  [S3-S5/AC8-AC10] ContextHelp タグ数 AppEdit 13 / MapEdit 18 / BaseMapEdit 10 / src 計 52: PASS");
}

// S4 続き: 旧 <p class="text-muted small"> の merc.tab_description が残っていない
{
  assert.ok(
    !/<p class="text-muted small">\{\{\s*t\("merc\.tab_description"\)\s*\}\}<\/p>/.test(mapEditVue),
    'S4/AC9: MapEdit.vue must not render merc.tab_description as a plain <p class="text-muted small">',
  );
  assert.match(
    mapEditVue,
    /<ContextHelp :title="t\('merc\.tab_title'\)" :text="t\('merc\.tab_description'\)"/,
    "S4/AC9: merc カードヘッダに merc.tab_description の ContextHelp があること",
  );
  console.log("  [S4/AC9] merc タブ: <p> 廃止 → カードヘッダの ContextHelp へ移設: PASS");
}

// ---------------------------------------------------------------------------
// S6 (AC11): 共通 7 説明の field_help.* 1 本化
// ---------------------------------------------------------------------------
const FIELD_HELP_TRANSFER = [
  // [新キー, 移送元（削除する mapedit.* キー）, ja 値（不変）]
  ["display_label", "map_display_label_desc", "ビューアの地図切替に表示する短い名称です。"],
  ["image_attribution", "map_copyright_desc", "地図画像の帰属表記を入力してください。"],
  ["image_license", "map_image_license_desc", "地図のライセンスを選択してください。"],
  ["image_license_note", "map_image_license_note_desc", "地図画像のライセンスの補足説明を入力します。"],
  ["data_attribution", "map_gcp_copyright_desc", "データの帰属表記を入力してください。"],
  ["data_license", "map_gcp_license_desc", "データのライセンスを選択してください。"],
  ["data_license_note", "map_gcp_license_note_desc", "データのライセンスの補足説明を入力します。"],
];

{
  for (const lang of langs) {
    const j = locales[lang];
    assert.ok(j.field_help, `S6/AC11: ${lang} must have a top-level "field_help" section`);
    for (const [newKey, oldKey] of FIELD_HELP_TRANSFER) {
      const v = j.field_help[newKey];
      assert.ok(
        typeof v === "string" && v.trim() !== "",
        `S6/AC11: ${lang}.field_help.${newKey} must be a non-empty string`,
      );
      assert.equal(
        j.mapedit?.[oldKey],
        undefined,
        `S6/AC11: ${lang}.mapedit.${oldKey} must be removed (移送元は残さない)`,
      );
    }
  }
  // 値は 1 文字も変えない（ja で照合）
  for (const [newKey, , jaValue] of FIELD_HELP_TRANSFER) {
    assert.equal(
      locales.ja.field_help[newKey],
      jaValue,
      `S6/AC11: ja.field_help.${newKey} must be transferred verbatim`,
    );
  }
  // 参照側: MapEdit.vue の 7 箇所が field_help.* を見ており、mapedit.map_*_desc の 7 キーは 0 参照。
  //   image_license は image_license_note の接頭辞なので、閉じ引用符まで含めて数える
  //   （素の部分一致で数えると 4 件になり、検査が接頭辞キーを二重計上する）
  for (const [newKey, oldKey] of FIELD_HELP_TRANSFER) {
    assert.equal(
      count(mapEditVue, `mapedit.${oldKey}'`),
      0,
      `S6/AC11: MapEdit.vue must not reference mapedit.${oldKey} anymore`,
    );
    assert.equal(
      count(mapEditVue, `field_help.${newKey}'`),
      2,
      `S6/AC11: MapEdit.vue must reference field_help.${newKey} twice (:text と :ariaLabel)`,
    );
    assert.equal(
      count(baseMapEditVue, `field_help.${newKey}'`),
      2,
      `S6/AC11: BaseMapEdit.vue must reference field_help.${newKey} twice (:text と :ariaLabel)`,
    );
  }
  console.log("  [S6/AC11] field_help.* 7 キー 1 本化（11 言語・値不変・両画面が同一キーを参照）: PASS");
}

// ---------------------------------------------------------------------------
// S7 (AC12): manifest_settings のラテン語 manifest 残存（非ラテン 5 言語）
// ---------------------------------------------------------------------------
{
  for (const lang of ["ja", "ko", "zh", "zh-TW", "th"]) {
    const v = locales[lang].appedit.manifest_settings;
    assert.ok(
      !/manifest/i.test(v),
      `S7/AC12: ${lang}.appedit.manifest_settings must not contain the latin word "manifest" (got ${JSON.stringify(v)})`,
    );
  }
  // ラテン文字圏 6 言語は変更しない
  for (const lang of ["de", "en", "es", "fr", "id", "vi"]) {
    assert.match(
      locales[lang].appedit.manifest_settings,
      /manifest/i,
      `S7/AC12: ${lang}.appedit.manifest_settings は変更しない（借用語として機能している）`,
    );
  }
  // Web App Manifest のフィールド名そのものは原語のまま（設計 §7.4.1）
  for (const lang of langs) {
    for (const k of ["manifest_display", "manifest_start_url", "manifest_scope"]) {
      assert.ok(locales[lang].appedit[k] !== undefined, `S7/AC12: ${lang}.appedit.${k} は残すこと`);
    }
  }
  console.log("  [S7/AC12] manifest_settings: 非ラテン 5 言語からラテン語 manifest が消滅 / 6 言語は不変: PASS");
}

// ---------------------------------------------------------------------------
// S8 (AC13): 新設 10 キー × 11 言語
// ---------------------------------------------------------------------------
const NEW_APPEDIT_NOTE_KEYS = [
  "description_note",
  "extra_info_note",
  "pwa_manifest_note",
  "overlay_ui_note",
  "hide_marker_ui_note",
  "marker_list_ui_note",
  "border_ui_note",
  "cache_ui_note",
  "state_url_note",
  "share_ui_note",
];

{
  for (const lang of langs) {
    for (const key of NEW_APPEDIT_NOTE_KEYS) {
      const v = locales[lang].appedit[key];
      assert.ok(
        typeof v === "string" && v.trim() !== "",
        `S8/AC13: ${lang}.appedit.${key} must be a non-empty string`,
      );
    }
  }
  // 参照側: 10 キーすべてが AppEdit.vue から参照されている
  for (const key of NEW_APPEDIT_NOTE_KEYS) {
    assert.equal(
      count(appEditVue, `appedit.${key}`),
      2,
      `S8/AC13: AppEdit.vue must reference appedit.${key} twice (:text と :ariaLabel)`,
    );
  }
  console.log(`  [S8/AC13] 新設 ${NEW_APPEDIT_NOTE_KEYS.length} キー × ${langs.length} 言語が非空 / 全キー参照済み: PASS`);
}

// ---------------------------------------------------------------------------
// S9 (AC15): .preview-lang の絶対配置 CSS が残っていない
// ---------------------------------------------------------------------------
{
  assert.ok(
    !/\.preview-lang\s*\{/.test(appEditVue),
    "S9/AC15: AppEdit.vue must not keep the .preview-lang CSS rule (絶対配置を廃止)",
  );
  assert.equal(
    count(appEditVue, 'class="preview-lang'),
    0,
    "S9/AC15: AppEdit.vue must not keep the .preview-lang wrapper",
  );
  assert.match(
    appEditVue,
    /data-testid="app-preview-toolbar"/,
    "S9/AC15: タブ直下の 1 行メニューバー（app-preview-toolbar）があること",
  );
  assert.equal(
    count(appEditVue, 'id="previewLang"'),
    1,
    "S9/AC15: #previewLang は 1 箇所で維持すること（m1-t6-preview-restart.spec.ts が依存）",
  );
  console.log("  [S9/AC15] 言語切替の移設: .preview-lang 絶対配置の廃止 / #previewLang 生存: PASS");
}

// ---------------------------------------------------------------------------
// S10 (AC16): 人間検証ハーネスの案内文が凍結後 UI に合っている
// ---------------------------------------------------------------------------
{
  const humanCheck = await readSrc(HUMAN_CHECK);
  const guide = humanCheck.slice(0, humanCheck.indexOf("import {"));
  for (const stale of ["帰属・ライセンス系5欄", "サムネイル"]) {
    assert.equal(
      count(guide, stale),
      0,
      `S10/AC16: ${HUMAN_CHECK} の案内文に凍結前 UI の記述「${stale}」が残っている`,
    );
  }
  assert.match(guide, /m19-t4b/, "S10/AC16: 案内文に m19-t4b 追加分の見てほしい項目があること");
  // seed 部分（masterDoc / ソース選択導線）は変更しない
  assert.match(humanCheck, /const masterDoc = \(suffix: string\) => \(\{/, "S10/AC16: masterDoc は変更しない");
  assert.match(humanCheck, /m6t10-human-tms/, "S10/AC16: seed 導線は変更しない");
  console.log("  [S10/AC16] 人間検証ハーネスの案内文が凍結後 UI に追随: PASS");
}

// ---------------------------------------------------------------------------
// S11 (AC17): 本タスクが新設する 2 ファイルに凍結属性名のリテラルが 0 件
//   （検査対象を新設 2 ファイルへ限定する理由は設計 §9.2。変更対象ファイルには
//     本タスクと無関係な既存リテラルが計 23 件あり、全ファイル検査は成立しない）
// ---------------------------------------------------------------------------
{
  for (const rel of [SELF_SMOKE, SELF_E2E]) {
    const source = await readSrc(rel);
    for (const attr of FROZEN_RANGE_ATTRS) {
      assert.equal(
        count(source, attr),
        0,
        `S11/AC17: ${rel} must not spell the frozen attribute name as a literal (断片結合を使うこと)`,
      );
    }
  }
  console.log("  [S11/AC17] 新設 2 ファイルに凍結属性名リテラル 0 件: PASS");
}

// ---------------------------------------------------------------------------
// S12 (AC18): データスキーマ属性の増減がゼロ
//   (a) defaultApp().httpSettings のキー集合が 11 キーのまま
//   (b) NEW_APP_HTTP_OVERRIDES が既存キーしか上書きしない（新属性を持ち込まない）
//   (c) MC7b: 変更対象 4 ファイルの凍結属性名リテラル数が baseline のまま
// ---------------------------------------------------------------------------
{
  const declaredKeys = [...defaultHttpBlock.matchAll(/(^|\n)\s*([A-Za-z][A-Za-z0-9_]*)\s*:/g)].map((m) => m[2]);
  assert.deepEqual(
    declaredKeys.sort(),
    Object.keys(DEFAULT_HTTP_SETTINGS).sort(),
    "S12/AC18 (a): defaultApp().httpSettings のキー集合は 11 キーのまま（属性の増減ゼロ）",
  );

  const ovStart = appEditVue.indexOf("const NEW_APP_HTTP_OVERRIDES");
  const ovBlock = appEditVue.slice(ovStart, appEditVue.indexOf("}", ovStart));
  const ovKeys = [...ovBlock.matchAll(/(^|\n)\s*([A-Za-z][A-Za-z0-9_]*)\s*:/g)].map((m) => m[2]);
  assert.ok(ovKeys.length > 0, "S12/AC18 (b): NEW_APP_HTTP_OVERRIDES のキーを読み取れること");
  for (const k of ovKeys) {
    assert.ok(
      k in DEFAULT_HTTP_SETTINGS,
      `S12/AC18 (b): NEW_APP_HTTP_OVERRIDES.${k} は httpSettings の既存キーでなければならない（新属性を持ち込まない）`,
    );
  }

  // (c) MC7b: 設計 §9.2 の実測 baseline。
  //   **単位に注意**: 設計 §9.2 が載せた 11 / 3 / 8 / 1 は `grep -c`（= 語を含む「行数」）である。
  //   一方 m19-t11 smoke の凍結カウント（baseline 473）は **出現回数**を数えている
  //   （scripts/m19-t11-range-vocabulary-smoke.mjs の MC5。1 行に 2 回現れれば 2 と数える）。
  //   ∴ baseline を守る側の単位は「出現回数」であり、こちらが 13 / 3 / 12 / 1 である。
  //   両方を固定して、どちらの単位で数えても本タスクが件数を動かさないことを示す。
  const mc7b = [
    [APP_EDIT, appEditVue, 13, 11],
    [MAP_EDIT, mapEditVue, 3, 3],
    [BASE_MAP_EDIT, baseMapEditVue, 12, 8],
    [HUMAN_CHECK, await readSrc(HUMAN_CHECK), 1, 1],
  ];
  for (const [rel, source, expectedOccurrences, expectedLines] of mc7b) {
    const actual = count(source, FROZEN_RANGE_ATTRS[0]);
    assert.equal(
      actual,
      expectedOccurrences,
      `S12/AC18 (c): ${rel} の凍結属性名の出現回数は ${expectedOccurrences} のまま（m19-t11 の baseline を動かさない。got ${actual}）`,
    );
    const lines = source.split("\n").filter((l) => l.includes(FROZEN_RANGE_ATTRS[0])).length;
    assert.equal(
      lines,
      expectedLines,
      `S12/AC18 (c): ${rel} の凍結属性名を含む行数は ${expectedLines} のまま（設計 §9.2 の grep -c 実測値。got ${lines}）`,
    );
  }
  // locales には凍結属性名が 1 件も無い（i18n 移送が baseline に影響し得ないことの直接確認）
  for (const lang of langs) {
    const raw = await readSrc(`public/locales/${lang}/translation.json`);
    for (const attr of FROZEN_RANGE_ATTRS) {
      assert.equal(count(raw, attr), 0, `S12/AC18 (c): public/locales/${lang}/translation.json に ${attr} は無いこと`);
    }
  }
  console.log("  [S12/AC18] スキーマ属性の増減ゼロ（httpSettings 11 キー不変 / 上書きは既存キーのみ / MC7b 11-3-8-1）: PASS");
}

// ---------------------------------------------------------------------------
// S13 (AC4): キャッシュの PWA 従属は watch ではなく onPwaToggle 内で 1 履歴レコードへ畳む
//   設計 §4.3.3。watch にすると履歴が 2 レコードに割れて E3（Undo 1 回で両方復帰）が RED になり、
//   performRedo の redo スタックも壊れる
// ---------------------------------------------------------------------------
{
  // 「watch を使っていないこと」はコード上の事実であって、コメントで watch に言及すること
  // （onPwaToggle の直前に「なぜ watch を採らないか」を書いている）は禁止対象ではない。
  // ∴ 行コメント・ブロックコメント・HTML コメントを落としてから数える
  const codeOnly = appEditVue
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/[^\n]*/g, "$1");
  assert.equal(
    count(codeOnly, "watch(pwaEnabled"),
    0,
    "S13/AC4: watch(pwaEnabled) を使ってはならない（設計 §4.3.3 の 4 点）",
  );
  assert.match(
    codeOnly,
    /v-model="appData\.httpSettings\.pwaManifest"[^>]*@change="onPwaToggle"/,
    "S13/AC4: PWA チェックボックスの @change は onPwaToggle であること",
  );
  assert.equal(
    count(codeOnly, '@change="onPwaToggle"'),
    1,
    "S13/AC4: onPwaToggle は PWA チェックボックス 1 箇所だけに結線すること",
  );

  const fnStart = codeOnly.indexOf("function onPwaToggle()");
  assert.notEqual(fnStart, -1, "S13/AC4: function onPwaToggle() が存在すること");
  const fnEnd = codeOnly.indexOf("\n}", fnStart);
  const body = codeOnly.slice(fnStart, fnEnd);
  const coerceAt = body.search(/enableCache\s*=\s*false/);
  const recordAt = body.indexOf("recordHistory()");
  assert.ok(coerceAt !== -1, "S13/AC4: onPwaToggle 内で enableCache = false を行うこと");
  assert.ok(recordAt !== -1, "S13/AC4: onPwaToggle 内で recordHistory() を呼ぶこと");
  assert.ok(
    coerceAt < recordAt,
    "S13/AC4: enableCache = false は recordHistory() より前に書くこと（2 つの変化を 1 レコードへ畳む）",
  );
  assert.equal(
    count(body, "recordHistory()"),
    1,
    "S13/AC4: onPwaToggle は recordHistory() を 1 回だけ呼ぶこと",
  );

  // 表示従属（v-if / :disabled）は pwaEnabled computed に集約する
  assert.match(
    codeOnly,
    /const pwaEnabled = computed\(\(\) => appData\.value\.httpSettings\.pwaManifest\)/,
    "S13/AC4: PWA 従属 UI の唯一の判定点 pwaEnabled computed があること",
  );
  assert.match(
    codeOnly,
    /<section v-if="pwaEnabled"/,
    "S13/AC4: マニフェスト設定欄の v-if は pwaEnabled を見ること",
  );
  assert.match(
    codeOnly,
    /v-model="appData\.httpSettings\.enableCache"[^>]*:disabled="translationMode \|\| !pwaEnabled"/,
    "S13/AC4: キャッシュのチェックボックスは PWA オフ時に disabled になること",
  );
  // テンプレート形（appData.httpSettings.pwaManifest）の直接参照は v-model の 1 箇所だけ。
  //   旧実装は v-if でも同じ式を書いていた（:1486）。それを pwaEnabled 経由へ寄せたので
  //   「PWA 従属の判定点は 1 つ」が構造的に保たれる（script 側の computed 定義は
  //   appData.value.httpSettings.pwaManifest なので、この needle には当たらない）
  assert.equal(
    count(codeOnly, "appData.httpSettings.pwaManifest"),
    1,
    "S13/AC4: pwaManifest のテンプレート直接参照は v-model の 1 箇所だけ（v-if は pwaEnabled 経由）",
  );
  console.log("  [S13/AC4] キャッシュの PWA 従属: onPwaToggle 1 レコード化 / 判定点は pwaEnabled 1 つ: PASS");
}

console.log("m19-t4b editor UI help & defaults smoke: PASS (S1-S13)");
