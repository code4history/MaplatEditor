// Google プリセット既定値 smoke
// case 1: build（buildGooglePresetDefaults の既定値）
// case 2: apply（applyGooglePresetDefaults への適用）
// case 3: プリセットの既定値は帰属表記に触れない
// case 4: 非空の license / 非 null の zoom は保持し、zoom はフィールド単位で扱う
// case 9: Google の地図の帰属表記は埋めず、入力させず、読み込み・保存でも持たない
// case 8: 11言語 Note キー
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "vite";

const projectRoot = path.resolve(new URL("..", import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, ".tmp-smoke");
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, "google-preset-defaults-"));
const entryPath = path.join(workDir, "entry.ts");
const outDir = path.join(workDir, "dist");
const modulePath = (relativePath) => JSON.stringify(path.join(projectRoot, relativePath));

try {
  await writeFile(
    entryPath,
    [
      `export * from ${modulePath("src/utils/googlePresetDefaults.ts")};`,
      `export * from ${modulePath("src/utils/baseMapEditorDocument.ts")};`,
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
      lib: { entry: entryPath, formats: ["es"], fileName: () => "contracts.mjs" },
    },
  });

  const {
    GOOGLE_DEFAULT_LICENSE,
    GOOGLE_DEFAULT_MIN_ZOOM,
    GOOGLE_DEFAULT_MAX_ZOOM,
    GOOGLE_DEFAULT_LICENSE_NOTE_BY_LANG,
    GOOGLE_DEFAULT_DATA_LICENSE_NOTE_BY_LANG,
    allGoogleDefaultNoteTexts,
    buildGooglePresetDefaults,
    applyGooglePresetDefaults,
    isGoogleDefaultNote,
    newBaseMapDocument,
    validateBaseMapDocument,
    fromBaseMapCatalogItem,
    toBaseMapSavePayload,
    usesGoogleAttribution,
  } = await import(pathToFileURL(path.join(outDir, "contracts.mjs")).href);

  const uid = "33333333-3333-4333-8333-333333333333";

  // ---- case 1 ----
  const d = buildGooglePresetDefaults("ja");
  assert.equal("attr" in d, false, "case 1: 帰属表記の既定値は持たない");
  assert.equal(d.license, GOOGLE_DEFAULT_LICENSE, "case 1: license");
  assert.equal(d.dataLicense, GOOGLE_DEFAULT_LICENSE, "case 1: dataLicense");
  assert.equal(d.minZoom, GOOGLE_DEFAULT_MIN_ZOOM, "case 1: minZoom 0");
  assert.equal(d.maxZoom, GOOGLE_DEFAULT_MAX_ZOOM, "case 1: maxZoom 22");
  assert.equal(typeof d.licenseNote.ja, "string");
  assert.ok(d.licenseNote.ja.length > 0, "case 1: licenseNote non-empty");
  assert.equal(d.licenseNote.ja, GOOGLE_DEFAULT_LICENSE_NOTE_BY_LANG.ja);
  assert.equal(d.dataLicenseNote.ja, GOOGLE_DEFAULT_DATA_LICENSE_NOTE_BY_LANG.ja);

  // ---- case 2 ----
  const fresh = newBaseMapDocument(uid, "ja");
  const applied = applyGooglePresetDefaults(fresh, d);
  assert.deepEqual(applied.attr, {}, "case 2: 帰属表記は埋めない");
  assert.equal(applied.license, GOOGLE_DEFAULT_LICENSE, "case 2: license filled");
  assert.equal(applied.dataLicense, GOOGLE_DEFAULT_LICENSE, "case 2: dataLicense filled");
  assert.equal(applied.minZoom, 0, "case 2: minZoom");
  assert.equal(applied.maxZoom, 22, "case 2: maxZoom");
  assert.equal(applied.licenseNote.ja, d.licenseNote.ja, "case 2: licenseNote");
  assert.equal(applied.dataLicenseNote.ja, d.dataLicenseNote.ja, "case 2: dataLicenseNote");

  // validate after maptype + defaults
  const ready = { ...applied, kind: "google", maptype: "google_roadmap", slug: "g1", title: { ja: "G" } };
  const v = validateBaseMapDocument(ready);
  assert.equal(v.errors.includes("attr-required"), false, "case 2: Google の地図は帰属表記が空でも attr-required を出さない");
  assert.equal(v.errors.includes("maptype-required"), false);

  // ---- case 3: プリセットの既定値は帰属表記に触れない ----
  const customAttr = applyGooglePresetDefaults(
    { ...fresh, attr: { ja: "My Custom Attr" } },
    d,
  );
  assert.equal(customAttr.attr.ja, "My Custom Attr", "case 3: 既定値の適用は attr を書き換えない");

  // ---- case 4: non-empty license / non-null zoom preserved; per-field zoom ----
  const customLicense = applyGooglePresetDefaults(
    { ...fresh, license: "CC BY", dataLicense: "ODbL", minZoom: 5, maxZoom: null },
    d,
  );
  assert.equal(customLicense.license, "CC BY", "case 4: license kept");
  assert.equal(customLicense.dataLicense, "ODbL", "case 4: dataLicense kept");
  assert.equal(customLicense.minZoom, 5, "case 4: minZoom kept");
  assert.equal(customLicense.maxZoom, 22, "case 4: maxZoom filled independently");

  const onlyMinNull = applyGooglePresetDefaults(
    { ...fresh, minZoom: null, maxZoom: 18 },
    d,
  );
  assert.equal(onlyMinNull.minZoom, 0, "min only null → fill min");
  assert.equal(onlyMinNull.maxZoom, 18, "max user value kept");

  // empty All right reserved path: empty license gets default
  const emptyLic = applyGooglePresetDefaults({ ...fresh, license: "" }, d);
  assert.equal(emptyLic.license, GOOGLE_DEFAULT_LICENSE);

  // note: custom note kept; default note (any lang) is still considered default
  const customNote = applyGooglePresetDefaults(
    { ...fresh, licenseNote: { ja: "user wrote this" } },
    d,
  );
  assert.equal(customNote.licenseNote.ja, "user wrote this", "custom note kept");

  const enDefaultInJaDoc = applyGooglePresetDefaults(
    {
      ...fresh,
      licenseNote: { ja: GOOGLE_DEFAULT_LICENSE_NOTE_BY_LANG.en },
    },
    d,
  );
  assert.equal(
    enDefaultInJaDoc.licenseNote.ja,
    d.licenseNote.ja,
    "EN default note text is still treated as Google default and re-applied for defaultLang",
  );

  assert.equal(isGoogleDefaultNote(""), true);
  assert.equal(isGoogleDefaultNote(GOOGLE_DEFAULT_LICENSE_NOTE_BY_LANG.ko), true);
  // 用語集で de の文を改めた後も、保存済みの旧既定 Note は Google 既定として認識する
  assert.equal(isGoogleDefaultNote("Es gelten die Nutzungsbedingungen der Google Maps Platform. Die Attribution muss sichtbar bleiben."), true);
  assert.equal(isGoogleDefaultNote("nope"), false);
  assert.ok(allGoogleDefaultNoteTexts().length >= 22, "11 langs × 2 notes");

  // ---- case 9: Google の地図の帰属表記は読み込み・保存で持たない ----
  // 他の種別では attr-required が残る
  const tmsDoc = { ...fresh, kind: "tms", url: "https://example.org/{z}/{x}/{y}.png", slug: "t1", title: { ja: "T" } };
  assert.equal(validateBaseMapDocument(tmsDoc).errors.includes("attr-required"), true, "case 9: tms は帰属表記が必須のまま");
  // 以前の版で入力できた帰属表記が保存されている Google の地図
  const savedGoogle = fromBaseMapCatalogItem({
    uid,
    scope: "user",
    mapID: "g-saved",
    data: { kind: "google", maptype: "google_satellite", lang: "ja", title: { ja: "G" }, attr: { ja: "勝手な帰属表記" } },
  });
  assert.deepEqual(savedGoogle.attr, {}, "case 9: 読み込みで保存済みの帰属表記を読まない");
  // 種別を Google に切り替える前に入れた帰属表記も保存しない
  const switched = { ...ready, attr: { ja: "切り替える前の帰属表記" } };
  assert.deepEqual(toBaseMapSavePayload(switched, null).tms.attr, {}, "case 9: 保存で帰属表記を出さない");
  const tmsPayload = toBaseMapSavePayload({ ...tmsDoc, attr: { ja: "© Example" } }, null);
  assert.deepEqual(tmsPayload.tms.attr, { ja: "© Example" }, "case 9: tms の帰属表記は保存する");
  // データの帰属表記（dataAttr）も同じ扱い（どちらも Google Maps が返す著作権の表示を使う）
  const savedGoogleData = fromBaseMapCatalogItem({
    uid,
    scope: "user",
    mapID: "g-saved-data",
    data: { kind: "google", maptype: "google_roadmap", lang: "ja", title: { ja: "G" }, dataAttr: { ja: "勝手なデータ帰属" } },
  });
  assert.deepEqual(savedGoogleData.dataAttr, {}, "case 9: 読み込みで保存済みのデータ帰属を読まない");
  assert.deepEqual(toBaseMapSavePayload({ ...ready, dataAttr: { ja: "データ帰属" } }, null).tms.dataAttr, {}, "case 9: 保存でデータ帰属を出さない");
  assert.deepEqual(toBaseMapSavePayload({ ...tmsDoc, attr: { ja: "© Example" }, dataAttr: { ja: "© Data" } }, null).tms.dataAttr, { ja: "© Data" }, "case 9: tms のデータ帰属は保存する");
  // 旧保存形（kind 無し・maptype が google_*）は読み込みで kind を google にそろえ、画面・保存も Google として扱う
  const legacyGoogle = fromBaseMapCatalogItem({
    uid,
    scope: "user",
    mapID: "g-legacy",
    data: { maptype: "google_hybrid", lang: "ja", title: { ja: "G" }, attr: { ja: "旧の帰属表記" }, dataAttr: { ja: "旧のデータ帰属" } },
  });
  assert.equal(legacyGoogle.kind, "google", "case 9: 旧保存形の Google の地図は kind を google にそろえる");
  assert.equal(legacyGoogle.maptype, "google_hybrid", "case 9: 旧保存形の maptype を保つ");
  assert.deepEqual(legacyGoogle.attr, {}, "case 9: 旧保存形の帰属表記を読まない");
  assert.deepEqual(legacyGoogle.dataAttr, {}, "case 9: 旧保存形のデータ帰属を読まない");
  assert.equal(validateBaseMapDocument({ ...legacyGoogle, slug: "g-legacy" }).errors.includes("attr-required"), false, "case 9: 旧保存形も帰属表記を求めない");
  const legacyPayload = toBaseMapSavePayload({ ...legacyGoogle, slug: "g-legacy", attr: { ja: "x" }, dataAttr: { ja: "y" } }, 1);
  assert.equal(legacyPayload.tms.kind, "google", "case 9: 旧保存形は kind: google で保存し直す");
  assert.deepEqual([legacyPayload.tms.attr, legacyPayload.tms.dataAttr], [{}, {}], "case 9: 旧保存形も帰属表記とデータ帰属を保存しない");
  // 判定は kind 優先・旧保存形（kind 無し・maptype が google_*）も Google とみなす
  assert.equal(usesGoogleAttribution({ kind: "google" }), true);
  assert.equal(usesGoogleAttribution({ maptype: "google_hybrid" }), true);
  assert.equal(usesGoogleAttribution({ kind: "tms", maptype: "google_hybrid" }), false);
  assert.equal(usesGoogleAttribution({ kind: "mapbox" }), false);

  // ---- case 8 locales ----
  const localeRoot = path.join(projectRoot, "public/locales");
  const langs = await readdir(localeRoot);
  for (const lang of langs) {
    const loc = JSON.parse(await readFile(path.join(localeRoot, lang, "translation.json"), "utf8"));
    const g = loc?.basemap?.google;
    assert.ok(g, `case 8: ${lang} basemap.google`);
    assert.equal(typeof g.default_license_note, "string", `case 8: ${lang} default_license_note`);
    assert.equal(typeof g.default_data_license_note, "string", `case 8: ${lang} default_data_license_note`);
    assert.ok(g.default_license_note.length > 0);
    assert.ok(g.default_data_license_note.length > 0);
    // parity with module table when lang is a LangCode key
    if (GOOGLE_DEFAULT_LICENSE_NOTE_BY_LANG[lang]) {
      assert.equal(
        g.default_license_note,
        GOOGLE_DEFAULT_LICENSE_NOTE_BY_LANG[lang],
        `case 8: ${lang} license note matches module table`,
      );
      assert.equal(
        g.default_data_license_note,
        GOOGLE_DEFAULT_DATA_LICENSE_NOTE_BY_LANG[lang],
        `case 8: ${lang} data license note matches module table`,
      );
    }
  }

  console.log("google-preset-defaults-smoke: PASS");
} finally {
  await rm(workDir, { recursive: true, force: true });
}
