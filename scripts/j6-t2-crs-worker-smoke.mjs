import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from '@playwright/test';
import proj4 from 'proj4';
import { worldFileToCrs } from '@maplat/transform';
import { CrsEstimationService } from '../electron/services/CrsEstimationService.ts';
import { describeCandidate, toCenteredWorldFile } from '../electron/workers/crsEstimationProcess.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const rawWorldFile = { xScale: 2, xSkew: 3, xOrigin: 100, ySkew: 5, yScale: -7, yOrigin: 200 };
const worldFile = toCenteredWorldFile(rawWorldFile);
const pixel = [11, 13];
assert.deepEqual(worldFileToCrs(worldFile, pixel), [161, 164]);
assert.notDeepEqual(worldFileToCrs(toCenteredWorldFile(worldFile), pixel), [161, 164]);
assert.equal(rawWorldFile.xOrigin, 100);
assert.equal(rawWorldFile.yOrigin, 200);
assert.throws(() => toCenteredWorldFile({ ...rawWorldFile, yScale: 10 }));
assert.throws(() => toCenteredWorldFile({ ...rawWorldFile, xOrigin: Infinity }));
assert.throws(() => toCenteredWorldFile({ ...rawWorldFile, ySkew: 0, yScale: 0 }));

const esri = { id: 'ESRI:102012', authority: 'ESRI', code: '102012', name: '試験用' };
const definition = '+proj=utm +zone=53 +datum=WGS84 +units=m';
const compatible = describeCandidate({ ...esri, proj4: definition + ' +axis=enu' });
assert.equal(compatible.coreCompatible, true);
assert.deepEqual(compatible.crs, { authority: 'ESRI', code: '102012', proj4: definition });
for (const proj4 of ['', '+proj=pipeline', definition + '+axis=neu', definition + '+nadgrids=a.gsb',
  definition + '+geoidgrids=a.gtx', '+proj=hgridshift', '+proj=vgridshift', '+proj=unknown']) {
  assert.equal(describeCandidate({ ...esri, proj4 }).coreCompatible, false, proj4);
}
assert.equal(describeCandidate({ ...esri, proj4: definition + '+nadgrids=@null' }).coreCompatible, true);

const gcps = [[10, 20], [220, 20], [10, 180], [220, 180]].map(([x, y]) => ({
  pixel: [x, y],
  geo: proj4('EPSG:3857', 'EPSG:4326', [15100000 + 13 * x + 4 * y, 4160000 + 4 * x - 13 * y]),
}));
const input = { gcps };

class TestChild extends EventEmitter {
  sent = [];
  killed = 0;
  postMessage(message) { this.sent.push(message); }
  kill() { this.killed += 1; return true; }
  reply(result) { this.emit('message', result); }
}

const children = [];
const service = new CrsEstimationService(() => {
  const child = new TestChild();
  children.push(child);
  return child;
}, { overallTimeoutMs: 100, cancelGraceMs: 10, idleTtlMs: 20 });
try {
  assert.equal(children.length, 0);
  assert.equal((await service.estimate({ gcps: Array(501).fill(gcps[0]) })).failureReason, 'too_many_gcps');
  assert.equal((await service.estimate({ gcps: [...gcps, { pixel: [0, NaN], geo: [135, 35] }] })).failureReason, 'invalid_input');
  assert.equal(children.length, 0);

  const pending = service.estimate(input);
  const [first] = children;
  const [{ requestId }] = first.sent;
  assert.equal((await service.estimate(input)).failureReason, 'busy');
  assert.equal(service.cancel('古い要求'), false);
  first.reply({ type: 'result', status: 'failed', requestId: '古い要求', failureReason: 'worker_error' });
  await Promise.resolve();
  assert.equal(service.cancel(requestId), true, '古い応答を受けても現在の要求を終了しない');
  assert.equal((await pending).status, 'canceled');
  assert.equal(first.killed, 1);

  const timedOut = service.estimate(input);
  const second = children[1];
  assert.equal((await timedOut).failureReason, 'timeout');
  assert.equal(second.sent[1].type, 'cancel');
  assert.equal(second.killed, 1);

  const crashed = service.estimate(input);
  const third = children[2];
  third.emit('exit', 9);
  assert.equal((await crashed).failureReason, 'worker_crashed');

  const canceled = service.estimate(input);
  const fourth = children[3];
  assert.equal(service.cancel(), true);
  fourth.reply({ type: 'result', status: 'canceled', requestId: fourth.sent[0].requestId });
  assert.equal((await canceled).status, 'canceled');

  const retried = service.estimate(input);
  const fifth = children[4];
  third.emit('exit', 9);
  fifth.reply({ type: 'result', status: 'insufficient', requestId: fifth.sent[0].requestId });
  assert.equal((await retried).status, 'insufficient');
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(fifth.killed, 1, 'アイドル期限で子プロセスを破棄する');
} finally {
  service.dispose();
}

const profile = await mkdtemp(join(root, 'node_modules/.j6-profile-'));
let application;
try {
  const env = { ...process.env, VITE_DEV_SERVER_URL: '', MAPLAT_E2E_ROOT: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  application = await electron.launch({
    args: [root, '--user-data-dir=' + profile],
    env,
    timeout: 30_000,
  });
  const page = await application.firstWindow();
  const servicePids = () => application.evaluate(({ app }) => app.getAppMetrics()
    .filter(metric => metric.name === 'Maplat CRS 推定').map(metric => metric.pid));
  assert.deepEqual(await servicePids(), []);
  const result = await page.evaluate(input => window.crs.estimate(input), input);
  assert.ok(result.selected, JSON.stringify(result));
  assert.ok(result.ranked.some(row => row.authority === 'EPSG' && row.code === '3857'));
  assert.equal(result.selected.coreCompatible, true);
  assert.equal(result.selected.gcpsNew.length, gcps.length);
  assert.equal((await servicePids()).length, 1);

  const alternative = result.ranked.find(row => row.id !== result.selected.id && row.coreCompatible);
  assert.ok(alternative, '互換性のある別の候補が必要');
  const single = await page.evaluate(input => window.crs.estimateCandidate(input), { ...input, candidateId: alternative.id });
  assert.ok(single.selected, JSON.stringify(single));
  assert.deepEqual(single.ranked.map(row => row.id), [alternative.id]);
  assert.equal(single.selected.id, alternative.id);
  assert.ok(single.selected.unit.name);
  assert.equal(single.selected.qualityGate, 'adoptable');
  for (const { selected } of [result, single]) {
    const { worldFile: centered, rawWorldFile: raw } = selected;
    assert.ok(centered.xScale * centered.yScale - centered.xSkew * centered.ySkew < 0);
    assert.equal(centered.xOrigin, raw.xOrigin + 0.5 * raw.xScale + 0.5 * raw.xSkew);
    assert.equal(centered.yOrigin, raw.yOrigin + 0.5 * raw.ySkew + 0.5 * raw.yScale);
  }
  const [pid] = await servicePids();
  await application.evaluate(({ app }, pid) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      app.off('child-process-gone', onGone);
      reject(new Error('CRS 推定の子プロセスが終了しませんでした'));
    }, 5_000);
    const onGone = (_event, details) => {
      if (details.name !== 'Maplat CRS 推定') return;
      clearTimeout(timer);
      app.off('child-process-gone', onGone);
      resolve();
    };
    app.on('child-process-gone', onGone);
    process.kill(pid, 'SIGTERM');
  }), pid);
  const recovered = await page.evaluate(input => window.crs.estimate(input), input);
  assert.ok(recovered.selected, JSON.stringify(recovered));
  assert.ok(!(await servicePids()).includes(pid));
} finally {
  if (application) {
    const child = application.process();
    const forceQuit = setTimeout(() => child.kill('SIGKILL'), 5_000);
    try {
      await application.close();
      if (child.exitCode === null && child.signalCode === null) await once(child, 'exit');
    } finally {
      clearTimeout(forceQuit);
    }
  }
  await rm(profile, { recursive: true, force: true });
}
console.log('CRS 推定ワーカーの IPC・半画素換算・異常終了からの復旧を確認');
