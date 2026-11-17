// Google プリセット既定値 smoke
// case 1-4: build / apply / 上書きポリシー
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
    GOOGLE_DEFAULT_ATTR,
    GOOGLE_DEFAULT_LICENSE,
    GOOGLE_DEFAULT_MIN_ZOOM,
    GOOGLE_DEFAULT_MAX_ZOOM,
    GOOGLE_DEFAULT_LICENSE_NOTE_BY_LANG,
    GOOGLE_DEFAULT_DATA_LICENSE_NOTE_BY_LANG,
    allGoogleDefaultNoteTexts,
    buildGooglePresetDefaults,
    applyGooglePresetDefaults,
    isGoogleDefaultAttr,
    isGoogleDefaultNote,
    newBaseMapDocument,
    validateBaseMapDocument,
  } = await import(pathToFileURL(path.join(outDir, "contracts.mjs")).href);

  const uid = "33333333-3333-4333-8333-333333333333";

  // ---- case 1 ----
  const d = buildGooglePresetDefaults("ja");
  assert.equal(d.attr.ja, GOOGLE_DEFAULT_ATTR, "case 1: attr © Google");
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
  assert.equal(applied.attr.ja, GOOGLE_DEFAULT_ATTR, "case 2: attr filled");
  assert.equal(applied.license, GOOGLE_DEFAULT_LICENSE, "case 2: license filled");
  assert.equal(applied.dataLicense, GOOGLE_DEFAULT_LICENSE, "case 2: dataLicense filled");
  assert.equal(applied.minZoom, 0, "case 2: minZoom");
  assert.equal(applied.maxZoom, 22, "case 2: maxZoom");
  assert.equal(applied.licenseNote.ja, d.licenseNote.ja, "case 2: licenseNote");
  assert.equal(applied.dataLicenseNote.ja, d.dataLicenseNote.ja, "case 2: dataLicenseNote");

  // validate after maptype + defaults
  const ready = { ...applied, kind: "google", maptype: "google_roadmap", slug: "g1", title: { ja: "G" } };
  const v = validateBaseMapDocument(ready);
  assert.equal(v.errors.includes("attr-required"), false, "case 2: attr-required cleared");
  assert.equal(v.errors.includes("maptype-required"), false);

  // ---- case 3: custom attr preserved ----
  const customAttr = applyGooglePresetDefaults(
    { ...fresh, attr: { ja: "My Custom Attr" } },
    d,
  );
  assert.equal(customAttr.attr.ja, "My Custom Attr", "case 3: custom attr kept");

  // Google default attr is re-applied (still default)
  const keepDefaultAttr = applyGooglePresetDefaults(
    { ...fresh, attr: { ja: GOOGLE_DEFAULT_ATTR } },
    d,
  );
  assert.equal(keepDefaultAttr.attr.ja, GOOGLE_DEFAULT_ATTR, "case 3b: default attr still default");

  // ---- case 4: non-empty license / non-null zoom preserved; per-field zoom () ----
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

  assert.equal(isGoogleDefaultAttr(""), true);
  assert.equal(isGoogleDefaultAttr(GOOGLE_DEFAULT_ATTR), true);
  assert.equal(isGoogleDefaultAttr("x"), false);
  assert.equal(isGoogleDefaultNote(""), true);
  assert.equal(isGoogleDefaultNote(GOOGLE_DEFAULT_LICENSE_NOTE_BY_LANG.ko), true);
  // 用語集で de の文を改めた後も、保存済みの旧既定 Note は Google 既定として認識する
  assert.equal(isGoogleDefaultNote("Es gelten die Nutzungsbedingungen der Google Maps Platform. Die Attribution muss sichtbar bleiben."), true);
  assert.equal(isGoogleDefaultNote("nope"), false);
  assert.ok(allGoogleDefaultNoteTexts().length >= 22, "11 langs × 2 notes");

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
