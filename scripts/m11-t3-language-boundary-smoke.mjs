import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });

async function importSource(relativeEntry, fileName) {
  const workDir = await mkdtemp(path.join(scratchRoot, 'm11-t3-language-'));
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
          entry: path.join(projectRoot, relativeEntry),
          formats: ['es'],
          fileName: () => fileName,
        },
      },
    });
    return await import(`${pathToFileURL(path.join(outDir, fileName)).href}?t=${Date.now()}`);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

const { isTranslationMode } = await importSource(
  'src/utils/editorLanguageMode.ts',
  'editorLanguageMode.mjs',
);
assert.equal(isTranslationMode('ja', 'ja'), false);
assert.equal(isTranslationMode('en', 'ja'), true);
assert.equal(isTranslationMode('en-US', 'en-US'), false);
assert.equal(isTranslationMode('', 'ja'), false);
assert.equal(isTranslationMode('en', ''), false);

const { resolveAppLocalizedMetadata } = await importSource(
  'src/utils/appLocalizedMetadata.ts',
  'appLocalizedMetadata.mjs',
);
const resolvedMetadata = resolveAppLocalizedMetadata({
  appID: 'himeji',
  lang: 'ja',
  title: { ja: '姫路アプリ', en: 'Himeji App' },
  keywords: { ja: '姫路,古地図', en: 'Himeji,historical map' },
  manifestSettings: {
    name: { ja: '姫路案内', en: 'Himeji Guide' },
    shortName: { ja: '姫路', en: 'Himeji' },
  },
});
assert.deepEqual(resolvedMetadata, {
  lang: 'ja',
  appName: '姫路アプリ',
  keywords: '姫路,古地図',
  manifestName: '姫路案内',
  manifestShortName: '姫路',
});
assert.equal(resolveAppLocalizedMetadata({
  appID: 'fallback',
  lang: 'en',
  title: { en: 'Fallback App' },
  manifestSettings: { name: {}, shortName: {} },
}).manifestName, 'Fallback App');

const mapEdit = await readFile(path.join(projectRoot, 'src/views/MapEdit.vue'), 'utf8');
assert.match(mapEdit, /const label = createLangComputed\(['"]label['"]\)/);
assert.match(mapEdit, /data-testid="map-label"[^>]*v-model="label"/);
assert.match(
  mapEdit,
  /<SlugField(?=[^>]*:disabled="translationMode")(?=[^>]*input-testid="map-slug")[^>]*\/>/,
);
assert.match(mapEdit, /data-editor-document-language[^>]*:disabled="translationMode"/);
assert.match(mapEdit, /@click="mapUpload"[^>]*:disabled="translationMode"/);

const slugField = await readFile(
  path.join(projectRoot, 'src/components/editor-ui/SlugField.vue'),
  'utf8',
);
assert.match(
  slugField,
  /<input(?=[^>]*:disabled="disabled")(?=[^>]*:data-testid="inputTestid")[^>]*\/>/,
);

const appEdit = await readFile(path.join(projectRoot, 'src/views/AppEdit.vue'), 'utf8');
assert.match(appEdit, /keywords:\s*Record<string, string>/);
assert.match(appEdit, /name:\s*Record<string, string>/);
assert.match(appEdit, /shortName:\s*Record<string, string>/);
assert.match(appEdit, /const keywordsText = createAppLangComputed/);
assert.match(appEdit, /const manifestNameText = createManifestLangComputed/);
assert.match(appEdit, /const manifestShortNameText = createManifestLangComputed/);
assert.match(appEdit, /data-testid="app-keywords"[^>]*v-model="keywordsText"/);
assert.match(appEdit, /data-testid="app-manifest-name"[^>]*v-model="manifestNameText"/);
assert.match(appEdit, /data-testid="app-manifest-short-name"[^>]*v-model="manifestShortNameText"/);
assert.match(appEdit, /const translationMode = computed/);
assert.match(
  appEdit,
  /<SlugField(?=[^>]*:disabled="translationMode")(?=[^>]*input-testid="app-id")[^>]*\/>/,
);
assert.match(appEdit, /data-editor-document-language[^>]*:disabled="translationMode"/);
assert.match(appEdit, /<PoiReferenceEditor[^>]*:active-lang="currentLang"/);
assert.match(appEdit, /<AppSourceEditor[^>]*:default-lang="appData\.lang"/);
// m19-t3: label 強制補完（normalizeLangObject(value.label || value.data?.label …)）を要求する
// assert は m6-t10 hotfix（a9df183）が当該コードを廃止した時点で失効した。同じ保証は
// m6-t10 smoke 側の `/source\.label\s*=/` 不在 assert が逆向きに担っているため削除する。
assert.doesNotMatch(appEdit, /localizedWithLang\(title, "ja"\)/);

const poiReferenceEditor = await readFile(
  path.join(projectRoot, 'src/components/PoiReferenceEditor.vue'),
  'utf8',
);
assert.match(poiReferenceEditor, /activeLang:\s*LangCode/);
assert.match(poiReferenceEditor, /languageOptions:\s*readonly/);
assert.match(poiReferenceEditor, /ResourceSelectorList/);
assert.match(poiReferenceEditor, /:active-lang="activeLang"/);
assert.match(poiReferenceEditor, /localizeTitle\(item\.title, props\.activeLang\)/);
assert.doesNotMatch(poiReferenceEditor, /i18next\.language/);

const appSourceEditor = await readFile(
  path.join(projectRoot, 'src/components/AppSourceEditor.vue'),
  'utf8',
);
assert.match(appSourceEditor, /defaultLang:\s*LangCode/);
// m19-t3: `<LangValueChips` を要求する assert は m6-t10（b6dcfd1）が LangResourceInput へ
// 寄せた時点で失効した。同じ保証は m6-t10 smoke の AC28（`<LangValueChips` の**不在**）が
// 逆向きに担っている。2 本の smoke が正反対を要求する状態を解消するため削除する。
assert.doesNotMatch(appSourceEditor, /props\.currentLang !== "ja"/);

const appPreviewService = await readFile(
  path.join(projectRoot, 'electron/services/AppPreviewService.ts'),
  'utf8',
);
const appExportService = await readFile(
  path.join(projectRoot, 'electron/services/AppExportService.ts'),
  'utf8',
);
for (const service of [appPreviewService, appExportService]) {
  assert.match(service, /resolveAppLocalizedMetadata/);
  assert.doesNotMatch(service, /String\(document\.keywords \|\| ''\)/);
}

console.log('M11-T3 language-boundary smoke checks passed.');
