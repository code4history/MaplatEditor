import assert from 'node:assert/strict';
import Tin from '@maplat/tin';
import { resolveTinBuildOptions } from '../src/utils/tinOptions.ts';

const gcps = [
  [[0, 0], [0, 0]], [[100, 0], [100, 0]], [[100, 100], [100, 100]], [[0, 100], [0, 100]],
  [[50, 50], [51, 49]],
];
const worldFile = { xScale: 1, xSkew: 0, xOrigin: 0, ySkew: 0, yScale: -1, yOrigin: 0 };
const legacy = resolveTinBuildOptions({ compiled: { outerTransform: 'worldFile', worldFile } });
assert.equal(legacy.useV2Algorithm, true, 'crs を持たない地図は V2 を使う');
const adopted = resolveTinBuildOptions({ crs: { epsg: 3857 }, compiled: { outerTransform: 'worldFile', worldFile } });
assert.equal(adopted.useV2Algorithm, false, '3857 でも採用済み crs のある地図は V4 を使う');
assert.equal(adopted.outerTransform, 'worldFile');
assert.deepEqual(adopted.worldFile, worldFile);
const b = new Tin(adopted);
b.setWh([100, 100]); b.setPoints(gcps); b.setEdges([]); await b.updateTinAsync();
assert.equal(b.useV2Algorithm, false);
assert.equal(b.boundaryDiagnostics?.requestedOuterTransform, 'worldFile');
assert.equal(b.boundaryDiagnostics?.outerTransform, 'extrapolate');
assert.equal(b.boundaryDiagnostics?.fallbackReason, 'boundaryFlips');
const cOptions = resolveTinBuildOptions({ crs: { epsg: 6674 }, compiled: {} }, {}, 'C');
assert.equal(cOptions.outerTransform, 'extrapolate');
assert.equal(cOptions.useV2Algorithm, false);
assert.equal(resolveTinBuildOptions({ tinEnabled: false, crs: { epsg: 6677 }, worldFile }), null, 'A は三角網を作らない');
assert.deepEqual(resolveTinBuildOptions({ crs: { epsg: 3857 }, compiled: {} }), { useV2Algorithm: false, outerTransform: 'extrapolate', yaxisMode: 'invert' }, 'C は常に extrapolate を明示し、y 軸の向きは crs から導く');
console.log('J6-T1b V4 projection paths smoke passed');
