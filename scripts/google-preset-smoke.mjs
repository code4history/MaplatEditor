// Google プリセット smoke
// case 1: maptype フィールド / fromBaseMapCatalogItem 正規化 / newBaseMapDocument null
// case 2: validateBaseMapDocument の maptype-required / provider-incomplete 分岐
// case 3: toBaseMapSavePayload の maptype 出力条件
// case 7: createAppSourceFromBaseMap → normalize → compose で google_roadmap が通る
// case 12: 11言語ロケールに Google キーがある
// case 13 相当: smoke 更新対象の分岐をここでも確認
// case 16: 既定サムネイルパスの定数整合（document 値は UI 側。payload thumbnail は別経路）
// case 3: icons exist ブロックへ単色プレースホルダ検出・寸法検証を追加
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "vite";
// 512px は webp。webp/非 webp を同じ規則で読む共通リーダーを使う
import { readImageRGBA } from "./lib/webpAssets.mjs";

const projectRoot = path.resolve(new URL("..", import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, ".tmp-smoke");
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, "google-preset-"));
const entryPath = path.join(workDir, "entry.ts");
const outDir = path.join(workDir, "dist");
const modulePath = (relativePath) => JSON.stringify(path.join(projectRoot, relativePath));

const GOOGLE_MAPTYPES = ["google_roadmap", "google_satellite", "google_hybrid", "google_terrain"];

// 単色プレースホルダでないことの検証（6x6 グリッドサンプルで distinct 色数を数える）
async function assertNotSolidColor(filePath, label) {
  // 512px は webp。Jimp は webp を decode できないため共通リーダーへ委譲する
  const img = await readImageRGBA(filePath);
  const { width, height } = img;
  const seen = new Set();
  const steps = 6;
  for (let i = 0; i < steps; i++) {
    for (let j = 0; j < steps; j++) {
      const x = Math.min(width - 1, Math.floor((width / steps) * i));
      const y = Math.min(height - 1, Math.floor((height / steps) * j));
      seen.add(img.getPixelColor(x, y));
    }
  }
  assert.ok(seen.size >= 4, `${label}: 単色プレースホルダの疑い（distinct=${seen.size}）`);
}

// 寸法検証（assertNotSolidColor とは独立に読み直す）
async function assertDimensions(filePath, expected, label) {
  const img = await readImageRGBA(filePath);
  const { width, height } = img;
  assert.equal(width, expected, `${label}: 幅が ${expected}px でない（実測 ${width}px）`);
  assert.equal(height, expected, `${label}: 高さが ${expected}px でない（実測 ${height}px）`);
}

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
    composeBaseMapSettingFile,
    createBaseMapMasterLookup,
  } = await import(pathToFileURL(path.join(outDir, "contracts.mjs")).href);

  const uid = "22222222-2222-4222-8222-222222222222";

  // ---- case 1 ----
  const fresh = newBaseMapDocument(uid, "ja");
  assert.equal(fresh.maptype, null, "case 1: newBaseMapDocument は maptype: null");
  assert.equal(fresh.kind, null, "case 1: kind null も維持");

  for (const mt of GOOGLE_MAPTYPES) {
    const loaded = fromBaseMapCatalogItem({
      uid,
      mapID: "g1",
      scope: "user",
      revision: 1,
      data: { lang: "ja", kind: "google", maptype: mt },
    });
    assert.equal(loaded.kind, "google", `case 1: kind google 保持 (${mt})`);
    assert.equal(loaded.maptype, mt, `case 1: maptype ${mt} 保持`);
  }

  // kind が google 以外なら maptype は null
  const tmsLoaded = fromBaseMapCatalogItem({
    uid,
    mapID: "t1",
    scope: "user",
    revision: 1,
    data: { lang: "ja", kind: "tms", maptype: "google_roadmap" },
  });
  assert.equal(tmsLoaded.maptype, null, "case 1: kind!==google では maptype null");

  // 未知 maptype
  const bad = fromBaseMapCatalogItem({
    uid,
    mapID: "g2",
    scope: "user",
    revision: 1,
    data: { lang: "ja", kind: "google", maptype: "google_unknown" },
  });
  assert.equal(bad.maptype, null, "case 1: 未知 maptype は null");
  assert.equal(normalizeGoogleMaptype("google_hybrid", "google"), "google_hybrid");
  assert.equal(normalizeGoogleMaptype("google_hybrid", "tms"), null);

  // ---- case 2 ----
  const baseDoc = {
    ...newBaseMapDocument(uid, "ja"),
    slug: "valid-slug",
    title: { ja: "T" },
    attr: { ja: "© Ex" },
  };
  const googleNoMaptype = validateBaseMapDocument({ ...baseDoc, kind: "google", maptype: null });
  assert.equal(googleNoMaptype.errors.includes("maptype-required"), true, "case 2: google+null → maptype-required");
  assert.equal(googleNoMaptype.errors.includes("provider-incomplete"), false, "case 2: google は provider-incomplete を出さない");
  assert.equal(googleNoMaptype.valid, false);

  const googleOk = validateBaseMapDocument({ ...baseDoc, kind: "google", maptype: "google_roadmap" });
  assert.equal(googleOk.errors.includes("maptype-required"), false, "case 2: maptype 選択済みは maptype-required なし");
  assert.equal(googleOk.errors.includes("provider-incomplete"), false, "case 2: google 選択済みは provider-incomplete なし");

  for (const pk of ["mapbox", "maplibre"]) {
    const v = validateBaseMapDocument({ ...baseDoc, kind: pk, maptype: null, style: null });
    assert.equal(v.errors.includes("style-required"), true, `case 2: ${pk} は style-required (style-required へ置換済み)`);
    assert.equal(v.errors.includes("provider-incomplete"), false, `case 2: ${pk} は provider-incomplete を出さない`);
  }

  // ---- case 3 ----
  const payloadGoogle = toBaseMapSavePayload(
    { ...baseDoc, kind: "google", maptype: "google_satellite", thumbnail: "basemap_icons/google_satellite.png" },
    null,
  );
  assert.equal(payloadGoogle.tms.maptype, "google_satellite", "case 3: google は tms.maptype を出力");
  assert.equal(payloadGoogle.tms.kind, "google");

  const payloadTms = toBaseMapSavePayload(
    { ...baseDoc, kind: "tms", maptype: null, url: "https://x/{z}/{x}/{y}.png" },
    null,
  );
  assert.equal("maptype" in payloadTms.tms, false, "case 3: tms は maptype を出力しない");

  // ---- case 7 ----
  // 以前の書き出しの検査と同型: master は data を剥がした内部形（mapID/kind/maptype がトップレベル）
  const masterGoogle = {
    mapID: "g-road",
    lang: "ja",
    title: { ja: "G" },
    attr: { ja: "© G" },
    kind: "google",
    maptype: "google_roadmap",
  };
  // google_roadmap の運び先はアプリ JSON から設定ファイルへ移った。
  // 「create → 連鎖の末端まで google_roadmap が生きる」という case 7 の趣旨は維持する。
  const masterGoogleItem = { uid: "uid-google", mapID: "google-master", data: { mapID: "google-master", ...masterGoogle } };
  const lookup = createBaseMapMasterLookup([masterGoogleItem]);
  const appSrc = createAppSourceFromBaseMap(masterGoogleItem, "ja");
  assert.equal(appSrc.baseMapUid, "uid-google", "case 7: createAppSourceFromBaseMap が参照を持つ");
  const viewer = composeViewerSource(appSrc, { lookup });
  assert.equal("maptype" in viewer, false, "case 7: アプリ JSON に maptype は出さない");
  assert.equal(viewer.settingFile, "maps/google-master.json", "case 7: 設定ファイル参照を出す");
  assert.equal(
    composeBaseMapSettingFile(masterGoogleItem, appSrc.role).maptype,
    "google_roadmap",
    "case 7: 設定ファイル側が google_roadmap を出力",
  );
  // normalize 経由でも同じ
  const normalized = normalizeAppSource(appSrc);
  assert.equal("maptype" in composeViewerSource(normalized, { lookup }), false, "case 7: normalize→compose でも maptype は出ない");

  // ---- case 12 ロケール ----
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
    assert.ok(g, `case 12: ${lang} basemap.google`);
    for (const k of requiredGoogleKeys) {
      assert.equal(typeof g[k], "string", `case 12: ${lang} google.${k}`);
      assert.ok(g[k].length > 0, `case 12: ${lang} google.${k} non-empty`);
    }
    assert.equal(typeof loc.basemap.errors.maptype_required, "string", `case 12: ${lang} maptype_required`);
  }

  // ---- icons exist ----
  for (const suffix of ["roadmap", "satellite", "hybrid", "terrain"]) {
    const icon = path.join(projectRoot, "public/basemap_icons", `google_${suffix}.png`);
    const buf = await readFile(icon);
    assert.ok(buf.length > 0, `icon google_${suffix}.png exists`);
  }

  // ---- 単色プレースホルダでないこと・52px寸法（basemap_icons/） ----
  for (const suffix of ["roadmap", "satellite", "hybrid", "terrain"]) {
    const icon = path.join(projectRoot, "public/basemap_icons", `google_${suffix}.png`);
    await assertNotSolidColor(icon, `google_${suffix}.png (52px)`);
    await assertDimensions(icon, 52, `google_${suffix}.png (52px)`);
  }

  // ---- case 9: 単色プレースホルダでないこと・512px寸法（basemap_icons_512/） ----
  for (const suffix of ["roadmap", "satellite", "hybrid", "terrain"]) {
    const icon512 = path.join(projectRoot, "public/basemap_icons_512", `google_${suffix}.webp`);
    const stat512 = await import("node:fs/promises").then(({ stat }) => stat(icon512));
    assert.equal(stat512.isFile(), true, `google_${suffix}.png (512px) 存在`);
    await assertNotSolidColor(icon512, `google_${suffix}.png (512px)`);
    await assertDimensions(icon512, 512, `google_${suffix}.png (512px)`);
  }

  console.log("google-preset-smoke: PASS");
} finally {
  await rm(workDir, { recursive: true, force: true });
}
