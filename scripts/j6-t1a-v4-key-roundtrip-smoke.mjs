import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { build } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const scratch = path.join(root, '.tmp-smoke');
await mkdir(scratch, { recursive: true });
const workDir = await mkdtemp(path.join(scratch, 'j6-t1a-'));
const entry = path.join(workDir, 'entry.ts');
const electronStub = path.join(workDir, 'electron.ts');
const storeStub = path.join(workDir, 'electron-store.ts');
const outDir = path.join(workDir, 'dist');

try {
  await writeFile(electronStub, `
    export const app = { getPath: () => ${JSON.stringify(workDir)}, getName: () => 'MaplatEditor' };
    export const dialog = {
      filePath: '',
      async showSaveDialog() { return { canceled: false, filePath: this.filePath }; },
    };
    export const BrowserWindow = class { static getAllWindows() { return []; } };
    export const shell = {};
  `);
  await writeFile(storeStub, `
    export default class Store {
      constructor({ defaults = {} } = {}) { this.store = { ...defaults }; }
      get(key) { return this.store[key]; }
      set(key, value) { this.store[key] = value; }
      has(key) { return Object.hasOwn(this.store, key); }
    }
  `);
  await writeFile(entry, String.raw`
    import assert from 'node:assert/strict';
    import { mkdir } from 'node:fs/promises';
    import path from 'node:path';
    import AdmZip from 'adm-zip';
    import proj4 from 'proj4';
    import { dialog } from 'electron';
    import Tin from '@maplat/tin';
    import SettingsService from '../../electron/services/SettingsService';
    import SqliteDataService from '../../electron/services/SqliteDataService';
    import DataUploadService from '../../electron/services/DataUploadService';
    import MapEditService from '../../electron/services/MapEditService';
    import MapPurposeService from '../../electron/services/MapPurposeService';
    import { store2HistMap, histMap2Store } from '../../electron/utils/store_handler';
    import { composeDownloadMapJson } from '../../electron/utils/mapDownloadZip';
    import { buildExportManifest, EXPORT_MANIFEST_NAME } from '../../src/utils/exportOptions';

    const workDir = process.argv[2];
    const saveFolder = path.join(workDir, 'data');
    const tmpFolder = path.join(workDir, 'tmp');
    await mkdir(saveFolder);
    await mkdir(tmpFolder);
    SettingsService.set('saveFolder', saveFolder);
    SettingsService.set('tmpFolder', tmpFolder);
    const db = await SqliteDataService.getDb();
    const win = { webContents: { send() {} }, isDestroyed: () => false };
    const options = { tiles: false, json: true, originals: false };
    const json = (doc) => JSON.parse(JSON.stringify(doc));

    const wgs = { epsg: 4326 };
    const japan = { epsg: 6677, proj4: '+proj=tmerc +lat_0=36 +lon_0=139.833333333333 +k=0.9999 +ellps=GRS80 +towgs84=0,0,0 +units=m +axis=enu' };
    const bounds = [[10, 10], [90, 10], [90, 70], [10, 70]];
    const wf = { xScale: 0.001, xSkew: 0.0001, xOrigin: 139.5, ySkew: 0.0002, yScale: -0.001, yOrigin: 36.5 };
    const a = {
      width: 100, height: 80, crs: wgs, worldFile: wf, tinEnabled: false,
      gcps: [[[10, 10], [139.51, 36.49]]], edges: [],
    };
    const aSub = { crs: wgs, worldFile: { ...wf, xOrigin: 140 }, tinEnabled: false, bounds, gcps: a.gcps, edges: [] };

    // B は境界頂点をワールドファイルで置き、外挿用の頂点パラメーターと重心を省略する。
    async function compiledTin(outerTransform, sub = false) {
      const exterior = { xScale: 2, xSkew: 0, xOrigin: 1000, ySkew: 0, yScale: -2, yOrigin: 2000 };
      const inCrs = ([x, y]) => [exterior.xOrigin + 2 * (x - 0.5), exterior.yOrigin - 2 * (y - 0.5)];
      const tin = new Tin({
        useV2Algorithm: false, yaxisMode: 'follow', strictMode: 'loose', vertexMode: 'plain',
        ...(sub ? { bounds } : { wh: [100, 80] }),
      });
      tin.setPoints([[20, 20], [75, 25], [25, 55], [78, 60]].map(xy => [xy, inCrs(xy)]));
      await tin.updateTinAsync();
      const compiled = { ...tin.getCompiled(), outerTransform };
      if (outerTransform === 'worldFile') {
        compiled.worldFile = exterior;
        compiled.vertices_points = compiled.vertices_points.map(([xy]) => {
          const [x, y] = inCrs(xy);
          return [xy, [x, -y]];
        });
        delete compiled.vertices_params;
        delete compiled.centroid_point;
      }
      return json(compiled);
    }

    const b = { crs: japan, compiled: await compiledTin('worldFile') };
    const bSub = { crs: japan, compiled: await compiledTin('worldFile', true) };
    const c = { crs: japan, compiled: await compiledTin('extrapolate') };
    const cSub = { crs: japan, compiled: await compiledTin('extrapolate', true) };
    const sub = (layer, index) => ({ ...layer, priority: index + 1, importance: index + 1 });
    const map = (layer, sub_maps = []) => ({ title: '位置合わせ試験', attr: '試験', lang: 'ja', ...layer, sub_maps: sub_maps.map(sub) });

    async function importZip(slug, doc) {
      const zip = new AdmZip();
      zip.addFile('maps/' + slug + '.json', Buffer.from(JSON.stringify(doc)));
      zip.addFile(EXPORT_MANIFEST_NAME, Buffer.from(buildExportManifest(options)));
      const file = path.join(workDir, slug + '.zip');
      zip.writeZip(file);
      return DataUploadService.extractZip(file);
    }

    function fields(layer) {
      const keys = ['crs', 'tinEnabled', 'worldFile', 'outerTransform', 'compiled', 'unknownKey'];
      if (layer.tinEnabled === false) keys.push('width', 'height', 'bounds', 'gcps', 'edges');
      return Object.fromEntries(keys.filter(key => Object.hasOwn(layer, key)).map(key => [key, layer[key]]));
    }
    const allFields = doc => [fields(doc), ...doc.sub_maps.map(fields)];

    for (const [slug, doc] of [
      ['roundtrip-a', map(a, [bSub, aSub, cSub])],
      ['roundtrip-b', map(b, [aSub, cSub])],
      ['roundtrip-c', map(c, [bSub])],
    ]) {
      const [hist, tins] = await store2HistMap(doc, true);
      assert.deepEqual(tins.map(tin => typeof tin === 'string' ? tin : tin.outerTransform),
        [doc, ...doc.sub_maps].map(layer => layer.tinEnabled === false ? 'worldFile' : layer.compiled.outerTransform),
        'ワールドファイルの印を主図と副層で保持する');
      const saved = json(await histMap2Store(hist, [...tins]));
      assert.deepEqual(allFields(saved), allFields(doc), slug + ' 保存時の鍵');
      const exported = json((await composeDownloadMapJson(hist, [...tins])).compiled);
      assert.deepEqual(allFields(exported), allFields(doc), slug + ' 書き出し時の鍵');
      const imported = await importZip(slug, exported);
      assert.ok(imported.mapData, JSON.stringify(imported));
      const stored = await SqliteDataService.findMapByRef(slug);
      assert.deepEqual(allFields(stored), allFields(doc), slug + ' 再取込後の DB の鍵');
      const [histDefault, tinsDefault] = await store2HistMap(doc);
      assert.deepEqual(allFields(json(await histMap2Store(histDefault, tinsDefault))), allFields(doc),
        slug + ' Transform を返す読み込み経路の鍵');
    }
    const aOnly = map(a, [aSub]);
    assert.deepEqual(allFields(json(await histMap2Store(aOnly, []))), allFields(aOnly));
    assert.deepEqual(allFields(json(await histMap2Store(aOnly, [b.compiled, bSub.compiled]))), allFields(aOnly));
    const edit = await MapEditService.request('roundtrip-b');
    const save = await MapEditService.save({
      mapObject: { ...edit, title: '再保存した地図' }, tins: edit.compiledTins, uid: edit.uid,
      slug: edit.mapID, expectedRevision: edit.revision,
    });
    assert.equal(save.result, 'Success');
    assert.deepEqual(allFields(await SqliteDataService.findMapByRef(edit.uid)), allFields(map(b, [aSub, cSub])));
    console.log('受け入れ条件1: A／B／C の主図と混在する副層が保存・ZIP 往復で一致');

    const stale = { worldFile: wf, tinEnabled: true, outerTransform: 'worldFile', unknownKey: 1 };
    const cWithStaleCompiled = { ...cSub, compiled: { ...cSub.compiled, worldFile: wf } };
    const staleDoc = map({ ...b, ...stale }, [{ ...cWithStaleCompiled, ...stale }]);
    const [clean, cleanTins] = await store2HistMap(staleDoc, true);
    assert.deepEqual(allFields(clean), allFields(map(b, [cSub])));
    const staleZip = await importZip('stale', staleDoc);
    assert.ok(staleZip.mapData, JSON.stringify(staleZip));
    assert.deepEqual(allFields(await SqliteDataService.findMapByRef('stale')), allFields(map(b, [cSub])));
    assert.deepEqual(allFields(json(await histMap2Store(clean, cleanTins))), allFields(map(b, [cSub])));
    console.log('受け入れ条件2: 旧式の鍵を読み捨て、C の不要な係数を保存しない');

    const createMap = SqliteDataService.createMap.bind(SqliteDataService);
    let createCalls = 0;
    SqliteDataService.createMap = (...args) => { createCalls++; return createMap(...args); };
    const invalid = [
      ['compiled', map({ ...a, compiled: null })],
      ['sub-compiled', map(b, [{ ...aSub, compiled: bSub.compiled }])],
      ['wf', map({ ...a, worldFile: undefined })],
      ['det', map({ ...a, worldFile: { ...wf, yScale: 1 } })],
      ['singular', map({ ...a, worldFile: { ...wf, xScale: 0, xSkew: 0 } })],
      ['width', map({ ...a, width: 0 })],
      ['height', map({ ...a, height: undefined })],
      ['bounds', map(a, [{ ...aSub, bounds: undefined }])],
      ['sub-bounds-range', map(a, [{ ...aSub, worldFile: { ...wf, yOrigin: 100 } }])],
      ['sub-tin-bounds', map(a, [{ ...cSub, compiled: { ...cSub.compiled, bounds: undefined } }])],
      ['crs', map({ ...a, crs: undefined })],
      ['axis', map(b, [{ ...aSub, crs: { epsg: 4326, proj4: '+proj=longlat +datum=WGS84 +axis=neu' } }])],
      ['mismatch', map({ ...a, crs: { epsg: 4326, proj4: '+proj=utm +zone=54 +datum=WGS84' } })],
      ['bad-proj', map({ ...b, crs: { epsg: 6677, proj4: '+proj=unknown' } })],
      ['bad-sub-crs', map(c, [{ ...cSub, crs: null }])],
      ['bad-layer', { ...map(a), sub_maps: [null] }],
      ['missing-b-wf', map({ ...b, compiled: { ...b.compiled, worldFile: undefined } })],
    ];
    for (const [name, doc] of invalid) {
      const slug = 'invalid-' + name;
      assert.deepEqual(await importZip(slug, doc), { err: 'Corrupt' }, slug);
      assert.strictEqual(db.prepare('SELECT uid FROM maps WHERE slug = ?').get(slug), undefined, slug);
      await assert.rejects(store2HistMap(json(doc), true), Error, slug);
    }
    assert.equal(createCalls, 0, '破損した地図は createMap まで到達しない');
    const invalidStored = await createMap('invalid-stored', { ...a, width: 0 });
    await assert.rejects(MapEditService.request(invalidStored.uid), /width/);
    console.log('受け入れ条件3: 破損 ZIP を DB 書き込み前に拒否し、壊れた保存済み地図も明示エラー');

    const preview = await MapEditService.buildPreviewSource('roundtrip-a');
    assert.deepEqual(allFields(json(preview)), allFields(map(a, [bSub, aSub, cSub])));
    const reopened = await MapEditService.request('roundtrip-a');
    assert.equal(reopened.compiledTins[0], 'worldFile');
    assert.equal(reopened.compiledTins[2], 'worldFile');
    dialog.filePath = path.join(workDir, 'saved.zip');
    assert.equal(await MapPurposeService.downloadSavedMap(win, 'roundtrip-a', options), 'Success');
    const savedZip = new AdmZip(dialog.filePath);
    assert.deepEqual(allFields(JSON.parse(savedZip.readAsText('maps/roundtrip-a.json'))), allFields(map(a, [bSub, aSub, cSub])));
    console.log('受け入れ条件4: GCP が 1 点の A の主図・副層でプレビュー用 JSON と保存済み ZIP を生成');

    const sqlBbox = db.prepare('SELECT maplat_map_bbox(?) AS bbox');
    const envelope = pts => {
      const [xs, ys] = [0, 1].map(i => pts.map(pt => pt[i]));
      return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    };
    const merc = (pt, crs) => proj4(crs.proj4 ?? 'EPSG:' + crs.epsg, 'EPSG:3857', pt);
    const wfPoints = (layer, pixels) => pixels.map(([x, y]) => {
      const f = layer.worldFile;
      return merc([
        f.xOrigin + f.xScale * (x - 0.5) + f.xSkew * (y - 0.5),
        f.yOrigin + f.ySkew * (x - 0.5) + f.yScale * (y - 0.5),
      ], layer.crs);
    });
    const tinPoints = layer => layer.compiled.vertices_points.map(([, [x, y]]) => merc([x, -y], layer.crs));
    const corners = [[0, 0], [100, 0], [100, 80], [0, 80]];
    const aJapan = { ...a, crs: japan, worldFile: b.compiled.worldFile };
    const aSubWithSize = { ...aSub, width: 100, height: 80 };
    for (const [doc, points] of [
      [map(a), wfPoints(a, corners)],
      [map(aJapan), wfPoints(aJapan, corners)],
      [map(b), tinPoints(b)],
      [map(c), tinPoints(c)],
      [map(a, [aSub]), [...wfPoints(a, corners), ...wfPoints(aSub, bounds)]],
      [map(a, [aSubWithSize]), [...wfPoints(a, corners), ...wfPoints(aSubWithSize, corners)]],
      [map(a, [bSub, cSub]), [...wfPoints(a, corners), ...tinPoints(bSub), ...tinPoints(cSub)]],
      [map(a, [bSub]), [...wfPoints(a, corners), ...tinPoints(bSub)]],
      [map(a, [cSub]), [...wfPoints(a, corners), ...tinPoints(cSub)]],
    ]) {
      const expected = envelope(points);
      const value = sqlBbox.get(JSON.stringify(doc)).bbox;
      assert.notEqual(value, null);
      JSON.parse(value).forEach((coordinate, index) => assert.ok(Math.abs(coordinate - expected[index]) < 1e-5,
        'bbox の座標が一致する: ' + coordinate + '・' + expected[index]));
    }
    for (const doc of [
      invalid.find(([name]) => name === 'singular')[1],
      invalid.find(([name]) => name === 'bad-proj')[1],
      map({ ...a, worldFile: { ...wf, xOrigin: 200 } }),
      map(a, [{ ...aSub, crs: { epsg: 9999 } }]),
    ]) assert.equal(sqlBbox.get(JSON.stringify(doc)).bbox, null);
    assert.equal(sqlBbox.get(JSON.stringify(map(a)).replace('"width":100', '"width":1e309')).bbox, null);
    const rtree = db.prepare(
      'SELECT r.min_x, r.min_y, r.max_x, r.max_y FROM maps_rtree r JOIN maps_rtree_key k ON r.id = k.rid JOIN maps m ON k.uid = m.uid WHERE m.slug = ?',
    ).get('roundtrip-a');
    assert.ok(rtree);
    const rtreePoints = [...wfPoints(a, corners), ...wfPoints(aSub, bounds), ...tinPoints(bSub), ...tinPoints(cSub)];
    const expectedRtree = envelope(rtreePoints);
    [rtree.min_x, rtree.min_y, rtree.max_x, rtree.max_y].forEach((coordinate, index) => {
      assert.ok(Math.abs(coordinate - expectedRtree[index]) < 4, 'R-Tree の単精度丸めの範囲内で一致');
    });
    const legacy = { compiled: { vertices_points: [[[0, 0], [-100, 50]], [[1, 1], [300, 10]]] } };
    assert.equal(sqlBbox.get(JSON.stringify(map(legacy, [bSub].map(layer => ({ compiled: { ...layer.compiled, outerTransform: undefined } }))))).bbox,
      '[-100,10,300,50]', '従来形式は主図の範囲を返す');
    console.log('受け入れ条件5: 半画素・非 3857・follow の主図と副層の bbox が一致し、不正値は null');
  `);

  await build({
    configFile: false,
    logLevel: 'silent',
    resolve: { alias: { electron: electronStub, 'electron-store': storeStub } },
    build: {
      ssr: entry, outDir, target: 'node22',
      rollupOptions: { output: { entryFileNames: 'entry.mjs' } },
    },
  });

  const { stdout } = await promisify(execFile)(process.execPath, [path.join(outDir, 'entry.mjs'), workDir]);
  process.stdout.write(stdout);
} catch (error) {
  if (error.stdout) process.stdout.write(error.stdout);
  if (error.stderr) process.stderr.write(error.stderr);
  throw error;
} finally {
  await rm(workDir, { recursive: true, force: true });
}
