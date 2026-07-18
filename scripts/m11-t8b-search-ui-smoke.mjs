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
  console.log("m11-t8b Task 1 smoke: OK");
} finally {
  await rm(workDir, { recursive: true, force: true });
}
