import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import path from "node:path";

const projectRoot = path.resolve(new URL("..", import.meta.url).pathname);
const read = (rel) => readFile(path.join(projectRoot, rel), "utf8");
const exists = (rel) => access(path.join(projectRoot, rel)).then(() => true, () => false);

const LOCALES = ["de", "en", "es", "fr", "id", "ja", "ko", "th", "vi", "zh", "zh-TW"];

// --- Part 1: P1 契約型 ---
const types = await read("src/components/resource-list/resourceListTypes.ts");
assert.match(types, /export interface ResourceListFilter/, "ResourceListFilter missing");
assert.match(types, /export interface ResourceListBatch<T, Cursor = string>/, "ResourceListBatch missing");
// D8改: total は number | null（List v2 §7 からの明示差分）
assert.match(types, /total:\s*number\s*\|\s*null/, "ResourceListBatch.total must be number | null (D8改)");
assert.match(types, /export interface ResourceListItemViewModel/, "view model missing");
assert.match(types, /export interface ResourceListAdapter<T, Cursor = string>/, "adapter missing");
assert.match(types, /export interface ResourceListAction/, "ResourceListAction missing");
assert.match(types, /key:\s*"delete"/, "ResourceListAction.key must be \"delete\" for T6");

// --- Part 1b: action 写像は i18n key を返す（labelKey）が adapter へ i18n を漏らさない ---
const builder = await read("src/components/resource-list/buildResourceListActions.ts");
assert.match(builder, /export function buildResourceListActions/, "buildResourceListActions missing");
assert.match(builder, /resource_list\.menu_delete/, "delete action must map to resource_list.menu_delete");

// --- Part 1c: P2 CSS が editor-ui token へ委譲する ---
const css = await read("src/components/resource-list/resource-list.scss");
assert.match(css, /\.resource-list/, "resource-list class missing");
assert.match(css, /var\(--editor-ui-/, "resource-list.scss must delegate to editor-ui tokens");
const mainScss = await read("src/assets/scss/main.scss");
assert.match(mainScss, /resource-list/, "main.scss must import resource-list.scss");

// --- Part 1d: i18n resource_list namespace（全 locale）+ placeholder 全角… ---
const REQUIRED_KEYS = [
  "new_item", "loading", "empty", "end", "load_error", "append_error", "retry",
  "menu_delete", "menu_label", "total_loaded", "loaded_only", "search_placeholder",
];
const KIND_KEYS = ["kind_map", "kind_poi_source", "kind_base_map", "kind_app", "kind_asset"];
const translations = {};
for (const loc of LOCALES) {
  const t = JSON.parse(await read(`public/locales/${loc}/translation.json`));
  translations[loc] = t;
  for (const key of [...REQUIRED_KEYS, ...KIND_KEYS]) {
    assert.ok(t.resource_list?.[key] != null, `resource_list.${key} missing in ${loc}`);
  }
  // placeholder template は {{name}} を含み、末尾は全角 … （半角 ... 禁止）
  const ph = t.resource_list.search_placeholder;
  assert.match(ph, /\{\{name\}\}/, `resource_list.search_placeholder must interpolate {{name}} (${loc})`);
  assert.ok(ph.includes("…"), `resource_list.search_placeholder must use full-width … (${loc})`);
  assert.ok(!ph.includes("..."), `resource_list.search_placeholder must not use half-width ... (${loc})`);
}
// ja 確定語彙（回帰防止の錨）
assert.equal(translations.ja.resource_list.kind_map, "地図");
assert.equal(translations.ja.resource_list.kind_poi_source, "POIソース");
assert.equal(translations.ja.resource_list.kind_base_map, "ベースマップ");
assert.equal(translations.ja.resource_list.kind_app, "アプリ");
assert.equal(translations.ja.resource_list.kind_asset, "アセット");
assert.equal(translations.ja.resource_list.search_placeholder, "{{name}}を検索…");

console.log("m11-t6 smoke Part 1: OK");

// --- Part 2: useInfiniteResourceList pure unit（vite bundle → node 実行）---
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { build } from "vite";

const scratchRoot = path.join(projectRoot, ".tmp-smoke");
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, "t6-composable-"));
const entryFile = path.join(workDir, "entry.ts");
const outFile = path.join(workDir, "dist", "entry.mjs");

// fake adapter を使い composable の状態機械を検証するエントリ。
await writeFile(entryFile, `
import assert from "node:assert/strict";
import { useInfiniteResourceList } from ${JSON.stringify(path.join(projectRoot, "src/composables/useInfiniteResourceList.ts"))};

type Row = { uid: string };
const filter = { q: "", bbox: null };
const sources = { filter: () => filter, activeLang: () => "ja" };

// page式backend を模した fake（cursor=page番号、5件/2ページ、2ページ目末尾は前ページと1件重複=dedupe対象）
function makePageAdapter(opts: { failAppend?: boolean } = {}) {
  const pages: Row[][] = [
    [{ uid: "a" }, { uid: "b" }, { uid: "c" }],
    [{ uid: "c" }, { uid: "d" }, { uid: "e" }], // "c" は重複 → dedupe
  ];
  return {
    calls: [] as Array<number | null>,
    load(input: any) {
      this.calls.push(input.cursor);
      const page = (input.cursor ?? 1) as number;
      if (opts.failAppend && page === 2) return Promise.reject(new Error("append boom"));
      const items = pages[page - 1] ?? [];
      const nextCursor = page < pages.length ? page + 1 : null;
      return Promise.resolve({ items, total: null, nextCursor });
    },
    toViewModel(item: Row) {
      return { uid: item.uid, slug: item.uid, title: item.uid, thumbnailUrl: null, metadata: [], badges: [], selected: false, hasDraft: false, actions: ["delete"] };
    },
  };
}

// (1) 基本取得 + dedupe（"c" が1件のみ）
{
  const list = useInfiniteResourceList(makePageAdapter(), sources, { limit: 3 });
  await list.loadFirst();
  assert.deepEqual(list.items.value.map((i: any) => i.uid), ["a", "b", "c"]);
  assert.equal(list.state.value, "idle");
  await list.loadMore();
  assert.deepEqual(list.items.value.map((i: any) => i.uid), ["a", "b", "c", "d", "e"], "dedupe: c は1件のみ");
  assert.equal(list.state.value, "end");
  assert.equal(list.loaded.value, 5);
}

// (2) 同一cursor多重取得禁止（loadMore を並行呼びしても cursor=2 は1回だけ）
{
  const adapter = makePageAdapter();
  const list = useInfiniteResourceList(adapter, sources, { limit: 3 });
  await list.loadFirst();
  await Promise.all([list.loadMore(), list.loadMore(), list.loadMore()]);
  const page2Calls = adapter.calls.filter((c) => c === 2).length;
  assert.equal(page2Calls, 1, "同一cursor(2)は1回だけ取得");
}

// (3) generation: filter 変更で古い応答を捨てる（loadFirst 連打で最新のみ反映）
{
  const list = useInfiniteResourceList(makePageAdapter(), sources, { limit: 3 });
  const p1 = list.loadFirst();
  const p2 = list.loadFirst();
  await Promise.all([p1, p2]);
  assert.deepEqual(list.items.value.map((i: any) => i.uid), ["a", "b", "c"], "最新 loadFirst のみ反映（重複追記なし）");
}

// (4) append error: 取得済み item を保持し state=append-error、retry で回復
{
  const list = useInfiniteResourceList(makePageAdapter({ failAppend: true }), sources, { limit: 3 });
  await list.loadFirst();
  await list.loadMore();
  assert.deepEqual(list.items.value.map((i: any) => i.uid), ["a", "b", "c"], "append 失敗時も既存 item 保持");
  assert.equal(list.state.value, "append-error");
}

// (5) applyDeletion（D9）: uid 除去 + 最終page再取得 dedupe
{
  const list = useInfiniteResourceList(makePageAdapter(), sources, { limit: 3 });
  await list.loadFirst();
  await list.loadMore();
  await list.applyDeletion("d");
  assert.ok(!list.items.value.some((i: any) => i.uid === "d"), "削除した uid は消える");
  assert.ok(!hasDup(list.items.value.map((i: any) => i.uid)), "再取得 dedupe で重複が出ない");
}
function hasDup(arr: string[]) { return new Set(arr).size !== arr.length; }

console.log("m11-t6 composable unit: OK");
`);

await build({
  root: workDir,
  configFile: false,
  logLevel: "error",
  build: {
    outDir: path.join(workDir, "dist"),
    lib: { entry: entryFile, formats: ["es"], fileName: () => "entry.mjs" },
    rollupOptions: { external: ["node:assert/strict"] },
    minify: false,
    emptyOutDir: true,
  },
});
await import(path.resolve(outFile));
await rm(workDir, { recursive: true, force: true });

console.log("m11-t6 smoke Part 2: OK");
