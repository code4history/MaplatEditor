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
