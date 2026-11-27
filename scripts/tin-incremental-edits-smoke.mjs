// 三角網の差分更新（MaplatTin#100）の Editor 側・第 2 週:
//   1. Editor の対応点・必須エッジの配列から TinEdit を作る（安定した id・並び・検算）
//   2. その編集を本物の Tin#applyEdits へ当て、Editor の配列と compiled の並びが一致する
//   3. 表示用の網の差分で描き直す（描いてある三角形が、網と一致する）
//   4. 清書: 編集が止まったとき・保存の前・層を消したときの後始末（モデル）
//   5. 保存される地図: 設定が切のとき今と同じ。入のときは、保存の前に清書した結果
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import Tin from '@maplat/tin';

const { TinWorkerSession, snapshotFromTin } = await import('../src/workers/tinWorkerSession.ts');
const { TinDisplayMesh } = await import('../src/utils/tinDisplayMesh.ts');
const { LayerTinSync, StaleRequestError } = await import('../src/services/tinEditSync.ts');
const { TinMeshRenderer } = await import('../src/utils/tinMeshRenderer.ts');
const { createIdleRunner } = await import('../src/utils/idleRunner.ts');
const { applyEditsToTracked, planEdits, trackInputs } = await import('../src/utils/tinEditPlanner.ts');
const { buildEditorLayerTin, finalizeEditorLayerTin } = await import('../src/services/editorComputeBackend.ts');
const { transformLayerFromDocument } = await import('../src/utils/layerTransformIntent.ts');
const { useLayerTransformState } = await import('../src/composables/useLayerTransformState.ts');

const incrementalTin = typeof Tin.prototype.applyEdits === 'function';
const itest = (name, fn) => test(name, { skip: incrementalTin ? false : '@maplat/tin に applyEdits が無い' }, fn);

function lcg(seed) {
  let state = seed;
  return () => (state = (state * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
}
const bits = (value) => JSON.stringify(value);
const clone = (value) => structuredClone(value);
const W = 600;
const H = 500;

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
const V3 = { useV2Algorithm: false, yaxisMode: 'invert', outerTransform: 'extrapolate', strictMode: 'strict' };
function request(overrides = {}) {
  return {
    gcps: gridGcps(7), edges: [], index: 0, bounds: [W, H], strict: 'strict', vertex: 'plain',
    tinOptions: V3, layerKey: 'main', incrementalEdits: true, ...overrides,
  };
}

// ---------------- 1. 編集を作る ----------------
const P = (fx, fy, bx, by) => [[fx, fy], [bx, by]];
const ids = (tracked) => tracked.pointIds;

test('変化が無ければ編集は空で、id は添字から始まる', () => {
  const points = [P(0, 0, 10, 10), P(1, 0, 11, 10), P(0, 1, 10, 11)];
  const tracked = trackInputs(points, []);
  assert.deepEqual(ids(tracked), [0, 1, 2]);
  assert.equal(tracked.nextPointId, 3);
  const plan = planEdits(tracked, clone(points), []);
  assert.deepEqual(plan.edits, []);
  assert.deepEqual(plan.next, tracked);
  // 呼び出し側の配列を書き換えても、写しは変わらない
  points[0][0][0] = 99;
  assert.equal(tracked.points[0][0][0], 0);
});

test('点の移動・追加・削除: id を保ち、追加は使われていない id と並びの位置を持つ', () => {
  const base = [P(0, 0, 10, 10), P(1, 0, 11, 10), P(0, 1, 10, 11), P(1, 1, 11, 11)];
  const tracked = trackInputs(base, []);
  // 紙の面だけの移動 → forw だけ。地理面だけの移動 → bakw だけ
  let plan = planEdits(tracked, [P(0.5, 0, 10, 10), base[1], base[2], base[3]], []);
  assert.deepEqual(plan.edits, [{ type: 'movePoint', id: 0, forw: [0.5, 0] }]);
  plan = planEdits(tracked, [base[0], P(1, 0, 11.5, 10), base[2], base[3]], []);
  assert.deepEqual(plan.edits, [{ type: 'movePoint', id: 1, bakw: [11.5, 10] }]);
  // 真ん中に追加: position は新しい並びの位置、id は使われていない 4
  plan = planEdits(tracked, [base[0], base[1], P(5, 5, 15, 15), base[2], base[3]], []);
  assert.deepEqual(plan.edits, [{ type: 'addPoint', id: 4, forw: [5, 5], bakw: [15, 15], position: 2 }]);
  assert.deepEqual(plan.next.pointIds, [0, 1, 4, 2, 3]);
  assert.equal(plan.next.nextPointId, 5);
  // 削除: 他の id は変わらない。消した id は、次の追加で使い回さない
  plan = planEdits(plan.next, [base[0], base[1], base[2], base[3]], []);
  assert.deepEqual(plan.edits, [{ type: 'removePoint', id: 4 }]);
  assert.deepEqual(plan.next.pointIds, [0, 1, 2, 3]);
  assert.equal(plan.next.nextPointId, 5);
  const again = planEdits(plan.next, [...base, P(9, 9, 19, 19)], []);
  assert.deepEqual(again.edits, [{ type: 'addPoint', id: 5, forw: [9, 9], bakw: [19, 19], position: 4 }]);
});

test('並びの入れ替えは、増加列だけを対応づけ、残りは削除 + 追加にする（並びを再現できる）', () => {
  const base = [P(0, 0, 1, 1), P(2, 2, 3, 3), P(4, 4, 5, 5), P(6, 6, 7, 7)];
  const tracked = trackInputs(base, []);
  const plan = planEdits(tracked, [base[3], base[0], base[1], base[2]], []);
  assert.ok(plan);
  assert.deepEqual(plan.next.points, [base[3], base[0], base[1], base[2]]);
  assert.equal(plan.edits.filter((e) => e.type === 'movePoint').length, 0, '座標が同じ点は、動かさない');
});

test('必須エッジ: 端点の id の組で対応づけ、端点が動いても同じ必須エッジ。端点を消すときは、先にエッジを外す', () => {
  const base = [P(0, 0, 1, 1), P(10, 0, 11, 1), P(10, 10, 11, 11), P(0, 10, 1, 11)];
  const edge = [[[5, 0]], [[6, 1]], [0, 1]];
  const tracked = trackInputs(base, [edge]);
  // 端点を動かす: movePoint だけ
  let plan = planEdits(tracked, [P(0, 0.5, 1, 1), ...base.slice(1)], [edge]);
  assert.deepEqual(plan.edits.map((e) => e.type), ['movePoint']);
  assert.deepEqual(plan.next.edgeIds, [0]);
  // 折れ点だけ変える: replaceEdgeNodes
  plan = planEdits(tracked, base, [[[[5, 0.5]], [[6, 1]], [0, 1]]]);
  assert.deepEqual(plan.edits, [{ type: 'replaceEdgeNodes', id: 0, forwNodes: [[5, 0.5]], bakwNodes: [[6, 1]] }]);
  // 端点を消す（エッジも無くなる）: removeEdge が removePoint より先
  plan = planEdits(tracked, base.slice(1), []);
  assert.deepEqual(plan.edits.map((e) => e.type), ['removeEdge', 'removePoint']);
  // 足す: addEdge は点を足した後。id は使われていない 1
  plan = planEdits(tracked, [...base, P(20, 20, 21, 21)], [edge, [[], [], [2, 4]]]);
  assert.deepEqual(plan.edits.map((e) => e.type), ['addPoint', 'addEdge']);
  assert.equal(plan.edits[1].id, 1);
  assert.equal(plan.edits[1].start, plan.next.pointIds[2]);
  assert.equal(plan.edits[1].end, plan.next.pointIds[4]);
  // 範囲の外の添字: 編集にできない
  assert.equal(planEdits(tracked, base, [[[], [], [0, 99]]]), undefined);
});

test('乱数の編集（点の移動・追加・削除・並べ替え・必須エッジ）で、編集を当て直すと、必ず新しい配列になる', () => {
  const rnd = lcg(5);
  const pick = (n) => Math.floor(rnd() * n);
  let points = gridGcps(3, 5, 5);
  let edges = [[[], [], [0, 1]], [[[200, 200]], [[15020000, 3980000]], [10, 11]]];
  let tracked = trackInputs(points, edges);
  for (let step = 0; step < 300; step++) {
    const nextPoints = clone(points);
    let nextEdges = clone(edges);
    const op = pick(8);
    const k = pick(nextPoints.length);
    if (op === 0) nextPoints[k][0] = [nextPoints[k][0][0] + rnd(), nextPoints[k][0][1]];
    else if (op === 1) nextPoints[k][1] = [nextPoints[k][1][0], nextPoints[k][1][1] + rnd()];
    else if (op === 2) nextPoints.splice(pick(nextPoints.length + 1), 0, [[rnd() * 500, rnd() * 500], [rnd(), rnd()]]);
    else if (op === 3 && nextPoints.length > 4) {
      nextPoints.splice(k, 1);
      nextEdges = nextEdges.filter(([, , [s, e]]) => s !== k && e !== k)
        .map(([f, b, [s, e]]) => [f, b, [s > k ? s - 1 : s, e > k ? e - 1 : e]]);
    } else if (op === 4) {
      const j = pick(nextPoints.length);
      [nextPoints[k], nextPoints[j]] = [nextPoints[j], nextPoints[k]];
      nextEdges = []; // 入れ替えでは、添字で持つ必須エッジの意味が変わるので、この操作では持たない
    } else if (op === 5 && nextPoints.length > 3) {
      const s = pick(nextPoints.length);
      const e = pick(nextPoints.length);
      if (s !== e) nextEdges.push([[], [], [s, e]]);
    } else if (op === 6 && nextEdges.length) nextEdges.splice(pick(nextEdges.length), 1);
    else if (op === 7 && nextEdges.length) nextEdges[pick(nextEdges.length)][0] = [[rnd() * 500, rnd() * 500]];
    const plan = planEdits(tracked, nextPoints, nextEdges);
    assert.ok(plan, `step ${step} op ${op}: 編集を作れる`);
    const applied = applyEditsToTracked(tracked, plan.edits);
    assert.deepEqual(applied.points, nextPoints.map((p) => [p[0], p[1]]), `step ${step}: 点の並び`);
    assert.deepEqual(applied.edges, nextEdges.map(([f, b, [s, e]]) => [f, b, [s, e]]), `step ${step}: 必須エッジの並び`);
    assert.equal(new Set(applied.pointIds).size, applied.pointIds.length, '点の id は重ならない');
    assert.equal(new Set(applied.edgeIds).size, applied.edgeIds.length, '必須エッジの id は重ならない');
    assert.ok(applied.pointIds.every((id) => id < applied.nextPointId) && applied.edgeIds.every((id) => id < applied.nextEdgeId));
    points = nextPoints;
    edges = nextEdges;
    tracked = plan.next;
  }
});

// ---------------- 2. 本物の Tin へ ----------------
function transportOf(session, log) {
  return {
    rebuild: async (req) => { log.push('rebuild'); return session.rebuild(req); },
    applyEdits: async (req) => { log.push('applyEdits'); return session.applyEdits(req); },
    getCompiled: async (req) => { log.push('getCompiled'); return session.getCompiled(req); },
    getSnapshot: async (req) => { log.push('getSnapshot'); return session.getSnapshot(req); },
    finalize: async (req) => { log.push('finalize'); return session.finalize(req); },
    disposeLayer: async (key) => { log.push('disposeLayer'); return session.disposeLayer(key); },
  };
}
const vertexAndTriangles = (canonical) => ({ vertices: canonical.vertices, triangles: canonical.triangles });
function freshCanonical(session, layerKey) {
  const mesh = new TinDisplayMesh();
  mesh.replaceAll(snapshotFromTin(session.peekTin(layerKey), {}));
  return mesh.canonical();
}

itest('Editor の配列の変化を本物の applyEdits へ当てると、compiled の並びが Editor の配列と一致し、表示用の網も Tin の網と一致する', async () => {
  const rnd = lcg(77);
  const pick = (n) => Math.floor(rnd() * n);
  const session = new TinWorkerSession();
  const log = [];
  const sync = new LayerTinSync(transportOf(session, log), 'edit');
  let gcps = gridGcps(2025);
  let edges = [[[], [], [0, 1]]];
  const first = await sync.refresh(request({ gcps, edges }));
  assert.equal(first.kind, 'rebuilt');
  assert.equal(first.reason, 'noMesh');
  const counts = { patched: 0, rebuilt: 0, unchanged: 0, thrown: 0 };
  let finalizes = 0;
  for (let step = 0; step < 60; step++) {
    const nextGcps = clone(gcps);
    let nextEdges = clone(edges);
    const op = pick(6);
    const k = pick(nextGcps.length);
    if (op <= 1) nextGcps[k][0] = [nextGcps[k][0][0] + (rnd() - 0.5) * 12, nextGcps[k][0][1] + (rnd() - 0.5) * 12];
    else if (op === 2) nextGcps[k][1] = [nextGcps[k][1][0] + (rnd() - 0.5) * 400, nextGcps[k][1][1] + (rnd() - 0.5) * 400];
    else if (op === 3) {
      const x = 100 + rnd() * 400, y = 100 + rnd() * 300;
      nextGcps.splice(pick(nextGcps.length + 1), 0, [[x, y], [15000000 + 100 * x, 4000000 - 100 * y]]);
      // 追加で、必須エッジの端点の添字がずれるので、端点の添字を直す
      nextEdges = [];
    } else if (op === 4 && nextGcps.length > 20) {
      nextGcps.splice(k, 1);
      nextEdges = nextEdges.filter(([, , [s, e]]) => s !== k && e !== k).map(([f, b, [s, e]]) => [f, b, [s > k ? s - 1 : s, e > k ? e - 1 : e]]);
    } else nextEdges = clone(edges);
    const req = request({ gcps: nextGcps, edges: nextEdges });
    let outcome;
    try {
      outcome = await sync.refresh(req);
    } catch (error) {
      // 必須エッジが交差するなど、全部組み直しでも例外になる入力。Editor の配列を前の状態へ戻して続ける
      counts.thrown++;
      assert.ok(counts.thrown <= 3, `例外が多すぎる: ${error}`);
      continue;
    }
    counts[outcome.kind]++;
    const compiled = outcome.result[1];
    assert.equal(typeof compiled, 'object', `step ${step} op ${op}: compiled が返る（${String(compiled)}）`);
    assert.deepEqual(compiled.points, nextGcps.map(([f, b]) => [f, b]), `step ${step}: compiled の点の並びが Editor の配列と同じ`);
    assert.deepEqual(compiled.edges.map(([f, b, se]) => [f, b, se]), nextEdges, `step ${step}: 必須エッジの並びが同じ`);
    gcps = nextGcps;
    edges = nextEdges;
    assert.deepEqual(vertexAndTriangles(sync.display.canonical()), vertexAndTriangles(freshCanonical(session, 'edit')), `step ${step}: 表示用の網 = Tin の網`);
    if (step % 17 === 16) {
      // 清書: 別のインスタンスに替わる。その後も、id の写しは添字から始まり、続けて差分で更新できる
      const done = await sync.finalize(req);
      finalizes++;
      assert.equal(done.replaced, true);
      assert.deepEqual(sync.tracked.pointIds, gcps.map((_, i) => i));
    }
  }
  assert.ok(counts.patched >= 10, `局所で済んだ更新がある: ${bits(counts)}`);
  assert.ok(finalizes >= 3);
  assert.ok(log.includes('getCompiled'), '局所で済んだときは、網から compiled を書き出す');
});

itest('同じ入力・作り方が変わったとき・設定が切のときの refresh', async () => {
  const session = new TinWorkerSession();
  const log = [];
  const sync = new LayerTinSync(transportOf(session, log), 'sig');
  const req = request();
  await sync.refresh(req);
  log.length = 0;
  const same = await sync.refresh({ ...req, gcps: clone(req.gcps) });
  assert.equal(same.kind, 'unchanged');
  assert.deepEqual(log, ['getCompiled'], '三角形分けも、編集の送信もしない');
  assert.equal(bits(same.result[1].points), bits(req.gcps));
  // 作り方が変わった（生成設定）
  log.length = 0;
  const changed = await sync.refresh({ ...req, tinOptions: { ...V3, strictMode: 'auto' } });
  assert.deepEqual([changed.kind, changed.reason], ['rebuilt', 'optionsChanged']);
  assert.deepEqual(log, ['rebuild']);
  // スイッチが切: 局所更新は使わず、網の写しも持たない
  log.length = 0;
  const off = await sync.refresh({ ...req, incrementalEdits: undefined });
  assert.deepEqual([off.kind, off.reason], ['rebuilt', 'optionsChanged']);
  assert.equal(sync.tracked, undefined);
  assert.equal(sync.display.triangleCount, 0);
});

itest('依頼は 1 つずつ処理する（同じ層の refresh が追い越し合っても、入力の写しと網が食い違わない）', async () => {
  const session = new TinWorkerSession();
  const sync = new LayerTinSync(transportOf(session, []), 'serial');
  const base = gridGcps(8);
  await sync.refresh(request({ gcps: base }));
  const a = clone(base);
  a[3][0] = [a[3][0][0] + 5, a[3][0][1]];
  const b = clone(a);
  b[4][0] = [b[4][0][0], b[4][0][1] + 5];
  const [ra, rb] = await Promise.all([sync.refresh(request({ gcps: a })), sync.refresh(request({ gcps: b }))]);
  assert.deepEqual(ra.result[1].points, a.map(([f, g]) => [f, g]));
  assert.deepEqual(rb.result[1].points, b.map(([f, g]) => [f, g]));
});

itest('失効した依頼は網に触らない（版も入力の写しも、そのまま）', async () => {
  const session = new TinWorkerSession();
  const sync = new LayerTinSync(transportOf(session, []), 'stale');
  const base = gridGcps(9);
  await sync.refresh(request({ gcps: base }));
  const before = { stamp: sync.stamp, tracked: clone(sync.tracked) };
  const next = clone(base);
  next[14][0] = [next[14][0][0] + 3, next[14][0][1]];
  await assert.rejects(sync.refresh(request({ gcps: next }), () => false), /失効/);
  assert.deepEqual(sync.stamp, before.stamp);
  assert.deepEqual(sync.tracked, before.tracked);
  const ok = await sync.refresh(request({ gcps: next }));
  assert.notEqual(ok.kind, 'rebuilt', '失効した依頼のあとも、差分で更新できる');
});

// ---------------- 2b. 失効・続けた編集・表示用の網の補完点（レビュー指摘 M-1・m-1・M-3）----------------
/** editorComputeBackend.ts の enqueue と同じ作り（依頼は 1 つずつ・失効した依頼は送らず、StaleRequestError）。 */
function backendLikeTransport(session, log) {
  let queue = Promise.resolve();
  const enqueue = (isCurrent, task) => {
    const next = queue.then(() => { if (isCurrent && !isCurrent()) throw new StaleRequestError(); return task(); });
    queue = next.catch(() => undefined);
    return next;
  };
  const wire = (value) => structuredClone(value);
  return {
    enqueue,
    rebuild: (r, c) => enqueue(c, () => { log.push('rebuild'); return session.rebuild(wire(r)).then(wire); }),
    applyEdits: (r, c) => enqueue(c, () => { log.push('applyEdits'); return session.applyEdits(wire(r)).then(wire); }),
    getCompiled: (r, c) => enqueue(c, () => { log.push('getCompiled'); return session.getCompiled(wire(r)).then(wire); }),
    getSnapshot: (r, c) => enqueue(c, () => { log.push('getSnapshot'); return session.getSnapshot(wire(r)).then(wire); }),
    finalize: (r, c) => enqueue(c, () => { log.push('finalize'); return session.finalize(wire(r)).then(wire); }),
    disposeLayer: (k) => enqueue(undefined, () => session.disposeLayer(k)),
  };
}
const moveForw = (gcps, id, d) => gcps.map((g, i) => (i === id ? [[g[0][0] + d, g[0][1] + d], g[1]] : g));

itest('失効して送られなかった編集のあとの編集が、古い網に当たらない（編集を 1 つ飛ばした網にならない）', async () => {
  for (const mode of ['edit', 'refresh']) {
    const session = new TinWorkerSession();
    const log = [];
    const transport = backendLikeTransport(session, log);
    const sync = new LayerTinSync(transport, 'race');
    const g0 = gridGcps(7);
    await sync.rebuild(request({ gcps: g0 }));
    log.length = 0;
    // 別の依頼（別の層の rebuild など）が先に走っている間に、E1・E2 が並ぶ。E1 は、E2 の編集で失効する
    let release;
    const blocker = transport.enqueue(undefined, () => new Promise((resolve) => { release = resolve; }));
    let generation = 1;
    const g1 = moveForw(g0, 16, 6);
    const gen1 = ++generation;
    const g2 = moveForw(g1, 22, 6);
    const call = (gcps, edits, gen) => mode === 'edit'
      ? sync.edit(edits, request({ gcps }), () => generation === gen)
      : sync.refresh(request({ gcps }), () => generation === gen);
    const e1 = call(g1, [{ type: 'movePoint', id: 16, forw: g1[16][0] }], gen1).catch((error) => error);
    const gen2 = ++generation;
    const e2 = call(g2, [{ type: 'movePoint', id: 22, forw: g2[22][0] }], gen2);
    await Promise.resolve();
    release();
    await blocker;
    assert.ok((await e1) instanceof Error, `${mode}: E1 は送られない`);
    const out = await e2;
    const held = session.peekTin('race').getCompiled();
    assert.deepEqual(held.points, g2.map(([f, b]) => [f, b]), `${mode}: worker の網が、最新の入力（E1 も入っている）と一致する`);
    assert.deepEqual(out.result[1].points, g2.map(([f, b]) => [f, b]), `${mode}: Editor へ返った compiled も同じ`);
    if (mode === 'edit') {
      assert.equal(out.kind, 'rebuilt');
      assert.equal(out.reason, 'noMesh', '明示の編集は、失効のあと網を捨て、入力の全部を送り直す');
    } else {
      assert.ok(!log.includes('rebuild'), 'refresh は、入力の写しとの差を取り直すので、全部組み直さずに済む');
    }
  }
});

itest('失効して送られなかった rebuild のあとの編集も、古い網に当たらない', async () => {
  const session = new TinWorkerSession();
  const sync = new LayerTinSync(backendLikeTransport(session, []), 'race2');
  const g0 = gridGcps(7);
  await sync.rebuild(request({ gcps: g0 }));
  const g1 = moveForw(g0, 16, 6);
  await assert.rejects(sync.rebuild(request({ gcps: g1 }), () => false), /失効/);
  assert.equal(sync.stamp, undefined, '公開の入口は、例外で終わったら版を捨てる');
  const g2 = moveForw(g1, 22, 6);
  const out = await sync.edit([{ type: 'movePoint', id: 22, forw: g2[22][0] }], request({ gcps: g2 }));
  assert.equal(out.kind, 'rebuilt');
  assert.deepEqual(session.peekTin('race2').getCompiled().points, g2.map(([f, b]) => [f, b]));
});

itest('応答を待たずに続けた編集は、全部組み直しにならず、順に差分で当たる（版は送る時点で読む）', async () => {
  const session = new TinWorkerSession();
  const log = [];
  const sync = new LayerTinSync(backendLikeTransport(session, log), 'burst');
  let g = gridGcps(7);
  await sync.rebuild(request({ gcps: g }));
  log.length = 0;
  const outs = [];
  for (let k = 0; k < 4; k++) {
    g = moveForw(g, 16, 1.5);
    outs.push(sync.edit([{ type: 'movePoint', id: 16, forw: g[16][0] }], request({ gcps: g })));
  }
  const done = await Promise.all(outs);
  assert.ok(done.every((o) => o.kind === 'patched' || o.reason !== 'revisionMismatch'), done.map((o) => `${o.kind}:${o.reason ?? ''}`).join(','));
  assert.ok(!log.includes('rebuild'), `全部組み直さない: ${log.join(' → ')}`);
  assert.deepEqual(session.peekTin('burst').getCompiled().points, g.map(([f, b]) => [f, b]));
  // refresh で続けても同じ
  const burst = [];
  for (let k = 0; k < 4; k++) {
    g = moveForw(g, 20, 1.5);
    burst.push(sync.refresh(request({ gcps: g })));
  }
  const refreshed = await Promise.all(burst);
  assert.ok(refreshed.every((o) => o.kind !== 'rebuilt' || o.reason !== 'revisionMismatch'));
  assert.deepEqual(refreshed.at(-1).result[1].points, g.map(([f, b]) => [f, b]));
});

itest('結果の層の番号は、依頼のたびに渡した値（層の削除で変わった番号）になる', async () => {
  const session = new TinWorkerSession();
  const sync = new LayerTinSync(backendLikeTransport(session, []), 'index');
  const g0 = gridGcps(7);
  const sub = { bounds: [[0, 0], [W, 0], [W, H], [0, H]] };
  await sync.refresh(request({ gcps: g0, index: 2, ...sub }));
  const g1 = moveForw(g0, 16, 4);
  const patched = await sync.refresh(request({ gcps: g1, index: 1, ...sub }));
  assert.equal(patched.kind, 'patched');
  assert.equal(patched.result[0], 1, '局所更新の結果の番号');
  const same = await sync.refresh(request({ gcps: g1, index: 1, ...sub }));
  assert.equal(same.result[0], 1);
});

itest('表示用の網の補完点の対は、頂点の指し方で持ち、点の削除・追加でずれない（全部から作った網と一致する）', async () => {
  const rnd = lcg(42);
  const session = new TinWorkerSession();
  const log = [];
  const sync = new LayerTinSync(backendLikeTransport(session, log), 'supp');
  let gcps = gridGcps(42);
  await sync.refresh(request({ gcps }));
  let locals = 0;
  let checkedPairs = 0;
  for (let step = 0; step < 150; step++) {
    const next = clone(gcps);
    const k = Math.floor(rnd() * next.length);
    const op = rnd();
    if (op < 0.6) {
      next[k][0] = [next[k][0][0] + (rnd() - 0.5) * 14, next[k][0][1] + (rnd() - 0.5) * 14];
      next[k][1] = [next[k][1][0] + (rnd() - 0.5) * 200, next[k][1][1] + (rnd() - 0.5) * 200];
    } else if (op < 0.8) {
      const x = 80 + rnd() * 440, y = 80 + rnd() * 340;
      next.splice(Math.floor(rnd() * (next.length + 1)), 0, [[x, y], [15000000 + 100 * x, 4000000 - 100 * y]]);
    } else if (next.length > 20) next.splice(k, 1);
    let outcome;
    try {
      outcome = await sync.refresh(request({ gcps: next }));
    } catch {
      continue;
    }
    gcps = next;
    if (outcome.kind === 'patched') locals++;
    const tin = session.peekTin('supp');
    const fresh = new TinDisplayMesh();
    fresh.replaceAll(snapshotFromTin(tin, tin.getCompiled(), sync.display.boundaryStale), 0);
    const a = sync.display.canonical();
    const b = fresh.canonical();
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      assert.deepEqual(a[key], b[key], `step ${step}（${outcome.kind}）: 「${key}」が全部から作った網と一致する`);
    }
    checkedPairs += a.supplementPairs?.length ?? 0;
  }
  assert.ok(locals >= 15, `局所で済んだ更新: ${locals}`);
  assert.ok(checkedPairs > 0, '補完点の対を持つ網で確かめた');
});

// ---------------- 3. 描き直し ----------------
function fakeIO() {
  const sources = { forw: new Set(), bakw: new Set() };
  let created = 0;
  return {
    sources,
    get created() { return created; },
    io: {
      forwToMap: (p) => [p[0] * 2, p[1] * 2],
      bakwToMap: (p) => (p[0] < -1e12 ? false : [p[0] + 1, p[1] + 1]),
      createPolygon: (side, ring) => { created++; return { side, ring }; },
      add: (side, features) => features.forEach((f) => sources[side].add(f)),
      remove: (side, features) => features.forEach((f) => assert.ok(sources[side].delete(f), '描いてあるものだけを外す')),
    },
  };
}
const drawnSet = (set) => [...set].map((f) => bits(f.ring)).sort();
function expectedDrawn(mesh, side) {
  const convert = side === 'forw' ? (p) => [p[0] * 2, p[1] * 2] : (p) => [p[0] + 1, p[1] + 1];
  return mesh.toSnapshot().triangles.map(({ id }) => {
    const ring = mesh.triangle(id).keys.map((key) => convert(mesh.vertexByKey(key)[side]));
    return bits([...ring, ring[0]]);
  }).sort();
}

itest('描き直し: 差分で描いた三角形が、全部描き直したものと一致し、当たっていない三角形には触らない', async () => {
  const session = new TinWorkerSession();
  const sync = new LayerTinSync(transportOf(session, []), 'draw');
  const gcps = gridGcps(31);
  await sync.refresh(request({ gcps }));
  const { sources, io } = fakeIO();
  const renderer = new TinMeshRenderer(io);
  const changes = [];
  sync.onDisplayChange((change) => changes.push(change));
  renderer.renderAll(sync.display);
  assert.equal(renderer.triangleCount, sync.display.triangleCount);
  assert.deepEqual(drawnSet(sources.forw), expectedDrawn(sync.display, 'forw'));
  assert.ok(renderer.isCurrentFor(sync.display));
  const rnd = lcg(4);
  let patched = 0;
  for (let step = 0; step < 40; step++) {
    const next = clone(gcps);
    const k = Math.floor(rnd() * next.length);
    next[k][step % 2] = [next[k][step % 2][0] + (rnd() - 0.5) * 10, next[k][step % 2][1] + (rnd() - 0.5) * 10];
    gcps.splice(0, gcps.length, ...next);
    changes.length = 0;
    const before = new Set([...sources.forw, ...sources.bakw]);
    const outcome = await sync.refresh(request({ gcps: next }));
    const patch = changes.find((c) => c.kind === 'patch');
    if (outcome.kind === 'patched' && patch) {
      patched++;
      assert.ok(renderer.isOneBehind(sync.display), '差分 1 つぶん遅れている');
      renderer.applyChange(sync.display, patch.change);
      const touched = new Set(patch.change.removedTriangles.concat(patch.change.addedTriangles, patch.change.movedTriangles));
      // 触らなかった三角形の図形は、そのまま残っている
      const kept = [...sources.forw, ...sources.bakw].filter((f) => before.has(f)).length;
      assert.ok(kept >= before.size - touched.size * 2, '当たっていない三角形の図形は作り直さない');
    } else {
      renderer.renderAll(sync.display);
    }
    assert.ok(renderer.isCurrentFor(sync.display));
    assert.deepEqual(drawnSet(sources.forw), expectedDrawn(sync.display, 'forw'), `step ${step}: 紙の面`);
    assert.deepEqual(drawnSet(sources.bakw), expectedDrawn(sync.display, 'bakw'), `step ${step}: 地理面`);
    assert.equal(renderer.triangleCount, sync.display.triangleCount);
  }
  assert.ok(patched >= 10, `差分で描き直した回数: ${patched}`);
  // 三角形以外の図形（交差の点など）と区別できる
  const [anyFeature] = sources.forw;
  assert.equal(renderer.owns(anyFeature), true);
  assert.equal(renderer.owns({ other: true }), false);
  renderer.forget();
  assert.equal(renderer.isCurrentFor(sync.display), false);
});

test('描き直し: 地理面へ変換できない三角形は、その面だけ描かない', () => {
  const mesh = new TinDisplayMesh();
  const ref = (id) => ({ kind: 'gcp', id });
  mesh.replaceAll({
    vertices: [
      { ref: ref(0), forw: [0, 0], bakw: [-1e13, 0] },
      { ref: ref(1), forw: [1, 0], bakw: [1, 0] },
      { ref: ref(2), forw: [0, 1], bakw: [0, 1] },
    ],
    triangles: [{ id: 0, vertices: [ref(0), ref(1), ref(2)] }],
    boundaryStale: false,
  });
  const { sources, io } = fakeIO();
  new TinMeshRenderer(io).renderAll(mesh);
  assert.equal(sources.forw.size, 1);
  assert.equal(sources.bakw.size, 0);
});

// ---------------- 4. 作る手順（buildEditorLayerTin）----------------
function layerOf(gcps = [[[10, 10], [1000, 1000]], [[90, 10], [1900, 1000]], [[10, 90], [1000, 1900]], [[90, 90], [1900, 1900]]]) {
  return transformLayerFromDocument('main', { width: 100, height: 100, gcps });
}

test('buildEditorLayerTin: 設定が切なら、今と同じ手順（compute だけ・refresh は呼ばない）', async () => {
  const layer = layerOf();
  const calls = { compute: 0, refresh: 0, built: [] };
  const compute = async (input) => { calls.compute++; assert.equal('incrementalEdits' in input, false); return [0, 'tooLinear', null]; };
  const refresh = async () => { calls.refresh++; throw new Error('呼ばれない'); };
  const base = { layer, layerId: 'main', kind: 'edit', reqGen: 1, isCurrent: () => true };
  const result = await buildEditorLayerTin(base, 0, compute, { refresh, onBuilt: (id, origin) => calls.built.push([id, origin]) });
  assert.deepEqual(result, { tin: 'tooLinear' });
  assert.deepEqual(calls, { compute: 1, refresh: 0, built: [['main', 'rebuild']] });
});

test('buildEditorLayerTin: 設定が入なら編集の依頼は refresh を通り、局所更新の産物かを知らせる。採用は compute を通る', async () => {
  const layer = layerOf();
  const compiled = new Tin(V3);
  compiled.setWh([100, 100]);
  compiled.setPoints(layer.gcps.map(([p, g]) => [p, g]));
  await compiled.updateTinAsync().catch(() => undefined);
  const compiledObject = compiled.getCompiled();
  const built = [];
  const base = { layer, layerId: 'main', reqGen: 1, isCurrent: () => true };
  const options = (kind) => ({
    incrementalEdits: true,
    refresh: async (input) => {
      assert.equal(input.incrementalEdits, true);
      assert.equal(input.layerKey, 'main');
      return { kind, result: [0, compiledObject, null], ...(kind === 'rebuilt' ? { reason: 'noMesh' } : {}) };
    },
    onBuilt: (id, origin) => built.push(origin),
  });
  const compute = async () => { built.push('compute'); return [0, compiledObject, null]; };
  for (const kind of ['patched', 'rebuilt', 'unchanged']) {
    const result = await buildEditorLayerTin({ ...base, kind: 'edit' }, 0, compute, options(kind));
    assert.equal(typeof result.tin, 'object');
  }
  assert.deepEqual(built, ['incremental', 'rebuild'], 'unchanged は、前の産物のまま（知らせない）');
  built.length = 0;
  await buildEditorLayerTin({ ...base, kind: 'adoption', adoptionId: 1, signal: new AbortController().signal }, 0, compute, options('patched'));
  assert.deepEqual(built, ['compute', 'rebuild'], '採用は、全部組み直す');
  // 失効した依頼は知らせない
  built.length = 0;
  let current = true;
  await assert.rejects(buildEditorLayerTin({ ...base, kind: 'edit', isCurrent: () => current }, 0, compute, {
    ...options('patched'), refresh: async () => { current = false; return { kind: 'patched', result: [0, compiledObject, null] }; },
  }), /失効/);
  assert.deepEqual(built, []);
});

test('採用（CRS の試し）の候補は、層の網とは別の鍵で、網を持たせずに計算し、終わったら鍵を捨てる', async () => {
  const layer = layerOf();
  const inputs = [];
  const released = [];
  const compute = async (input) => { inputs.push(input); return [0, 'tooLinear', null]; };
  const base = { layer, layerId: 'main', reqGen: 1, isCurrent: () => true };
  const options = { incrementalEdits: true, refresh: async () => assert.fail('採用は refresh を通らない'), releaseCandidate: (key) => released.push(key) };
  await assert.rejects(buildEditorLayerTin({ ...base, kind: 'adoption', adoptionId: 1, signal: new AbortController().signal }, 0, compute, options), /tooLinear/);
  assert.equal(inputs[0].layerKey, 'main#adoption', '層の網の鍵（main）とは別');
  assert.equal('incrementalEdits' in inputs[0], false, '候補に網を持たせない');
  assert.deepEqual(released, ['main#adoption']);
  // 編集の依頼は、層の鍵のまま
  await buildEditorLayerTin({ ...base, kind: 'edit' }, 0, compute, { incrementalEdits: true });
  assert.equal(inputs[1].layerKey, 'main');
  assert.equal(inputs[1].incrementalEdits, true);
});

test('finalizeEditorLayerTin: 清書の依頼は層の入力の全部を渡し、結果は三角網（Tin）かエラー', async () => {
  const layer = layerOf();
  let sent;
  const compiled = new Tin(V3);
  compiled.setWh([100, 100]);
  compiled.setPoints(layer.gcps.map(([p, g]) => [p, g]));
  await compiled.updateTinAsync().catch(() => undefined);
  const decision = { source: 'rebuild', reason: 'rebuildStrict' };
  const ok = await finalizeEditorLayerTin({ layer, layerId: 'main', isCurrent: () => true }, 0, async (input) => {
    sent = input;
    return { result: [0, compiled.getCompiled(), null], decision, replaced: true };
  }, { incrementalEdits: true });
  assert.equal(sent.incrementalEdits, true);
  assert.equal(sent.layerKey, 'main');
  assert.equal(sent.gcps.length, 4);
  assert.equal(typeof ok.tin, 'object');
  assert.deepEqual(ok.decision, decision);
  const failed = await finalizeEditorLayerTin({ layer, layerId: 'main', isCurrent: () => true }, 0,
    async () => ({ result: [0, 'tooLinear', null], decision, replaced: false }));
  assert.equal(failed.tin, 'tooLinear');
});

// ---------------- 5. モデル（清書・後始末）----------------
function modelWith(overrides = {}) {
  const log = [];
  let built = 0;
  const flagged = new Set();
  const model = useLayerTransformState([layerOf()], {
    history: { commit() {}, undo: () => undefined, redo: () => undefined, withoutHistoryAsync: async (apply) => apply() },
    buildTin: async (request) => { built++; flagged.add(request.layerId); return { tin: { built } }; },
    prepareAdoption: async () => { throw new Error('使わない'); },
    finalize: async ({ layerId }) => { log.push(['finalize', layerId]); return { tin: { finalized: layerId } }; },
    needsFinalize: (layerId) => flagged.has(layerId),
    onFinalized: (layerId) => { flagged.delete(layerId); log.push(['finalized', layerId]); },
    onLayerRemoved: (layerId) => { flagged.delete(layerId); log.push(['removed', layerId]); },
    ...overrides,
  });
  return { model, log, flagged };
}
const editOf = (model) => model.editLayer('main', { gcps: [...model.layers.value[0].gcps, [[50, 50], [1500, 1500]]] });

test('清書: 局所更新で済ませた層だけを、編集が止まったあと（finalizeAll）と保存の前に、全部組み直した結果へ替える', async () => {
  const { model, log, flagged } = modelWith();
  assert.equal(editOf(model), true);
  await model.requestTin('main');
  assert.equal(typeof model.getTinState('main').tin.built, 'number', '編集のたびの結果（局所更新の産物の見立て）');
  const generation = model.editGeneration.value;
  await model.finalizeAll();
  assert.deepEqual(log, [['finalize', 'main'], ['finalized', 'main']]);
  assert.deepEqual(model.getTinState('main').tin, { finalized: 'main' });
  assert.equal(model.editGeneration.value, generation, '文書の世代は変えない（履歴も増えない）');
  // 清書済みの層は、もう清書しない
  log.length = 0;
  await model.finalizeAll();
  assert.deepEqual(log, []);
  // 保存の前: 局所更新の産物へ戻して、保存で清書される
  flagged.add('main');
  const saved = [];
  const result = await model.save(async ({ tins }) => { saved.push(...tins); });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(log.map(([kind]) => kind), ['finalize', 'finalized']);
  assert.deepEqual(saved, [{ finalized: 'main' }], '保存されるのは清書の結果');
});

test('清書: 設定が切（finalize が無い・印が無い）なら、保存は今までどおり編集のたびの結果', async () => {
  const noHook = modelWith({ finalize: undefined, needsFinalize: undefined });
  editOf(noHook.model);
  await noHook.model.requestTin('main');
  const saved = [];
  assert.deepEqual(await noHook.model.save(async ({ tins }) => { saved.push(...tins); }), { ok: true });
  assert.equal(typeof saved[0].built, 'number');
  assert.deepEqual(noHook.log, []);
  const unflagged = modelWith({ needsFinalize: () => false });
  editOf(unflagged.model);
  await unflagged.model.requestTin('main');
  const saved2 = [];
  assert.deepEqual(await unflagged.model.save(async ({ tins }) => { saved2.push(...tins); }), { ok: true });
  assert.equal(typeof saved2[0].built, 'number');
  assert.deepEqual(unflagged.log, []);
});

test('清書: 失敗したら保存しない。編集が入ったら結果を捨てる', async () => {
  const failing = modelWith({ finalize: async () => { throw new Error('boom'); } });
  editOf(failing.model);
  await failing.model.requestTin('main');
  let persisted = false;
  const result = await failing.model.save(async () => { persisted = true; });
  assert.deepEqual(result, { ok: false, reason: 'buildFailed' });
  assert.equal(persisted, false, '局所更新の産物のまま、保存しない');

  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const racing = modelWith({ finalize: async ({ layerId }) => { await gate; return { tin: { finalized: layerId } }; } });
  editOf(racing.model);
  await racing.model.requestTin('main');
  const pending = racing.model.finalizeLayer('main');
  editOf(racing.model); // 清書の間に、次の編集が入る
  release();
  assert.equal(await pending, false, '古い入力の清書は捨てる');
  assert.equal(racing.log.some(([kind]) => kind === 'finalized'), false);
  await racing.model.requestTin('main');
  assert.notDeepEqual(racing.model.getTinState('main').tin, { finalized: 'main' });
});

test('層を消したとき・履歴の復元で層が無くなったとき、後始末（disposeLayer）を呼ぶ', () => {
  const sub = { gcps: [[[0, 0], [0, 0]]] };
  let restoreTo;
  const { model, log } = modelWith({
    history: { commit() {}, undo: () => restoreTo, redo: () => undefined, withoutHistoryAsync: async (apply) => apply() },
  });
  const first = model.addLayer({ ...sub, buildOptions: { strictMode: 'strict', vertexMode: 'plain' } });
  const second = model.addLayer({ ...sub, buildOptions: { strictMode: 'strict', vertexMode: 'plain' } });
  assert.ok(first && second);
  assert.equal(model.removeLayer(first), true);
  assert.deepEqual(log.filter(([kind]) => kind === 'removed'), [['removed', first]]);
  // 履歴を戻したら、第 2 の層が無い文書になる
  restoreTo = model.capture().filter(({ layerId }) => layerId !== second);
  log.length = 0;
  assert.equal(model.undo().restored, true);
  assert.deepEqual(log.filter(([kind]) => kind === 'removed'), [['removed', second]]);
  model.dispose();
});

test('編集が止まって一定時間後に 1 回だけ実行する（編集のたびに数え直し、やめられる）', () => {
  const timers = new Map();
  let now = 0;
  let nextHandle = 1;
  const clock = {
    setTimeout: (task, ms) => { const handle = nextHandle++; timers.set(handle, { task, at: now + ms }); return handle; },
    clearTimeout: (handle) => timers.delete(handle),
  };
  const advance = (ms) => {
    now += ms;
    for (const [handle, { task, at }] of [...timers]) if (at <= now) { timers.delete(handle); task(); }
  };
  let runs = 0;
  const runner = createIdleRunner(() => { runs++; }, 1000, clock);
  runner.schedule();
  advance(900);
  runner.schedule(); // 編集がまた入った
  advance(900);
  assert.equal(runs, 0, '最後の呼び出しから 1000 ミリ秒たつまで実行しない');
  assert.equal(runner.pending, true);
  advance(100);
  assert.equal(runs, 1);
  assert.equal(runner.pending, false);
  advance(5000);
  assert.equal(runs, 1, '1 回だけ');
  runner.schedule();
  runner.cancel();
  advance(5000);
  assert.equal(runs, 1, 'やめたら実行しない');
});

// ---------------- 6. 保存される地図（設定が切のとき今と同じ・入のときの保存）----------------
test('配線: 編集が止まって 1 秒後・保存の前・層を消したとき・地図を開き直したときの後始末が、MapEdit につながっている', async () => {
  const mapEdit = await readFile(new URL('../src/views/MapEdit.vue', import.meta.url), 'utf8');
  assert.match(mapEdit, /const INCREMENTAL_FINALIZE_IDLE_MS = 1000;/);
  assert.match(mapEdit, /createIdleRunner\(\(\) => \{\n\s+if \(!isUnmounted\) void layerTransformState\.value\.finalizeAll\(\);\n\}, INCREMENTAL_FINALIZE_IDLE_MS\)/);
  assert.match(mapEdit, /watch\(\[tinStates, editGeneration\], scheduleIncrementalFinalize\)/, '三角網の状態・文書が変わるたびに延ばす');
  assert.match(mapEdit, /finalize: \(\{ layer, layerId, isCurrent \}\) => finalizeIncrementalLayer\(layer, layerId, isCurrent\)/);
  assert.match(mapEdit, /onLayerRemoved: \(layerId\) => releaseLayerTin\(layerId\)/);
  assert.match(mapEdit, /void editorComputeBackend\.disposeLayer\(layerId\)/, '層を消したら worker の網を捨てる');
  assert.match(mapEdit, /void editorComputeBackend\.disposeAllLayers\(\)/, '地図を開き直したら、前の地図の層の網を捨てる');
  assert.match(mapEdit, /function createLayerTransformState\(snapshot: LayerTransformSnapshot, initialTins\?: MapEditTinSeed\) \{\n\s+releaseAllLayerTins\(\);/);
  assert.match(mapEdit, /await layerTransformState\.value\.finalizeAll\(\);\n\s+if \(!tinObjects\.value\[0\]/, 'タイルを作る前にも清書する');
  assert.match(mapEdit, /const meshRenderer = new TinMeshRenderer/);
  assert.match(mapEdit, /if \(!keepTriangles\) meshRenderer\.renderAll\(displayMesh\)/, '三角形は表示用の網から描く');
  const model = await readFile(new URL('../src/composables/useLayerTransformState.ts', import.meta.url), 'utf8');
  assert.match(model, /保存するのは、全部組み直した三角網/);
});

itest('入のときの保存: 局所更新で更新した層でも、保存される compiled は、清書（全部組み直し）の結果と 1 ビットも変わらない', async () => {
  const session = new TinWorkerSession();
  const sync = new LayerTinSync(transportOf(session, []), 'save');
  const gcps = gridGcps(404);
  await sync.refresh(request({ gcps }));
  const edited = clone(gcps);
  edited[10][0] = [edited[10][0][0] + 4, edited[10][0][1] + 4];
  edited[20][1] = [edited[20][1][0] + 100, edited[20][1][1] - 100];
  const incremental = await sync.refresh(request({ gcps: edited }));
  assert.ok(['patched', 'rebuilt'].includes(incremental.kind));
  const done = await sync.finalize(request({ gcps: edited }));
  assert.equal(done.decision.source, 'rebuild');
  // 今の updateTin（毎回全部組み直し）と同じ結果
  const reference = new Tin(V3);
  reference.setWh([W, H]);
  reference.setPoints(edited);
  reference.setEdges([]);
  await reference.updateTinAsync();
  assert.equal(bits(done.result[1]), bits(reference.getCompiled()), '保存する compiled は、全部組み直しの結果');
});

test('設定が切のとき、保存される compiled は今と同じ（局所更新の部品を通らない）', async () => {
  const session = new TinWorkerSession();
  const sync = new LayerTinSync(transportOf(session, []), 'off');
  const gcps = gridGcps(505);
  const req = request({ gcps, incrementalEdits: undefined });
  const rebuilt = await sync.refresh(req);
  assert.equal(rebuilt.kind, 'rebuilt');
  assert.equal(sync.tracked, undefined);
  const reference = new Tin(V3);
  reference.setWh([W, H]);
  reference.setPoints(gcps);
  reference.setEdges([]);
  await reference.updateTinAsync();
  assert.equal(bits(rebuilt.result[1]), bits(reference.getCompiled()));
});
