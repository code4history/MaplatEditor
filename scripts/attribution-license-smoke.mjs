// スモーク: 帰属・ライセンスの 2×2 と自由記述（表示まで）。フォールバックは含まない。
//
// case 1  BaseMapEditDocument / BaseMapSavePayload.tms が の5フィールドを持ち、
//      fromBaseMapCatalogItem → toBaseMapSavePayload の往復で保たれる。
// case 2  newBaseMapDocument の license / dataLicense が空文字（All right reserved を既定にしない）。
// case 3  MAP_LANG_ATTRS が12件で licenseNote / dataLicenseNote を含み、url を含まない。
// case 4  BASE_MAP_LANG_ATTRS が5件（label を含まない）で、composeViewerSource がそれを回して解決する。
//      解決結果が空のキーは出力されない。
// case 7  語彙が licenseVocabulary.ts 単一の正本から供給され、image 11件 / data 10件で PD は data に無い。
//      ソーステキスト assert: MapEdit / BaseMapEdit に <option のべた書きが残っていない。
//
// master-detail-smoke と同じ harness（vite SSR ビルド + import）。
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
const workDir = await mkdtemp(path.join(scratchRoot, "attribution-license-"));
const entryFile = path.join(workDir, "attribution-license-smoke.ts");
const outDir = path.join(workDir, "dist");
const bundledFile = path.join(outDir, "attribution-license-smoke.mjs");

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
        output: { entryFileNames: "attribution-license-smoke.mjs", format: "es" },
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
    composeBaseMapSettingFile,
    createBaseMapMasterLookup,
    createAppSourceFromBaseMap,
    validateBaseMapDocument,
  } = await import(pathToFileURL(bundledFile).href);
  // 単独実行を可能にするため bundledFile の import を相対解決させる
  // (rollup ssr は相対 import を同ディレクトリへまとめる。既存 smoke と同じ手順)。

  const uid = "11111111-1111-4111-8111-111111111111";

  // --- case 2: newBaseMapDocument の license / dataLicense は空文字 ---
  const fresh = newBaseMapDocument(uid, "fr");
  assert.equal(fresh.license, "", "case 2: newBaseMapDocument.license は空文字のはず");
  assert.equal(fresh.dataLicense, "", "case 2: newBaseMapDocument.dataLicense は空文字のはず");
  assert.deepEqual(fresh.licenseNote, {}, "case 2: licenseNote は空オブジェクトのはず");
  assert.deepEqual(fresh.dataLicenseNote, {}, "case 2: dataLicenseNote は空オブジェクトのはず");
  assert.deepEqual(fresh.dataAttr, {}, "case 2: dataAttr は空オブジェクトのはず");

  // --- (レビュー差し戻し): attr (地図画像帰属) を必須化 ---
  // kind: "tms" は 種別の軸の導入で加わった必須チェックへの適応（validateBaseMapDocument は kind-required を持つ）
  const attrMissing = { ...fresh, kind: "tms", slug: "custom", title: { fr: "Titre" }, url: "https://x/{z}/{x}/{y}.png" };
  const attrMissingValidation = validateBaseMapDocument(attrMissing);
  assert.ok(
    !attrMissingValidation.valid && attrMissingValidation.errors.includes("attr-required"),
    "M2: attr 未設定のベースマップは invalid で attr-required を含むはず。実際: " + JSON.stringify(attrMissingValidation.errors),
  );
  const attrPresent = { ...attrMissing, attr: { fr: "© Exemple" } };
  assert.ok(
    validateBaseMapDocument(attrPresent).valid,
    "M2: attr を既定言語で設定すれば valid のはず",
  );
  console.log("ok: M2 attr (地図画像帰属) is required in validateBaseMapDocument");
  console.log("ok: case 2 newBaseMapDocument defaults (license/dataLicense = empty string)");

  // --- case 1: fromBaseMapCatalogItem → toBaseMapSavePayload の往復で5フィールドが保たれる ---
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
  assert.deepEqual(base.licenseNote, { ja: "補足" }, "case 1: licenseNote は内部形へ正規化されるはず");
  assert.deepEqual(base.dataLicenseNote, { ja: "データ補足" }, "case 1: dataLicenseNote は内部形へ正規化されるはず");
  assert.deepEqual(base.dataAttr, { ja: "データ帰属" }, "case 1: dataAttr は内部形へ正規化されるはず");
  assert.equal(base.license, "CC BY", "case 1: license は文字列のまま");
  assert.equal(base.dataLicense, "ODbL", "case 1: dataLicense は文字列のまま");

  const payload = toBaseMapSavePayload(base, 3);
  assert.equal(payload.tms.license, "CC BY", "case 1: 往復で license が保たれる");
  assert.equal(payload.tms.dataLicense, "ODbL", "case 1: 往復で dataLicense が保たれる");
  assert.deepEqual(payload.tms.licenseNote, { ja: "補足" }, "case 1: 往復で licenseNote が保たれる");
  assert.deepEqual(payload.tms.dataLicenseNote, { ja: "データ補足" }, "case 1: 往復で dataLicenseNote が保たれる");
  assert.deepEqual(payload.tms.dataAttr, { ja: "データ帰属" }, "case 1: 往復で dataAttr が保たれる");
  console.log("ok: case 1 fromBaseMapCatalogItem -> toBaseMapSavePayload roundtrip keeps 5 fields");

  // --- case 3: MAP_LANG_ATTRS が12件で licenseNote/dataLicenseNote を含み url を含まない ---
  assert.equal(MAP_LANG_ATTRS.length, 12, "case 3: MAP_LANG_ATTRS は12件のはず。実際: " + MAP_LANG_ATTRS.length);
  assert.ok(MAP_LANG_ATTRS.includes("licenseNote"), "case 3: MAP_LANG_ATTRS に licenseNote を含むはず");
  assert.ok(MAP_LANG_ATTRS.includes("dataLicenseNote"), "case 3: MAP_LANG_ATTRS に dataLicenseNote を含むはず");
  assert.ok(!MAP_LANG_ATTRS.includes("url"), "case 3: MAP_LANG_ATTRS に url を含まないはず");
  console.log("ok: case 3 MAP_LANG_ATTRS = 12 with licenseNote/dataLicenseNote, no url");

  // --- case 4: BASE_MAP_LANG_ATTRS が5件（label を含まない）で composeViewerSource が解決する ---
  assert.equal(BASE_MAP_LANG_ATTRS.length, 5, "case 4: BASE_MAP_LANG_ATTRS は5件のはず。実際: " + BASE_MAP_LANG_ATTRS.length);
  assert.ok(!BASE_MAP_LANG_ATTRS.includes("label"), "case 4: BASE_MAP_LANG_ATTRS に label を含まないはず");
  assert.deepEqual(
    [...BASE_MAP_LANG_ATTRS].sort(),
    ["title", "attr", "dataAttr", "licenseNote", "dataLicenseNote"].sort(),
    "case 4: BASE_MAP_LANG_ATTRS の要素が想定どおり",
  );

  // 5フィールドの運び先はアプリ JSON から**設定ファイル**へ移った。
  // また 多言語の値は内部では常に言語別のオブジェクトで持ち、書き出しでは既定言語だけなら文字列に畳む決まりの交換形（既定言語のみは平文へ畳む）を保ち、言語の解決は viewer 側
  // （ui.translate）が行う。∴ 検査対象を composeBaseMapSettingFile へ移し、
  // 「5件が運ばれる／空のキーは落ちる」という case 4 の趣旨はそのまま維持する。
  const masterForSetting = {
    uid,
    mapID: "custom",
    data: {
      mapID: "custom",
      lang: "ja",
      title: "タイトル",
      attr: { ja: "帰属" },
      dataAttr: { ja: "データ帰属" },
      license: "CC BY",
      dataLicense: "ODbL",
      licenseNote: { ja: "補足" },
      dataLicenseNote: "データ補足",
      url: "https://example.test/{z}/{x}/{y}.png",
    },
  };
  const settingFile = composeBaseMapSettingFile(masterForSetting, "base");
  assert.equal(settingFile.title, "タイトル", "case 4: 設定ファイルが title を運ぶはず");
  assert.equal(settingFile.attr, "帰属", "case 4: 設定ファイルが attr を運ぶはず");
  assert.equal(settingFile.dataAttr, "データ帰属", "case 4: 設定ファイルが dataAttr を運ぶはず");
  assert.equal(settingFile.licenseNote, "補足", "case 4: 設定ファイルが licenseNote を運ぶはず");
  assert.equal(settingFile.dataLicenseNote, "データ補足", "case 4: 設定ファイルが dataLicenseNote を運ぶはず");
  assert.equal(settingFile.license, "CC BY", "case 4: license は単一文字列のまま運ばれる");
  assert.equal(settingFile.dataLicense, "ODbL", "case 4: dataLicense は単一文字列のまま運ばれる");
  // アプリ JSON 側にはマスタ由来値を出さない（上書きが無いため参照だけになる）
  const lookup = createBaseMapMasterLookup([masterForSetting]);
  const appElement = composeViewerSource(createAppSourceFromBaseMap(masterForSetting, "ja"), { lang: "ja", lookup });
  for (const key of ["title", "attr", "dataAttr", "licenseNote", "dataLicenseNote", "license", "dataLicense"]) {
    assert.ok(!(key in appElement), `case 4: 未上書きの ${key} はアプリ JSON に出ない（設定ファイル側が持つ）`);
  }

  // 空へ解決したキーは出力されない（case 4: 解決結果が空のキーは出力されない）
  const masterNoNote = {
    uid,
    mapID: "custom2",
    data: { mapID: "custom2", lang: "ja", title: "T", attr: { ja: "A" }, url: "https://example.test/{z}/{x}/{y}.png" },
  };
  const settingNoNote = composeBaseMapSettingFile(masterNoNote, "base");
  assert.ok(!("licenseNote" in settingNoNote), "case 4: 空の licenseNote は出力されないはず");
  assert.ok(!("dataLicenseNote" in settingNoNote), "case 4: 空の dataLicenseNote は出力されないはず");
  assert.ok(!("dataAttr" in settingNoNote), "case 4: 空の dataAttr は出力されないはず");
  console.log("ok: case 4 BASE_MAP_LANG_ATTRS が設定ファイルへ運ばれ、空のキーは落ちる");

  // --- case 7: 語彙が licenseVocabulary.ts 単一の正本で image 11 / data 10、PD は data に無い ---
  assert.equal(IMAGE_LICENSE_OPTIONS.length, 11, "case 7: image は11件のはず。実際: " + IMAGE_LICENSE_OPTIONS.length);
  assert.equal(DATA_LICENSE_OPTIONS.length, 10, "case 7: data は10件のはず。実際: " + DATA_LICENSE_OPTIONS.length);
  assert.ok(
    DATA_LICENSE_OPTIONS.every((o) => o.value !== "PD"),
    "case 7: data 選択肢に PD が無いはず（既存の非対称を温存）",
  );
  assert.ok(IMAGE_LICENSE_OPTIONS.some((o) => o.value === "PD"), "case 7: image 選択肢には PD があるはず");
  assert.ok(
    LICENSE_VOCABULARY.some((o) => o.value === "ODbL") && LICENSE_VOCABULARY.some((o) => o.value === "Custom"),
    "case 7: 語彙に ODbL と Custom があるはず",
  );
  assert.equal(LICENSE_WITHOUT_ICON, "Custom", "case 7: LICENSE_WITHOUT_ICON は Custom のはず");
  console.log("ok: case 7 vocabulary (image 11 / data 10, PD asymmetry, ODbL/Custom)");

  // --- case 7-ソースassert: MapEdit / BaseMapEdit にライセンス語彙の <option value="..."> べた書きが残っていない ---
  // (MapEdit.vue には strictMode/defaultLang など他の正当な <option> があるため、
  //   ライセンス語彙の保存値が option value として直接書かれていないことだけを見張る)
  for (const vueFile of ["src/views/MapEdit.vue", "src/components/basemap/BaseMapEdit.vue"]) {
    const text = await readFile(path.join(projectRoot, vueFile), "utf8");
    for (const option of LICENSE_VOCABULARY) {
      assert.ok(
        !text.includes(`<option value="${option.value}"`),
        `case 7: ${vueFile} に語彙 ${option.value} の <option べた書きが残ってはいけない（LicenseSelect を使うはず）`,
      );
    }
  }
  console.log("ok: case 7 MapEdit/BaseMapEdit no literal license <option> (LicenseSelect used)");

  console.log("attribution-license smoke passed");
  process.exit(0);
} finally {
  await rm(workDir, { recursive: true, force: true });
}
