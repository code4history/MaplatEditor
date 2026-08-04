import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "vite";

const projectRoot = path.resolve(new URL("..", import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, ".tmp-smoke");
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, "m11-t4-master-detail-"));
const entryPath = path.join(workDir, "entry.ts");
const outDir = path.join(workDir, "dist");

const modulePath = (relativePath) => JSON.stringify(path.join(projectRoot, relativePath));

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...body] = rows;
  return body.filter((values) => values.some(Boolean)).map((values) =>
    Object.fromEntries(header.map((key, index) => [key, values[index] ?? ""])),
  );
}

try {
  await writeFile(
    entryPath,
    [
      `export * from ${modulePath("src/utils/baseMapEditorDocument.ts")};`,
      `export * from ${modulePath("src/utils/imageAssetEditorDocument.ts")};`,
      `export * from ${modulePath("src/utils/masterDetailRouteState.ts")};`,
      `export * from ${modulePath("src/utils/baseMapCatalogFilter.ts")};`,
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
      lib: {
        entry: entryPath,
        formats: ["es"],
        fileName: () => "contracts.mjs",
      },
    },
  });

  const {
    applyImageAssetDraft,
    clampScrollTop,
    composeViewerSource,
    createAppSourceFromBaseMap,
    fromBaseMapCatalogItem,
    fromImageAssetRow,
    filterBaseMapCatalog,
    mergeMasterDetailQuery,
    mergeMasterDetailFilters,
    newBaseMapDocument,
    newImageAssetDocument,
    normalizeAppSource,
    resolveBaseMapRuntimeText,
    resolveBaseMapLayerMetadata,
    resolveBaseMapSelectorText,
    parseBaseMapBboxQuery,
    serializeBaseMapBboxQuery,
    toBaseMapSavePayload,
    toImageAssetDraft,
    validateBaseMapDocument,
    validateImageAssetDocument,
  } = await import(pathToFileURL(path.join(outDir, "contracts.mjs")).href);

  const uid = "11111111-1111-4111-8111-111111111111";
  const base = fromBaseMapCatalogItem({
    uid,
    mapID: "custom",
    scope: "user",
    revision: 3,
    data: {
      lang: "en",
      title: "Title",
      attr: { ja: "帰属" },
      url: "https://x/{z}/{x}/{y}.png",
    },
  });
  assert.deepEqual(base.title, { en: "Title" });
  assert.equal(base.defaultLang, "en");
  assert.deepEqual(base.label, { en: "Title" });
  assert.equal(resolveBaseMapRuntimeText(base.title, "de", "en"), "Title");
  assert.deepEqual(toBaseMapSavePayload(base, 3), {
    uid,
    slug: "custom",
    expectedRevision: 3,
    tms: {
      kind: "tms", // m6-t1: kind は読み込み時 "tms" へ正規化され、保存時 tms.kind として永続化される
      lang: "en",
      title: { en: "Title" },
      label: { en: "Title" },
      attr: { ja: "帰属" },
      url: "https://x/{z}/{x}/{y}.png",
      minZoom: null,
      maxZoom: null,
      thumbnail: "",
      coverageLngLats: null,
    },
  });

  const emptyBase = newBaseMapDocument(uid, "fr");
  assert.equal(emptyBase.defaultLang, "fr");
  assert.equal(validateBaseMapDocument(emptyBase).valid, false);
  const newBasePayload = toBaseMapSavePayload(
    {
      ...emptyBase,
      slug: "nouveau-fond",
      title: { fr: "Nouveau fond" },
      label: { fr: "Nouveau fond" },
      url: "https://example.test/{z}/{x}/{y}.png",
    },
    null,
  );
  assert.equal("uid" in newBasePayload, false);
  assert.equal("expectedRevision" in newBasePayload, false);
  assert.deepEqual(
    toBaseMapSavePayload({ ...emptyBase, slug: "title-fallback", title: { fr: "Titre" }, label: {} }, null).tms.label,
    { fr: "Titre" },
  );
  assert.deepEqual(
    toBaseMapSavePayload({ ...emptyBase, slug: "preserve-label", title: { fr: "Titre" }, label: { fr: "Court" } }, null).tms.label,
    { fr: "Court" },
  );
  assert.equal(
    validateBaseMapDocument({
      ...emptyBase,
      slug: "invalid slug",
      title: { fr: "Titre" },
      url: "https://example.test/static.png",
      minZoom: -1,
      maxZoom: 26,
    }).valid,
    false,
  );

  const asset = fromImageAssetRow({
    uid,
    slug: "photo",
    lang: "ja",
    title: { ja: "写真" },
    sourceName: null,
    mime: "image/png",
    ext: "png",
    width: 10,
    height: 20,
    byteSize: 100,
    revision: 2,
    updatedAt: "2026-07-14T00:00:00.000Z",
  });
  assert.equal(asset.defaultLang, "ja");
  assert.deepEqual(toImageAssetDraft(asset), {
    uid,
    defaultLang: "ja",
    slug: "photo",
    title: { ja: "写真" },
  });
  assert.equal(JSON.stringify(toImageAssetDraft(asset)).includes("sourcePath"), false);
  assert.deepEqual(
    applyImageAssetDraft(asset, { ...toImageAssetDraft(asset), title: { ja: "更新" } }),
    { ...asset, title: { ja: "更新" } },
  );

  const emptyAsset = newImageAssetDocument(uid, "de");
  assert.equal(emptyAsset.defaultLang, "de");
  assert.equal(validateImageAssetDocument(emptyAsset, false).valid, false);
  assert.equal(
    validateImageAssetDocument({ ...emptyAsset, slug: "invalid slug", title: { de: "Bild" } }, true).valid,
    false,
  );

  assert.deepEqual(
    mergeMasterDetailQuery({ q: "himeji", page: "2" }, { uid }),
    { q: "himeji", page: "2", uid },
  );
  assert.deepEqual(
    mergeMasterDetailQuery({ q: "himeji", uid, new: "1" }, { uid: null }),
    { q: "himeji" },
  );
  assert.deepEqual(
    mergeMasterDetailQuery({ q: "himeji" }, { uid, isNew: true }),
    { q: "himeji", uid, new: "1" },
  );
  assert.equal(clampScrollTop(500, 200, 600), 400);

  const worldBaseMap = {
    uid: "world",
    mapID: "osm",
    scope: "builtin",
    revision: 0,
    data: {
      title: { ja: "OpenStreetMap", en: "OpenStreetMap" },
      label: { ja: "OSM", en: "OSM" },
      attr: { en: "OpenStreetMap contributors" },
      url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    },
  };
  const himejiBaseMap = {
    uid: "himeji",
    mapID: "himeji-old",
    scope: "user",
    revision: 1,
    data: {
      title: { ja: "姫路古地図", en: "Historic Himeji" },
      label: { ja: "姫路", en: "Himeji" },
      attr: { ja: "姫路市立城郭研究室" },
      url: "https://example.test/himeji/{z}/{x}/{y}.png",
      coverageLngLats: [[134.5, 34.5], [135, 34.5], [135, 35], [134.5, 35]],
    },
  };
  assert.deepEqual(filterBaseMapCatalog([worldBaseMap, himejiBaseMap], "城郭", null).map((item) => item.uid), ["himeji"]);
  assert.deepEqual(filterBaseMapCatalog([worldBaseMap, himejiBaseMap], "historic", null).map((item) => item.uid), ["himeji"]);
  assert.deepEqual(filterBaseMapCatalog([worldBaseMap, himejiBaseMap], "", [134.7, 34.7, 134.8, 34.8]).map((item) => item.uid), ["world", "himeji"]);
  assert.deepEqual(filterBaseMapCatalog([worldBaseMap, himejiBaseMap], "", [140, 40, 141, 41]).map((item) => item.uid), ["world"]);
  assert.deepEqual(parseBaseMapBboxQuery("134.7,34.7,134.8,34.8"), [134.7, 34.7, 134.8, 34.8]);
  assert.equal(parseBaseMapBboxQuery("134.8,34.8,134.7,34.7"), null);
  assert.equal(parseBaseMapBboxQuery("181,34,182,35"), null);
  assert.equal(serializeBaseMapBboxQuery([134.7, 34.7, 134.8, 34.8]), "134.7,34.7,134.8,34.8");
  assert.deepEqual(
    mergeMasterDetailFilters({ uid: "world", page: "2" }, { q: "gsi", bbox: null }),
    { uid: "world", page: "2", q: "gsi" },
  );
  assert.equal(clampScrollTop(-20, 200, 600), 0);

  const master = {
    mapID: "custom",
    lang: "en",
    title: { ja: "地図", en: "Map" },
    label: { ja: "地図ラベル", en: "Map label" },
    attr: { ja: "帰属", en: "Attribution" },
    url: "https://x/{z}/{x}/{y}.png",
    coverageLngLats: [[135, 34], [136, 34], [136, 35], [135, 35]],
  };
  const appSource = createAppSourceFromBaseMap(master, "ja");
  assert.equal(resolveBaseMapSelectorText(master, "ja"), "地図ラベル");
  assert.equal(resolveBaseMapSelectorText(master, "en"), "Map label");
  assert.deepEqual(appSource.label, master.label);
  assert.notEqual(appSource.label, master.label);
  assert.equal(appSource.title, "地図");
  assert.equal(appSource.data.defaultLang, "ja");
  const runtimeSource = composeViewerSource(appSource, { lang: "ja" });
  assert.equal(runtimeSource.title, "地図");
  assert.equal(runtimeSource.attr, "帰属");
  assert.equal("coverageLngLats" in runtimeSource, false);
  assert.equal("defaultLang" in runtimeSource, false);
  assert.deepEqual(resolveBaseMapLayerMetadata(master, "ja"), { title: "地図", attr: "帰属" });
  const builtinMaster = {
    mapID: "osm",
    lang: "en",
    title: { ja: "OpenStreetMap", en: "OpenStreetMap" },
    label: { ja: "OpenStreetMap", en: "OpenStreetMap" },
  };
  const builtinSource = createAppSourceFromBaseMap(builtinMaster, "ja");
  assert.deepEqual(builtinSource.label, builtinMaster.label);
  assert.notEqual(builtinSource.label, builtinMaster.label);
  assert.equal(builtinSource.data.defaultLang, "ja");
  assert.equal(composeViewerSource(builtinSource, { lang: "ja" }), "osm");
  assert.deepEqual(normalizeAppSource(builtinSource, "ja").label, builtinMaster.label);

  const routeComposable = await readFile(
    path.join(projectRoot, "src/composables/useMasterDetailRouteState.ts"),
    "utf8",
  );
  assert.match(routeComposable, /select/);
  assert.match(routeComposable, /clearSelection/);
  assert.match(routeComposable, /saveScroll/);
  assert.match(routeComposable, /restoreScroll/);
  assert.match(routeComposable, /mergeMasterDetailQuery/);

  const generatorSource = await readFile(
    path.join(projectRoot, "scripts/generate-builtin-basemaps.mjs"),
    "utf8",
  );
  assert.match(generatorSource, /export function buildBuiltinBaseMaps/);
  assert.match(generatorSource, /--data-only/);
  assert.doesNotMatch(generatorSource, /rm\(iconOutputDir/);

  const catalog = JSON.parse(
    await readFile(path.resolve(projectRoot, "../Playground/KTGIS/ktgis-maplat-catalog.json"), "utf8"),
  );
  const regions = new Map();
  for (const row of catalog.rows) {
    assert.equal(typeof row.regionEn, "string", `regionEn missing: ${row.region}`);
    assert.ok(row.regionEn.trim(), `regionEn empty: ${row.region}`);
    if (regions.has(row.region)) assert.equal(regions.get(row.region), row.regionEn);
    else regions.set(row.region, row.regionEn);
  }
  assert.equal(regions.size, 59);
  const { buildBuiltinBaseMaps } = await import(
    `${pathToFileURL(path.join(projectRoot, "scripts/generate-builtin-basemaps.mjs")).href}?smoke=${Date.now()}`
  );
  const legacyList = JSON.parse(
    await readFile(path.join(projectRoot, "electron/tms_list.json"), "utf8"),
  );
  const generatedBuiltins = buildBuiltinBaseMaps(catalog, legacyList);
  assert.equal(generatedBuiltins.length, 329);
  const goldenRows = parseCsv(
    await readFile(path.join(projectRoot, "tests/fixtures/m11-t4-builtin-label-review.csv"), "utf8"),
  );
  assert.equal(goldenRows.length, 329);
  const goldenByMapID = new Map(goldenRows.map((row) => [row.mapID, row]));
  assert.equal(goldenByMapID.size, 329);
  for (const entry of generatedBuiltins) {
    const golden = goldenByMapID.get(entry.mapID);
    assert.ok(golden, `golden row missing: ${entry.mapID}`);
    assert.equal(entry.title.ja, golden.title_ja, `${entry.mapID}: title.ja`);
    assert.equal(entry.title.en, golden.title_en, `${entry.mapID}: title.en`);
    assert.equal(entry.label.ja, golden.label_ja, `${entry.mapID}: label.ja`);
    assert.equal(entry.label.en, golden.label_en, `${entry.mapID}: label.en`);
  }
  assert.equal(new Set(generatedBuiltins.map((entry) => entry.label.ja)).size, 329);
  assert.equal(new Set(generatedBuiltins.map((entry) => entry.label.en)).size, 329);
  assert.equal(generatedBuiltins.filter((entry) => entry.label.ja.length > 12).length, 0);
  const generatedOsm = generatedBuiltins.find((entry) => entry.mapID === "osm");
  assert.equal(Object.keys(generatedOsm.label).length, 11);
  assert.ok(Object.values(generatedOsm.label).every((label) => label === "OSM"));
  assert.equal(generatedBuiltins.find((entry) => entry.mapID === "nagasaki03").url.includes("/nagasaki/03/"), true);
  assert.equal(generatedBuiltins.find((entry) => entry.mapID === "nagasaki04").url.includes("/nagasaki/04/"), true);
  const missingRegionCatalog = structuredClone(catalog);
  delete missingRegionCatalog.rows[0].regionEn;
  assert.throws(
    () => buildBuiltinBaseMaps(missingRegionCatalog, legacyList),
    /regionEn missing/,
  );
  const duplicateMapIDCatalog = structuredClone(catalog);
  duplicateMapIDCatalog.rows.push(structuredClone(duplicateMapIDCatalog.rows[0]));
  assert.throws(
    () => buildBuiltinBaseMaps(duplicateMapIDCatalog, legacyList),
    /catalog Base Map mapID must be unique/,
  );

  const builtins = JSON.parse(
    await readFile(path.join(projectRoot, "electron/builtin_base_maps.json"), "utf8"),
  );
  const osmBuiltin = builtins.find((entry) => entry.mapID === "osm");
  assert.equal(osmBuiltin.lang, "en");
  assert.equal(Object.keys(osmBuiltin.title).length, 11);
  for (const entry of builtins.filter((item) => item.mapID !== "osm")) {
    assert.equal(entry.lang, "en");
    assert.deepEqual(Object.keys(entry.title).sort(), ["en", "ja"]);
    assert.deepEqual(entry.label, generatedBuiltins.find((generated) => generated.mapID === entry.mapID).label);
  }

  for (const tmsPath of ["electron/tms_list.json", "public/tms_list.json"]) {
    const tmsList = JSON.parse(await readFile(path.join(projectRoot, tmsPath), "utf8"));
    assert.equal(tmsList.filter((entry) => entry.mapID === "nagasaki03").length, 1, `${tmsPath}: nagasaki03`);
    assert.equal(tmsList.filter((entry) => entry.mapID === "nagasaki04").length, 1, `${tmsPath}: nagasaki04`);
    assert.equal(tmsList.find((entry) => entry.mapID === "nagasaki04").url.includes("/nagasaki/04/"), true);
  }

  const baseMapShell = await readFile(
    path.join(projectRoot, "src/views/BaseMapList.vue"),
    "utf8",
  );
  const appEditor = await readFile(path.join(projectRoot, "src/views/AppEdit.vue"), "utf8");
  assert.doesNotMatch(appEditor, /String\(item\.data\?\.(?:title|label)/);
  assert.doesNotMatch(appEditor, /source\.title\s*=\s*baseMapTitle/);
  assert.match(appEditor, /resolveBaseMapSelectorText/);
  const baseMapMasterList = await readFile(
    path.join(projectRoot, "src/components/basemap/BaseMapMasterList.vue"),
    "utf8",
  );
  const baseMapEditor = await readFile(
    path.join(projectRoot, "src/components/basemap/BaseMapEdit.vue"),
    "utf8",
  );
  assert.match(baseMapShell, /BaseMapMasterList/);
  assert.match(baseMapShell, /BaseMapEdit/);
  assert.match(baseMapShell, /useMasterDetailRouteState/);
  assert.match(baseMapShell, /data-master-detail/);
  assert.match(baseMapShell, /notFound/);
  assert.doesNotMatch(baseMapShell, /modal show d-block/);
  assert.match(baseMapMasterList, /draft_badge/);
  assert.match(baseMapMasterList, /btn-outline-primary/);
  assert.match(baseMapMasterList, /basemap-search/);
  assert.match(baseMapMasterList, /basemap-range-filter/);
  assert.match(baseMapMasterList, /basemap-range-clear/);
  // M11-T6 D7: 一覧の新規追加ボタンは resource_list.new_item へ集約（値は editor_ui.new_item と同一「新規追加」）
  assert.match(baseMapMasterList, /resource_list\.new_item/);
  assert.match(baseMapShell, /EnvelopeEditorModal/);
  assert.match(baseMapShell, /mergeMasterDetailFilters/);
  assert.match(baseMapEditor, /EditorActionHeader/);
  assert.match(baseMapEditor, /EditorBusyOverlay/);
  assert.match(baseMapEditor, /LangResourceInput/);
  assert.match(baseMapEditor, /useAssetDraftLifecycle/);
  assert.match(baseMapEditor, /UndoStack/);
  assert.match(baseMapEditor, /shouldPersist/);
  assert.match(baseMapEditor, /conflictRevision/);
  assert.match(baseMapEditor, /reloadLatest/);
  assert.match(baseMapEditor, /keepCurrentEdit/);
  assert.match(baseMapEditor, /sessionTransition/);
  assert.match(baseMapEditor, /pendingSavedIdentity/);
  assert.match(baseMapEditor, /onEditorKeydown/);
  assert.match(baseMapEditor, /key === "y"/);
  assert.match(baseMapEditor, /event\.shiftKey/);
  assert.match(baseMapEditor, /translationMode/);
  assert.match(baseMapEditor, /:disabled="structuralDisabled"/);

  const assetShell = await readFile(
    path.join(projectRoot, "src/views/AssetList.vue"),
    "utf8",
  );
  const assetMasterList = await readFile(
    path.join(projectRoot, "src/components/assets/AssetMasterList.vue"),
    "utf8",
  );
  const assetEditor = await readFile(
    path.join(projectRoot, "src/components/assets/AssetEdit.vue"),
    "utf8",
  );
  assert.match(assetShell, /AssetMasterList/);
  assert.match(assetShell, /AssetEdit/);
  assert.match(assetShell, /useMasterDetailRouteState/);
  assert.doesNotMatch(assetShell, /modal show d-block/);
  assert.match(assetMasterList, /useAssetThumbnails/);
  assert.match(assetMasterList, /btn-outline-primary/);
  // M11-T6 D7: 新規追加ボタンは resource_list.new_item へ集約（値は editor_ui.new_item と同一「新規追加」）
  assert.match(assetMasterList, /resource_list\.new_item/);
  assert.match(assetEditor, /EditorActionHeader/);
  assert.match(assetEditor, /EditorBusyOverlay/);
  assert.match(assetEditor, /pickImageFile/);
  assert.match(assetEditor, /sourcePath/);
  assert.match(assetEditor, /toImageAssetDraft/);
  assert.match(assetEditor, /pendingSavedIdentity/);
  const draftSerializer = assetEditor.match(/serialize:[\s\S]*?apply:/)?.[0] ?? "";
  assert.doesNotMatch(draftSerializer, /sourcePath/);

  const routerSource = await readFile(path.join(projectRoot, "src/router/index.ts"), "utf8");
  assert.match(routerSource, /uid\/new\/q\/bbox\/page/);

  console.log("m11-t4 master-detail smoke: PASS (Part 1 pure contracts)");
} finally {
  await rm(workDir, { recursive: true, force: true });
}
