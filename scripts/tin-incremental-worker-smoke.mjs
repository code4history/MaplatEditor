// 三角網の差分更新（MaplatTin#100）の Editor 側: 状態つき worker・表示用の網・清書と特例の保存の受け皿。
//   1. 状態つきにしても、保存される compiled が今と 1 ビットも変わらない（スイッチ切・入のどちらでも）
//   2. 表示用の網へ差分（TinPatch）を当てた結果が、全部作り直した網と一致する（本物の Tin#applyEdits の差分で確かめる）
//   3. 版が合わないとき（revisionMismatch ほか）は、最新の入力の全部で rebuild を送り直す
//   4. 清書は別のインスタンスで行い、strict のときだけ網を差し替える。strict にならないときの、特例の保存の分岐
//   5. 設定 incrementalEdits（既定は切）の通り道
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import Tin from '@maplat/tin';

// worker の本体は、読み込むと self.onmessage を置く。先に、記録するだけの self を用意する
const posted = [];
globalThis.self = { onmessage: null, postMessage: (message) => posted.push(message) };
const worker = await import('../src/workers/tinComputeWorker.ts');
const { TinWorkerSession, normalizeTinError, snapshotFromTin } = await import('../src/workers/tinWorkerSession.ts');
const { TinDisplayMesh, vertexKey } = await import('../src/utils/tinDisplayMesh.ts');
const { LayerTinSync } = await import('../src/services/tinEditSync.ts');
const { decideSavedMesh, hasIncrementalOrigin, withMeshOrigin } = await import('../src/utils/tinSavedMesh.ts');
const { normalizeIncrementalEdits } = await import('../src/utils/incrementalEditsSetting.ts');
const { applyTinGeometry } = await import('../src/utils/tinOptions.ts');
const { buildEditorLayerTin } = await import('../src/services/editorComputeBackend.ts');
const { transformLayerFromDocument } = await import('../src/utils/layerTransformIntent.ts');
const { RENDERER_SETTINGS_KEYS } = await import('../electron/services/settingsKeys.ts');

// 局所更新（Tin#applyEdits・Options#incremental）を持つ Tin（MaplatTin#103 以降）のときだけ、本物の差分を使う試験を走らせる。
// 持たない版（npm の公開版）では、その試験を飛ばす（理由を表示する）。状態つき worker・設定・特例の保存の判定などは、どちらでも走る。
const incrementalTin = typeof Tin.prototype.applyEdits === 'function';
if (!incrementalTin) console.log('注意: この @maplat/tin は applyEdits を持たない。本物の差分を使う試験は飛ばす');
const itest = (name, fn) => test(name, { skip: incrementalTin ? false : '@maplat/tin に applyEdits が無い' }, fn);

// ---------------- 入力 ----------------
function lcg(seed) {
  let state = seed;
  return () => (state = (state * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
}
const W = 600;
const H = 500;

/** 乱数でゆらした格子の対応点（紙 [x, y]、地理 [X, Y]）。 */
function gridGcps(seed, cols = 7, rows = 6) {
  const rnd = lcg(seed);
  const gcps = [];
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const x = 40 + i * 90 + (rnd() - 0.5) * 40;
      const y = 40 + j * 85 + (rnd() - 0.5) * 40;
      gcps.push([[x, y], [15000000 + 100 * x + (rnd() - 0.5) * 30, 4000000 - 100 * y + (rnd() - 0.5) * 30]]);
    }
  }
  return gcps;
}

const V3 = { useV2Algorithm: false, yaxisMode: 'invert', outerTransform: 'extrapolate' };
function request(overrides = {}) {
  return {
    gcps: gridGcps(7), edges: [], index: 0, bounds: [W, H], strict: 'strict', vertex: 'plain',
    tinOptions: { ...V3, strictMode: 'strict' }, layerKey: 'main', ...overrides,
  };
}

/** 今の updateTin（状態を持たない）と同じ手順。結果の基準にする。 */
async function reference(req) {
  const { gcps, edges, index, bounds, tinOptions } = req;
  if (gcps.length < 3) return [index, 'tooLessGcps', null];
  const options = tinOptions;
  const tin = new Tin(options);
  const wh = index === 0 ? bounds : undefined;
  const bd = index !== 0 ? bounds : undefined;
  assert.ok(applyTinGeometry(tin, options, { wh, bounds: bd }));
  tin.setPoints(gcps);
  tin.setEdges(edges);
  try {
    await tin.updateTinAsync();
    return [index, tin.getCompiled(), tin.boundaryDiagnostics ?? null];
  } catch (err) {
    const normalized = normalizeTinError(err);
    if (normalized) return [index, normalized, null];
    throw err;
  }
}
const bits = (value) => JSON.stringify(value);

// ---------------- 1. 保存される compiled が変わらない ----------------
const subBounds = [[0, 0], [W, 0], [W, H], [0, H]];
const scenarios = [
  ['V3 strict', request()],
  ['V3 auto', request({ tinOptions: { ...V3, strictMode: 'auto' } })],
  ['V3 follow', request({ tinOptions: { ...V3, yaxisMode: 'follow', strictMode: 'strict' } })],
  ['V2（既定）', request({ tinOptions: { useV2Algorithm: true } })],
  ['副層（bounds の多角形）', request({ index: 1, bounds: subBounds, layerKey: 'sub' })],
  ['必須エッジつき', request({ edges: [[[], [], [0, 1]], [[[130, 130]], [[15013000, 3987000]], [8, 14]]] })],
];

for (const incrementalEdits of [false, true]) {
  (incrementalEdits ? itest : test)(`状態つき worker の rebuild は、今の updateTin と compiled・診断が 1 ビットも変わらない（incrementalEdits=${incrementalEdits}）`, async () => {
    const session = new TinWorkerSession();
    for (const [name, base] of scenarios) {
      const req = { ...base, ...(incrementalEdits ? { incrementalEdits: true } : {}) };
      const expected = await reference(base);
      const got = await session.rebuild(req);
      assert.equal(bits(got.result), bits(expected), `${name}: 結果が今と同じ`);
      if (incrementalEdits) assert.ok(got.stamp, `${name}: スイッチが入っていれば、網を持ち続ける`);
      else assert.equal(got.stamp, undefined, `${name}: スイッチ切では、網を持ち続けない`);
      if (incrementalEdits && ['V3 strict', 'V3 auto'].includes(name)) assert.ok(got.snapshot, `${name}: 局所更新の網が取り込まれ、表示用の網の全部が返る`);
      if (!incrementalEdits) assert.equal(got.snapshot, undefined, `${name}: スイッチ切では表示用の網を作らない`);
    }
  });
}

test('前の入力が残らない: 同じ層・別の層を挟んで組み直しても、毎回、新しい Tin と同じ結果', async () => {
  const session = new TinWorkerSession();
  const a = request({ layerKey: 'x', incrementalEdits: true });
  const b = request({ layerKey: 'x', gcps: gridGcps(99, 6, 6), incrementalEdits: true });
  const c = request({ layerKey: 'y', gcps: gridGcps(5, 5, 6), incrementalEdits: true });
  for (const req of [a, c, b, a, b]) {
    const got = await session.rebuild(req);
    assert.equal(bits(got.result), bits(await reference({ ...req, incrementalEdits: undefined })));
  }
  assert.deepEqual(session.layerKeys().sort(), ['x', 'y']);
  // スイッチが切なら、網を持ち続けない（使い道が無く、層ごとに大きなメモリを占める）
  const off = new TinWorkerSession();
  await off.rebuild(request({ layerKey: 'x' }));
  await off.finalize({ request: request({ layerKey: 'x' }) });
  assert.deepEqual(off.layerKeys(), []);
});

test('エラーの結果も今と同じで、網は捨てる（古い網を残さない）', async () => {
  const session = new TinWorkerSession();
  await session.rebuild(request({ incrementalEdits: true }));
  assert.ok(session.stampOf('main'));
  const few = request({ gcps: gridGcps(1, 1, 2) });
  assert.deepEqual((await session.rebuild(few)).result, [0, 'tooLessGcps', null]);
  assert.equal(session.stampOf('main'), undefined, 'エラーで網を捨てる');
  const line = request({ gcps: [0, 1, 2, 3, 4].map((i) => [[50 + i * 100, 100], [15000000 + i * 1000, 4000000]]) });
  const expected = await reference(line);
  const got = await session.rebuild(line);
  assert.equal(bits(got.result), bits(expected));
  assert.equal(typeof got.result[1], 'string', '一直線は文字列のエラー');
  assert.equal(got.stamp, undefined);
  assert.equal(session.stampOf('main'), undefined);
});

test('worker の入口: updateTin は今と同じ形の結果、rebuild・applyEdits・finalize・disposeLayer・dispose が通る', async () => {
  assert.equal(typeof globalThis.self.onmessage, 'function');
  let nextId = 0;
  const call = async (type, payload) => {
    const id = ++nextId;
    await globalThis.self.onmessage({ data: { id, type, payload } });
    const reply = posted.find((m) => m.id === id);
    assert.ok(reply, `${type}: 応答がある`);
    return reply;
  };
  const req = request({ layerKey: 'msg', incrementalEdits: true });
  const legacy = await call('updateTin', { ...req, layerKey: 'legacy' });
  assert.equal(bits(legacy.result), bits(await reference(request())), 'updateTin は、結果だけ（今と同じ）');
  // updateTin（今の入口）も、網を持ち続ける
  assert.ok((await worker.updateTin(request({ layerKey: 'direct' }))).length === 3);
  const rebuilt = await call('rebuild', req);
  assert.ok(rebuilt.result.stamp && rebuilt.result.result[0] === 0);
  if (incrementalTin) assert.ok(rebuilt.result.snapshot);
  const stale = await call('applyEdits', { layerKey: 'msg', edits: [], base: { ...rebuilt.result.stamp, generation: rebuilt.result.stamp.generation + 100 } });
  assert.equal(stale.result.status, 'revisionMismatch', '世代が違えば、網に触らず食い違いを返す');
  assert.deepEqual((await call('applyEdits', { layerKey: 'none', edits: [], base: { generation: 1, revision: 0 } })).result, { status: 'noMesh' });
  const fin = await call('finalize', { request: req });
  assert.equal(fin.result.decision.source, 'rebuild');
  assert.equal(fin.result.replaced, true, '清書が strict なら、網を差し替える');
  assert.equal((await call('disposeLayer', { layerKey: 'msg' })).result, null);
  assert.deepEqual((await call('applyEdits', { layerKey: 'msg', edits: [], base: rebuilt.result.stamp })).result, { status: 'noMesh' }, '捨てた層は網が無い');
  assert.equal((await call('dispose')).result, null);
  assert.match((await call('bogus')).error, /^Unknown worker request: bogus$/);
});

// ---------------- 2. 表示用の網 ----------------
/** 表示用の網と、Tin の網の今の全部を、付随の値を除いて比べる（局所更新は帯を更新しないので、付随の値は別に確かめる）。 */
function vertexAndTriangleForm(canonical) {
  return { vertices: canonical.vertices, triangles: canonical.triangles };
}
function freshCanonical(session, layerKey) {
  const tin = session.peekTin(layerKey);
  const mesh = new TinDisplayMesh();
  mesh.replaceAll(snapshotFromTin(tin, {}));
  return mesh.canonical();
}

itest('表示用の網: 本物の applyEdits の差分を当てた結果が、Tin の網の全部から作った網と一致する', async () => {
  const gcps = gridGcps(2024);
  const session = new TinWorkerSession();
  const rnd = lcg(31);
  const first = await session.rebuild(request({ gcps, layerKey: 'live', incrementalEdits: true }));
  const display = new TinDisplayMesh();
  display.replaceAll(first.snapshot, first.stamp.revision);
  assert.equal(display.vertexCount, first.snapshot.vertices.length);
  assert.equal(display.triangleCount, first.snapshot.triangles.length);
  assert.deepEqual(vertexAndTriangleForm(display.canonical()), vertexAndTriangleForm(freshCanonical(session, 'live')), '最初の全部の取り込みが一致');

  let stamp = first.stamp;
  let locals = 0;
  let moveOnly = 0;
  let fulls = 0;
  let resnapshots = 0;
  const live = new Map(gcps.map((g, id) => [id, g]));
  let nextId = gcps.length;
  for (let step = 0; step < 60; step++) {
    const ids = [...live.keys()];
    const pick = ids[Math.floor(rnd() * ids.length)];
    const [paper, geo] = live.get(pick);
    const kind = rnd();
    let edit;
    if (kind < 0.4) edit = { type: 'movePoint', id: pick, forw: [paper[0] + (rnd() - 0.5) * 16, paper[1] + (rnd() - 0.5) * 16] };
    else if (kind < 0.7) edit = { type: 'movePoint', id: pick, bakw: [geo[0] + (rnd() - 0.5) * 300, geo[1] + (rnd() - 0.5) * 300] };
    else if (kind < 0.85) {
      const x = 80 + rnd() * 440, y = 80 + rnd() * 340;
      edit = { type: 'addPoint', id: nextId, forw: [x, y], bakw: [15000000 + 100 * x, 4000000 - 100 * y] };
    } else edit = { type: 'removePoint', id: pick };
    const response = await session.applyEdits({ layerKey: 'live', edits: [edit], base: stamp, index: 0 });
    assert.equal(response.status, 'patched', `step ${step}: 版が合っているので、当たる（${JSON.stringify(response)}）`);
    if (edit.type === 'movePoint') live.set(pick, [edit.forw ?? paper, edit.bakw ?? geo]);
    else if (edit.type === 'addPoint') live.set(nextId++, [edit.forw, edit.bakw]);
    else live.delete(pick);
    stamp = response.stamp;
    if (response.patch.mode === 'local') {
      locals++;
      assert.equal(response.patch.boundaryStale, true);
      const applied = display.applyPatch(response.patch);
      if (!applied.ok && applied.reason === 'supplementPairs') {
        // 補完点の対が変わる差分は、当てられない（添字の上の番号）。worker の網から全部を取り直す
        const tin = session.peekTin('live');
        display.replaceAll(snapshotFromTin(tin, tin.getCompiled(), true), response.stamp.revision);
        resnapshots++;
      } else assert.ok(applied.ok, `step ${step}: 差分が表示用の網に当たる（${JSON.stringify(applied)}）`);
      if (!response.patch.removedTriangles?.length && !response.patch.addedTriangles?.length) moveOnly++;
      assert.equal(display.boundaryStale, true);
    } else {
      fulls++;
      assert.ok(response.full?.snapshot, '全部組み直しのときは、全部が返る');
      display.replaceAll(response.full.snapshot, response.stamp.revision);
    }
    assert.deepEqual(vertexAndTriangleForm(display.canonical()), vertexAndTriangleForm(freshCanonical(session, 'live')), `step ${step}: 差分を当てた網 = 全部から作った網`);
  }
  assert.ok(locals >= 20, `局所で済んだ編集が十分ある（${locals} / 60、全部組み直し ${fulls}）`);
  assert.ok(moveOnly >= 1, '座標だけの変化（接続が変わらない差分）も通った');
});

/** 2 つの網の全部から、差分（三角形の id は新しく振る）を作る。差分の当て方の正しさを、全部の組み直しに対して確かめるため。 */
function diffToPatch(before, after, revision) {
  const triangleKey = (vertices) => {
    const keys = vertices.map(vertexKey);
    let start = 0;
    for (let i = 1; i < 3; i++) if (keys[i] < keys[start]) start = i;
    return [keys[start], keys[(start + 1) % 3], keys[(start + 2) % 3]].join('|');
  };
  const beforeVertices = new Map(before.vertices.map((v) => [vertexKey(v.ref), v]));
  const afterVertices = new Map(after.vertices.map((v) => [vertexKey(v.ref), v]));
  const afterTriangles = new Set(after.triangles.map((t) => triangleKey(t.vertices)));
  const beforeTriangles = new Set(before.triangles.map((t) => triangleKey(t.vertices)));
  let nextId = Math.max(-1, ...before.triangles.map((t) => t.id)) + 1;
  return {
    revision, mode: 'local', strict_status: 'strict', boundaryStale: false,
    removedTriangles: before.triangles.filter((t) => !afterTriangles.has(triangleKey(t.vertices))).map((t) => t.id),
    addedTriangles: after.triangles.filter((t) => !beforeTriangles.has(triangleKey(t.vertices))).map((t) => ({ id: nextId++, vertices: t.vertices })),
    removedVertices: before.vertices.filter((v) => !afterVertices.has(vertexKey(v.ref))).map((v) => v.ref),
    addedVertices: after.vertices.filter((v) => !beforeVertices.has(vertexKey(v.ref))),
    movedVertices: after.vertices.filter((v) => {
      const old = beforeVertices.get(vertexKey(v.ref));
      return old && (bits(old.forw) !== bits(v.forw) || bits(old.bakw) !== bits(v.bakw));
    }),
  };
}

itest('表示用の網: 2 つの全部組み直しの差を差分にして当てると、後の全部組み直しの網と一致する（頂点の増減・移動・三角形の増減）', async () => {
  const gcpsA = gridGcps(11);
  const gcpsB = gcpsA.map((g) => g.map((p) => [...p]));
  gcpsB[10][0] = [gcpsB[10][0][0] + 9, gcpsB[10][0][1] - 7]; // 紙の面の移動（接続が変わりうる）
  gcpsB[20][1] = [gcpsB[20][1][0] + 40, gcpsB[20][1][1] + 40]; // 地理面だけの移動
  gcpsB.push([[300.5, 250.5], [15030050, 3974950]]); // 点の追加
  gcpsB.splice(3, 1); // 点の削除（添字が詰まる＝別の指し方になる。差分は、それを含めて当たること）
  const session = new TinWorkerSession();
  const a = await session.rebuild(request({ gcps: gcpsA, layerKey: 'a', incrementalEdits: true }));
  const b = await session.rebuild(request({ gcps: gcpsB, layerKey: 'b', incrementalEdits: true }));
  const patch = diffToPatch(a.snapshot, b.snapshot, 1);
  assert.ok(patch.addedVertices.length + patch.removedVertices.length + patch.movedVertices.length > 0);
  const display = new TinDisplayMesh();
  display.replaceAll(a.snapshot, 0);
  assert.equal(display.applyPatch(patch).ok, true);
  const expected = new TinDisplayMesh();
  expected.replaceAll(b.snapshot, 1);
  assert.deepEqual(vertexAndTriangleForm(display.canonical()), vertexAndTriangleForm(expected.canonical()));
  assert.equal(display.revision, 1);
  // 座標だけの差分: 動いた頂点だけが入り、三角形は触らない
  const moveOnly = { revision: 2, mode: 'local', strict_status: 'strict', boundaryStale: true, movedVertices: [{ ref: { kind: 'gcp', id: 0 }, forw: [1, 2], bakw: [3, 4] }] };
  const triangleCount = display.triangleCount;
  const moved = display.applyPatch(moveOnly);
  assert.equal(moved.ok, true);
  assert.deepEqual(moved.change.removedTriangles.concat(moved.change.addedTriangles), [], '座標だけの差分は、三角形の増減が無い');
  assert.ok(moved.change.movedTriangles.length > 0, '頂点が動いた三角形が、描き直しの対象として返る');
  assert.deepEqual(display.vertex({ kind: 'gcp', id: 0 }).forw, [1, 2]);
  assert.equal(display.triangleCount, triangleCount);
  assert.deepEqual(display.triangleCoordinates('forw').length, triangleCount);
});

itest('表示用の網: 壊れた差分は、網に触らずに断る（途中まで当たった分も戻す）', async () => {
  const session = new TinWorkerSession();
  const first = await session.rebuild(request({ layerKey: 'r', incrementalEdits: true }));
  const display = new TinDisplayMesh();
  display.replaceAll(first.snapshot, 0);
  const before = bits(display.canonical());
  const base = { revision: 1, mode: 'local', strict_status: 'strict', boundaryStale: true };
  const someTriangle = first.snapshot.triangles[0];
  const unusedRef = { kind: 'gcp', id: 123456 };
  const cases = [
    ['全部組み直しの差分', { ...base, mode: 'full', fallbackReason: 'unsupported' }, 'notLocal'],
    ['版が飛ぶ', { ...base, revision: 3 }, 'revisionGap'],
    ['同じ版を 2 回', { ...base, revision: 0 }, 'revisionGap'],
    ['知らない三角形を消す', { ...base, removedTriangles: [987654] }, 'unknownTriangle'],
    ['三角形が指したままの頂点を消す', { ...base, removedVertices: [someTriangle.vertices[0]] }, 'danglingVertex'],
    ['知らない頂点を消す', { ...base, removedVertices: [unusedRef] }, 'unknownVertex'],
    ['もうある頂点を足す', { ...base, addedVertices: [{ ref: someTriangle.vertices[0], forw: [0, 0], bakw: [0, 0] }] }, 'duplicateVertex'],
    ['知らない頂点を動かす', { ...base, movedVertices: [{ ref: unusedRef, forw: [0, 0], bakw: [0, 0] }] }, 'unknownVertex'],
    ['知らない頂点を指す三角形を足す', { ...base, addedTriangles: [{ id: 900000, vertices: [someTriangle.vertices[0], someTriangle.vertices[1], unusedRef] }] }, 'unknownVertex'],
    ['もうある id の三角形を足す', { ...base, addedTriangles: [{ id: someTriangle.id, vertices: someTriangle.vertices }] }, 'duplicateTriangle'],
    // 前半は当たり（三角形を消し、頂点を動かす）、後半で壊れる。前半も戻ること
    ['途中まで当たってから壊れる', {
      ...base,
      removedTriangles: [someTriangle.id],
      movedVertices: [{ ref: someTriangle.vertices[0], forw: [-1, -1], bakw: [-2, -2] }],
      addedTriangles: [{ id: 900001, vertices: [someTriangle.vertices[0], someTriangle.vertices[1], unusedRef] }],
    }, 'unknownVertex'],
  ];
  for (const [name, patch, reason] of cases) {
    assert.deepEqual(display.applyPatch(patch), { ok: false, reason }, name);
    assert.equal(bits(display.canonical()), before, `${name}: 網は変わらない`);
    assert.equal(display.revision, 0, `${name}: 版も進まない`);
  }
});

// ---------------- 3. 版が合わないとき ----------------
/** worker を立てず、同じ筋道（rebuild・applyEdits・finalize）を通すための通信路。呼び出しを記録する。 */
function recordingTransport(session, log) {
  return {
    rebuild: async (req) => { log.push(['rebuild', req]); return session.rebuild(req); },
    applyEdits: async (req) => { log.push(['applyEdits', req]); return session.applyEdits(req); },
    getCompiled: async (req) => { log.push(['getCompiled', req]); return session.getCompiled(req); },
    getSnapshot: async (req) => { log.push(['getSnapshot', req]); return session.getSnapshot(req); },
    finalize: async (req) => { log.push(['finalize', req]); return session.finalize(req); },
    disposeLayer: async (key) => { log.push(['disposeLayer', key]); return session.disposeLayer(key); },
  };
}
const kinds = (log) => log.map(([kind]) => kind);

itest('版が合っていれば、差分だけが返り、rebuild は送り直さない', async () => {
  const session = new TinWorkerSession();
  const log = [];
  const sync = new LayerTinSync(recordingTransport(session, log), 'sync');
  const req = request({ incrementalEdits: true });
  assert.equal(bits(await sync.rebuild(req)), bits(await reference(request())), 'rebuild の結果は今と同じ');
  assert.ok(sync.stamp && sync.display.triangleCount > 0);
  log.length = 0;
  const g = req.gcps[10];
  const edits = [{ type: 'movePoint', id: 10, bakw: [g[1][0] + 25, g[1][1] - 25] }];
  const latest = { ...req, gcps: req.gcps.map((p, i) => (i === 10 ? [p[0], [p[1][0] + 25, p[1][1] - 25]] : p)) };
  const outcome = await sync.edit(edits, latest);
  assert.equal(outcome.kind, 'patched');
  assert.deepEqual(kinds(log), ['applyEdits'], '送り直さない');
  assert.equal(sync.stamp.revision, 1);
  assert.deepEqual(vertexAndTriangleForm(sync.display.canonical()), vertexAndTriangleForm(freshCanonical(session, 'sync')));
});

itest('revisionMismatch: worker は網に触らず、Editor は最新の入力の全部で rebuild を送り直す', async () => {
  const session = new TinWorkerSession();
  const log = [];
  const sync = new LayerTinSync(recordingTransport(session, log), 'mm');
  const req = request({ incrementalEdits: true });
  await sync.rebuild(req);
  const goodStamp = session.stampOf('mm');
  // Editor が持つ版が食い違った（別の rebuild が Editor の知らないうちに入った、など）
  sync.stamp = { generation: goodStamp.generation, revision: goodStamp.revision + 5 };
  log.length = 0;
  const latest = { ...req, gcps: gridGcps(777) };
  const outcome = await sync.edit([{ type: 'movePoint', id: 0, forw: [60, 60] }], latest);
  assert.deepEqual(kinds(log), ['applyEdits', 'rebuild'], '食い違いのあとに rebuild を送る');
  assert.deepEqual(log[0][1].base, { generation: goodStamp.generation, revision: goodStamp.revision + 5 });
  assert.equal(outcome.kind, 'rebuilt');
  assert.equal(outcome.reason, 'revisionMismatch');
  assert.equal(log[1][1].gcps, latest.gcps, 'rebuild は、最新の入力の全部（差分ではない）');
  assert.equal(bits(outcome.result), bits(await reference(request({ gcps: latest.gcps }))), 'Editor の入力に追いついた結果');
  assert.notDeepEqual(sync.stamp, goodStamp, '版が新しくなる');
  assert.deepEqual(sync.stamp, session.stampOf('mm'));
  assert.deepEqual(vertexAndTriangleForm(sync.display.canonical()), vertexAndTriangleForm(freshCanonical(session, 'mm')), '表示用の網も取り込み直す');

  // 食い違いのとき、worker は網に触っていない
  const before = session.stampOf('mm');
  const direct = await session.applyEdits({ layerKey: 'mm', edits: [{ type: 'movePoint', id: 0, forw: [61, 61] }], base: { generation: before.generation - 1, revision: before.revision }, index: 0 });
  assert.deepEqual(direct, { status: 'revisionMismatch', current: before });
  assert.deepEqual(session.stampOf('mm'), before);
});

itest('世代が古いとき（Editor が見ていない rebuild があった）も食い違いになり、rebuild を送り直す', async () => {
  const session = new TinWorkerSession();
  const log = [];
  const sync = new LayerTinSync(recordingTransport(session, log), 'gen');
  const req = request({ incrementalEdits: true });
  await sync.rebuild(req);
  // Editor の知らない rebuild（依頼が失効して結果を捨てた、など）。Tin の版は 0 で同じでも、世代が違う
  await session.rebuild({ ...req, layerKey: 'gen', gcps: gridGcps(3) });
  assert.equal(session.stampOf('gen').revision, sync.stamp.revision);
  log.length = 0;
  const outcome = await sync.edit([{ type: 'movePoint', id: 0, forw: [70, 70] }], req);
  assert.deepEqual(kinds(log), ['applyEdits', 'rebuild']);
  assert.equal(outcome.reason, 'revisionMismatch');
});

test('網が無い・applyEdits が使えない・編集が例外・差分が当たらない、のときも rebuild を送り直す', async () => {
  const req = request({ incrementalEdits: true });
  const edits = [{ type: 'movePoint', id: 0, forw: [70, 70] }];

  // noMesh: この層は、まだ rebuild していない（Editor は版も持たない）
  {
    const session = new TinWorkerSession();
    const log = [];
    const outcome = await new LayerTinSync(recordingTransport(session, log), 'nm').edit(edits, req);
    assert.deepEqual(kinds(log), ['rebuild']);
    assert.equal(outcome.reason, 'noMesh');
  }
  // noMesh: worker が作り直された（Editor は古い版を持っている）
  {
    const log = [];
    const sync = new LayerTinSync(recordingTransport(new TinWorkerSession(), log), 'nm2');
    sync.stamp = { generation: 1, revision: 0 };
    const outcome = await sync.edit(edits, req);
    assert.deepEqual(kinds(log), ['applyEdits', 'rebuild']);
    assert.equal(outcome.reason, 'noMesh');
  }
  // unsupported: Tin が applyEdits を持たない
  {
    class OldTin extends Tin { applyEdits = undefined; }
    const session = new TinWorkerSession({ createTin: (options) => new OldTin(options) });
    const log = [];
    const sync = new LayerTinSync(recordingTransport(session, log), 'un');
    await sync.rebuild(req);
    log.length = 0;
    const outcome = await sync.edit(edits, req);
    assert.deepEqual(kinds(log), ['applyEdits', 'rebuild']);
    assert.equal(outcome.reason, 'unsupported');
  }
  // failed: 編集が例外になる（網は捨てる）
  {
    class ThrowingTin extends Tin { applyEdits() { throw new Error('boom'); } }
    const session = new TinWorkerSession({ createTin: (options) => new ThrowingTin(options) });
    const log = [];
    const sync = new LayerTinSync(recordingTransport(session, log), 'fl');
    await sync.rebuild(req);
    log.length = 0;
    const outcome = await sync.edit(edits, req);
    assert.deepEqual(kinds(log), ['applyEdits', 'rebuild']);
    assert.equal(outcome.reason, 'failed');
    assert.ok(session.stampOf('fl'), 'rebuild で網が戻る');
  }
  // patchRejected: worker が返した差分が、表示用の網に当たらない
  {
    const log = [];
    const session = new TinWorkerSession();
    const transport = recordingTransport(session, log);
    transport.applyEdits = async (r) => {
      log.push(['applyEdits', r]);
      return { status: 'patched', stamp: { generation: 1, revision: 9 }, patch: { revision: 9, mode: 'local', strict_status: 'strict', boundaryStale: true } };
    };
    const sync = new LayerTinSync(transport, 'pr');
    await sync.rebuild(req);
    log.length = 0;
    const outcome = await sync.edit(edits, req);
    assert.deepEqual(kinds(log), ['applyEdits', 'rebuild']);
    assert.equal(outcome.reason, 'patchRejected');
  }
  // 全部組み直しへ落ちた（Tin の fallbackReason）: 差分は無く、全部を取り込む。rebuild は送り直さない
  {
    const log = [];
    const session = new TinWorkerSession();
    const sync = new LayerTinSync(recordingTransport(session, log), 'fb');
    await sync.rebuild({ ...req, tinOptions: { ...V3, strictMode: 'strict' } });
    log.length = 0;
    // 範囲外へ動かす（紙の面の外）。局所で済まず、全部組み直しへ落ちる
    const outcome = await sync.edit([{ type: 'movePoint', id: 0, forw: [-5000, -5000] }], req);
    assert.equal(outcome.kind === 'rebuilt' || outcome.kind === 'patched', true);
    if (incrementalTin && outcome.kind === 'rebuilt') assert.deepEqual(kinds(log), ['applyEdits'], '全部組み直しの結果は applyEdits の応答に入っている');
  }
});

// ---------------- 4. 清書と特例の保存 ----------------
/** 清書（finalize）で作られる 2 つ目の Tin だけ、strict_error と報告させる（今の全部組み直しが strict にならない場面を作る）。 */
function sessionWhereFinalizeFails(options = {}) {
  const control = { failing: false };
  class MaybeFailingTin extends Tin {
    constructor(o) {
      super(o);
      this.isFinalizer = control.failing;
    }
    getCompiled() {
      const compiled = super.getCompiled();
      return this.isFinalizer ? { ...compiled, strict_status: 'strict_error' } : compiled;
    }
  }
  const session = new TinWorkerSession({ createTin: (o) => new MaybeFailingTin(o), ...options });
  const finalize = (req, base) => {
    control.failing = true; // この間に作られる Tin（清書のインスタンス）だけが、strict_error と報告する
    return session.finalize({ ...req, ...(base ? { base } : {}) }).finally(() => { control.failing = false; });
  };
  return { session, finalize };
}

const goodEvidence = () => ({
  incrementalStatus: 'strict', boundaryFresh: true, invariantsHold: true, roundTripMatches: true,
  sweepKinks: 0, remainingForbiddenTriangles: 2, editsSinceRebuild: 0,
});

async function editedSession(session, key = 'fin') {
  const req = request({ layerKey: key, incrementalEdits: true });
  const first = await session.rebuild(req);
  // 局所で済む編集（紙の面の小さな移動）を 1 つ当てる。内側の点だけが局所で済むので、局所で済むものを探す
  for (let id = 0; id < req.gcps.length; id++) {
    const rebuilt = id === 0 ? first : await session.rebuild(req);
    const [x, y] = req.gcps[id][0];
    const response = await session.applyEdits({ layerKey: key, edits: [{ type: 'movePoint', id, forw: [x + 3, y + 3] }], base: rebuilt.stamp, index: 0 });
    if (response.status === 'patched' && response.patch.mode === 'local') {
      // 清書を頼む入力は、編集を反映した最新の入力
      const edited = { ...req, gcps: req.gcps.map((g, i) => (i === id ? [[x + 3, y + 3], g[1]] : g)) };
      return { req: edited, stamp: response.stamp, patch: response.patch };
    }
  }
  assert.fail('局所で済む編集が見つからない');
}

itest('清書: strict になれば、別のインスタンスの結果で網を差し替える（保存する compiled は今の updateTin と同じ）', async () => {
  const session = new TinWorkerSession();
  const { req, stamp: oldStamp } = await editedSession(session);
  const peekBefore = session.peekTin('fin');
  const done = await session.finalize({ request: req, base: oldStamp });
  assert.deepEqual(done.decision, { source: 'rebuild', reason: 'rebuildStrict' });
  assert.equal(done.replaced, true);
  assert.equal(bits(done.result), bits(await reference(request({ gcps: req.gcps, incrementalEdits: undefined }))), '保存する compiled は、全部組み直しの結果（今と同じ）');
  assert.notEqual(session.peekTin('fin'), peekBefore, '別のインスタンスに差し替わる');
  assert.ok(done.stamp.generation > oldStamp.generation && done.stamp.revision === 0);
  assert.ok(done.snapshot);
  assert.equal((await session.applyEdits({ layerKey: 'fin', edits: [], base: oldStamp, index: 0 })).status, 'revisionMismatch', '差し替え前の版では当たらない');
});

itest('清書が strict にならなくても、局所更新の網は上書きされない（証拠が無ければ、清書の結果を保存する）', async () => {
  const { session, finalize } = sessionWhereFinalizeFails();
  const { req, stamp } = await editedSession(session);
  const peekBefore = session.peekTin('fin');
  const done = await finalize({ request: req }, stamp);
  assert.deepEqual(done.decision, { source: 'rebuild', reason: 'noEvidence' });
  assert.equal(done.replaced, false);
  assert.equal(done.result[1].strict_status, 'strict_error', '保存するのは、清書の結果（今と同じ）');
  assert.equal(hasIncrementalOrigin(done.result[1]), false);
  assert.equal(session.peekTin('fin'), peekBefore, '局所更新の網は、そのまま');
  assert.deepEqual(done.stamp, stamp);
  assert.equal((await session.applyEdits({ layerKey: 'fin', edits: [], base: stamp, index: 0 })).status, 'patched', '網は使い続けられる');
});

itest('特例の保存: 清書が strict_error で、局所更新の網が strict なら、局所更新の網から書いた compiled（印つき）を保存する', async () => {
  let asked = 0;
  const { session, finalize } = sessionWhereFinalizeFails({ collectEvidence: (tin) => { asked++; assert.ok(tin.incrementalMesh); return goodEvidence(); } });
  const { req, stamp } = await editedSession(session);
  const peekBefore = session.peekTin('fin');
  const done = await finalize({ request: req }, stamp);
  assert.equal(asked, 1);
  assert.equal(done.stamp.revision, stamp.revision);
  assert.deepEqual(done.decision, { source: 'incremental', reason: 'specialSave' });
  assert.equal(done.replaced, false);
  const saved = done.result[1];
  assert.equal(saved.meshOrigin, 'incremental', '印が付く');
  assert.equal(hasIncrementalOrigin(saved), true);
  assert.equal(saved.strict_status, 'strict', '局所更新の網は strict');
  const { meshOrigin, ...rest } = saved;
  assert.equal(meshOrigin, 'incremental');
  assert.equal(bits(rest), bits(peekBefore.getCompiled()), '局所更新の網そのものから書いている');
  assert.deepEqual(done.result[2].incremental, {
    rebuildStatus: 'strict_error', rebuildKinks: 0, editsSinceRebuild: 1, sweepKinks: 0, remainingForbiddenTriangles: 2,
  }, '診断に、特例の保存であることと、清書の結果が残る');
  assert.equal(session.peekTin('fin'), peekBefore, '網は保たれ、局所更新を続けられる');
  assert.deepEqual(done.stamp.generation, stamp.generation);
});

itest('特例の保存: 条件が 1 つでも欠ければ、清書の結果を保存する', async () => {
  const breakers = {
    incrementalNotStrict: { incrementalStatus: 'strict_error' },
    boundaryStale: { boundaryFresh: false },
    invariantsNotHeld: { invariantsHold: false },
    roundTripMismatch: { roundTripMatches: false },
    sweepKinksFound: { sweepKinks: 1 },
  };
  for (const [reason, broken] of Object.entries(breakers)) {
    const { session, finalize } = sessionWhereFinalizeFails({ collectEvidence: () => ({ ...goodEvidence(), ...broken }) });
    const { req, stamp } = await editedSession(session);
    const done = await finalize({ request: req }, stamp);
    assert.deepEqual(done.decision, { source: 'rebuild', reason }, reason);
    assert.equal(done.result[1].strict_status, 'strict_error');
    assert.equal(hasIncrementalOrigin(done.result[1]), false);
  }
  // 証拠の値が、型・範囲に合わないときは、通さない（undefined・NaN・文字列・負の数）
  for (const sweepKinks of [undefined, Number.NaN, '1', -1, 0.5]) {
    const { session, finalize } = sessionWhereFinalizeFails({ collectEvidence: () => ({ ...goodEvidence(), sweepKinks }) });
    const { req, stamp } = await editedSession(session);
    const done = await finalize({ request: req }, stamp);
    assert.deepEqual(done.decision, { source: 'rebuild', reason: 'evidenceInvalid' }, `sweepKinks=${String(sweepKinks)}`);
  }
  // 持っている網が、清書を頼んだ入力・版と対応しないときは、特例の保存の候補にしない（証拠を集めることもしない）
  {
    let asked = 0;
    const { session, finalize } = sessionWhereFinalizeFails({ collectEvidence: () => { asked++; return goodEvidence(); } });
    const { req, stamp } = await editedSession(session);
    const stale = await finalize({ request: req }, { generation: stamp.generation, revision: stamp.revision - 1 });
    assert.deepEqual(stale.decision, { source: 'rebuild', reason: 'meshMismatch' }, '版が違う');
    const noBase = await finalize({ request: req });
    assert.deepEqual(noBase.decision, { source: 'rebuild', reason: 'meshMismatch' }, '版を渡さない');
    const newer = { ...req, gcps: req.gcps.map((g, i) => (i === 16 ? [[g[0][0] + 6, g[0][1] + 6], g[1]] : g)) };
    const other = await finalize({ request: newer }, stamp);
    assert.deepEqual(other.decision, { source: 'rebuild', reason: 'meshMismatch' }, 'Editor の最新の入力が、網の入力と違う（網に入っていない編集がある）');
    assert.equal(other.result[1].points[16][0][0], newer.gcps[16][0][0], '保存するのは、渡した入力の清書');
    assert.equal(hasIncrementalOrigin(other.result[1]), false);
    assert.equal(asked, 0, '対応しない網の証拠は集めない');
    // 必須エッジの違いも見る
    const withEdge = { ...req, edges: [[[], [], [0, 1]]] };
    assert.equal((await finalize({ request: withEdge }, stamp)).decision.reason, 'meshMismatch');
    const ok = await finalize({ request: req }, stamp);
    assert.equal(ok.decision.reason, 'specialSave', '入力と版が合えば、特例の保存');
  }
  // 清書が入力のエラーで失敗したときは、そのエラーを保存し、網には触らない
  const session = new TinWorkerSession();
  const { req, stamp } = await editedSession(session);
  const failed = await session.finalize({ request: { ...req, gcps: req.gcps.slice(0, 2) } });
  assert.deepEqual(failed.result, [0, 'tooLessGcps', null]);
  assert.deepEqual(failed.decision, { source: 'rebuild', reason: 'rebuildFailed' });
  assert.deepEqual(failed.stamp, stamp);
});

test('decideSavedMesh と印の道具', () => {
  const evidence = goodEvidence();
  assert.deepEqual(decideSavedMesh({ rebuildStatus: 'strict', evidence }), { source: 'rebuild', reason: 'rebuildStrict' }, '清書が strict なら、証拠があっても清書');
  assert.deepEqual(decideSavedMesh({ rebuildStatus: undefined, evidence }), { source: 'rebuild', reason: 'rebuildFailed' });
  assert.deepEqual(decideSavedMesh({ rebuildStatus: 'strict_error' }), { source: 'rebuild', reason: 'noEvidence' });
  assert.deepEqual(decideSavedMesh({ rebuildStatus: 'strict_error', evidence }), { source: 'rebuild', reason: 'meshMismatch' }, '網と入力の対応が確かめられていなければ使わない');
  assert.deepEqual(decideSavedMesh({ rebuildStatus: 'loose', evidence: { ...evidence, editsSinceRebuild: 3 }, rebuildKinks: 4, meshMatchesRequest: true }), {
    source: 'incremental', reason: 'specialSave',
    diagnostics: { rebuildStatus: 'loose', rebuildKinks: 4, editsSinceRebuild: 3, sweepKinks: 0, remainingForbiddenTriangles: 2 },
  });
  const compiled = { version: 3, strict_status: 'strict' };
  const marked = withMeshOrigin(compiled);
  assert.equal(marked.meshOrigin, 'incremental');
  assert.equal('meshOrigin' in compiled, false, '元の compiled は変えない');
  assert.equal(hasIncrementalOrigin(compiled), false);
  assert.equal(hasIncrementalOrigin(null), false);
  assert.equal(hasIncrementalOrigin('x'), false);
});

// ---------------- 5. 設定 incrementalEdits ----------------
test('設定 incrementalEdits は既定が切で、明示の true だけが入る', () => {
  for (const value of [undefined, null, false, 'false', 0, 1, '', 'yes', {}, []]) assert.equal(normalizeIncrementalEdits(value), false, String(value));
  assert.equal(normalizeIncrementalEdits(true), true);
  assert.equal(normalizeIncrementalEdits('true'), true);
  assert.ok(RENDERER_SETTINGS_KEYS.has('incrementalEdits'), 'renderer が読み書きできる');
});

test('設定が切なら、worker への依頼は今と同じ形（incrementalEdits を付けない）。入なら印を付ける', async () => {
  const layer = transformLayerFromDocument('main', { width: 100, height: 100, gcps: [[[10, 10], [1000, 1000]], [[90, 10], [1900, 1000]], [[10, 90], [1000, 1900]], [[90, 90], [1900, 1900]]] });
  const inputs = [];
  const compute = async (input) => { inputs.push(input); return [0, 'tooLinear', null]; };
  const base = { layer, layerId: 'main', kind: 'edit', reqGen: 1, isCurrent: () => true };
  await buildEditorLayerTin(base, 0, compute);
  await buildEditorLayerTin(base, 0, compute, { incrementalEdits: false });
  await buildEditorLayerTin(base, 0, compute, { incrementalEdits: true });
  assert.equal(inputs.length, 3);
  for (const input of inputs.slice(0, 2)) assert.equal('incrementalEdits' in input, false);
  assert.equal(inputs[2].incrementalEdits, true);
  assert.deepEqual(inputs.map((i) => i.layerKey), ['main', 'main', 'main'], '層の id で、worker が網を持ち分ける');
  // 印以外は同じ
  const { incrementalEdits, ...rest } = inputs[2];
  assert.equal(incrementalEdits, true);
  assert.equal(bits(rest), bits(inputs[0]));
});

test('配線: 設定画面の切り替えが保存され、MapEdit が画面を開いたときに設定を読む。導入文は既定が切', async () => {
  const mapEdit = await readFile(new URL('../src/views/MapEdit.vue', import.meta.url), 'utf8');
  assert.match(mapEdit, /normalizeIncrementalEdits\(await settings\.get\('incrementalEdits'\)\)/);
  assert.match(mapEdit, /const incrementalEditsSetting: Promise<boolean> = readIncrementalEditsSetting\(\);/, '開いたときに 1 回だけ読む');
  assert.doesNotMatch(mapEdit, /await readIncrementalEditsSetting\(\)/, '依頼のたびには読まない');
  assert.match(mapEdit, /incrementalEdits,\n\s+refresh: \(input, isCurrent\) => editorComputeBackend\.refreshTin/, 'buildEditorLayerTin へ渡す');
  const settings = await readFile(new URL('../src/views/Settings.vue', import.meta.url), 'utf8');
  assert.match(settings, /incrementalEdits: false,/, '画面の既定は切');
  assert.match(settings, /window\.settings\.set\("incrementalEdits", state\.incrementalEdits\)/);
  const service = await readFile(new URL('../electron/services/SettingsService.ts', import.meta.url), 'utf8');
  assert.match(service, /incrementalEdits: false,/, '保存値の既定は切');
});
