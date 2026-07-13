import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });

async function importSource() {
  const workDir = await mkdtemp(path.join(scratchRoot, 'm11-t3-poi-package-'));
  const outDir = path.join(workDir, 'dist');
  try {
    await build({
      root: projectRoot,
      logLevel: 'error',
      configFile: false,
      build: {
        outDir,
        emptyOutDir: true,
        lib: {
          entry: path.join(projectRoot, 'src/utils/poiPackage.ts'),
          formats: ['es'],
          fileName: () => 'poiPackage.mjs',
        },
      },
    });
    return await import(`${pathToFileURL(path.join(outDir, 'poiPackage.mjs')).href}?t=${Date.now()}`);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

const {
  assertSafePoiPackageEntries,
  findPoiDocumentEntry,
  rewritePoiMediaReferences,
} = await importSource();

assert.doesNotThrow(() => assertSafePoiPackageEntries([
  { name: 'pois/himeji.geojson', size: 200 },
  { name: 'imgs/photo.png', size: 1000 },
]));
for (const name of ['/abs.geojson', '../escape.geojson', 'pois/../../escape.geojson', 'pois\\evil.geojson']) {
  assert.throws(() => assertSafePoiPackageEntries([{ name, size: 1 }]));
}
assert.throws(() => assertSafePoiPackageEntries([{ name: 'pois/a.geojson', size: 101 * 1024 * 1024 }]));
assert.throws(() => assertSafePoiPackageEntries([
  { name: 'pois/a.geojson', size: 1 },
  { name: 'pois/a.geojson', size: 1 },
]));
assert.throws(() => assertSafePoiPackageEntries([{ name: 'imgs/link.png', size: 1, isSymlink: true }]));
assert.throws(() => assertSafePoiPackageEntries([{ name: 'imgs/huge.png', size: 21 * 1024 * 1024 }]));
assert.throws(() => assertSafePoiPackageEntries([{
  name: 'imgs/icons/default/huge.png',
  size: 21 * 1024 * 1024,
}]));
assert.equal(findPoiDocumentEntry(['README', 'pois/himeji.geojson']), 'pois/himeji.geojson');
assert.throws(() => findPoiDocumentEntry([]));
assert.throws(() => findPoiDocumentEntry(['pois/a.geojson', 'pois/b.geojson']));

const input = {
  type: 'FeatureCollection',
  icon: 'asset-a',
  features: [{
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [134, 34] },
    properties: {
      selectedIcon: 'asset-b',
      image: ['asset-c', { src: 'asset-d', desc: 'D' }, 'https://example.com/x.png'],
    },
  }],
};
const output = await rewritePoiMediaReferences(input, async (value) =>
  value.startsWith('asset-') ? `imgs/${value}.png` : value,
);
assert.equal(output.icon, 'imgs/asset-a.png');
assert.equal(output.features[0].properties.selectedIcon, 'imgs/asset-b.png');
assert.deepEqual(output.features[0].properties.image, [
  'imgs/asset-c.png',
  { src: 'imgs/asset-d.png', desc: 'D' },
  'https://example.com/x.png',
]);
assert.equal(input.icon, 'asset-a', 'rewrite must not mutate the stored POI document');

const servicePath = path.join(projectRoot, 'electron/services/PoiPackageService.ts');
assert.equal(existsSync(servicePath), true, 'PoiPackageService must implement the main-process boundary');
const packageService = await readFile(servicePath, 'utf8');
assert.match(packageService, /inspectPoiExport/);
assert.match(packageService, /importPoiZip/);
assert.match(packageService, /assertSafePoiPackageEntries/);
assert.match(packageService, /imageAssetService\.add/);
assert.match(packageService, /imageAssetService\.delete/);
const writeExportBlock = packageService.slice(
  packageService.indexOf('export async function writePoiExport'),
  packageService.indexOf('async function sameStoredBytes'),
);
assert.match(writeExportBlock, /SettingsService\.get\(['"]tmpFolder['"]\)/);

const poiIpc = await readFile(path.join(projectRoot, 'electron/ipc/poisource.ts'), 'utf8');
const poiSourceService = await readFile(path.join(projectRoot, 'electron/services/PoiSourceService.ts'), 'utf8');
assert.match(poiIpc, /inspectPoiExport/);
assert.match(poiIpc, /writePoiExport/);
assert.match(poiIpc, /extensions:\s*\[['"]zip['"]\]/);
const exportHandler = poiIpc.slice(
  poiIpc.indexOf("ipcMain.handle('poisource:exportFile'"),
  poiIpc.indexOf("ipcMain.handle('poisource:pickImportFile'"),
);
assert.ok(
  exportHandler.indexOf('showSaveDialog') < exportHandler.indexOf('await writePoiExport'),
  'POI must choose the output path before generating the file',
);
assert.match(poiIpc, /extensions:\s*\[['"]geojson['"],\s*['"]json['"],\s*['"]zip['"]\]/);
assert.match(poiSourceService, /ext === ['"]\.zip['"][\s\S]*importPoiZip/);
assert.match(poiSourceService, /preparedImport\.cleanup\(\)/);

console.log('m11-t3 POI package smoke: PASS');
