// M19-T8 スモーク: ビルトイン OSM 1件のデータ帰属（dataAttr）是正。
//
// 設計 docs/superpowers/specs/2026-08-09-m19-t8-builtin-osm-data-attr-design.md §9 準拠。
//
// AC1  VIEWER_BUILTIN_LICENSES.osm に dataAttr（attr と同一構造・同一値）が追加されている
//      （生成関数の出力から逆検証する）。
// AC2  applyProviderFields の dataAttr 転写分岐が GSI/NARO 系 provider には影響しない
//      （dataAttr キーを持たないため発火しない）。
// AC3  実ファイル（electron/builtin_base_maps.json、要事前再生成）の osm エントリが
//      dataAttr を保持し値が attr と一致する。
// AC10 licenseNote が変更前後で一致する（§3.3 の決定どおり無変更）。
//
// buildBuiltinBaseMaps を動的 import して直接呼び出す（m11-t4-master-detail-smoke.mjs と同じ方式。
// generate-builtin-basemaps.mjs は plain ESM のため vite バンドルは不要）。
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const projectRoot = path.resolve(new URL("..", import.meta.url).pathname);

const EXPECTED_OSM_ATTR = {
  ja: "©︎ OpenStreetMap contributors",
  en: "©︎ OpenStreetMap contributors",
};
const EXPECTED_OSM_LICENSE_NOTE = {
  ja: "©︎ OpenStreetMap contributors（OpenStreetMap Copyright: https://www.openstreetmap.org/copyright）",
  en: "©︎ OpenStreetMap contributors (OpenStreetMap Copyright: https://www.openstreetmap.org/copyright)",
};

const { buildBuiltinBaseMaps } = await import(
  `${pathToFileURL(path.join(projectRoot, "scripts/generate-builtin-basemaps.mjs")).href}?smoke=${Date.now()}`
);

const catalog = JSON.parse(
  await readFile(path.resolve(projectRoot, "../Playground/KTGIS/ktgis-maplat-catalog.json"), "utf8"),
);
const legacyList = JSON.parse(await readFile(path.join(projectRoot, "electron/tms_list.json"), "utf8"));
const generatedBuiltins = buildBuiltinBaseMaps(catalog, legacyList);

// --- AC1: osm の dataAttr が attr と同一構造・同一値 ---
const generatedOsm = generatedBuiltins.find((entry) => entry.mapID === "osm");
assert.ok(generatedOsm, "osm エントリが生成されていない");
assert.deepEqual(generatedOsm.attr, EXPECTED_OSM_ATTR, "osm.attr が既存値から変わっている");
assert.ok(generatedOsm.dataAttr, "osm.dataAttr が生成されていない（AC1未実装）");
assert.deepEqual(generatedOsm.dataAttr, generatedOsm.attr, "osm.dataAttr が osm.attr と一致しない");
assert.deepEqual(
  Object.keys(generatedOsm.dataAttr).sort(),
  ["en", "ja"],
  "osm.dataAttr の言語範囲は ja/en の2言語のみであるべき（11言語へ拡張しない）",
);

// --- AC10: licenseNote は無変更 ---
assert.deepEqual(generatedOsm.licenseNote, EXPECTED_OSM_LICENSE_NOTE, "osm.licenseNote が変更されている（§3.3違反）");
assert.equal(generatedOsm.license, "Custom", "osm.license が変更されている");
assert.equal(generatedOsm.dataLicense, "ODbL", "osm.dataLicense が変更されている");

// --- AC2: dataAttr を持つのは osm のみ（GSI/NARO/今昔マップは無影響） ---
const entriesWithDataAttr = generatedBuiltins.filter((entry) => "dataAttr" in entry);
assert.deepEqual(
  entriesWithDataAttr.map((entry) => entry.mapID),
  ["osm"],
  "dataAttr を持つのは osm 1件のみであるべき（決定(a)の範囲を超えて他エントリに波及している）",
);

// GSI/NARO 系 provider は dataAttr キーを持たないため転写分岐が発火しないことを個別にも確認する。
for (const mapID of [
  "gsi_ort_USA10",
  "gsi_ort_old10",
  "gsi_gazo1",
  "gsi_gazo2",
  "gsi_gazo3",
  "gsi_gazo4",
  "affrc_rapid16",
  "affrc_tokyo5k",
]) {
  const entry = generatedBuiltins.find((item) => item.mapID === mapID);
  assert.ok(entry, `${mapID} エントリが見つからない`);
  assert.ok(!("dataAttr" in entry), `${mapID} に dataAttr が誤って設定されている`);
}

// gsi / gsi_ortho（VIEWER_BUILTIN_IDS 側だが GSI_PROVIDER を使う）も dataAttr を持たない。
for (const mapID of ["gsi", "gsi_ortho"]) {
  const entry = generatedBuiltins.find((item) => item.mapID === mapID);
  assert.ok(entry, `${mapID} エントリが見つからない`);
  assert.ok(!("dataAttr" in entry), `${mapID} に dataAttr が誤って設定されている`);
}

// 今昔マップ由来エントリ（オブジェクトリテラル直接構築、applyProviderFields非経由）も無影響。
const konjakuSample = generatedBuiltins.filter(
  (entry) => !["osm", "gsi", "gsi_ortho"].includes(entry.mapID) && !(entry.mapID in {
    gsi_ort_USA10: 1, gsi_ort_old10: 1, gsi_gazo1: 1, gsi_gazo2: 1, gsi_gazo3: 1, gsi_gazo4: 1,
    affrc_rapid16: 1, affrc_tokyo5k: 1,
  }),
);
assert.ok(konjakuSample.length > 300, "今昔マップ由来エントリのサンプル数が想定より少ない");
assert.ok(
  konjakuSample.every((entry) => !("dataAttr" in entry)),
  "今昔マップ由来エントリに dataAttr が誤って設定されている",
);

assert.equal(generatedBuiltins.length, 329, "生成件数が329件から変わっている");

// --- AC3: 実ファイル（要・事前に `pnpm run generate:builtin-basemaps -- --data-only` を実行）---
const builtins = JSON.parse(await readFile(path.join(projectRoot, "electron/builtin_base_maps.json"), "utf8"));
assert.equal(builtins.length, 329, "electron/builtin_base_maps.json の件数が329件でない");
const fileOsm = builtins.find((entry) => entry.mapID === "osm");
assert.ok(fileOsm, "electron/builtin_base_maps.json に osm エントリが無い");
assert.ok(
  fileOsm.dataAttr,
  "electron/builtin_base_maps.json の osm に dataAttr が無い（`pnpm run generate:builtin-basemaps -- --data-only` を実行してから再実行すること）",
);
assert.deepEqual(fileOsm.dataAttr, fileOsm.attr, "実ファイルの osm.dataAttr が osm.attr と一致しない");
assert.deepEqual(fileOsm.licenseNote, EXPECTED_OSM_LICENSE_NOTE, "実ファイルの osm.licenseNote が変更されている");
const fileEntriesWithDataAttr = builtins.filter((entry) => "dataAttr" in entry);
assert.deepEqual(
  fileEntriesWithDataAttr.map((entry) => entry.mapID),
  ["osm"],
  "実ファイルで dataAttr を持つのは osm 1件のみであるべき",
);

console.log("m19-t8 builtin-osm-data-attr smoke: PASS");
