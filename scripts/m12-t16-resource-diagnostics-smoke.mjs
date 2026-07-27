// M12-T16: リソース一覧診断バッジ smoke。
// 既存の main 判定関数を直接呼び、一覧添付・renderer badge 変換・静的制約を表駆動で固定する。
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'm12-t16-resource-diagnostics-'));
const entryFile = path.join(workDir, 'm12-t16-resource-diagnostics-smoke.ts');
const electronStubFile = path.join(workDir, 'electron-stub.ts');
const electronStoreStubFile = path.join(workDir, 'electron-store-stub.ts');
const outDir = path.join(workDir, 'dist');
const bundledFile = path.join(outDir, 'm12-t16-resource-diagnostics-smoke.mjs');

try {
  const dataDir = path.join(workDir, 'data');
  const tmpDir = path.join(workDir, 'tmp');
  const exportDir = path.join(workDir, 'export-out');
  await mkdir(dataDir, { recursive: true });
  await mkdir(tmpDir, { recursive: true });
  await mkdir(exportDir, { recursive: true });

  const settingsPath = path.join(projectRoot, 'electron/services/SettingsService.ts');
  const sqlitePath = path.join(projectRoot, 'electron/services/SqliteDataService.ts');
  const poiSourceServicePath = path.join(projectRoot, 'electron/services/PoiSourceService.ts');
  const appDataServicePath = path.join(projectRoot, 'electron/services/AppDataService.ts');
  const appExportServicePath = path.join(projectRoot, 'electron/services/AppExportService.ts');
  const mapPurposeServicePath = path.join(projectRoot, 'electron/services/MapPurposeService.ts');
  const diagnosticsPath = path.join(projectRoot, 'electron/services/ResourceDiagnosticsService.ts');
  const badgesPath = path.join(projectRoot, 'src/utils/resourceDiagnosticsBadges.ts');
  const resourceListTypesPath = path.join(projectRoot, 'src/components/resource-list/resourceListTypes.ts');
  const searchIpcPath = path.join(projectRoot, 'electron/ipc/search.ts');
  const poiResolverPath = path.join(projectRoot, 'electron/services/poiReferenceResolver.ts');

  await writeFile(
    electronStubFile,
    `
      const handlers = new Map<string, any>();
      export const __handlers = handlers;
      export const app = {
        getPath(name: string) {
          if (name === 'documents') return ${JSON.stringify(path.join(workDir, 'documents'))};
          if (name === 'temp') return ${JSON.stringify(tmpDir)};
          if (name === 'appData') return ${JSON.stringify(path.join(workDir, 'appData'))};
          return ${JSON.stringify(workDir)};
        },
        getName() { return 'MaplatEditorSmoke'; },
        whenReady() { return Promise.resolve(); },
        exit(code?: number) { if (code && code !== 0) process.exitCode = code; },
      };
      export const ipcMain = {
        handle: (ch: string, fn: any) => handlers.set(ch, fn),
        removeHandler: (ch: string) => handlers.delete(ch),
      };
      export const dialog = {
        showSaveDialog() { return Promise.resolve((globalThis as any).__nextDialogResult || { canceled: true, filePath: undefined }); },
        showOpenDialog() { return Promise.resolve({ canceled: true, filePaths: [] }); },
        showMessageBox() { return Promise.resolve({ response: 0, checkboxChecked: false }); },
      };
      export const BrowserWindow = class {
        static fromWebContents() { return { webContents: { send() {} } }; }
        static getAllWindows() { return []; }
      };
      export const session = { defaultSession: { clearStorageData() { return Promise.resolve(); } } };
      export const shell = { trashItem(_path: string) { return Promise.resolve(); } };
    `,
  );
  await writeFile(
    electronStoreStubFile,
    `
      export default class Store<T extends Record<string, any>> {
        store: T;
        constructor(options: { defaults?: T } = {}) {
          this.store = { ...(options.defaults || {}) } as T;
        }
        get(key: string) { return this.store[key]; }
        set(key: string, value: any) { this.store[key as keyof T] = value; }
        has(key: string) { return Object.prototype.hasOwnProperty.call(this.store, key); }
      }
    `,
  );

  await writeFile(
    entryFile,
    `
      import assert from 'node:assert/strict';
      import path from 'node:path';
      import { readFile } from 'node:fs/promises';
      import fs from 'fs-extra';
      import AdmZip from 'adm-zip';

      process.env.APP_ROOT = ${JSON.stringify(projectRoot)};

      const { default: SettingsService } = await import(${JSON.stringify(settingsPath)});
      SettingsService.set('saveFolder', ${JSON.stringify(dataDir)});
      SettingsService.set('tmpFolder', ${JSON.stringify(tmpDir)});

      const { default: SqliteDataService } = await import(${JSON.stringify(sqlitePath)});
      const { default: PoiSourceService } = await import(${JSON.stringify(poiSourceServicePath)});
      const { default: AppDataService } = await import(${JSON.stringify(appDataServicePath)});
      const { default: AppExportService } = await import(${JSON.stringify(appExportServicePath)});
      const { default: MapPurposeService } = await import(${JSON.stringify(mapPurposeServicePath)});
      const {
        attachMapDiagnostics,
        attachAppDiagnostics,
        attachPoiSourceDiagnostics,
      } = await import(${JSON.stringify(diagnosticsPath)});
      const { buildResourceDiagnosticsBadges } = await import(${JSON.stringify(badgesPath)});
      const { resourceBadgeClass } = await import(${JSON.stringify(resourceListTypesPath)});
      const { registerSearchHandlers } = await import(${JSON.stringify(searchIpcPath)});
      const { __handlers } = await import(${JSON.stringify(electronStubFile)});
      const { default: PoiSourceServiceForMemo } = await import(${JSON.stringify(poiSourceServicePath)});
      const {
        MISSING_ASSET_REF_WARNING,
        UNRESOLVED_ICON_WARNING,
        resolveAssetRefsForExport,
        resolvePoisArray,
      } = await import(${JSON.stringify(poiResolverPath)});

      await SqliteDataService.getDb();

      const missingPoiUid = '99999999-9999-4999-8999-999999999999';
      const missingAssetUid = '88888888-8888-4888-8888-888888888888';
      const missingBaseMapUid = '77777777-7777-4777-8777-777777777777';
      const baseMapUid = '66666666-6666-4666-8666-666666666666';
      const baseMapThumbnailBytes = Buffer.from('m12-t16-base-map-thumbnail');

      function fc(id: string, props: Record<string, unknown> = {}) {
        return {
          type: 'FeatureCollection',
          id,
          features: [
            { type: 'Feature', id: id + '-f', geometry: { type: 'Point', coordinates: [139, 35] }, properties: { name: { ja: id }, ...props } },
          ],
        };
      }
      function maplatSource(ref: string) {
        return { sourceType: 'maplat', mapUid: ref, role: 'maplat', startFrom: true, data: { mapID: ref, maptype: 'maplat', noload: true } };
      }
      function tmsSource(thumbnail: string) {
        return { sourceType: 'tms', mapUid: 'tms-' + thumbnail, role: 'base', data: { mapID: 'tms-' + thumbnail, thumbnail } };
      }
      function assertBadgeKeys(actual: any[], expected: string[], label: string) {
        assert.deepEqual(actual.map((badge) => badge.key), expected, label + ' badge key order');
      }

      const normalPoi = await PoiSourceService.createLocal({ slug: 'diag-normal-poi', title: { ja: '正常POI' }, lang: 'ja' });
      assert.equal(normalPoi.result, 'Success');
      await PoiSourceService.save(normalPoi.uid, {
        slug: 'diag-normal-poi',
        title: { ja: '正常POI' },
        fc: fc('normal-poi'),
      });
      const assetMissingPoi = await PoiSourceService.createLocal({ slug: 'diag-asset-missing-poi', title: { ja: '欠損POI' }, lang: 'ja' });
      assert.equal(assetMissingPoi.result, 'Success');
      await PoiSourceService.save(assetMissingPoi.uid, {
        slug: 'diag-asset-missing-poi',
        title: { ja: '欠損POI' },
        fc: fc('asset-missing-poi', { html: { ja: '<p>画像 maplat-asset:' + missingAssetUid + '</p>' } }),
      });
      const iconMissingPoi = await PoiSourceService.createLocal({ slug: 'diag-icon-missing-poi', title: { ja: 'icon欠損POI' }, lang: 'ja' });
      assert.equal(iconMissingPoi.result, 'Success');
      await PoiSourceService.save(iconMissingPoi.uid, {
        slug: 'diag-icon-missing-poi',
        title: { ja: 'icon欠損POI' },
        fc: fc('icon-missing-poi', { icon: missingAssetUid }),
      });
      const remoteAssetMissingPoiUid = '55555555-5555-4555-8555-555555555555';
      await SqliteDataService.createPoiSource('diag-remote-asset-missing-poi', {
        title: { ja: 'remote欠損POI' },
        mode: 'remote',
        url: 'https://example.com/remote-poi.geojson',
        dataJson: JSON.stringify(fc('remote-asset-missing-poi', { html: { ja: 'maplat-asset:' + missingAssetUid } })),
        featureCount: 1,
      }, remoteAssetMissingPoiUid);

      const { uid: normalMapUid } = await SqliteDataService.createMap('diag-normal-map', { title: { ja: '正常地図' }, compiled: { strict_status: 'strict' }, pois: [] });
      const { uid: strictMapUid } = await SqliteDataService.createMap('diag-strict-map', { title: { ja: 'strict地図' }, compiled: { strict_status: 'strict_error' }, pois: [] });
      const { uid: subStrictMapUid } = await SqliteDataService.createMap('diag-sub-strict-map', {
        title: { ja: 'sub strict地図' },
        compiled: { strict_status: 'strict' },
        sub_maps: [{ compiled: { strict_status: 'strict_error' } }],
        pois: [],
      });
      const { uid: missingPoiMapUid } = await SqliteDataService.createMap('diag-missing-poi-map', { title: { ja: 'POI欠損地図' }, pois: [{ poiUid: missingPoiUid }] });
      const { uid: inlineOnlyMapUid } = await SqliteDataService.createMap('diag-inline-map', {
        title: { ja: 'inline地図' },
        pois: [
          fc('inline-fc'),
          { type: 'Feature', geometry: { type: 'Point', coordinates: [139, 35] }, properties: { name: 'raw feature' } },
          'https://example.com/pois.geojson',
          { poiUid: 'not-a-uuid', cachedTitle: 'not uuid' },
          42,
        ],
      });
      const { uid: assetMapUid } = await SqliteDataService.createMap('diag-asset-map', {
        title: { ja: 'asset欠損地図' },
        pois: [fc('asset-map', { html: { ja: '<img src="maplat-asset:' + missingAssetUid + '">' } })],
      });
      const { uid: iconMapUid } = await SqliteDataService.createMap('diag-icon-map', {
        title: { ja: 'icon欠損地図' },
        pois: [fc('icon-map', { icon: missingAssetUid })],
      });
      const { uid: referencedAssetMapUid } = await SqliteDataService.createMap('diag-ref-asset-map', {
        title: { ja: '参照先asset欠損地図' },
        pois: [{ poiUid: assetMissingPoi.uid }],
      });

      await fs.ensureDir(path.join(${JSON.stringify(dataDir)}, 'tmbs'));
      await fs.writeFile(path.join(${JSON.stringify(dataDir)}, 'tmbs', baseMapUid + '.png'), baseMapThumbnailBytes);
      await SqliteDataService.saveUserBaseMap({
        uid: baseMapUid,
        slug: 'diag-base-ok',
        create: true,
        tms: { title: { ja: '正常ベース' }, url: 'https://example.com/{z}/{x}/{y}.png', thumbnail: 'tmbs/' + baseMapUid + '.png' },
      });

      const mapDocs = await Promise.all([
        SqliteDataService.findMapByRef(normalMapUid),
        SqliteDataService.findMapByRef(strictMapUid),
        SqliteDataService.findMapByRef(subStrictMapUid),
        SqliteDataService.findMapByRef(missingPoiMapUid),
        SqliteDataService.findMapByRef(inlineOnlyMapUid),
        SqliteDataService.findMapByRef(assetMapUid),
        SqliteDataService.findMapByRef(iconMapUid),
        SqliteDataService.findMapByRef(referencedAssetMapUid),
      ]);
      await attachMapDiagnostics(mapDocs);
      const [normalMap, strictMap, subStrictMap, missingPoiMap, inlineOnlyMap, assetMap, iconMap, referencedAssetMap] = mapDocs;
      assert.deepEqual(normalMap.resourceDiagnostics, { kind: 'map', strictError: false, missingPoiRefs: false, missingAssetRefs: false });
      assert.equal(strictMap.resourceDiagnostics.strictError, true, 'M1 strict_error');
      assert.equal(subStrictMap.resourceDiagnostics.strictError, true, 'M1 sub_maps strict_error');
      assert.equal(missingPoiMap.resourceDiagnostics.missingPoiRefs, true, 'M2 missing poi');
      assert.equal(inlineOnlyMap.resourceDiagnostics.missingPoiRefs, false, 'M3 inline/url/non UUID は POI 欠損にしない');
      assert.equal(assetMap.resourceDiagnostics.missingAssetRefs, true, 'M4 inline FC asset 欠損');
      assert.equal(iconMap.resourceDiagnostics.missingAssetRefs, true, 'M4 inline FC unresolved icon');
      assert.equal(referencedAssetMap.resourceDiagnostics.missingAssetRefs, true, 'M4 参照先 POI source 内 asset 欠損');
      console.log('ok: Part 2/3 map diagnostics classes');

      const mapRefCases = [
        { label: 'none', refs: [], expectedMissing: [], expectedStrict: [] },
        { label: 'present-normal', refs: [normalMapUid], expectedMissing: [], expectedStrict: [] },
        { label: 'present-normal-duplicate', refs: [normalMapUid, normalMapUid], expectedMissing: [], expectedStrict: [] },
        { label: 'missing', refs: [missingPoiUid], expectedMissing: [missingPoiUid], expectedStrict: [] },
        { label: 'missing-duplicate', refs: [missingPoiUid, missingPoiUid], expectedMissing: [missingPoiUid], expectedStrict: [] },
        { label: 'strict', refs: [strictMapUid], expectedMissing: [], expectedStrict: [strictMapUid] },
        { label: 'strict-duplicate', refs: [strictMapUid, strictMapUid], expectedMissing: [], expectedStrict: [strictMapUid] },
        { label: 'sub-strict', refs: [subStrictMapUid], expectedMissing: [], expectedStrict: [subStrictMapUid] },
        { label: 'present-plus-missing', refs: [normalMapUid, missingPoiUid], expectedMissing: [missingPoiUid], expectedStrict: [] },
        { label: 'present-plus-strict', refs: [normalMapUid, strictMapUid], expectedMissing: [], expectedStrict: [strictMapUid] },
        { label: 'missing-plus-strict', refs: [missingPoiUid, strictMapUid], expectedMissing: [missingPoiUid], expectedStrict: [strictMapUid] },
      ];
      for (const c of mapRefCases) {
        const expected = c.expectedMissing.length > 0 || c.expectedStrict.length > 0;
        const doc = { appID: 'app-' + c.label, lang: 'ja', sources: c.refs.map(maplatSource) };
        await attachAppDiagnostics([doc]);
        const refs = MapPurposeService.collectMaplatMapRefs(doc);
        const classification = await MapPurposeService.classifyViewerRuntimeRefs(refs);
        const gateRejected = classification.missing.length > 0 || classification.strictError.length > 0;
        assert.deepEqual([...refs].sort(), [...new Set(c.refs)].sort(), c.label + ' collectMaplatMapRefs dedup');
        assert.deepEqual(classification.missing.sort(), c.expectedMissing.slice().sort(), c.label + ' missing refs');
        assert.deepEqual(classification.strictError.sort(), c.expectedStrict.slice().sort(), c.label + ' strict refs');
        if (expected) {
          await assert.rejects(() => MapPurposeService.assertViewerRuntimeAllowed(refs), /appedit\\.preview\\.strict_error/, c.label + ' assertViewerRuntimeAllowed');
        } else {
          await MapPurposeService.assertViewerRuntimeAllowed(refs);
        }
        const save = await AppDataService.saveApp({ slug: 'save-' + c.label, document: { ...doc, title: { ja: c.label } } });
        assert.equal(doc.resourceDiagnostics.mapRefError, expected, c.label + ' mapRefError');
        assert.equal(gateRejected, expected, c.label + ' classifyViewerRuntimeRefs');
        assert.equal(save.result === 'Error', expected, c.label + ' AppDataService.saveApp gate');
      }
      console.log('ok: Part 1 gate/classify/app diagnostics equivalence');

      const appCases = [
        { label: 'base-missing', doc: { appID: 'base-missing', lang: 'ja', sources: [tmsSource('tmbs/' + missingBaseMapUid + '.png')] }, field: 'missingBaseMapRefs', expected: true },
        { label: 'base-present', doc: { appID: 'base-present', lang: 'ja', sources: [tmsSource('tmbs/' + baseMapUid + '.png')] }, field: 'missingBaseMapRefs', expected: false },
        { label: 'base-builtin', doc: { appID: 'base-builtin', lang: 'ja', sources: [{ sourceType: 'builtin', mapUid: 'osm', role: 'base' }] }, field: 'missingBaseMapRefs', expected: false },
        { label: 'base-pattern-out', doc: { appID: 'base-pattern-out', lang: 'ja', sources: [tmsSource('tmbs/not-a-uuid.png')] }, field: 'missingBaseMapRefs', expected: false },
        { label: 'app-poi-missing', doc: { appID: 'app-poi-missing', lang: 'ja', sources: [], pois: [{ poiUid: missingPoiUid }] }, field: 'missingPoiRefs', expected: true },
        { label: 'app-asset-missing', doc: { appID: 'app-asset-missing', lang: 'ja', sources: [], pois: [fc('app-asset', { html: { ja: 'maplat-asset:' + missingAssetUid } })] }, field: 'missingAssetRefs', expected: true },
        { label: 'app-icon-missing', doc: { appID: 'app-icon-missing', lang: 'ja', sources: [], pois: [fc('app-icon', { icon: missingAssetUid })] }, field: 'missingAssetRefs', expected: true },
      ];
      for (const c of appCases) {
        await attachAppDiagnostics([c.doc]);
        assert.equal(c.doc.resourceDiagnostics[c.field], c.expected, c.label + ' ' + c.field);
      }
      const sameMapDoc = { title: { ja: '同一fixture地図' }, pois: [{ poiUid: missingPoiUid }, fc('same-asset', { html: { ja: 'maplat-asset:' + missingAssetUid } })] };
      const sameAppDoc = { appID: 'same-fixture-app', lang: 'ja', sources: [], pois: sameMapDoc.pois };
      await attachMapDiagnostics([sameMapDoc]);
      await attachAppDiagnostics([sameAppDoc]);
      assert.equal(sameMapDoc.resourceDiagnostics.missingPoiRefs, sameAppDoc.resourceDiagnostics.missingPoiRefs, 'AC6 POI欠損はmap/appで一致');
      assert.equal(sameMapDoc.resourceDiagnostics.missingAssetRefs, sameAppDoc.resourceDiagnostics.missingAssetRefs, 'AC6 asset欠損はmap/appで一致');
      console.log('ok: Part 2 app diagnostics classes');

      const a6Cases = [
        { label: 'array', pois: [fc('array')], expected: false },
        { label: 'empty-array', pois: [], expected: false },
        { label: 'stringify-once', pois: JSON.stringify([fc('once')]), expected: true },
        { label: 'stringify-deep', pois: JSON.stringify(JSON.stringify([fc('deep')])), expected: true },
        { label: 'stringify-empty-deep', pois: JSON.stringify(JSON.stringify([])), expected: true },
        { label: 'layer-object', pois: { main: fc('layer-object') }, expected: true },
        { label: 'url-string', pois: 'https://example.com/pois.geojson', expected: true },
        { label: 'junk-number', pois: 123, expected: true },
        { label: 'null', pois: null, expected: false },
        { label: 'undefined', expected: false },
      ];
      for (const c of a6Cases) {
        const doc = { appID: 'a6-' + c.label, lang: 'ja', sources: [], pois: c.pois };
        await attachAppDiagnostics([doc]);
        assert.equal(doc.resourceDiagnostics.unsupportedPoisFormat, c.expected, 'A6 ' + c.label);
      }
      console.log('ok: Part 4 A6 unsupported pois table');

      const poiRows = [
        { uid: normalPoi.uid, slug: 'diag-normal-poi', title: { ja: '正常POI' }, mode: 'local', url: null, featureCount: 1, revision: 1, updatedAt: '' },
        { uid: assetMissingPoi.uid, slug: 'diag-asset-missing-poi', title: { ja: '欠損POI' }, mode: 'local', url: null, featureCount: 1, revision: 1, updatedAt: '' },
        { uid: remoteAssetMissingPoiUid, slug: 'diag-remote-asset-missing-poi', title: { ja: 'remote欠損POI' }, mode: 'remote', url: 'https://example.com/remote-poi.geojson', featureCount: 1, revision: 1, updatedAt: '' },
        { uid: iconMissingPoi.uid, slug: 'diag-icon-missing-poi', title: { ja: 'icon欠損POI' }, mode: 'local', url: null, featureCount: 1, revision: 1, updatedAt: '' },
        { uid: missingPoiUid, slug: 'broken-poi', title: { ja: '破損POI' }, mode: 'local', url: null, featureCount: 0, revision: 1, updatedAt: '' },
      ];
      await attachPoiSourceDiagnostics(poiRows);
      assert.equal(poiRows[0].resourceDiagnostics.missingAssetRefs, false, 'P2 asset 欠損なし');
      assert.equal(poiRows[1].resourceDiagnostics.missingAssetRefs, true, 'P1 local html asset 欠損');
      assert.equal(poiRows[2].resourceDiagnostics.missingAssetRefs, true, 'P3 remote snapshot html asset 欠損');
      assert.equal(poiRows[3].resourceDiagnostics.missingAssetRefs, true, 'P1 local unresolved icon');
      assert.equal(poiRows[4].resourceDiagnostics.missingAssetRefs, false, 'exportForm null は対象外');
      console.log('ok: Part 2 POI source diagnostics classes');

      const fakeWin = { webContents: { send() {} } };
      const exportZipPath = path.join(${JSON.stringify(exportDir)}, 'diag-thumbnail-export.zip');
      (globalThis as any).__nextDialogResult = { canceled: false, filePath: exportZipPath };
      const exportDocument = {
        appID: 'diag_thumbnail_export',
        title: { ja: 'thumbnail export' },
        lang: 'ja',
        sources: [tmsSource('tmbs/' + baseMapUid + '.png')],
        appSettings: {},
        httpSettings: { enableCache: false, pwaManifest: false },
      };
      const exported = await AppExportService.exportApp(fakeWin as any, exportDocument);
      assert.equal(exported.result, 'Success', 'AppExportService thumbnail export should succeed: ' + JSON.stringify(exported));
      assert.ok(!exported.warnings.includes('appedit.export.missing_thumbnail'), 'resolved base map thumbnail should not warn: ' + JSON.stringify(exported.warnings));
      const exportExtractDir = path.join(${JSON.stringify(exportDir)}, 'diag-thumbnail-export-extract');
      await fs.emptyDir(exportExtractDir);
      new AdmZip(exported.outDir).extractAllTo(exportExtractDir, true);
      const exportedAppJson = JSON.parse(await readFile(path.join(exportExtractDir, 'apps', 'diag_thumbnail_export.json'), 'utf8'));
      assert.equal(exportedAppJson.sources[0].thumbnail, 'tmbs/diag-base-ok.png', 'export app JSON thumbnail is rewritten from uid to slug');
      const copiedThumbnail = await readFile(path.join(exportExtractDir, 'tmbs', 'diag-base-ok.png'));
      assert.ok(copiedThumbnail.equals(baseMapThumbnailBytes), 'export copies the original uid thumbnail bytes to the rewritten slug path');
      assert.equal(await fs.pathExists(path.join(exportExtractDir, 'tmbs', baseMapUid + '.png')), false, 'export does not leave the internal uid thumbnail path in the package');
      console.log('ok: Part 2 AppExportService thumbnail rewrite/copy path');

      let exportFormCalls = 0;
      const originalExportForm = PoiSourceServiceForMemo.exportForm;
      PoiSourceServiceForMemo.exportForm = async function (...args: any[]) {
        exportFormCalls++;
        return originalExportForm.apply(this, args as never);
      };
      try {
        const duplicated = { title: { ja: 'memo' }, pois: [{ poiUid: normalPoi.uid }, { poiUid: normalPoi.uid }] };
        await attachMapDiagnostics([duplicated]);
        assert.equal(exportFormCalls, 1, '同一 attach 呼び出し内では exportForm を uid ごとに memo 化する');
      } finally {
        PoiSourceServiceForMemo.exportForm = originalExportForm;
      }

      const iconResolved = await resolvePoisArray([fc('unresolved-icon', { icon: missingAssetUid })]);
      assert.ok(iconResolved.warnings.includes(UNRESOLVED_ICON_WARNING), 'fixture sanity: unresolved icon warning');
      const assetResolved = await resolveAssetRefsForExport(fc('missing-asset', { html: { ja: 'maplat-asset:' + missingAssetUid } }), new Map());
      assert.ok(assetResolved.warnings.includes(MISSING_ASSET_REF_WARNING), 'fixture sanity: missing asset ref warning');

      registerSearchHandlers();
      const mapsHandler = __handlers.get('search:maps');
      const appsHandler = __handlers.get('search:apps');
      const poiHandler = __handlers.get('search:poiSources');
      assert.ok(mapsHandler && appsHandler && poiHandler, 'search handlers must be registered');
      const pagedMaps = await mapsHandler(null, { q: 'diag-', page: 1, pageSize: 20 });
      assert.ok(pagedMaps.docs.some((doc: any) => doc.resourceDiagnostics?.kind === 'map'), 'paged maps attach diagnostics');
      const allMaps = await mapsHandler(null, { q: 'diag-', page: 1, pageSize: 0 });
      assert.ok(allMaps.docs.every((doc: any) => !('resourceDiagnostics' in doc)), 'pageSize<=0 maps do not attach diagnostics');
      const pagedApps = await appsHandler(null, { q: 'base-', page: 1, pageSize: 20 });
      assert.ok(pagedApps.docs.every((doc: any) => doc.resourceDiagnostics?.kind === 'app'), 'paged apps attach diagnostics');
      const allPoi = await poiHandler(null, { q: 'diag-', page: 1, pageSize: 0 });
      assert.ok(allPoi.docs.every((doc: any) => !('resourceDiagnostics' in doc)), 'pageSize<=0 poi sources do not attach diagnostics');
      console.log('ok: Part 5 bounded/unbounded search diagnostics');

      const labels = {
        strictError: 'strictエラー',
        mapRefError: '参照地図エラー',
        missingBaseMap: 'ベースマップ欠損',
        missingPoi: 'POI参照欠損',
        missingAsset: 'アセット欠損',
        poisFormat: 'POI形式未対応',
      };
      assertBadgeKeys(
        buildResourceDiagnosticsBadges({
          kind: 'app',
          mapRefError: true,
          missingBaseMapRefs: true,
          missingPoiRefs: true,
          missingAssetRefs: true,
          unsupportedPoisFormat: true,
        }, labels),
        ['map-ref-error', 'missing-base-map', 'missing-poi', 'missing-asset', 'pois-format'],
        'app diagnostics badges',
      );
      assertBadgeKeys(
        buildResourceDiagnosticsBadges({ kind: 'map', strictError: true, missingPoiRefs: true, missingAssetRefs: true }, labels),
        ['strict-error', 'missing-poi', 'missing-asset'],
        'map diagnostics badges',
      );
      assert.equal(resourceBadgeClass('danger'), 'bg-danger');
      assert.equal(resourceBadgeClass('warning'), 'bg-warning text-dark');
      console.log('ok: Part 6 renderer badge helper');

      const localeFiles = ${JSON.stringify(['en', 'ja', 'de', 'ko', 'vi', 'zh', 'zh-TW', 'fr', 'es', 'th', 'id'])};
      const requiredKeys = [
        'badge_strict_error',
        'badge_map_ref_error',
        'badge_missing_base_map',
        'badge_missing_poi',
        'badge_missing_asset',
        'badge_pois_format',
      ];
      for (const locale of localeFiles) {
        const json = JSON.parse(await readFile(path.join(${JSON.stringify(projectRoot)}, 'public/locales', locale, 'translation.json'), 'utf8'));
        for (const key of requiredKeys) {
          assert.equal(typeof json.resource_list?.[key], 'string', locale + ' resource_list.' + key);
          assert.notEqual(json.resource_list[key].trim(), '', locale + ' resource_list.' + key + ' non-empty');
        }
      }
      console.log('ok: Part 6 i18n keys');

      const strictPattern = /strict_status\\s*===\\s*['"]strict_error['"]/g;
      const scanRoots = ['src', 'electron', 'scripts', 'tests'];
      const strictScanExtensions = new Set(['.cjs', '.cts', '.js', '.jsx', '.json', '.mjs', '.mts', '.ts', '.tsx', '.vue']);
      async function collectTextFiles(relDir: string, out: string[] = []) {
        const absDir = path.join(${JSON.stringify(projectRoot)}, relDir);
        const entries = await fs.readdir(absDir, { withFileTypes: true });
        for (const entry of entries) {
          const childRel = path.join(relDir, entry.name);
          if (entry.isDirectory()) {
            if (entry.name === 'node_modules' || entry.name === '.git') continue;
            await collectTextFiles(childRel, out);
          } else if (entry.isFile() && strictScanExtensions.has(path.extname(entry.name))) {
            out.push(childRel.split(path.sep).join('/'));
          }
        }
        return out;
      }
      const staticFiles: string[] = [];
      for (const root of scanRoots) {
        staticFiles.push(...await collectTextFiles(root));
      }
      const strictHits: string[] = [];
      for (const rel of staticFiles) {
        const text = await readFile(path.join(${JSON.stringify(projectRoot)}, rel), 'utf8');
        for (const match of text.matchAll(strictPattern)) {
          const lineNumber = text.slice(0, match.index).split('\\n').length;
          const lineText = text.split('\\n')[lineNumber - 1].trim();
          strictHits.push(rel + ':' + lineNumber + ':' + lineText);
        }
      }
      function allowedStrictHit(hit: string): boolean {
        const lineText = hit.replace(/^[^:]+:\\d+:/, '');
        if (hit.startsWith('electron/services/MapEditService.ts:')) {
          return /compiled\\?\\.strict_status\\s*===\\s*['"]strict_error['"]/.test(lineText);
        }
        if (hit.startsWith('src/views/MapEdit.vue:')) {
          return /tin\\.strict_status\\s*===\\s*['"]strict_error['"]/.test(lineText);
        }
        return hit.startsWith('scripts/m12-t16-resource-diagnostics-smoke.mjs:');
      }
      const unexpectedStrictHits = strictHits.filter((hit) => !allowedStrictHit(hit));
      assert.deepEqual(unexpectedStrictHits, [], 'strict_status === strict_error 直書きは許容箇所以外に残さない: ' + unexpectedStrictHits.join(' | '));
      assert.equal(strictHits.filter((hit) => hit.startsWith('electron/services/MapEditService.ts')).length, 1, '正準 hasStrictError だけが MapEditService に残る');
      assert.ok(strictHits.some((hit) => hit.includes('src/views/MapEdit.vue') && hit.includes('tin.strict_status')), 'MapEdit.vue の TIN 単位判定は残す');
      assert.equal(strictHits.filter((hit) => hit.includes('src/views/MapEdit.vue')).length, 2, 'MapEdit.vue の TIN 単位判定は2箇所');
      assert.ok(!strictHits.some((hit) => hit.startsWith('electron/services/MapDataService.ts')), 'MapDataService private重複は撤去');
      assert.ok(!strictHits.some((hit) => hit.startsWith('src/views/resource-adapters/mapListAdapter.ts')), 'mapListAdapter renderer重複は撤去');
      const diagnosticsSource = await readFile(path.join(${JSON.stringify(projectRoot)}, 'electron/services/ResourceDiagnosticsService.ts'), 'utf8');
      assert.equal(/\\bpoiSources\\b/.test(diagnosticsSource), false, 'ResourceDiagnosticsService に旧 poiSources フィールドを持ち込まない');
      console.log('ok: Part 7 static constraints');

      console.log('M12-T16 resource diagnostics smoke passed');
      process.exit(0);
    `,
  );

  await build({
    configFile: false,
    logLevel: 'silent',
    resolve: {
      alias: [
        { find: 'electron', replacement: electronStubFile },
        { find: 'electron-store', replacement: electronStoreStubFile },
      ],
    },
    build: {
      emptyOutDir: true,
      outDir,
      ssr: entryFile,
      target: 'node22',
      rollupOptions: {
        external: [
          '@duckdb/node-api',
          '@duckdb/node-bindings',
          /^@duckdb\/node-bindings-.*/,
          'jimp',
          'pwa-asset-generator',
          '@maplat/tin',
          '@maplat/transform',
          'adm-zip',
        ],
        output: {
          entryFileNames: 'm12-t16-resource-diagnostics-smoke.mjs',
          format: 'es',
        },
      },
    },
  });

  await execFileAsync(process.execPath, [bundledFile], {
    cwd: projectRoot,
    timeout: 180000,
    maxBuffer: 1024 * 1024 * 8,
  });
} finally {
  await rm(workDir, { recursive: true, force: true });
}
