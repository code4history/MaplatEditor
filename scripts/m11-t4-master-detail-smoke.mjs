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

try {
  await writeFile(
    entryPath,
    [
      `export * from ${modulePath("src/utils/baseMapEditorDocument.ts")};`,
      `export * from ${modulePath("src/utils/imageAssetEditorDocument.ts")};`,
      `export * from ${modulePath("src/utils/masterDetailRouteState.ts")};`,
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
    fromBaseMapCatalogItem,
    fromImageAssetRow,
    mergeMasterDetailQuery,
    newBaseMapDocument,
    newImageAssetDocument,
    resolveBaseMapRuntimeText,
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
  assert.equal(clampScrollTop(-20, 200, 600), 0);

  const routeComposable = await readFile(
    path.join(projectRoot, "src/composables/useMasterDetailRouteState.ts"),
    "utf8",
  );
  assert.match(routeComposable, /select/);
  assert.match(routeComposable, /clearSelection/);
  assert.match(routeComposable, /saveScroll/);
  assert.match(routeComposable, /restoreScroll/);
  assert.match(routeComposable, /mergeMasterDetailQuery/);

  console.log("m11-t4 master-detail smoke: PASS (Part 1 pure contracts)");
} finally {
  await rm(workDir, { recursive: true, force: true });
}
