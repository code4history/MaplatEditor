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
// (6) applyDeletion×in-flight loadMore: cursor ロックが残留せず、以後の loadMore が進む（実装レビューMinor-2回帰）
{
  const adapter = makePageAdapter();
  const baseLoad = adapter.load.bind(adapter);
  let release: (() => void) | null = null;
  let deferOnce = false;
  adapter.load = (input: any) => {
    if (deferOnce && input.cursor === 2) {
      deferOnce = false;
      return new Promise((resolve) => { release = () => resolve(baseLoad(input)); });
    }
    return baseLoad(input);
  };
  const list = useInfiniteResourceList(adapter, sources, { limit: 3 });
  await list.loadFirst();
  deferOnce = true;
  const pending = list.loadMore();          // cursor=2 を in-flight で保留
  await list.applyDeletion("a");            // generation++（旧 loadMore は破棄対象になる）
  release?.();
  await pending;
  await list.loadMore();                    // 修正前はここが恒久ブロックされていた
  assert.ok(list.items.value.some((i: any) => i.uid === "d"), "cursor ロック残留なしで追加取得できる");
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

// --- Part 3: ResourceActionMenu 契約 ---
const menu = await read("src/components/resource-list/ResourceActionMenu.vue");
assert.match(menu, /role="menu"/, "menu role missing");
assert.match(menu, /aria-expanded/, "aria-expanded missing");
assert.match(menu, /role="menuitem"/, "menuitem role missing");
assert.match(menu, /contextmenu/, "must handle right-click (contextmenu)");
// Shift+F10（keydown 監視）
assert.match(menu, /F10/, "must handle Shift+F10");
assert.match(menu, /Escape/, "must close on Escape");
// actions 空なら trigger 自体を出さない（D4改 / AC17）
assert.match(menu, /v-if="actions\.length"/, "empty actions must hide the ⋮ trigger (D4改)");
// select emit（key を親へ返す）
assert.match(menu, /emit\(["']select["']/, "must emit select with action key");
// focus restore（trigger へ戻す）
assert.match(menu, /focus\(\)/, "must restore focus to trigger");
console.log("m11-t6 smoke Part 3: OK");

// --- Part 4: 表示 primitives 契約 ---
const toolbar = await read("src/components/resource-list/ResourceListToolbar.vue");
assert.match(toolbar, /bi-plus-lg/, "toolbar primary must use plus icon");
assert.match(toolbar, /resource_list\.new_item/, "toolbar primary must use resource_list.new_item");
assert.match(toolbar, /name="secondary"/, "toolbar must expose secondary slot (Import)");
assert.match(toolbar, /name="range"/, "toolbar must expose range slot");
assert.match(toolbar, /resource_list\.search_placeholder/, "toolbar search must use unified placeholder");
// pager 廃止: prev/next ボタンや < > を持たない
assert.doesNotMatch(toolbar, /&lt;|&gt;|prevPage|nextPage/, "toolbar must not contain pager");

const status = await read("src/components/resource-list/ResourceResultStatus.vue");
for (const key of ["total_loaded", "loaded_only", "loading", "empty", "end", "load_error", "append_error", "retry"]) {
  assert.match(status, new RegExp(`resource_list\\.${key}`), `ResultStatus must render resource_list.${key}`);
}

const shell = await read("src/components/resource-list/ResourceListShell.vue");
assert.match(shell, /IntersectionObserver/, "Shell must use IntersectionObserver sentinel");
assert.match(shell, /resource-list__sentinel/, "Shell must render sentinel");
assert.doesNotMatch(shell, /prevPage|nextPage/, "Shell must not have pager");

const card = await read("src/components/resource-list/ResourceGridCard.vue");
const row = await read("src/components/resource-list/ResourceMasterRow.vue");
for (const [name, src] of [["GridCard", card], ["MasterRow", row]]) {
  assert.match(src, /ResourceActionMenu/, `${name} must host ResourceActionMenu`);
  assert.match(src, /resource-item__title/, `${name} must render title layer`);
  assert.match(src, /resource-item__slug/, `${name} must render Slug layer`);
  assert.match(src, /contextmenu/, `${name} must wire right-click to the menu`);
  // primitive は domain service を直接呼ばない（window.* 不使用）
  assert.doesNotMatch(src, /window\.\w+/, `${name} must not call domain services directly`);
}
// primitive 全体で window.* を呼ばない（AC1）
for (const rel of ["ResourceListShell.vue", "ResourceListToolbar.vue", "ResourceResultStatus.vue", "ResourceGridCard.vue", "ResourceMasterRow.vue", "ResourceActionMenu.vue"]) {
  const src = await read(`src/components/resource-list/${rel}`);
  assert.doesNotMatch(src, /window\.(maplist|applist|poiSources|baseMaps|imageAssets|assetDrafts)/, `${rel} must not import domain service`);
}
console.log("m11-t6 smoke Part 4: OK");

// --- Part 5: MapList 移行 ---
const mapAdapter = await read("src/views/resource-adapters/mapListAdapter.ts");
assert.match(mapAdapter, /window\.maplist\.request/, "mapAdapter must call maplist.request (D1)");
assert.match(mapAdapter, /total:\s*null/, "map batch total must be null (D8改)");
const mapList = await read("src/views/MapList.vue");
assert.match(mapList, /ResourceListShell/, "MapList must use ResourceListShell");
assert.match(mapList, /ResourceGridCard/, "MapList must use ResourceGridCard");
assert.match(mapList, /useInfiniteResourceList/, "MapList must use composable");
// pager 全廃
assert.doesNotMatch(mapList, /prevPage|nextPage|&lt;|&gt;/, "MapList must not contain pager");
// 削除は menu 経由（旧独自 dropdown 撤去）。confirm と assetDrafts.remove は維持
assert.match(mapList, /assetDrafts\.remove\(['"]map['"]/, "delete must still remove map draft");
assert.match(mapList, /applyDeletion/, "delete must use composable applyDeletion (D9)");
console.log("m11-t6 smoke Part 5: OK");

// --- Part 6: AppList 移行 ---
const appAdapter = await read("src/views/resource-adapters/appListAdapter.ts");
assert.match(appAdapter, /window\.applist\.request/, "appAdapter must call applist.request (D1)");
assert.match(appAdapter, /total:\s*null/, "app batch total must be null (D8改)");
const appList = await read("src/views/AppList.vue");
assert.match(appList, /ResourceListShell/);
assert.match(appList, /ResourceGridCard/);
assert.match(appList, /useInfiniteResourceList/);
assert.doesNotMatch(appList, /prevPage|nextPage|&lt;|&gt;/, "AppList must not contain pager");
assert.match(appList, /assetDrafts\.remove\(['"]app['"]/);
assert.match(appList, /applyDeletion/);
console.log("m11-t6 smoke Part 6: OK");

// --- Part 7: PoiSourceList 移行 ---
const poiAdapter = await read("src/views/resource-adapters/poiSourceListAdapter.ts");
assert.match(poiAdapter, /window\.poiSources\.list/, "poiAdapter must call poiSources.list");
assert.match(poiAdapter, /total:\s*\w+\.total/, "poi batch must pass through real total (D8改)");
const poi = await read("src/views/PoiSourceList.vue");
assert.match(poi, /ResourceListShell/);
assert.match(poi, /ResourceGridCard/);
assert.match(poi, /useInfiniteResourceList/);
assert.doesNotMatch(poi, /prevPage|nextPage|&lt;|&gt;/, "PoiSourceList must not contain pager");
// Import は secondary slot へ
assert.match(poi, /#secondary/, "Import must move to secondary slot");
assert.match(poi, /openImport/, "Import handler must remain (no functional change)");
// Remote 登録フラグは不変（false のまま、slot 内へ移設）
assert.match(poi, /REMOTE_POI_REGISTRATION_ENABLED\s*=\s*false/, "remote flag must stay false (D13)");
assert.match(poi, /v-if="REMOTE_POI_REGISTRATION_ENABLED"/, "remote button must stay flag-gated (D13)");
// 削除の参照チェック（findReferences）は維持
assert.match(poi, /findReferences/, "delete must keep reference check");
console.log("m11-t6 smoke Part 7: OK");

// --- Part 8: master 2種移行 + P7 ---
const bmAdapter = await read("src/components/basemap/baseMapListAdapter.ts");
assert.match(bmAdapter, /filterBaseMapCatalog/, "BaseMap adapter must reuse filterBaseMapCatalog (D3改)");
assert.match(bmAdapter, /input\.filter\.bbox|filter\.bbox/, "BaseMap adapter must consume filter.bbox (D3改)");
// builtin は actions 空（D4改 / AC17）
assert.match(bmAdapter, /scope === ["']builtin["']/, "builtin capability must gate actions");
const assetAdapter = await read("src/components/assets/assetListAdapter.ts");
assert.match(assetAdapter, /width|height|mime/, "asset metadata must include dims/mime");

const bmList = await read("src/components/basemap/BaseMapMasterList.vue");
assert.match(bmList, /ResourceMasterRow/, "BaseMapMasterList must use ResourceMasterRow");
// 可視 trash アイコンは撤去（menu 経由へ）。always checkbox は固有 slot で維持（D11）
assert.doesNotMatch(bmList, /bi-trash/, "visible trash icon must move to menu (P5)");
assert.match(bmList, /always/, "always checkbox must remain as resource slot (D11)");
const assetMaster = await read("src/components/assets/AssetMasterList.vue");
assert.match(assetMaster, /ResourceMasterRow/, "AssetMasterList must use ResourceMasterRow");

// P7: refreshDrafts 直呼びが refreshDraftsNow へ統一（BaseMapList/AssetList の save/delete/load 経路）
for (const rel of ["src/views/BaseMapList.vue", "src/views/AssetList.vue"]) {
  const src = await read(rel);
  // saved/reload/delete 経路に裸の refreshDrafts() が残らない（refreshDraftsNow を使う）
  assert.doesNotMatch(src, /await refreshDrafts\(\);\s*\n\s*await select/, `${rel}: saved path must use refreshDraftsNow`);
  assert.match(src, /refreshDraftsNow/, `${rel} must use refreshDraftsNow`);
}
console.log("m11-t6 smoke Part 8: OK");

// --- Part 9: P6 Back cache ---
const backCache = await read("src/composables/useResourceListBackCache.ts");
assert.match(backCache, /sessionStorage/, "back cache must use sessionStorage (D6)");
assert.match(backCache, /resource-list:/, "cache key must be resource-list:<kind> (D6)");
const mapListP9 = await read("src/views/MapList.vue");
assert.match(mapListP9, /restore\(/, "grid list must call composable restore on Back");
console.log("m11-t6 smoke Part 9: OK");
console.log("m11-t6 smoke: ALL OK");
