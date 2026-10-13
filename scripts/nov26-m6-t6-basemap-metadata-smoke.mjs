// nov26-m6-t6: 任意の出典メタデータ。fixtureはメモリ内で完結し既存出力を消さない。
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { build } from "vite";

const root = path.resolve(import.meta.dirname, "..");
const entry = "virtual:nov26-m6-t6";
const bundle = await build({
  root, configFile: false, logLevel: "error",
  plugins: [{ name: "nov26-m6-t6-memory-fixture", resolveId: id => id === entry ? id : undefined,
    load: id => id === entry ? ["baseMapEditorDocument", "appSourceModel", "langResource"].map(name =>
      `export * from ${JSON.stringify(path.join(root, "src/utils", name + ".ts"))};`).join("\n") : undefined }],
  build: { write: false, ssr: true, target: "node22", rollupOptions: { input: entry, output: { format: "es" } } },
});
const output = (Array.isArray(bundle) ? bundle[0] : bundle).output.find(o => o.type === "chunk");
const mod = await import(`data:text/javascript;base64,${Buffer.from(output.code).toString("base64")}`);
const keys = ["createdAt", "era", "contributor", "mapper", "reference", "description"];
const item = { uid: "11111111-1111-4111-8111-111111111111", mapID: "metadata", scope: "user", revision: 1,
  data: { lang: "ja", kind: "tms", title: "資料", attr: "出典", url: "https://example.test/{z}/{x}/{y}.png" } };
const original = mod.fromBaseMapCatalogItem(item);
for (const doc of [original, mod.newBaseMapDocument(item.uid, "ja")]) {
  const saved = mod.toBaseMapSavePayload(doc, 1).tms;
  for (const key of keys) { assert.ok(!Object.hasOwn(doc, key), `AC2 文書に空の${key}が増えた`); assert.ok(!Object.hasOwn(saved, key), `AC2 保存に空の${key}が増えた`); }
}
console.log("AC2: 未設定の既存/新規文書に6キーなし");
const values = Object.fromEntries(keys.map(key => [key, { ja: `${key} 日本語`, en: `${key} English` }]));
const doc = mod.fromBaseMapCatalogItem({ ...item, data: { ...item.data, ...values } });
const payload = mod.toBaseMapSavePayload(doc, 1);
const restored = mod.fromBaseMapCatalogItem({ ...item, data: JSON.parse(JSON.stringify(payload.tms)) });
for (const key of keys) {
  assert.deepEqual(payload.tms[key], values[key], `AC1 ${key} 保存`);
  assert.deepEqual(restored[key], values[key], `AC1 ${key} 再読込`);
}
console.log("AC1: 6項目の日本語/英語が保存・再読込で一致");
const setting = mod.composeBaseMapSettingFile({ ...item, data: payload.tms }, "base");
for (const key of keys) assert.deepEqual(setting[key], values[key], `AC5 ${key} 複数言語交換形`);
for (const key of keys) {
  const single = mod.fromBaseMapCatalogItem({ ...item, data: { ...item.data, [key]: "単一文字列" } });
  assert.deepEqual(single[key], { ja: "単一文字列" });
  assert.equal(mod.composeBaseMapSettingFile({ ...item, data: mod.toBaseMapSavePayload(single, 1).tms }, "base")[key], "単一文字列");
  const empty = { ...original, [key]: { ja: " ", en: "" } };
  const emptySaved = mod.toBaseMapSavePayload(empty, 1).tms;
  assert.ok(!Object.hasOwn(emptySaved, key), `AC2 ${key} 空を保存しない`);
  assert.ok(!Object.hasOwn(mod.composeBaseMapSettingFile({ ...item, data: emptySaved }, "base"), key));
}
assert.deepEqual(mod.BASE_MAP_META_LANG_ATTRS, keys);
assert.equal(mod.BASE_MAP_LANG_ATTRS.length, 5);
assert.ok(!mod.MAP_LANG_ATTRS.includes("reference"), "T6-MIN-1: 地図のreferenceは単一文字列のまま");
console.log("AC5: 6項目の交換形/文字列読み込み/空省略が一致");
for (const lang of ["de", "en", "es", "fr", "id", "ja", "ko", "th", "vi", "zh", "zh-TW"]) {
 const text = JSON.parse(await readFile(path.join(root, "public/locales", lang, "translation.json"), "utf8"));
 assert.ok(text.basemap.source_metadata?.trim(), `${lang} 見出しなし`);
 assert.ok(text.basemap.source_description_pf?.trim(), `${lang} 専用説明placeholderなし`);
}
console.log("文言: 11言語の見出しとベースマップ用placeholderあり");
