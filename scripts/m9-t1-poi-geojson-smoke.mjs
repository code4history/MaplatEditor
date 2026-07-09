// src/utils/poiGeoJson.ts (POI GeoJSON 純関数, renderer/main 共用) のスモーク。
// 検証コード・旧POI正規化・表示ID採番・_maplatUid注入/剥離・export形往復を検証する。
// m8-t1 の vite-bundle-single-module 方式に倣う(electron スタブ不要の純モジュール)。
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'poi-geojson-'));
const entryFile = path.join(workDir, 'poi-geojson-smoke.ts');
const outDir = path.join(workDir, 'dist');
const bundledFile = path.join(outDir, 'poi-geojson-smoke.mjs');

try {
  const modulePath = path.join(projectRoot, 'src/utils/poiGeoJson.ts');

  await writeFile(
    entryFile,
    `
      import assert from 'node:assert/strict';

      const mod = await import(${JSON.stringify(modulePath)});
      const {
        validateFeatureCollection,
        normalizeLegacyPoi,
        normalizeLegacyPoiList,
        ensureDisplayIds,
        ensureFeatureUids,
        toExportForm,
        fromExportForm,
      } = mod;

      const codesOf = (issues) => issues.map((i) => i.code);
      const point = (lng, lat) => ({ type: 'Point', coordinates: [lng, lat] });
      const feat = (id, coords, props = {}) => ({ type: 'Feature', id, geometry: point(coords[0], coords[1]), properties: props });
      const fc = (features) => ({ type: 'FeatureCollection', features });

      // ---- validateFeatureCollection: clean ----
      {
        const issues = validateFeatureCollection(fc([feat('p1', [135, 35], { name: 'A', desc: 'x' })]));
        assert.deepEqual(issues, [], 'クリーンなFCは空配列のはず: ' + JSON.stringify(issues));
        console.log('ok: validate clean FC returns no issues');
      }

      // ---- validate: not a FeatureCollection ----
      {
        const issues = validateFeatureCollection({ type: 'Feature' });
        assert.ok(codesOf(issues).includes('not-feature-collection'), 'FC以外はnot-feature-collection: ' + JSON.stringify(issues));
        console.log('ok: validate rejects non-FeatureCollection');
      }

      // ---- validate: non-Point geometry (POI-104) ----
      {
        const bad = { type: 'FeatureCollection', features: [{ type: 'Feature', id: 'p1', geometry: { type: 'LineString', coordinates: [[0,0],[1,1]] }, properties: { name: 'L' } }] };
        const issues = validateFeatureCollection(bad);
        assert.ok(codesOf(issues).includes('geometry-not-point'), 'geometry-not-point: ' + JSON.stringify(issues));
        console.log('ok: validate flags non-Point geometry');
      }

      // ---- validate: coord range ----
      {
        const issues = validateFeatureCollection(fc([feat('p1', [200, 100], { name: 'A', desc: 'x' })]));
        assert.ok(codesOf(issues).includes('coord-range'), 'coord-range: ' + JSON.stringify(issues));
        const ok = validateFeatureCollection(fc([feat('p1', [-180, -90], { name: 'A', desc: 'x' }), feat('p2', [180, 90], { name: 'B', desc: 'y' })]));
        assert.ok(!codesOf(ok).includes('coord-range'), '±180/±90境界はOK: ' + JSON.stringify(ok));
        console.log('ok: validate flags out-of-range coords, accepts boundary');
      }

      // ---- validate: name required (POI-107) ----
      {
        const issues = validateFeatureCollection(fc([feat('p1', [135, 35], { name: '', desc: 'x' })]));
        assert.ok(codesOf(issues).includes('name-required'), 'empty name: ' + JSON.stringify(issues));
        const issues2 = validateFeatureCollection(fc([feat('p2', [135, 35], { desc: 'x' })]));
        assert.ok(codesOf(issues2).includes('name-required'), 'missing name: ' + JSON.stringify(issues2));
        console.log('ok: validate flags missing/empty name');
      }

      // ---- validate: duplicate display id ----
      {
        const issues = validateFeatureCollection(fc([feat('p1', [135, 35], { name: 'A', desc: 'x' }), feat('p1', [136, 36], { name: 'B', desc: 'y' })]));
        assert.ok(codesOf(issues).includes('display-id-duplicate'), 'duplicate id: ' + JSON.stringify(issues));
        console.log('ok: validate flags duplicate display id');
      }

      // ---- validate: display id charset (POI-140) ----
      {
        const issues = validateFeatureCollection(fc([feat('bad#id', [135, 35], { name: 'A', desc: 'x' })]));
        assert.ok(codesOf(issues).includes('display-id-charset'), 'bad charset: ' + JSON.stringify(issues));
        console.log('ok: validate flags display id charset violation');
      }

      // ---- validate: no-content warning (POI-108) source-wide ----
      {
        const issues = validateFeatureCollection(fc([feat('p1', [135, 35], { name: 'A' }), feat('p2', [136, 36], { name: 'B' })]));
        const nc = issues.filter((i) => i.code === 'no-content');
        assert.equal(nc.length, 1, 'source-wide no-content は単一warning: ' + JSON.stringify(issues));
        assert.equal(nc[0].level, 'warning', 'no-content は warning レベル');
        // one feature with content -> no warning
        const withContent = validateFeatureCollection(fc([feat('p1', [135, 35], { name: 'A' }), feat('p2', [136, 36], { name: 'B', url: 'http://x' })]));
        assert.ok(!codesOf(withContent).includes('no-content'), '1件でもコンテンツあれば無警告');
        console.log('ok: validate emits single source-wide no-content warning');
      }

      // ---- validate: scale warnings (POI-121) ----
      {
        const many = [];
        for (let i = 0; i < 1001; i++) many.push(feat('p' + i, [135, 35], { name: 'n', desc: 'd' }));
        const issues = validateFeatureCollection(fc(many));
        const sc = issues.filter((i) => i.code === 'scale-feature-count');
        assert.equal(sc.length, 1, '>1000 feature で scale-feature-count 単一warning');
        assert.equal(sc[0].level, 'warning', 'scale は warning');
        console.log('ok: validate emits feature-count scale warning');

        const bigDesc = 'x'.repeat(6 * 1024 * 1024);
        const bigIssues = validateFeatureCollection(fc([feat('p1', [135, 35], { name: 'A', desc: bigDesc })]));
        assert.ok(codesOf(bigIssues).includes('scale-byte-size'), '>5MB で scale-byte-size warning');
        console.log('ok: validate emits byte-size scale warning');
      }

      // ---- normalizeLegacyPoi: lnglat priority ----
      {
        const f = normalizeLegacyPoi({ lnglat: [135, 35], name: 'A', desc: 'd', url: 'http://u', address: 'addr' });
        assert.equal(f.type, 'Feature');
        assert.equal(f.geometry.type, 'Point');
        assert.deepEqual(f.geometry.coordinates, [135, 35], 'lnglat 優先');
        assert.equal(f.properties.name, 'A');
        assert.equal(f.properties.desc, 'd');
        assert.equal(f.properties.url, 'http://u', 'url 透過');
        assert.equal(f.properties.address, 'addr', 'address 透過');
        assert.equal(f.id, '', 'display id は未採番');
        assert.ok(!('_maplatUid' in f.properties), '_maplatUid は未採番');
        console.log('ok: normalizeLegacyPoi uses lnglat, passes through url/address');
      }

      // ---- normalizeLegacyPoi: lng/lat ----
      {
        const f = normalizeLegacyPoi({ lng: 100, lat: 20, name: 'B' });
        assert.deepEqual(f.geometry.coordinates, [100, 20], 'lng/lat から生成');
        console.log('ok: normalizeLegacyPoi builds coords from lng/lat');
      }

      // ---- normalizeLegacyPoi: longitude/latitude fallback ----
      {
        const f = normalizeLegacyPoi({ longitude: 50, latitude: 10, name: 'C' });
        assert.deepEqual(f.geometry.coordinates, [50, 10], 'longitude/latitude fallback');
        console.log('ok: normalizeLegacyPoi builds coords from longitude/latitude');
      }

      // ---- normalizeLegacyPoi: image string/array/object pass-through ----
      {
        const s = normalizeLegacyPoi({ lng: 1, lat: 2, name: 'n', image: 'a.png' });
        assert.equal(s.properties.image, 'a.png', 'image 文字列透過');
        const a = normalizeLegacyPoi({ lng: 1, lat: 2, name: 'n', image: ['a.png', 'b.png'] });
        assert.deepEqual(a.properties.image, ['a.png', 'b.png'], 'image 配列透過');
        const o = normalizeLegacyPoi({ lng: 1, lat: 2, name: 'n', image: { src: 'a.png', desc: 'cap' } });
        assert.deepEqual(o.properties.image, { src: 'a.png', desc: 'cap' }, 'image オブジェクト透過');
        console.log('ok: normalizeLegacyPoi passes image string/array/object through');
      }

      // ---- normalizeLegacyPoi: existing id kept ----
      {
        const f = normalizeLegacyPoi({ id: 'keep1', lng: 1, lat: 2, name: 'n' });
        assert.equal(f.id, 'keep1', '既存 id は維持');
        console.log('ok: normalizeLegacyPoi keeps existing id');
      }

      // ---- normalizeLegacyPoiList: array / FC / single ----
      {
        const arr = normalizeLegacyPoiList([{ lng: 1, lat: 2, name: 'a' }, { lng: 3, lat: 4, name: 'b' }]);
        assert.equal(arr.length, 2, '配列を受容');
        const single = normalizeLegacyPoiList({ lng: 1, lat: 2, name: 'solo' });
        assert.equal(single.length, 1, '単体オブジェクトを受容');
        const fromFc = normalizeLegacyPoiList(fc([feat('p1', [135, 35], { name: 'A', desc: 'd' })]));
        assert.equal(fromFc.length, 1, 'FC を受容');
        assert.equal(fromFc[0].properties.name, 'A', 'FC feature の properties 保持');
        assert.deepEqual(fromFc[0].geometry.coordinates, [135, 35]);
        console.log('ok: normalizeLegacyPoiList accepts array/FC/single');
      }

      // ---- normalizeLegacyPoiList: non-Point FC feature NOT dropped ----
      {
        const bad = { type: 'FeatureCollection', features: [{ type: 'Feature', id: 'x', geometry: { type: 'LineString', coordinates: [[0,0],[1,1]] }, properties: { name: 'L' } }] };
        const out = normalizeLegacyPoiList(bad);
        assert.equal(out.length, 1, 'non-Point でも drop しない(caller が validate で拒否)');
        assert.equal(out[0].geometry.type, 'LineString', 'geometry を保持したまま返す');
        console.log('ok: normalizeLegacyPoiList does not silently drop non-Point features');
      }

      // ---- ensureDisplayIds: keep existing, assign sequential, avoid collision ----
      {
        const feats = [
          { type: 'Feature', id: 'p2', geometry: point(1,2), properties: { name: 'a' } },
          { type: 'Feature', id: '', geometry: point(3,4), properties: { name: 'b' } },
          { type: 'Feature', id: '', geometry: point(5,6), properties: { name: 'c' } },
        ];
        const { features, assigned } = ensureDisplayIds(feats);
        assert.equal(features[0].id, 'p2', '既存 id 維持');
        assert.notEqual(features[1].id, '', '欠落分に採番');
        assert.notEqual(features[2].id, '', '欠落分に採番');
        assert.notEqual(features[1].id, 'p2', '既存と衝突しない');
        assert.notEqual(features[1].id, features[2].id, '採番分どうしも一意');
        assert.equal(assigned.length, 2, '新規採番は2件');
        // ids should be p1 and p3 (p2 taken)
        assert.ok(assigned.includes('p1'), 'p1 が採番される');
        assert.ok(assigned.includes('p3'), 'p2 は取られているので p3 が採番される');
        console.log('ok: ensureDisplayIds keeps existing and assigns collision-free sequential ids');
      }

      // ---- ensureDisplayIds: charset-violating existing id counts as taken, not fixed ----
      {
        const feats = [
          { type: 'Feature', id: 'p1', geometry: point(1,2), properties: { name: 'a' } },
          { type: 'Feature', id: 'bad#', geometry: point(3,4), properties: { name: 'b' } },
          { type: 'Feature', id: '', geometry: point(5,6), properties: { name: 'c' } },
        ];
        const { features, assigned } = ensureDisplayIds(feats);
        assert.equal(features[1].id, 'bad#', '文字種違反 id は自動修正しない');
        assert.equal(assigned.length, 1, '欠落 1 件のみ採番');
        console.log('ok: ensureDisplayIds does not auto-fix charset violations but counts them as taken');
      }

      // ---- ensureFeatureUids: preserve + mint ----
      {
        const feats = [
          { type: 'Feature', id: 'p1', geometry: point(1,2), properties: { name: 'a', _maplatUid: 'existing-uid' } },
          { type: 'Feature', id: 'p2', geometry: point(3,4), properties: { name: 'b' } },
        ];
        const out = ensureFeatureUids(feats);
        assert.equal(out[0].properties._maplatUid, 'existing-uid', '既存 uid 維持');
        assert.equal(typeof out[1].properties._maplatUid, 'string', '欠落 uid 採番');
        assert.ok(out[1].properties._maplatUid.length > 0, '採番された uid は非空');
        assert.notEqual(out[1].properties._maplatUid, 'existing-uid', '別の新規 uid');
        console.log('ok: ensureFeatureUids preserves existing and mints missing _maplatUid');
      }

      // ---- toExportForm: strip _maplat*, FC.id=slug, FC.name compact, no rounding by default ----
      {
        const editorFc = {
          type: 'FeatureCollection',
          features: [
            { type: 'Feature', id: 'p1', geometry: point(135.123456789, 35.987654321), properties: { name: 'A', _maplatUid: 'u1', _maplatLayerId: 'L' } },
          ],
        };
        const out = toExportForm(editorFc, 'my-slug', { ja: 'タイトル' });
        assert.equal(out.id, 'my-slug', 'FC.id = slug');
        assert.equal(out.name, 'タイトル', 'FC.name は単一言語なら string に collapse');
        assert.equal(out.features[0].id, 'p1', 'Feature.id (display id) 保持');
        assert.ok(!('_maplatUid' in out.features[0].properties), '_maplatUid 剥離');
        assert.ok(!('_maplatLayerId' in out.features[0].properties), '_maplatLayerId 剥離');
        assert.equal(out.features[0].properties.name, 'A', 'name 保持');
        // roundCoordinates false (default): full precision preserved
        assert.deepEqual(out.features[0].geometry.coordinates, [135.123456789, 35.987654321], 'default は丸めない(全精度保持)');
        console.log('ok: toExportForm strips _maplat*, sets id/name, preserves precision by default');
      }

      // ---- toExportForm: FC.name object when multi-lang ----
      {
        const editorFc = { type: 'FeatureCollection', features: [] };
        const out = toExportForm(editorFc, 's', { ja: 'あ', en: 'a' });
        assert.deepEqual(out.name, { ja: 'あ', en: 'a' }, '複数言語は object のまま');
        console.log('ok: toExportForm keeps multi-lang name as object');
      }

      // ---- toExportForm: roundCoordinates true rounds to 7 decimals ----
      {
        const editorFc = { type: 'FeatureCollection', features: [ { type: 'Feature', id: 'p1', geometry: point(135.1234567891, 35.9876543219), properties: { name: 'A', _maplatUid: 'u1' } } ] };
        const out = toExportForm(editorFc, 's', { ja: 't' }, { roundCoordinates: true });
        assert.deepEqual(out.features[0].geometry.coordinates, [135.1234568, 35.9876543], 'roundCoordinates:true は7桁丸め');
        console.log('ok: toExportForm rounds to 7 decimals when roundCoordinates true');
      }

      // ---- fromExportForm: uid carry-over by id + new uid ----
      {
        const previous = [
          { type: 'Feature', id: 'p1', geometry: point(1,2), properties: { name: 'a', desc: 'd', _maplatUid: 'uid-prev-1' } },
        ];
        const parsed = { type: 'FeatureCollection', id: 's', name: 't', features: [
          { type: 'Feature', id: 'p1', geometry: point(1,2), properties: { name: 'a2', desc: 'd2' } },
          { type: 'Feature', id: 'p2', geometry: point(3,4), properties: { name: 'b', url: 'http://x' } },
        ] };
        const { features, issues } = fromExportForm(parsed, previous);
        assert.equal(features[0].properties._maplatUid, 'uid-prev-1', 'id 一致で uid 引継ぎ');
        assert.equal(typeof features[1].properties._maplatUid, 'string', '新規 id は新 uid');
        assert.notEqual(features[1].properties._maplatUid, 'uid-prev-1', '新規は別 uid');
        assert.deepEqual(issues, [], 'clean parse は issue 無し: ' + JSON.stringify(issues));
        console.log('ok: fromExportForm carries uid over by id and mints new');
      }

      // ---- fromExportForm: invalid input (not a FeatureCollection) ----
      {
        const { features, issues } = fromExportForm({ foo: 'bar' }, []);
        assert.deepEqual(features, [], '構造不正なら features 空');
        assert.ok(issues.length >= 1 && issues[0].code === 'not-feature-collection', 'not-feature-collection issue: ' + JSON.stringify(issues));
        assert.equal(issues[0].level, 'error');
        console.log('ok: fromExportForm returns not-feature-collection error on invalid input');
      }

      // ---- fromExportForm: collects validation issues from parsed FC ----
      {
        const parsed = { type: 'FeatureCollection', features: [ { type: 'Feature', id: 'dup', geometry: point(1,2), properties: { name: 'a' } }, { type: 'Feature', id: 'dup', geometry: point(3,4), properties: { name: 'b' } } ] };
        const { issues } = fromExportForm(parsed, []);
        assert.ok(issues.some((i) => i.code === 'display-id-duplicate'), 'validate 由来の issue を収集: ' + JSON.stringify(issues));
        console.log('ok: fromExportForm surfaces validation issues');
      }

      console.log('M9-T1 poi geojson smoke passed');
    `
  );

  await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      emptyOutDir: true,
      outDir,
      ssr: entryFile,
      target: 'node22',
      rollupOptions: {
        output: {
          entryFileNames: 'poi-geojson-smoke.mjs',
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
  console.log('M9-T1 poi geojson smoke passed');
} finally {
  await rm(workDir, { recursive: true, force: true });
}
