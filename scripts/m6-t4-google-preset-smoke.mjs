// m6-t4 Google プリセット smoke
// AC1: maptype フィールド / fromBaseMapCatalogItem 正規化 / newBaseMapDocument null
// AC2: validateBaseMapDocument の maptype-required / provider-incomplete 分岐
// AC3: toBaseMapSavePayload の maptype 出力条件
// AC7: createAppSourceFromBaseMap → normalize → compose で google_roadmap が通る
// AC12: 11言語ロケールに Google キーがある
// AC13 相当: m6-t1 smoke 更新対象の分岐をここでも確認
// AC16: 既定サムネイルパスの定数整合（document 値は UI 側。payload thumbnail は別経路）
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "vite";

const projectRoot = path.resolve(new URL("..", import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, ".tmp-smoke");
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, "m6-t4-google-preset-"));
const entryPath = path.join(workDir, "entry.ts");
const outDir = path.join(workDir, "dist");
const modulePath = (relativePath) => JSON.stringify(path.join(projectRoot, relativePath));

const GOOGLE_MAPTYPES = ["google_roadmap", "google_satellite", "google_hybrid", "google_terrain"];

try {
  await writeFile(
    entryPath,
    [
      `export * from ${modulePath("src/utils/baseMapEditorDocument.ts")};`,
      `export * from ${modulePath("src/utils/appSourceModel.ts")};`,
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
    fromBaseMapCatalogItem,
    newBaseMapDocument,
    validateBaseMapDocument,
    toBaseMapSavePayload,
    normalizeGoogleMaptype,
    createAppSourceFromBaseMap,
    normalizeAppSource,
    composeViewerSource,
  } = await import(pathToFileURL(path.join(outDir, "contracts.mjs")).href);

  const uid = "22222222-2222-4222-8222-222222222222";

  // ---- AC1 ----
  const fresh = newBaseMapDocument(uid, "ja");
  assert.equal(fresh.maptype, null, "AC1: newBaseMapDocument は maptype: null");
  assert.equal(fresh.kind, null, "AC1: kind null も維持");

  for (const mt of GOOGLE_MAPTYPES) {
    const loaded = fromBaseMapCatalogItem({
      uid,
      mapID: "g1",
      scope: "user",
      revision: 1,
      data: { lang: "ja", kind: "google", maptype: mt },
    });
    assert.equal(loaded.kind, "google", `AC1: kind google 保持 (${mt})`);
    assert.equal(loaded.maptype, mt, `AC1: maptype ${mt} 保持`);
  }

  // kind が google 以外なら maptype は null
  const tmsLoaded = fromBaseMapCatalogItem({
    uid,
    mapID: "t1",
    scope: "user",
    revision: 1,
    data: { lang: "ja", kind: "tms", maptype: "google_roadmap" },
  });
  assert.equal(tmsLoaded.maptype, null, "AC1: kind!==google では maptype null");

  // 未知 maptype
  const bad = fromBaseMapCatalogItem({
    uid,
    mapID: "g2",
    scope: "user",
    revision: 1,
    data: { lang: "ja", kind: "google", maptype: "google_unknown" },
  });
  assert.equal(bad.maptype, null, "AC1: 未知 maptype は null");
  assert.equal(normalizeGoogleMaptype("google_hybrid", "google"), "google_hybrid");
  assert.equal(normalizeGoogleMaptype("google_hybrid", "tms"), null);

  // ---- AC2 ----
  const baseDoc = {
    ...newBaseMapDocument(uid, "ja"),
    slug: "valid-slug",
    title: { ja: "T" },
    attr: { ja: "© Ex" },
  };
  const googleNoMaptype = validateBaseMapDocument({ ...baseDoc, kind: "google", maptype: null });
  assert.equal(googleNoMaptype.errors.includes("maptype-required"), true, "AC2: google+null → maptype-required");
  assert.equal(googleNoMaptype.errors.includes("provider-incomplete"), false, "AC2: google は provider-incomplete を出さない");
  assert.equal(googleNoMaptype.valid, false);

  const googleOk = validateBaseMapDocument({ ...baseDoc, kind: "google", maptype: "google_roadmap" });
  assert.equal(googleOk.errors.includes("maptype-required"), false, "AC2: maptype 選択済みは maptype-required なし");
  assert.equal(googleOk.errors.includes("provider-incomplete"), false, "AC2: google 選択済みは provider-incomplete なし");

  for (const pk of ["mapbox", "maplibre"]) {
    const v = validateBaseMapDocument({ ...baseDoc, kind: pk, maptype: null });
    assert.equal(v.errors.includes("provider-incomplete"), true, `AC2: ${pk} は provider-incomplete`);
  }

  // ---- AC3 ----
  const payloadGoogle = toBaseMapSavePayload(
    { ...baseDoc, kind: "google", maptype: "google_satellite", thumbnail: "basemap_icons/google_satellite.png" },
    null,
  );
  assert.equal(payloadGoogle.tms.maptype, "google_satellite", "AC3: google は tms.maptype を出力");
  assert.equal(payloadGoogle.tms.kind, "google");

  const payloadTms = toBaseMapSavePayload(
    { ...baseDoc, kind: "tms", maptype: null, url: "https://x/{z}/{x}/{y}.png" },
    null,
  );
  assert.equal("maptype" in payloadTms.tms, false, "AC3: tms は maptype を出力しない");

  // ---- AC7 ----
  // m6-t1 AC13 と同型: master は data を剥がした内部形（mapID/kind/maptype がトップレベル）
  const masterGoogle = {
    mapID: "g-road",
    lang: "ja",
    title: { ja: "G" },
    attr: { ja: "© G" },
    kind: "google",
    maptype: "google_roadmap",
  };
  const appSrc = createAppSourceFromBaseMap(masterGoogle, "ja");
  assert.equal(appSrc.data.kind, "google", "AC7: createAppSourceFromBaseMap が kind を保持");
  const viewer = composeViewerSource(appSrc);
  assert.equal(viewer.maptype, "google_roadmap", "AC7: composeViewerSource が google_roadmap を出力");
  // normalize 経由でも同じ
  const normalized = normalizeAppSource(appSrc);
  assert.equal(composeViewerSource(normalized).maptype, "google_roadmap", "AC7: normalize→compose でも google_roadmap");

  // ---- AC12 ロケール ----
  const localeRoot = path.join(projectRoot, "public/locales");
  const langs = await readdir(localeRoot);
  const requiredGoogleKeys = [
    "preset_label",
    "preset_roadmap",
    "preset_satellite",
    "preset_hybrid",
    "preset_terrain",
    "preset_already_registered",
    "presets_already_registered",
  ];
  for (const lang of langs) {
    const loc = JSON.parse(await readFile(path.join(localeRoot, lang, "translation.json"), "utf8"));
    const g = loc?.basemap?.google;
    assert.ok(g, `AC12: ${lang} basemap.google`);
    for (const k of requiredGoogleKeys) {
      assert.equal(typeof g[k], "string", `AC12: ${lang} google.${k}`);
      assert.ok(g[k].length > 0, `AC12: ${lang} google.${k} non-empty`);
    }
    assert.equal(typeof loc.basemap.errors.maptype_required, "string", `AC12: ${lang} maptype_required`);
  }

  // ---- icons exist ----
  for (const suffix of ["roadmap", "satellite", "hybrid", "terrain"]) {
    const icon = path.join(projectRoot, "public/basemap_icons", `google_${suffix}.png`);
    const buf = await readFile(icon);
    assert.ok(buf.length > 0, `icon google_${suffix}.png exists`);
  }

  console.log("m6-t4-google-preset-smoke: PASS");
} finally {
  await rm(workDir, { recursive: true, force: true });
}
