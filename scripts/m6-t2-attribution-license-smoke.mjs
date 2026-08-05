// M6-T2 スモーク: 帰属・ライセンスの 2×2 と自由記述（表示まで）。フォールバックは含まない。
//
// AC1  BaseMapEditDocument / BaseMapSavePayload.tms が §4.1 の5フィールドを持ち、
//      fromBaseMapCatalogItem → toBaseMapSavePayload の往復で保たれる。
// AC2  newBaseMapDocument の license / dataLicense が空文字（All right reserved を既定にしない）。
// AC3  MAP_LANG_ATTRS が13件で licenseNote / dataLicenseNote を含み、url を含まない。
// AC4  BASE_MAP_LANG_ATTRS が5件（label を含まない）で、composeViewerSource がそれを回して解決する。
//      解決結果が空のキーは出力されない。
// AC7  語彙が licenseVocabulary.ts 単一の正本から供給され、image 11件 / data 10件で PD は data に無い。
//      ソーステキスト assert: MapEdit / BaseMapEdit に <option のべた書きが残っていない。
//
// m11-t4 と同じ harness（vite SSR ビルド + import）。
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { build } from "vite";

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL("..", import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, ".tmp-smoke");
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, "m6-t2-attribution-license-"));
const entryFile = path.join(workDir, "m6-t2-attribution-license-smoke.ts");
const outDir = path.join(workDir, "dist");
const bundledFile = path.join(outDir, "m6-t2-attribution-license-smoke.mjs");

const modulePath = (relativePath) => JSON.stringify(path.join(projectRoot, relativePath));

try {
  await writeFile(
    entryFile,
    [
      `import assert from "node:assert/strict";`,
      `export * from ${modulePath("src/utils/baseMapEditorDocument.ts")};`,
      `export * from ${modulePath("src/utils/appSourceModel.ts")};`,
      `export * from ${modulePath("src/utils/langResource.ts")};`,
      `export * from ${modulePath("src/utils/licenseVocabulary.ts")};`,
    ].join("\n"),
    "utf8",
  );

  await build({
    root: projectRoot,
    logLevel: "error",
    configFile: false,
    build: {
      outDir,
      emptyOutDir: true,
      ssr: entryFile,
      target: "node22",
      rollupOptions: {
        output: { entryFileNames: "m6-t2-attribution-license-smoke.mjs", format: "es" },
      },
    },
  });

  const {
    BASE_MAP_LANG_ATTRS,
    MAP_LANG_ATTRS,
    LICENSE_VOCABULARY,
    IMAGE_LICENSE_OPTIONS,
    DATA_LICENSE_OPTIONS,
    LICENSE_WITHOUT_ICON,
    fromBaseMapCatalogItem,
    newBaseMapDocument,
    toBaseMapSavePayload,
    composeViewerSource,
    createAppSourceFromBaseMap,
  } = await import(pathToFileURL(bundledFile).href);
  // 単独実行を可能にするため bundledFile の import を相対解決させる
  // (rollup ssr は相対 import を同ディレクトリへまとめる。既存 smoke と同じ手順)。

  const uid = "11111111-1111-4111-8111-111111111111";

  // --- AC2: newBaseMapDocument の license / dataLicense は空文字 ---
  const fresh = newBaseMapDocument(uid, "fr");
  assert.equal(fresh.license, "", "AC2: newBaseMapDocument.license は空文字のはず");
  assert.equal(fresh.dataLicense, "", "AC2: newBaseMapDocument.dataLicense は空文字のはず");
  assert.deepEqual(fresh.licenseNote, {}, "AC2: licenseNote は空オブジェクトのはず");
  assert.deepEqual(fresh.dataLicenseNote, {}, "AC2: dataLicenseNote は空オブジェクトのはず");
  assert.deepEqual(fresh.dataAttr, {}, "AC2: dataAttr は空オブジェクトのはず");
  console.log("ok: AC2 newBaseMapDocument defaults (license/dataLicense = empty string)");

  // --- AC1: fromBaseMapCatalogItem → toBaseMapSavePayload の往復で5フィールドが保たれる ---
  const base = fromBaseMapCatalogItem({
    uid,
    mapID: "custom",
    scope: "user",
    revision: 3,
    data: {
      lang: "ja",
      title: "タイトル",
      attr: { ja: "帰属" },
      dataAttr: { ja: "データ帰属" },
      license: "CC BY",
      dataLicense: "ODbL",
      licenseNote: { ja: "補足" },
      dataLicenseNote: "データ補足",
    },
  });
  assert.deepEqual(base.licenseNote, { ja: "補足" }, "AC1: licenseNote は内部形へ正規化されるはず");
  assert.deepEqual(base.dataLicenseNote, { ja: "データ補足" }, "AC1: dataLicenseNote は内部形へ正規化されるはず");
  assert.deepEqual(base.dataAttr, { ja: "データ帰属" }, "AC1: dataAttr は内部形へ正規化されるはず");
  assert.equal(base.license, "CC BY", "AC1: license は文字列のまま");
  assert.equal(base.dataLicense, "ODbL", "AC1: dataLicense は文字列のまま");

  const payload = toBaseMapSavePayload(base, 3);
  assert.equal(payload.tms.license, "CC BY", "AC1: 往復で license が保たれる");
  assert.equal(payload.tms.dataLicense, "ODbL", "AC1: 往復で dataLicense が保たれる");
  assert.deepEqual(payload.tms.licenseNote, { ja: "補足" }, "AC1: 往復で licenseNote が保たれる");
  assert.deepEqual(payload.tms.dataLicenseNote, { ja: "データ補足" }, "AC1: 往復で dataLicenseNote が保たれる");
  assert.deepEqual(payload.tms.dataAttr, { ja: "データ帰属" }, "AC1: 往復で dataAttr が保たれる");
  console.log("ok: AC1 fromBaseMapCatalogItem -> toBaseMapSavePayload roundtrip keeps 5 fields");

  // --- AC3: MAP_LANG_ATTRS が13件で licenseNote/dataLicenseNote を含み url を含まない ---
  assert.equal(MAP_LANG_ATTRS.length, 13, "AC3: MAP_LANG_ATTRS は13件のはず。実際: " + MAP_LANG_ATTRS.length);
  assert.ok(MAP_LANG_ATTRS.includes("licenseNote"), "AC3: MAP_LANG_ATTRS に licenseNote を含むはず");
  assert.ok(MAP_LANG_ATTRS.includes("dataLicenseNote"), "AC3: MAP_LANG_ATTRS に dataLicenseNote を含むはず");
  assert.ok(!MAP_LANG_ATTRS.includes("url"), "AC3: MAP_LANG_ATTRS に url を含まないはず");
  console.log("ok: AC3 MAP_LANG_ATTRS = 13 with licenseNote/dataLicenseNote, no url");

  // --- AC4: BASE_MAP_LANG_ATTRS が5件（label を含まない）で composeViewerSource が解決する ---
  assert.equal(BASE_MAP_LANG_ATTRS.length, 5, "AC4: BASE_MAP_LANG_ATTRS は5件のはず。実際: " + BASE_MAP_LANG_ATTRS.length);
  assert.ok(!BASE_MAP_LANG_ATTRS.includes("label"), "AC4: BASE_MAP_LANG_ATTRS に label を含まないはず");
  assert.deepEqual(
    [...BASE_MAP_LANG_ATTRS].sort(),
    ["title", "attr", "dataAttr", "licenseNote", "dataLicenseNote"].sort(),
    "AC4: BASE_MAP_LANG_ATTRS の要素が想定どおり",
  );

  const source = createAppSourceFromBaseMap(base, "ja");
  const runtimeSource = composeViewerSource(source, { lang: "ja" });
  assert.equal(runtimeSource.title, "タイトル", "AC4: composeViewerSource が title を解決するはず");
  assert.equal(runtimeSource.attr, "帰属", "AC4: composeViewerSource が attr を解決するはず");
  assert.equal(runtimeSource.dataAttr, "データ帰属", "AC4: composeViewerSource が dataAttr を解決するはず");
  assert.equal(runtimeSource.licenseNote, "補足", "AC4: composeViewerSource が licenseNote を解決するはず");
  assert.equal(runtimeSource.dataLicenseNote, "データ補足", "AC4: composeViewerSource が dataLicenseNote を解決するはず");

  // 空文字へ解決したキーは出力されない（AC4: 解決結果が空のキーは出力されない）
  const baseNoNote = fromBaseMapCatalogItem({
    uid,
    mapID: "custom2",
    scope: "user",
    revision: 1,
    data: { lang: "ja", title: "T", attr: { ja: "A" } },
  });
  const sourceNoNote = createAppSourceFromBaseMap(baseNoNote, "ja");
  const runtimeNoNote = composeViewerSource(sourceNoNote, { lang: "ja" });
  assert.ok(!("licenseNote" in runtimeNoNote), "AC4: 空の licenseNote は出力されないはず");
  assert.ok(!("dataLicenseNote" in runtimeNoNote), "AC4: 空の dataLicenseNote は出力されないはず");
  assert.ok(!("dataAttr" in runtimeNoNote), "AC4: 空の dataAttr は出力されないはず");
  console.log("ok: AC4 BASE_MAP_LANG_ATTRS resolves and drops empty-resolved keys");

  // --- AC7: 語彙が licenseVocabulary.ts 単一の正本で image 11 / data 10、PD は data に無い ---
  assert.equal(IMAGE_LICENSE_OPTIONS.length, 11, "AC7: image は11件のはず。実際: " + IMAGE_LICENSE_OPTIONS.length);
  assert.equal(DATA_LICENSE_OPTIONS.length, 10, "AC7: data は10件のはず。実際: " + DATA_LICENSE_OPTIONS.length);
  assert.ok(
    DATA_LICENSE_OPTIONS.every((o) => o.value !== "PD"),
    "AC7: data 選択肢に PD が無いはず（既存の非対称を温存）",
  );
  assert.ok(IMAGE_LICENSE_OPTIONS.some((o) => o.value === "PD"), "AC7: image 選択肢には PD があるはず");
  assert.ok(
    LICENSE_VOCABULARY.some((o) => o.value === "ODbL") && LICENSE_VOCABULARY.some((o) => o.value === "Custom"),
    "AC7: 語彙に ODbL と Custom があるはず",
  );
  assert.equal(LICENSE_WITHOUT_ICON, "Custom", "AC7: LICENSE_WITHOUT_ICON は Custom のはず");
  console.log("ok: AC7 vocabulary (image 11 / data 10, PD asymmetry, ODbL/Custom)");

  // --- AC7-ソースassert: MapEdit / BaseMapEdit にライセンス語彙の <option value="..."> べた書きが残っていない ---
  // (MapEdit.vue には strictMode/defaultLang など他の正当な <option> があるため、
  //   ライセンス語彙の保存値が option value として直接書かれていないことだけを見張る)
  for (const vueFile of ["src/views/MapEdit.vue", "src/components/basemap/BaseMapEdit.vue"]) {
    const text = await readFile(path.join(projectRoot, vueFile), "utf8");
    for (const option of LICENSE_VOCABULARY) {
      assert.ok(
        !text.includes(`<option value="${option.value}"`),
        `AC7: ${vueFile} に語彙 ${option.value} の <option べた書きが残ってはいけない（LicenseSelect を使うはず）`,
      );
    }
  }
  console.log("ok: AC7 MapEdit/BaseMapEdit no literal license <option> (LicenseSelect used)");

  console.log("M6-T2 attribution-license smoke passed");
  process.exit(0);
} finally {
  await rm(workDir, { recursive: true, force: true });
}
