import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { build } from "vite";

const projectRoot = path.resolve(new URL("..", import.meta.url).pathname);
const read = (relativePath) => readFile(path.join(projectRoot, relativePath), "utf8");
const scratchRoot = path.join(projectRoot, ".tmp-smoke");
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, "t8b-search-"));
const entryFile = path.join(workDir, "entry.ts");
const outFile = path.join(workDir, "dist", "entry.mjs");

await writeFile(entryFile, `
import assert from "node:assert/strict";
import { WEB_MERCATOR_MAX_LAT, mercatorBboxToWgs84, wgs84BboxToMercator } from ${JSON.stringify(path.join(projectRoot, "electron/utils/webMercator.ts"))};
import { filterBaseMapsByBbox, filterDocsByExtentSlugs } from ${JSON.stringify(path.join(projectRoot, "electron/utils/searchSpatial.ts"))};
import { useInfiniteResourceList } from ${JSON.stringify(path.join(projectRoot, "src/composables/useInfiniteResourceList.ts"))};

const world = wgs84BboxToMercator([-180, -90, 180, 90]);
assert.ok(world.every(Number.isFinite), "極を含むWGS84 bboxも有限値へclampする");
const roundTrip = mercatorBboxToWgs84(world);
assert.ok(Math.abs(roundTrip[1] + WEB_MERCATOR_MAX_LAT) < 1e-6);
assert.ok(Math.abs(roundTrip[3] - WEB_MERCATOR_MAX_LAT) < 1e-6);

const poiDocs = [
  { uid: "uid-a", slug: "inside" },
  { uid: "inside", slug: "outside" },
];
assert.deepEqual(filterDocsByExtentSlugs(poiDocs, ["inside"], (doc) => doc.slug), [poiDocs[0]], "POIはuidではなくslugで照合する");

const bbox = [130, 30, 140, 40] as [number, number, number, number];
const global = { uid: "global", data: {} };
const inside = { uid: "inside", data: { coverageLngLats: [[135, 35], [136, 36]] } };
const outside = { uid: "outside", data: { coverageLngLats: [[10, 10], [11, 11]] } };
assert.deepEqual(filterBaseMapsByBbox([global, inside, outside], bbox), [global, inside], "coverage未設定は全世界、設定済みは交差判定する");

let release!: (value: { items: Array<{ uid: string }>; total: number; nextCursor: null }) => void;
const deferredAdapter = {
  load: () => new Promise<{ items: Array<{ uid: string }>; total: number; nextCursor: null }>((resolve) => { release = resolve; }),
};
const list = useInfiniteResourceList(deferredAdapter, { filter: () => ({ q: "", bbox: null }), activeLang: () => "ja" });
const pending = list.loadFirst();
list.dispose();
release({ items: [{ uid: "late" }], total: 1, nextCursor: null });
await pending;
assert.deepEqual(list.items.value, [], "dispose後の後着応答は反映しない");
console.log("m11-t8b spatial unit: OK");
`);

try {
  await build({
    root: workDir,
    configFile: false,
    logLevel: "error",
    build: {
      outDir: path.join(workDir, "dist"),
      lib: { entry: entryFile, formats: ["es"], fileName: () => "entry.mjs" },
      rollupOptions: { external: ["node:assert/strict"] },
      minify: false,
      emptyOutDir: true,
    },
  });
  await import(path.resolve(outFile));

  const handler = await read("electron/ipc/search.ts");
  assert.match(handler, /wgs84BboxToMercator/, "search handler must convert WGS84 before searchExtent");
  assert.match(handler, /filterDocsByExtentSlugs\(docs, extentSlugs, \(doc\) => doc\.slug\)/, "POI handler must match slug");
  assert.match(handler, /filterBaseMapsByBbox\(docs, filter\.bbox\)/, "base map handler must use coverage intersection");
  assert.match(handler, /search:resourceBbox/, "resourceBbox handler missing");

  const preload = await read("electron/preload.ts");
  assert.match(preload, /resourceBbox:.*search:resourceBbox/s, "preload resourceBbox missing");
  const declarations = await read("src/electron.d.ts");
  assert.match(declarations, /resourceBbox\(kind: 'map'/, "SearchAPI.resourceBbox missing");

  const types = await read("src/components/resource-list/resourceListTypes.ts");
  assert.match(types, /export interface ResourceDataAdapter<T, Cursor = string>/, "ResourceDataAdapter missing");
  assert.match(types, /ResourceListAdapter<T, Cursor = string> extends ResourceDataAdapter<T, Cursor>/, "ResourceListAdapter must extend load-only contract");
  const infinite = await read("src/composables/useInfiniteResourceList.ts");
  assert.match(infinite, /dispose:\s*\(\) => void/, "dispose contract missing");
  for (const [file, api] of [
    ["src/views/resource-adapters/mapListAdapter.ts", "maps"],
    ["src/views/resource-adapters/appListAdapter.ts", "apps"],
    ["src/views/resource-adapters/poiSourceListAdapter.ts", "poiSources"],
  ]) {
    const source = await read(file);
    assert.match(source, new RegExp(`window\\.search\\.${api}`), `${file} must use search API`);
  }
  const baseAdapter = await read("src/views/resource-adapters/baseMapSearchAdapter.ts");
  assert.match(baseAdapter, /window\.search\.baseMaps/, "baseMapSearchAdapter must use FTS API");
  const assetAdapter = await read("src/views/resource-adapters/imageAssetSearchAdapter.ts");
  assert.match(assetAdapter, /window\.search\.imageAssets/, "imageAssetSearchAdapter must use FTS API");
  const bboxComposable = await read("src/composables/useBboxRangeFilter.ts");
  assert.match(bboxComposable, /export function useBboxRangeFilter/, "bbox composable missing");
  assert.match(bboxComposable, /parseBaseMapBboxQuery/, "bbox query parser must be shared");
  for (const file of ["src/views/MapList.vue", "src/views/PoiSourceList.vue"]) {
    const source = await read(file);
    assert.match(source, /useBboxRangeFilter/, `${file} must use shared bbox UI`);
    assert.match(source, /EnvelopeEditorModal/, `${file} must render range modal`);
    assert.match(source, /bbox:\s*bbox\.value/, `${file} must pass WGS84 bbox to adapter`);
  }
  const selectorList = await read("src/components/ResourceSelectorList.vue");
  assert.match(selectorList, /spatialContext\?: SelectorSpatialContextView/, "selector list plain spatial prop missing");
  assert.match(selectorList, /toggle-spatial-context/, "selector list toggle event missing");
  assert.match(selectorList, /name="item"/, "selector list full row slot missing");
  assert.match(selectorList, /onBeforeUnmount\([\s\S]*dispose\(\)/, "selector list must dispose in-flight reads");
  const spatial = await read("src/composables/useSelectorSpatialContext.ts");
  assert.match(spatial, /export function useSelectorSpatialContext/, "spatial context composable missing");
  const poiEditor = await read("src/components/PoiReferenceEditor.vue");
  assert.match(poiEditor, /spatialContext\?: SelectorSpatialContextView/, "PoiReferenceEditor spatial prop missing");
  assert.match(poiEditor, /toggle-spatial-context/, "PoiReferenceEditor toggle forwarding missing");
  console.log("m11-t8b Task 1-5 smoke: OK");
} finally {
  await rm(workDir, { recursive: true, force: true });
}
