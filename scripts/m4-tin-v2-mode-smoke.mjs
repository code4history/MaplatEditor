import assert from 'node:assert/strict';
import Tin from '@maplat/tin';
import { resolveTinBuildOptions } from '../src/utils/tinOptions.ts';

const gcps = [
  [[0, 0], [0, 0]], [[100, 0], [100, 0]], [[100, 100], [100, 100]], [[0, 100], [0, 100]],
  [[50, 50], [51, 49]],
];
async function build(layer, intent) {
  const tin = new Tin(resolveTinBuildOptions(layer, {}, intent));
  tin.setWh([100, 100]);
  tin.setPoints(gcps);
  tin.setEdges([]);
  await tin.updateTinAsync();
  return tin;
}

// 推定・比較状態に CRS 候補があっても、層直下に crs がなければ V2 のまま。
const unadopted = await build({ compiled: { version: 4, outerTransform: 'worldFile' }, estimateResult: { crs: { epsg: 6674 } } });
assert.equal(unadopted.useV2Algorithm, true);
assert.equal(unadopted.boundaryDiagnostics, undefined);
// 採用済み地図では Tin が V4 外周を計算し、診断を保持する。
const adopted = await build({ crs: { epsg: 3857 }, compiled: {} }, 'C');
assert.equal(adopted.useV2Algorithm, false);
assert.equal(adopted.outerTransform, 'extrapolate');
console.log('TIN V2/V4 mode smoke passed');
