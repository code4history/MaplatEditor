import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = path.join(root, '.tmp-smoke-poi-language');
await build({
  configFile: false,
  root,
  logLevel: 'silent',
  build: {
    lib: { entry: path.join(root, 'src/utils/poiGeoJson.ts'), formats: ['es'], fileName: () => 'poiGeoJson.mjs' },
    outDir: temp,
    emptyOutDir: true,
    rollupOptions: { external: [] },
  },
});
const poi = await import(`${pathToFileURL(path.join(temp, 'poiGeoJson.mjs')).href}?v=${Date.now()}`);

assert.equal(poi.resolvePoiSourceLanguage('en-US', 'ja'), 'en');
assert.equal(poi.resolvePoiSourceLanguage(undefined, 'ja'), 'ja');
assert.equal(poi.resolvePoiSourceLanguage('zh-Hant', 'en'), 'zh-TW');

const internal = poi.normalizePoiSourceCollection({
  type: 'FeatureCollection',
  lang: 'en',
  features: [{ type: 'Feature', id: 'p1', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { name: 'Castle' } }],
}, 'ja');
assert.equal(internal.lang, 'en');
assert.deepEqual(internal.features[0].properties.name, { en: 'Castle' });
const exported = poi.toExportForm(internal, 'castle-poi', { en: 'Castles' }, { defaultLang: internal.lang });
assert.equal(exported.lang, 'en');
assert.equal(exported.name, 'Castles');
assert.equal(exported.features[0].properties.name, 'Castle');

const editor = await readFile(path.join(root, 'src/views/PoiEdit.vue'), 'utf8');
const session = await readFile(path.join(root, 'src/composables/usePoiEditSession.ts'), 'utf8');
const raw = await readFile(path.join(root, 'src/components/PoiRawPane.vue'), 'utf8');
const list = await readFile(path.join(root, 'src/components/PoiFeatureList.vue'), 'utf8');
const service = await readFile(path.join(root, 'electron/services/PoiSourceService.ts'), 'utf8');

assert.match(session, /lang:\s*LangCode/);
assert.match(editor, /const translationMode = computed/);
assert.match(editor, /data-editor-document-language/);
assert.match(editor, /<PoiRawPane[\s\S]*:translation-mode="translationMode"/);
assert.match(editor, /<PoiFeatureList[\s\S]*:active-lang="currentLang"/);
assert.match(raw, /translationMode:\s*boolean/);
assert.match(list, /activeLang:\s*LangCode/);
assert.doesNotMatch(list, /i18next\.language/);
assert.match(service, /contentLanguage/);

await rm(temp, { recursive: true, force: true });
console.log('M11-T3 POI language-boundary smoke checks passed.');
