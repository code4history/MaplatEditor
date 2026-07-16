// M11-T9: POI Content Mode 純ロジック smoke (unit, vite lib build)
// poiContentMode.ts の ContentMode 型・legacy推定・Asset Reference URI収集を検証する。
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'poi-content-mode-'));
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
        entry: path.join(projectRoot, 'src/utils/poiContentMode.ts'),
        formats: ['es'],
        fileName: () => 'poiContentMode.mjs',
      },
      rollupOptions: { external: [] },
    },
  });

  const mod = await import(pathToFileURL(path.join(outDir, 'poiContentMode.mjs')).href);
  const {
    estimateContentMode,
    collectAssetRefUids,
    collectAssetRefsInFc,
    activeFieldsForMode,
    incompatibleFieldsForMode,
  } = mod;

  // --- ケース1: estimateContentMode ---
  // 1a: html property だけある → 'html'
  {
    assert.equal(estimateContentMode({ html: { ja: '<p>test</p>' } }), 'html');
    assert.equal(estimateContentMode({ html: 'plain string' }), 'html');
    // 空 html は無視
    assert.equal(estimateContentMode({ html: { ja: '' } }), undefined);
    assert.equal(estimateContentMode({ html: '' }), undefined);
    console.log('  case 1a (html → html mode): PASS');
  }

  // 1b: url だけある → 'url'（html がない場合）
  {
    assert.equal(estimateContentMode({ url: { ja: 'https://example.com' } }), 'url');
    assert.equal(estimateContentMode({ url: 'https://ex.com' }), 'url');
    // 空 url は無視
    assert.equal(estimateContentMode({ url: { ja: '' } }), undefined);
    assert.equal(estimateContentMode({ url: '' }), undefined);
    console.log('  case 1b (url → url mode): PASS');
  }

  // 1c: html + url 両方ある → html 優先
  {
    assert.equal(estimateContentMode({
      html: { ja: '<p>test</p>' },
      url: { ja: 'https://example.com' },
    }), 'html');
    console.log('  case 1c (html+url → html wins): PASS');
  }

  // 1d: どのフィールドも空・不在 → undefined（standardとして扱う）
  {
    assert.equal(estimateContentMode({}), undefined);
    assert.equal(estimateContentMode({ name: { ja: 'test' } }), undefined);
    assert.equal(estimateContentMode({ desc: { ja: 'desc' } }), undefined);
    console.log('  case 1d (no html/url → undefined/standard): PASS');
  }

  // 1e: LangResourceの数値 string 化 (name:5 が "5" 扱い → content mode には影響しないが、html/url の数値は解釈)
  {
    assert.equal(estimateContentMode({ html: 5 }), undefined, 'numeric html is not a LangResource string');
    console.log('  case 1e (numeric html/url ignored): PASS');
  }

  // --- ケース2: activeFieldsForMode / incompatibleFieldsForMode ---
  {
    assert.deepEqual(activeFieldsForMode('standard'), ['desc', 'address', 'image']);
    assert.deepEqual(activeFieldsForMode('html'), ['html', 'image']);
    assert.deepEqual(activeFieldsForMode('url'), ['url']);

    assert.deepEqual(incompatibleFieldsForMode('standard'), ['html', 'url']);
    assert.deepEqual(incompatibleFieldsForMode('html'), ['desc', 'address', 'url']);
    assert.deepEqual(incompatibleFieldsForMode('url'), ['desc', 'address', 'html', 'image']);
    console.log('  case 2 (field contracts): PASS');
  }

  // --- ケース3: collectAssetRefUids ---
  // 3a: 単一言語のhtml文字列からmaplat-asset:UIDを収集
  {
    const uids = collectAssetRefUids(
      '<img src="maplat-asset:00000000-0000-4000-a000-000000000001" /><img src="maplat-asset:00000000-0000-4000-a000-000000000002" />',
    );
    assert.equal(uids.size, 2);
    assert.ok(uids.has('00000000-0000-4000-a000-000000000001'));
    assert.ok(uids.has('00000000-0000-4000-a000-000000000002'));
    console.log('  case 3a (single lang with 2 uids): PASS');
  }

  // 3b: LangResource（多言語）のhtmlからUIDを収集
  {
    const uids = collectAssetRefUids({
      ja: '<img src="maplat-asset:00000000-0000-4000-a000-000000000003">',
      en: '<img src="maplat-asset:00000000-0000-4000-a000-000000000004">',
    });
    assert.equal(uids.size, 2);
    assert.ok(uids.has('00000000-0000-4000-a000-000000000003'));
    assert.ok(uids.has('00000000-0000-4000-a000-000000000004'));
    console.log('  case 3b (multi-lang LangResource): PASS');
  }

  // 3c: UUIDでない文字列・プレーンHTML・空文字は収集しない
  {
    const uids = collectAssetRefUids('maplat-asset:not-a-uuid maplat-asset:');
    assert.equal(uids.size, 0);
    assert.equal(collectAssetRefUids('').size, 0);
    assert.equal(collectAssetRefUids(null).size, 0);
    assert.equal(collectAssetRefUids(undefined).size, 0);
    assert.equal(collectAssetRefUids(123).size, 0);
    console.log('  case 3c (invalid/empty inputs yield empty set): PASS');
  }

  // 3d: 同一UIDの重複排除
  {
    const uids = collectAssetRefUids(
      '<img src="maplat-asset:00000000-0000-4000-a000-000000000005"><img src="maplat-asset:00000000-0000-4000-a000-000000000005">',
    );
    assert.equal(uids.size, 1);
    console.log('  case 3d (duplicate UID dedup): PASS');
  }

  // --- ケース4: collectAssetRefsInFc ---
  // 4a: FC 内の全 features の html からUIDを収集
  {
    const fc = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          id: 'p1',
          geometry: { type: 'Point', coordinates: [0, 0] },
          properties: {
            html: { ja: '<img src="maplat-asset:00000000-0000-4000-a000-000000000010">' },
          },
        },
        {
          type: 'Feature',
          id: 'p2',
          geometry: { type: 'Point', coordinates: [1, 1] },
          properties: {
            html: { en: '<img src="maplat-asset:00000000-0000-4000-a000-000000000011">' },
          },
        },
      ],
    };
    const uids = collectAssetRefsInFc(fc);
    assert.equal(uids.size, 2);
    assert.ok(uids.has('00000000-0000-4000-a000-000000000010'));
    assert.ok(uids.has('00000000-0000-4000-a000-000000000011'));
    console.log('  case 4a (FC asset ref collection): PASS');
  }

  // 4b: FC 以外や空 features では空集合
  {
    assert.equal(collectAssetRefsInFc(null).size, 0);
    assert.equal(collectAssetRefsInFc({}).size, 0);
    assert.equal(
      collectAssetRefsInFc({ type: 'FeatureCollection', features: [] }).size,
      0,
    );
    // html 以外のプロパティは走査しない（設計 §93）
    assert.equal(
      collectAssetRefsInFc({
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          id: 'p1',
          geometry: { type: 'Point', coordinates: [0, 0] },
          properties: {
            desc: { ja: 'maplat-asset:00000000-0000-4000-a000-000000000099' },
          },
        }],
      }).size,
      0,
    );
    console.log('  case 4b (invalid/empty FC + desc excluded): PASS');
  }

  // 4c: html未設定のfeatureを無視
  {
    const fc = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          id: 'p1',
          geometry: { type: 'Point', coordinates: [0, 0] },
          properties: { name: { ja: 'test' } },
        },
      ],
    };
    assert.equal(collectAssetRefsInFc(fc).size, 0);
    console.log('  case 4c (feature without html): PASS');
  }

  // --- ケース5: validateFeatureCollection content mode validation (AC15) ---
  // poiGeoJson.ts を追加 build して検証する
  await build({
    root: projectRoot,
    logLevel: 'error',
    configFile: false,
    build: {
      outDir: path.join(workDir, 'dist-geojson'),
      emptyOutDir: true,
      lib: {
        entry: path.join(projectRoot, 'src/utils/poiGeoJson.ts'),
        formats: ['es'],
        fileName: () => 'poiGeoJson.mjs',
      },
      rollupOptions: { external: [] },
    },
  });

  const geoMod = await import(pathToFileURL(path.join(workDir, 'dist-geojson', 'poiGeoJson.mjs')).href);
  const { validateFeatureCollection } = geoMod;

  // 5a: content-mode-html-missing-content: html mode + empty html → warning
  {
    const fc = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          id: 'p1',
          geometry: { type: 'Point', coordinates: [0, 0] },
          properties: {
            _maplatContentMode: 'html',
            name: { ja: 'test' },
            html: { ja: '' },
          },
        },
      ],
    };
    const issues = validateFeatureCollection(fc);
    const htmlEmptyIssue = issues.find((i) => i.code === 'content-mode-html-missing-content');
    assert.ok(htmlEmptyIssue, 'empty html in html mode should warn');
    assert.equal(htmlEmptyIssue.level, 'warning');
    assert.equal(htmlEmptyIssue.featureId, 'p1');
    console.log('  case 5a (html mode + empty html → warning): PASS');
  }

  // 5b: content-mode-url-format: data: URL → error
  {
    const fc = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          id: 'p2',
          geometry: { type: 'Point', coordinates: [0, 0] },
          properties: {
            _maplatContentMode: 'url',
            name: { ja: 'test' },
            url: 'data:text/html,<script>alert(1)</script>',
          },
        },
      ],
    };
    const issues = validateFeatureCollection(fc);
    const urlIssue = issues.find((i) => i.code === 'content-mode-url-format');
    assert.ok(urlIssue, 'data: URL in url mode should be error');
    assert.equal(urlIssue.level, 'error');
    assert.equal(urlIssue.featureId, 'p2');
    console.log('  case 5b (data: URL in url mode → error): PASS');
  }

  // 5c: content-mode-url-format: javascript: URL → error
  {
    const fc = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          id: 'p3',
          geometry: { type: 'Point', coordinates: [0, 0] },
          properties: {
            _maplatContentMode: 'url',
            name: { ja: 'test' },
            url: 'JavaScript:void(0)',
          },
        },
      ],
    };
    const issues = validateFeatureCollection(fc);
    const urlIssue = issues.find((i) => i.code === 'content-mode-url-format');
    assert.ok(urlIssue, 'javascript: URL in url mode should be error');
    assert.equal(urlIssue.level, 'error');
    assert.equal(urlIssue.featureId, 'p3');
    console.log('  case 5c (javascript: URL in url mode → error): PASS');
  }

  // 5d: https URL in url mode → no error
  {
    const fc = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          id: 'p4',
          geometry: { type: 'Point', coordinates: [0, 0] },
          properties: {
            _maplatContentMode: 'url',
            name: { ja: 'test' },
            url: 'https://example.com',
          },
        },
      ],
    };
    const issues = validateFeatureCollection(fc);
    const urlIssue = issues.find((i) => i.code === 'content-mode-url-format');
    assert.equal(urlIssue, undefined, 'https URL should not trigger error');
    console.log('  case 5d (https URL in url mode → no error): PASS');
  }

  // 5e: html mode with non-empty html → no warning
  {
    const fc = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          id: 'p5',
          geometry: { type: 'Point', coordinates: [0, 0] },
          properties: {
            _maplatContentMode: 'html',
            name: { ja: 'test' },
            html: { ja: '<p>content</p>' },
          },
        },
      ],
    };
    const issues = validateFeatureCollection(fc);
    const htmlEmptyIssue = issues.find((i) => i.code === 'content-mode-html-missing-content');
    assert.equal(htmlEmptyIssue, undefined, 'non-empty html should not warn');
    console.log('  case 5e (html mode with content → no warning): PASS');
  }

  // 5f: vbscript: URL in url mode → error (blocklist catch-all)
  {
    const fc = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          id: 'p6',
          geometry: { type: 'Point', coordinates: [0, 0] },
          properties: {
            _maplatContentMode: 'url',
            name: { ja: 'test' },
            url: 'vbscript:msgbox(1)',
          },
        },
      ],
    };
    const issues = validateFeatureCollection(fc);
    const urlIssue = issues.find((i) => i.code === 'content-mode-url-format');
    assert.ok(urlIssue, 'vbscript: URL in url mode should be error');
    assert.equal(urlIssue.level, 'error');
    console.log('  case 5f (vbscript: URL → error, allowlist): PASS');
  }

  // 5g: ftp: URL in url mode → error (not in http/https allowlist)
  {
    const fc = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          id: 'p7',
          geometry: { type: 'Point', coordinates: [0, 0] },
          properties: {
            _maplatContentMode: 'url',
            name: { ja: 'test' },
            url: 'ftp://example.com/file',
          },
        },
      ],
    };
    const issues = validateFeatureCollection(fc);
    const urlIssue = issues.find((i) => i.code === 'content-mode-url-format');
    assert.ok(urlIssue, 'ftp: URL in url mode should be error');
    console.log('  case 5g (ftp: URL → error, allowlist): PASS');
  }

  // 5h: relative path in url mode → no error
  {
    const fc = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          id: 'p8',
          geometry: { type: 'Point', coordinates: [0, 0] },
          properties: {
            _maplatContentMode: 'url',
            name: { ja: 'test' },
            url: '/page/subpage',
          },
        },
      ],
    };
    const issues = validateFeatureCollection(fc);
    const urlIssue = issues.find((i) => i.code === 'content-mode-url-format');
    assert.equal(urlIssue, undefined, 'relative path should be allowed');
    console.log('  case 5h (relative path in url mode → no error): PASS');
  }

  // 5i: javascript: in SECOND language of LangResource → error (full lang walk)
  {
    const fc = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          id: 'p9',
          geometry: { type: 'Point', coordinates: [0, 0] },
          properties: {
            _maplatContentMode: 'url',
            name: { ja: 'test' },
            url: { ja: 'https://example.com', en: 'javascript:alert(1)' },
          },
        },
      ],
    };
    const issues = validateFeatureCollection(fc);
    const urlIssue = issues.find((i) => i.code === 'content-mode-url-format');
    assert.ok(urlIssue, 'javascript: in second lang should be caught');
    assert.equal(urlIssue.level, 'error');
    console.log('  case 5i (javascript: in second LangResource lang → error, full walk): PASS');
  }

  console.log('m11-t9-poi-content-mode smoke: PASS');
} finally {
  await rm(workDir, { recursive: true, force: true });
}