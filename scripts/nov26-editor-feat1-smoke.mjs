// nov26-editor-feat1: 一覧トップの検索条件の記憶（直近の検索条件チップ）smoke
//
// 設計: .nayuta/2026-10-21-nov26-editor-feat1-design.md（v1.0）
// 設計レビュー NOV26-DR-EDITOR-FEATURES-0456 の指示:
//   1. ResourceListToolbar / BaseMapMasterList / AssetMasterList の検索入力に @change（Enter と blur）を付け、
//      新しい emit `commit:query` を足す（既存 props/emit/testid は変えない）
//   2. 800 ms の予約は compositionstart〜compositionend の間はしない（字面を本 smoke で固定する）
//   3. 左右ペイン 2 画面は uid 変化時と onBeforeUnmount で flush する
//   4. 現在の q と一致するチップに active を付ける
//   5. チップは表示専用部品（window.* を呼ばない）
//
// 実行: node --experimental-strip-types scripts/nov26-editor-feat1-smoke.mjs
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "vite";

const projectRoot = path.resolve(new URL("..", import.meta.url).pathname);
const read = (rel) => readFile(new URL(`../${rel}`, import.meta.url), "utf8");
const scratchRoot = path.join(projectRoot, ".tmp-smoke");
await mkdir(scratchRoot, { recursive: true });
let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`OK ${name}`);
  } catch (cause) {
    failures += 1;
    console.error(`NG ${name}\n  ${cause?.message ?? cause}`);
  }
}

// --- Part 1: 純関数（AC1 / AC2 / AC3） -------------------------------------
const workDir = await mkdtemp(path.join(scratchRoot, "nov26-feat1-"));
const outDir = path.join(workDir, "dist");
let recent;
try {
  await build({
    root: projectRoot,
    logLevel: "error",
    configFile: false,
    build: {
      outDir,
      emptyOutDir: true,
      lib: {
        entry: path.join(projectRoot, "src/utils/recentSearches.ts"),
        formats: ["es"],
        fileName: () => "recentSearches.mjs",
      },
      rollupOptions: { external: [] },
    },
  });
  recent = await import(pathToFileURL(path.join(outDir, "recentSearches.mjs")).href);
} catch (cause) {
  console.error("NG Part 1: src/utils/recentSearches.ts を読み込めない");
  console.error(cause);
  process.exit(1);
} finally {
  await rm(workDir, { recursive: true, force: true });
}

const {
  RECENT_SEARCH_LIMIT,
  RECENT_SEARCH_RECORD_DELAY_MS,
  RECENT_SEARCH_STORE_KEY,
  normalizeQueryForHistory,
  normalizeRecentSearches,
  insertRecentSearch,
  removeRecentSearch,
  sameSearchKey,
} = recent;

check("定数（件数上限・800 ms・保存キー）", () => {
  assert.deepEqual(RECENT_SEARCH_LIMIT, { map: 10, "poi-source": 10, app: 10, "base-map": 5, "image-asset": 5 });
  assert.equal(RECENT_SEARCH_RECORD_DELAY_MS, 800);
  assert.equal(RECENT_SEARCH_STORE_KEY, "recentSearches");
});

// AC3: 空・空白のみ（全角空白含む）は記録しない
check("AC3 normalizeQueryForHistory は空・空白のみ・201 文字を捨てる", () => {
  assert.equal(normalizeQueryForHistory(""), null);
  assert.equal(normalizeQueryForHistory("   "), null);
  assert.equal(normalizeQueryForHistory("\u3000"), null);
  assert.equal(normalizeQueryForHistory("\u3000 \t\n"), null);
  assert.equal(normalizeQueryForHistory("x".repeat(201)), null, "200 文字超は記録しない");
  assert.equal(normalizeQueryForHistory("x".repeat(200)), "x".repeat(200), "200 文字ちょうどは許す");
  assert.equal(normalizeQueryForHistory("\u3000東京 駅\u3000"), "東京 駅");
  assert.equal(normalizeQueryForHistory("  a  b  "), "a  b", "内部の空白は畳まない");
  assert.equal(normalizeQueryForHistory("TokYo"), "TokYo", "表記は入力どおり");
});

check("sameSearchKey は大文字小文字を区別しない", () => {
  assert.equal(sameSearchKey("Tokyo", "tokyo"), true);
  assert.equal(sameSearchKey("Tokyo", "osaka"), false);
});

// AC1: 壊れた値の正規化と上限
check("AC1 normalizeRecentSearches は非配列・型不正・空 q・200 文字超を捨てる", () => {
  assert.deepEqual(normalizeRecentSearches(undefined, "map"), []);
  assert.deepEqual(normalizeRecentSearches(null, "map"), []);
  assert.deepEqual(normalizeRecentSearches("recent", "map"), []);
  assert.deepEqual(normalizeRecentSearches({ map: [] }, "map"), []);
  const dirty = [
    { q: 1, at: 10 },
    { q: "", at: 11 },
    { q: "   ", at: 12 },
    { q: "x".repeat(201), at: 13 },
    { q: "ok", at: 14 },
    { q: "at が無い" },
    { q: "at が数値でない", at: "15" },
    "ただの文字列",
    null,
  ];
  assert.deepEqual(normalizeRecentSearches(dirty, "map"), [{ q: "ok", at: 14 }]);
});

check("AC1 normalizeRecentSearches は kind ごとの上限で切る", () => {
  const eleven = Array.from({ length: 11 }, (_, index) => ({ q: `q${index}`, at: index }));
  assert.equal(normalizeRecentSearches(eleven, "map").length, 10);
  assert.equal(normalizeRecentSearches(eleven, "poi-source").length, 10);
  assert.equal(normalizeRecentSearches(eleven, "app").length, 10);
  assert.equal(normalizeRecentSearches(eleven, "base-map").length, 5);
  assert.equal(normalizeRecentSearches(eleven, "image-asset").length, 5);
});

check("AC1 normalizeRecentSearches は at 降順・重複は新しい表記を残す", () => {
  const value = [
    { q: "old", at: 1 },
    { q: "Tokyo", at: 30 },
    { q: "new", at: 20 },
    { q: "tokyo", at: 10 },
    { q: "same-a", at: 40 },
    { q: "same-b", at: 40 },
  ];
  assert.deepEqual(normalizeRecentSearches(value, "map"), [
    { q: "same-a", at: 40 },
    { q: "same-b", at: 40 },
    { q: "Tokyo", at: 30 },
    { q: "new", at: 20 },
    { q: "old", at: 1 },
  ]);
});

// AC2: 同じ q（大文字小文字違い含む）は件数を増やさず先頭へ
check("AC2 insertRecentSearch は重複を増やさず先頭へ移動する", () => {
  const list = [
    { q: "b", at: 2 },
    { q: "a", at: 1 },
  ];
  assert.deepEqual(insertRecentSearch(list, "a", 3), [
    { q: "a", at: 3 },
    { q: "b", at: 2 },
  ]);
  assert.deepEqual(insertRecentSearch(list, "A", 4), [
    { q: "A", at: 4 },
    { q: "b", at: 2 },
  ], "大文字小文字違いは同じ条件として扱い、後に打った表記を残す");
  assert.equal(insertRecentSearch(list, "A", 4).length, list.length);
});

check("AC2/AC3 insertRecentSearch は空 q を記録せず、上限で末尾を落とす", () => {
  const list = [{ q: "a", at: 1 }];
  assert.deepEqual(insertRecentSearch(list, "   ", 2), list);
  const full = [
    { q: "c", at: 3 },
    { q: "b", at: 2 },
    { q: "a", at: 1 },
  ];
  assert.deepEqual(insertRecentSearch(full, "d", 4, 3), [
    { q: "d", at: 4 },
    { q: "c", at: 3 },
    { q: "b", at: 2 },
  ]);
});

check("removeRecentSearch は該当 1 件だけを消す", () => {
  const list = [
    { q: "b", at: 2 },
    { q: "a", at: 1 },
  ];
  assert.deepEqual(removeRecentSearch(list, "A"), [{ q: "b", at: 2 }]);
  assert.deepEqual(removeRecentSearch(list, "zzz"), list);
  assert.deepEqual(list, [
    { q: "b", at: 2 },
    { q: "a", at: 1 },
  ], "引数を破壊しない");
});
console.log("nov26-editor-feat1 smoke Part 1: OK");

// --- Part 2: ソーステキスト契約（AC11 / レビュー指示 1-5） ------------------
const sources = {};
for (const rel of [
  "src/components/resource-list/RecentSearchChips.vue",
  "src/components/resource-list/ResourceListToolbar.vue",
  "src/components/resource-list/ResourceListShell.vue",
  "src/components/basemap/BaseMapMasterList.vue",
  "src/components/assets/AssetMasterList.vue",
  "src/composables/useRecentSearches.ts",
  "src/views/MapList.vue",
  "src/views/PoiSourceList.vue",
  "src/views/AppList.vue",
  "src/views/BaseMapList.vue",
  "src/views/AssetList.vue",
]) {
  try {
    sources[rel] = await read(rel);
  } catch (cause) {
    failures += 1;
    console.error(`NG 読み込み: ${rel}\n  ${cause?.message ?? cause}`);
    sources[rel] = "";
  }
}

// AC11 + レビュー指示 5: チップは表示専用
check("AC11 RecentSearchChips.vue は window.* を呼ばない表示専用部品", () => {
  const src = sources["src/components/resource-list/RecentSearchChips.vue"];
  assert.doesNotMatch(src, /window\./, "チップ部品は window.* を呼ばない（m11-t6 Part 4 と同規約）");
  assert.match(src, /data-testid="recent-search-chips"/, "行のテスト用フック");
  assert.match(src, /data-recent-search="/, "チップのテスト用フック");
  assert.match(src, /data-recent-search-remove=/, "× のテスト用フック");
  assert.match(src, /role="group"/, "行は role=group");
  assert.match(src, /recent_searches_label/, "行の aria-label は文言キー経由");
  assert.match(src, /recent_search_apply/, "チップ本体の aria-label は文言キー経由");
  assert.match(src, /recent_search_remove/, "× の aria-label は文言キー経由");
  assert.match(src, /emit\(["']apply["']/, "チップは apply を emit する");
  assert.match(src, /emit\(["']remove["']/, "× は remove を emit する");
  assert.match(src, /active/, "現在の q と一致するチップに active を付ける（レビュー指示 4）");
  assert.doesNotMatch(src, /v-html/, "ラベルはテキストノードで描画する（XSS 経路を作らない）");
});

// レビュー指示 1: 検索入力の @change（Enter と blur）+ commit:query
check("レビュー指示 1 ResourceListToolbar は @change で commit:query を出す", () => {
  const src = sources["src/components/resource-list/ResourceListToolbar.vue"];
  assert.match(src, /@input="emit\('update:query'/, "既存の @input は変えない");
  assert.match(src, /@change=/, "@change（Enter と blur で発火）を付ける");
  assert.match(src, /"commit:query"/, "新しい emit commit:query を宣言する");
  assert.match(src, /data-resource-search/, "data-resource-search は動かさない");
  assert.match(src, /@change="[\s\S]{0,80}commit:query/, "@change から commit:query を出す");
});

check("レビュー指示 2 Toolbar/MasterList は compositionstart〜compositionend を親へ伝える", () => {
  for (const rel of [
    "src/components/resource-list/ResourceListToolbar.vue",
    "src/components/basemap/BaseMapMasterList.vue",
    "src/components/assets/AssetMasterList.vue",
  ]) {
    const src = sources[rel];
    assert.match(src, /@compositionstart=/, `${rel}: compositionstart を拾う`);
    assert.match(src, /@compositionend=/, `${rel}: compositionend を拾う`);
    assert.match(src, /composition-start/, `${rel}: composition-start を emit する`);
    assert.match(src, /composition-end/, `${rel}: composition-end を emit する`);
  }
});

check("レビュー指示 1 左右ペインの検索入力にも @change + commit:query", () => {
  for (const rel of ["src/components/basemap/BaseMapMasterList.vue", "src/components/assets/AssetMasterList.vue"]) {
    const src = sources[rel];
    assert.match(src, /@change=/, `${rel}: @change を付ける`);
    assert.match(src, /"commit:query"/, `${rel}: commit:query を emit 宣言する`);
    assert.match(src, /RecentSearchChips/, `${rel}: チップ行を置く`);
    assert.match(src, /apply-recent/, `${rel}: apply-recent を emit する`);
    assert.match(src, /remove-recent/, `${rel}: remove-recent を emit する`);
  }
  assert.match(
    sources["src/components/basemap/BaseMapMasterList.vue"],
    /data-testid="basemap-search"/,
    "既存 testid を動かさない（AC13）",
  );
});

check("Shell はチップ行を検索入力の下に置き、props/emit を中継する", () => {
  const src = sources["src/components/resource-list/ResourceListShell.vue"];
  assert.match(src, /RecentSearchChips/);
  assert.match(src, /recentSearches/);
  assert.match(src, /apply-recent/);
  assert.match(src, /remove-recent/);
  assert.match(src, /commit:query/);
  assert.match(src, /IntersectionObserver/, "既存の sentinel は残す");
  assert.doesNotMatch(src, /window\.(maplist|applist|poiSources|baseMaps|imageAssets|assetDrafts)/, "primitive は domain service を呼ばない");
});

// レビュー指示 2: 変換中の文字は記録しない（字面固定）
check("レビュー指示 2 useRecentSearches は isComposing 中に 800 ms の予約をしない", () => {
  const src = sources["src/composables/useRecentSearches.ts"];
  assert.match(src, /if \(composing\)/, "composing 中は予約しない分岐を字面で固定する");
  assert.match(src, /RECENT_SEARCH_RECORD_DELAY_MS/);
  assert.match(src, /window\.settings/, "window.settings を扱うのはこの composable だけ");
  assert.match(src, /normalizeRecentSearches/, "読み込み時に正規化する");
  assert.match(src, /insertRecentSearch/);
  assert.match(src, /removeRecentSearch/);
  assert.match(src, /beginComposition/);
  assert.match(src, /endComposition/);
  assert.match(src, /function flush|const flush/, "flush を持つ");
});

// 各ビューの配線
check("全面 3 画面は record / recordNow / flush / apply を配線する", () => {
  const expectations = [
    ["src/views/MapList.vue", '"map"'],
    ["src/views/PoiSourceList.vue", '"poi-source"'],
    ["src/views/AppList.vue", '"app"'],
  ];
  for (const [rel, kind] of expectations) {
    const src = sources[rel];
    assert.match(src, new RegExp(`useRecentSearches\\(${kind.replace(/"/g, '"')}\\)`), `${rel}: kind ${kind}`);
    assert.match(src, /recordRecent\(/, `${rel}: 入力のたびに record する`);
    assert.match(src, /recordRecentNow/, `${rel}: @change は即時記録する`);
    assert.match(src, /flushRecent/, `${rel}: 離脱時に flush する`);
    assert.match(src, /beginRecentComposition|beginComposition/, `${rel}: 変換中は予約しない`);
    assert.match(src, /applyRecent/, `${rel}: チップの適用`);
    assert.match(src, /removeRecent/, `${rel}: × の削除`);
    assert.match(src, /recent-searches=/, `${rel}: Shell へ履歴を渡す`);
  }
});

// レビュー指示 3: 左右ペインは onBeforeRouteLeave が無いので uid 変化時 + unmount で flush
check("レビュー指示 3 左右ペイン 2 画面は uid 変化時と onBeforeUnmount で flush する", () => {
  for (const [rel, kind] of [
    ["src/views/BaseMapList.vue", '"base-map"'],
    ["src/views/AssetList.vue", '"image-asset"'],
  ]) {
    const src = sources[rel];
    assert.match(src, new RegExp(`useRecentSearches\\(${kind.replace(/"/g, '"')}\\)`), `${rel}: kind ${kind}`);
    assert.doesNotMatch(src, /onBeforeRouteLeave\(/, `${rel}: 左右ペインに onBeforeRouteLeave は登録しない（現状維持）`);
    assert.match(src, /watch\(selectedUid[\s\S]{0,200}flushRecent/, `${rel}: uid が変わるときに flush`);
    assert.match(src, /onBeforeUnmount\([\s\S]{0,200}flushRecent/, `${rel}: unmount で flush`);
    assert.match(src, /recordRecent\(/, `${rel}: 入力のたびに record する`);
    assert.match(src, /recordRecentNow/, `${rel}: @change は即時記録する`);
    assert.match(src, /applyRecent/, `${rel}: チップの適用`);
    assert.match(src, /removeRecent/, `${rel}: × の削除`);
    assert.match(src, /mergeMasterDetailFilters|updateFilters|\.\.\.route\.query/, `${rel}: uid を保ったまま q を書き換える（AC9）`);
  }
});
console.log("nov26-editor-feat1 smoke Part 2: OK");

// --- Part 3: 11 言語の文言（AC12） -----------------------------------------
const LOCALE_KEYS = [
  "recent_searches_label",
  "recent_search_apply",
  "recent_search_remove",
  "recent_search_record_failed",
];
{
  const localesDir = path.join(projectRoot, "public/locales");
  const langs = (await readdir(localesDir, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  try {
    assert.deepEqual(langs, ["de", "en", "es", "fr", "id", "ja", "ko", "th", "vi", "zh", "zh-TW"], "11 ロケール");
    const keySets = new Map();
    for (const lang of langs) {
      const data = JSON.parse(await readFile(path.join(localesDir, lang, "translation.json"), "utf8"));
      const resourceList = data.resource_list ?? {};
      for (const key of LOCALE_KEYS) {
        assert.equal(typeof resourceList[key], "string", `${lang}: resource_list.${key} が無い`);
        assert.notEqual(resourceList[key].trim(), "", `${lang}: resource_list.${key} が空`);
      }
      for (const key of ["recent_search_apply", "recent_search_remove"]) {
        assert.match(resourceList[key], /\{\{q\}\}/, `${lang}: ${key} は {{q}} を保持する`);
      }
      keySets.set(lang, Object.keys(resourceList).sort().join(","));
    }
    const unique = new Set(keySets.values());
    assert.equal(unique.size, 1, "全ロケールで resource_list のキー集合が一致する（欠落も余剰も無い）");
    console.log("OK AC12 11 言語の 4 キー");
  } catch (cause) {
    failures += 1;
    console.error(`NG AC12 11 言語の 4 キー\n  ${cause?.message ?? cause}`);
  }
}

// --- Part 4: package.json のスクリプト -------------------------------------
{
  try {
    const pkg = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));
    assert.match(pkg.scripts["smoke:nov26-editor-feat1"] ?? "", /nov26-editor-feat1-smoke\.mjs/);
    assert.match(pkg.scripts["test:e2e:nov26-editor-feat1"] ?? "", /nov26-editor-feat1\.spec\.ts/);
    console.log("OK package.json の smoke / e2e スクリプト");
  } catch (cause) {
    failures += 1;
    console.error(`NG package.json の smoke / e2e スクリプト\n  ${cause?.message ?? cause}`);
  }
}

if (failures > 0) {
  console.error(`nov26-editor-feat1 smoke: ${failures} 件 NG`);
  process.exit(1);
}
console.log("nov26-editor-feat1 smoke: ALL OK");
