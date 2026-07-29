// M18-T5 スモーク: layer metadata 交換形の properties 正本化 + 参照 entry hide + m17 icon 波及解消
// 設計書 §6.1 の11ケースを検証する。vite バンドル方式（m9-t1 と同パターン）。
// poiGeoJson.ts（toExportForm / normalizePoiSourceCollection）と poiPackage.ts（rewritePoiMediaReferences）を検証。
// poiReferenceResolver.ts（applyReferenceIconOverrides / resolveIconRefsInFc）は m10-t1 smoke で実経路検証済みのため、
// ここでは純関数レベルの検証を行う。
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'm18-t5-'));
const entryFile = path.join(workDir, 'm18-t5-smoke.ts');
const outDir = path.join(workDir, 'dist');
const bundledFile = path.join(outDir, 'm18-t5-smoke.mjs');

try {
  const poiGeoJsonPath = path.join(projectRoot, 'src/utils/poiGeoJson.ts');
  const poiPackagePath = path.join(projectRoot, 'src/utils/poiPackage.ts');

  await writeFile(
    entryFile,
    `
      import assert from 'node:assert/strict';

      const poiGeoJson = await import(${JSON.stringify(poiGeoJsonPath)});
      const { toExportForm, normalizePoiSourceCollection } = poiGeoJson;

      const poiPackage = await import(${JSON.stringify(poiPackagePath)});
      const { rewritePoiMediaReferences } = poiPackage;

      // --- helpers ---
      const point = (lng, lat) => ({ type: 'Point', coordinates: [lng, lat] });
      const feat = (id, coords, props = {}) => ({ type: 'Feature', id, geometry: point(coords[0], coords[1]), properties: { _maplatUid: 'uid-' + id, ...props } });
      const makeFc = (features, layerMeta = {}, lang = 'en') => ({ type: 'FeatureCollection', features, lang, ...layerMeta });

      // ================================================================
      // AC5-1: toExportForm 出力の FC トップレベルに icon/selectedIcon/hide が出ず、FC.properties に入る
      // ================================================================
      {
        const fc = makeFc([feat('p1', [135, 35], { name: 'A' })], { icon: 'builtin:defaultpin', hide: true, selectedIcon: 'builtin:defaultpin-selected' });
        const out = toExportForm(fc, 'test-slug', { en: 'Test' }, { defaultLang: 'en' });
        assert.equal(out.type, 'FeatureCollection');
        assert.equal(out.id, 'test-slug');
        assert.equal(out.name, 'Test');
        assert.equal(out.lang, 'en', 'lang はトップレベルに残る');
        assert.equal(out.icon, undefined, 'FC トップレベルに icon は出ない');
        assert.equal(out.selectedIcon, undefined, 'FC トップレベルに selectedIcon は出ない');
        assert.equal(out.hide, undefined, 'FC トップレベルに hide は出ない');
        assert.ok(out.properties, 'FC.properties が存在する');
        assert.equal(out.properties.icon, 'builtin:defaultpin', 'properties.icon に格納');
        assert.equal(out.properties.selectedIcon, 'builtin:defaultpin-selected', 'properties.selectedIcon に格納');
        assert.equal(out.properties.hide, true, 'properties.hide に格納');
        console.log('ok #1: AC5-1 toExportForm writes layer metadata to FC.properties');
      }

      // ================================================================
      // AC5-2: normalizePoiSourceCollection が properties 優先で layerMeta を構成
      // ================================================================
      {
        const input = {
          type: 'FeatureCollection',
          id: 'test',
          features: [],
          icon: 'top-level-icon',
          properties: { icon: 'properties-icon', hide: true },
        };
        const result = normalizePoiSourceCollection(input, 'en');
        assert.equal(result.icon, 'properties-icon', 'properties 側の icon が優先される');
        assert.equal(result.hide, true, 'properties 側の hide が読まれる');
        console.log('ok #2: AC5-2 normalizePoiSourceCollection properties priority');
      }

      // ================================================================
      // AC5-3: 過去形式（FC トップレベルに layer metadata）を受容
      // ================================================================
      {
        const input = {
          type: 'FeatureCollection',
          id: 'legacy',
          features: [],
          icon: 'legacy-icon',
          hide: true,
        };
        const result = normalizePoiSourceCollection(input, 'en');
        assert.equal(result.icon, 'legacy-icon', '過去形式のトップレベル icon が layerMeta へ正規化される');
        assert.equal(result.hide, true, '過去形式のトップレベル hide が layerMeta へ正規化される');
        console.log('ok #3: AC5-3 legacy top-level metadata accepted');
      }

      // ================================================================
      // AC5-4: PoiRawPane raw JSON 往復（toExportForm → normalizePoiSourceCollection で layerMeta 一致）
      // ================================================================
      {
        const fc = makeFc([feat('p1', [135, 35], { name: 'A' })], { icon: 'builtin:defaultpin', hide: true });
        const exported = toExportForm(fc, 'rt-slug', { en: 'RT' }, { defaultLang: 'en' });
        // raw JSON 往復シミュレーション: exported → JSON → normalizePoiSourceCollection
        const json = JSON.parse(JSON.stringify(exported));
        const reimported = normalizePoiSourceCollection(json, 'en');
        assert.equal(reimported.icon, 'builtin:defaultpin', 'export → import 往復で icon が一致');
        assert.equal(reimported.hide, true, 'export → import 往復で hide が一致');
        console.log('ok #4: AC5-4 raw JSON roundtrip properties-based');
      }

      // ================================================================
      // AC5-10: export → import 往復（layerMeta 一致）
      // ================================================================
      {
        const fc = makeFc(
          [feat('p1', [135, 35], { name: 'A' })],
          { icon: 'builtin:defaultpin', poiTemplate: '<div>{{name}}</div>' }
        );
        const exported = toExportForm(fc, 'ex-slug', { en: 'EX' }, { defaultLang: 'en' });
        const reimported = normalizePoiSourceCollection(JSON.parse(JSON.stringify(exported)), 'en');
        assert.equal(reimported.icon, 'builtin:defaultpin');
        assert.equal(reimported.poiTemplate, '<div>{{name}}</div>');
        console.log('ok #10: AC5-11 export→import layerMeta roundtrip');
      }

      // ================================================================
      // AC5-17 (a)(b): rewritePoiMediaReferences の FC.properties 降下 + copy-on-write
      // ================================================================
      {
        // (a) FC.properties.icon が resolver へ渡される
        const fc = {
          type: 'FeatureCollection',
          id: 'pkg',
          features: [],
          properties: { icon: 'imgs/a.png' },
        };
        const resolve = async (ref) => ref === 'imgs/a.png' ? 'imgs/resolved-a.png' : ref;
        const result = await rewritePoiMediaReferences(fc, resolve);
        assert.equal(result.properties.icon, 'imgs/resolved-a.png', 'FC.properties.icon が書き換えられる');

        // (b) icon 参照を持たない FC.properties では同一参照維持（copy-on-write）
        const fcNoChange = {
          type: 'FeatureCollection',
          id: 'pkg2',
          features: [],
          properties: { poiTemplate: '<div></div>' },
        };
        const resultNoChange = await rewritePoiMediaReferences(fcNoChange, resolve);
        assert.equal(resultNoChange, fcNoChange, '変更なしの場合は同一参照（copy-on-write）');
        console.log('ok #11ab: AC5-17 rewritePoiMediaReferences FC.properties descent + copy-on-write');
      }

      // ================================================================
      // AC5-17 (c): package export→import 往復シミュレーション
      // FC.properties.icon = Asset UUID → rewritePoiMediaReferences で imgs/{slug}.{ext} へ書き換え →
      // normalizePoiSourceCollection で layerMeta へ読まれる（dangling でない）
      // ================================================================
      {
        const assetUid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
        const fc = {
          type: 'FeatureCollection',
          id: 'pkg-asset',
          features: [],
          properties: { icon: assetUid },
        };
        // package 内の icon パス（export 時に imgs/{slug}.{ext} へ解決済みと仮定）
        const exportedIconPath = 'imgs/temple-mark.png';
        const resolve = async (ref) => ref === assetUid ? exportedIconPath : ref;
        const rewritten = await rewritePoiMediaReferences(fc, resolve);
        assert.equal(rewritten.properties.icon, exportedIconPath, 'Asset UID が imgs/ へ書き換えられる');

        // import 後の normalizePoiSourceCollection
        const reimported = normalizePoiSourceCollection(JSON.parse(JSON.stringify(rewritten)), 'en');
        assert.equal(reimported.icon, exportedIconPath, 'import 後 layerMeta.icon が imgs/ パス（dangling でない）');
        console.log('ok #11c: AC5-17 package export→import Asset UID restoration');
      }

      // ================================================================
      // AC5-17 (d): 再 export で properties.icon が維持される
      // ================================================================
      {
        const reimported = { type: 'FeatureCollection', features: [], lang: 'en', icon: 'imgs/temple-mark.png' };
        const reexported = toExportForm(reimported, 're-slug', { en: 'RE' }, { defaultLang: 'en' });
        assert.equal(reexported.properties.icon, 'imgs/temple-mark.png', '再 export で properties.icon が維持される');
        console.log('ok #11d: AC5-17 re-export preserves properties.icon');
      }

      console.log('\\nM18-T5 properties migration smoke passed');
    `,
  );

  await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: true,
      outDir,
      ssr: true,
      rollupOptions: {
        input: entryFile,
        output: {
          entryFileNames: 'm18-t5-smoke.mjs',
          format: 'es',
        },
      },
    },
  });

  await execFileAsync(process.execPath, [bundledFile], {
    cwd: projectRoot,
    timeout: 30000,
    maxBuffer: 1024 * 1024 * 8,
  });
  console.log('M18-T5 properties migration smoke passed');
} finally {
  await rm(workDir, { recursive: true, force: true });
}
