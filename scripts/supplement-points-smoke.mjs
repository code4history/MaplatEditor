// 補完点（supplementPairs）の表示と、対応点への格上げ・地図ごとの切り替え（MaplatEditor#321）。
// 画面を開かずに確かめられることを固定する。
//   1. 補完点は対応点の表（gcps・compiled.points）に入らない（派生データとして別に持つ）
//   2. 補完点の位置や数が変わっても、文書（履歴・下書き・isDirty の監視対象）は変わらない
//   3. 格上げ「対応点にする」は gcps に入り、Undo 1 回で元へ戻る（履歴 1 件）
//   4. `supplementPairs: false` は保存・書き出し・取り込みで落ちず、Tin へも渡る
import assert from 'node:assert/strict';
import { test } from 'node:test';
import Tin from '@maplat/tin';

const {
    supplementPointsFromCompiled, supplementPointsFromDisplayMesh,
    supplementPointToGcp, supplementVertexText, supplementDisplayOf,
    tinDecorFromCompiled, tinDecorFromDisplayMesh,
} = await import('../src/utils/supplementPoints.ts');
const { TinDisplayMesh } = await import('../src/utils/tinDisplayMesh.ts');
const { UndoStack } = await import('../src/services/editorUndoStack.ts');
const { resolveTinBuildOptions } = await import('../src/utils/tinOptions.ts');
const storeHandler = await import('../electron/utils/store_handler.ts');

const incrementalTin = typeof Tin.prototype.applyEdits === 'function';
// 補完点（MaplatTin#89）は未公開の Tin にだけある。公開済みの Tin では、補完点が出る試験を飛ばす
// （tin-incremental-edits-smoke.mjs の能力ゲートと同じ扱い）。
const itest = (name, fn) => test(name, { skip: incrementalTin ? false : '@maplat/tin に補完点（applyEdits）が無い' }, fn);

// ---- 補完点が付く入力（MaplatTin#89 §2 の形: 凸包の辺の近くの対応点が、地理の面で弦の外へ出る） ----
function lcg(seed) {
    let state = seed;
    return () => (state = (state * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
}
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
/** 紙の面は同じまま、1 点の地理の位置だけを動かして、凸包の辺 1 本に補完点が付く入力を作る */
function supplementInput() {
    const gcps = gridGcps(7);
    const [x, y] = gcps[0][1];
    gcps[0] = [[...gcps[0][0]], [x, y - 2000]];
    return gcps;
}

/** 密な格子（凸包の辺が 50px 未満になる）。sign は地理の y が紙の面と同じ向き（+1）か逆（-1）か */
function denseGridGcps(seed, cols, rows, sx, sy, sign) {
    const rnd = lcg(seed);
    const gcps = [];
    for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
            const x = 40 + i * sx + (rnd() - 0.5) * sx * 0.45;
            const y = 40 + j * sy + (rnd() - 0.5) * sy * 0.45;
            gcps.push([[x, y], [15000000 + 100 * x + (rnd() - 0.5) * 30, 4000000 + sign * 100 * y + (rnd() - 0.5) * 30]]);
        }
    }
    return gcps;
}

/** 補完点が短い凸包の辺（50px 未満）に付く入力 */
function shortEdgeInput() {
    const gcps = denseGridGcps(7, 9, 8, 12, 11, -1);
    const [x, y] = gcps[0][1];
    gcps[0] = [[...gcps[0][0]], [x, y - 1200]];
    return gcps;
}

/** follow（地理の y が紙の面と同じ向き）の地図の入力。補完点が付く */
function followInput() {
    const gcps = denseGridGcps(7, 9, 8, 12, 11, 1);
    const [x, y] = gcps[0][1];
    gcps[0] = [[...gcps[0][0]], [x, y - 1200]];
    return gcps;
}
const V3 = { useV2Algorithm: false, yaxisMode: 'invert', outerTransform: 'extrapolate', strictMode: 'strict' };
const clone = (value) => structuredClone(value);
const bits = (value) => JSON.stringify(value);

async function buildTin(gcps, extra = {}, edges = []) {
    const tin = new Tin({ ...V3, wh: [700, 560], ...extra });
    tin.setPoints(clone(gcps));
    if (edges.length) tin.setEdges(clone(edges));
    await tin.updateTinAsync();
    return tin;
}

// ---- 1. 補完点は対応点の表に入らない ----
itest('補完点は gcps・compiled.points に入らず、派生データとしてだけ読める', async () => {
    const gcps = supplementInput();
    const tin = await buildTin(gcps);
    const compiled = tin.getCompiled();
    const pairs = compiled.supplementPairs ?? [];
    assert.ok(pairs.length >= 1, '補完点が付く入力を使う');
    assert.equal(compiled.points.length, gcps.length, 'compiled.points は人間の対応点だけ');
    assert.equal(tin.points.length, gcps.length, 'tin.points は人間の対応点だけ');
    assert.equal((compiled.edges ?? []).length, 0, '対応線（edges）は人間の分だけ');

    const views = supplementPointsFromCompiled(compiled);
    assert.equal(views.length, pairs.length);
    assert.ok(views.every((view) => view.kind === 'hullEdge'));
    // 辺・anchor・kind が読める（画面のツールチップの材料）
    const view = views[0];
    assert.equal(view.edge.length, 2);
    assert.ok(view.anchor && 'gcpIndex' in view.anchor);
    assert.match(supplementVertexText(view.edge[0]), /^\d+$/);
    // 補完点の座標は edgeNodes[node] に 1 か所だけ
    assert.ok(Array.isArray(view.forw) && Array.isArray(view.bakw));
});

itest('表示用の網（VertexRef）からも同じ補完点が読める', async () => {
    const gcps = supplementInput();
    const tin = await buildTin(gcps, { incremental: true, incrementalBand: true });
    const compiled = tin.getCompiled();
    const { snapshotFromTin } = await import('../src/workers/tinWorkerSession.ts');
    const snapshot = snapshotFromTin(tin, compiled);
    assert.ok(snapshot && (snapshot.supplementPairs ?? []).length >= 1);
    const mesh = new TinDisplayMesh();
    mesh.replaceAll(snapshot);
    const views = supplementPointsFromDisplayMesh(mesh);
    const compiledViews = supplementPointsFromCompiled(compiled);
    assert.equal(views.length, compiledViews.length);
    for (const [index, view] of views.entries()) {
        const other = compiledViews[index];
        assert.equal(view.kind, other.kind);
        assert.deepEqual(view.edge.map(supplementVertexText), other.edge.map(supplementVertexText));
        assert.equal(
            view.anchor ? supplementVertexText(view.anchor) : undefined,
            other.anchor ? supplementVertexText(other.anchor) : undefined,
        );
        assert.ok(Math.abs(view.forw[0] - other.forw[0]) < 1e-6);
    }
});

// ---- 2. 未保存の変更に数えない ----
itest('補完点の読み取り・作り直しで文書（gcps・edges・切り替え）は 1 文字も変わらない', async () => {
    const gcps = supplementInput();
    const document = { gcps: clone(gcps), edges: [], strictMode: 'strict', vertexMode: 'plain' };
    const historyState = () => bits({ gcps: document.gcps, edges: document.edges, strictMode: document.strictMode, vertexMode: document.vertexMode });
    const stack = new UndoStack(historyState());
    stack.save();
    const before = historyState();

    const tin = await buildTin(document.gcps);
    const compiled = tin.getCompiled();
    // 表示の更新（補完点の印・一覧を作り直す）は派生データだけを読む
    const views = supplementPointsFromCompiled(compiled);
    assert.ok(views.length >= 1);
    // 同じ入力で作り直しても（補完点のオブジェクトは作り直される）、文書は変わらない
    const tin2 = await buildTin(document.gcps);
    assert.equal((tin2.getCompiled().supplementPairs ?? []).length, views.length);
    supplementPointsFromCompiled(tin2.getCompiled());

    assert.equal(historyState(), before, '文書は不変');
    assert.equal(stack.isDirty(), false, '未保存の変更に数えない');
});

// ---- 3. 格上げ（対応点にする） ----
itest('格上げで gcps に入り、Undo 1 回で元へ戻る（履歴 1 件）', async () => {
    const gcps = supplementInput();
    const tin = await buildTin(gcps);
    const views = supplementPointsFromCompiled(tin.getCompiled());
    assert.ok(views.length >= 1);

    // 履歴: 状態は gcps の写し（MapEdit の captureHistoryState の縮小形）。格上げ 1 操作 = 1 件
    const doc = { gcps: clone(gcps) };
    const state = () => clone(doc.gcps);
    const stack = new UndoStack(state());
    stack.save();
    const original = state();

    const promoted = supplementPointToGcp(views[0], 0, 'invert');
    assert.equal(promoted.length, 3);
    assert.equal(promoted[2], 0, '層番号を付ける');
    // Tin が置いた座標をそのまま入れる（丸めない。短い凸包の辺で二重に補完点が付くのを防ぐ）
    assert.deepEqual(promoted[0], [views[0].forw[0], views[0].forw[1]], '紙の面は Tin の値そのもの');
    assert.deepEqual(promoted[1], [views[0].bakw[0], views[0].bakw[1]], '地理面も Tin の値そのもの');
    doc.gcps.push(promoted);
    stack.push(state());

    assert.equal(doc.gcps.length, original.length + 1, 'gcps に入る');
    assert.ok(stack.isDirty(), '未保存の変更として数える（人間の編集）');

    stack.undo();
    doc.gcps = clone(stack.current());
    assert.deepEqual(state(), original, 'Undo 1 回で元へ戻る');
    assert.equal(stack.isDirty(), false);

    // 格上げした点は以後は人間の対応点（その辺に補完点が置かれなくなる）
    doc.gcps.push(promoted);
    const tin2 = await buildTin(doc.gcps);
    assert.equal((tin2.getCompiled().supplementPairs ?? []).length, 0);
    assert.equal(tin2.getCompiled().points.length, doc.gcps.length);
});

// ---- 4. 地図ごとの切り替え（supplementPairs: false） ----
itest('supplementPairs: false の Tin は補完点を足さない（#91 の時点と同じ形）', async () => {
    const gcps = supplementInput();
    const on = await buildTin(gcps);
    assert.ok((on.getCompiled().supplementPairs ?? []).length >= 1);
    const off = await buildTin(gcps, { supplementPairs: false });
    const compiled = off.getCompiled();
    assert.ok(!('supplementPairs' in compiled) || !compiled.supplementPairs, 'compiled に補完点が無い');
    assert.equal(compiled.points.length, gcps.length);
    assert.equal(off.strict_status, on.strict_status);
});

test('Tin のオプションは layer の supplementPairs から決まる（false のときだけ渡す）', () => {
    const layer = { crs: { epsg: 3857 }, supplementPairs: false };
    assert.equal(resolveTinBuildOptions(layer, {}).supplementPairs, false);
    assert.equal(resolveTinBuildOptions({ crs: { epsg: 3857 } }, { supplementPairs: false }).supplementPairs, false);
    assert.ok(!('supplementPairs' in resolveTinBuildOptions({ crs: { epsg: 3857 } }, {})), '既定（true）は書かない');
    assert.ok(!('supplementPairs' in resolveTinBuildOptions({ crs: { epsg: 3857 }, supplementPairs: true }, {})));
});

test('supplementPairs: false は保存・書き出し・取り込みで落ちない', async () => {
    const gcps = supplementInput();
    const tin = await buildTin(gcps);
    const compiled = tin.getCompiled();
    const base = {
        title: 'map', label: 'map', attr: 'a', dataAttr: 'd',
        strictMode: 'strict', vertexMode: 'plain', yaxisMode: 'invert',
        width: 700, height: 560,
        gcps: clone(gcps), edges: [],
        supplementPairs: false,
    };

    // 保存（地図 JSON）→ 読み直し
    const saved = await storeHandler.histMap2Store({ ...base, compiled }, [compiled]);
    assert.equal(saved.supplementPairs, false, '保存で残る');
    const [loaded] = await storeHandler.store2HistMap(saved);
    assert.equal(loaded.supplementPairs, false, '読み直しで残る');

    // 書き出し（保存済みの地図 JSON）と同じ形から、取り込みの許可リストを通す
    const imported = storeHandler.prepareImportedMap({ ...saved });
    assert.equal(imported.supplementPairs, false, '取り込みで残る');

    // false 以外は書かない（true/省略は既定）
    const savedOn = await storeHandler.histMap2Store({ ...base, compiled, supplementPairs: undefined }, [compiled]);
    assert.ok(!('supplementPairs' in savedOn), 'true のときは書かない');
    const savedTrue = await storeHandler.histMap2Store({ ...base, compiled, supplementPairs: true }, [compiled]);
    assert.ok(!('supplementPairs' in savedTrue), 'true を書いても残さない');
    const importedTrue = storeHandler.prepareImportedMap({ ...saved, supplementPairs: true });
    assert.ok(!('supplementPairs' in importedTrue), '取り込みで true は落とす');
    const [loadedTrue] = await storeHandler.store2HistMap({ ...saved, supplementPairs: true });
    assert.ok(!('supplementPairs' in loadedTrue), '読み直しで true は落とす');

    // 副層にも同じ値を使う（地図最上位の値）
    const options = resolveTinBuildOptions({ crs: { epsg: 3857 }, supplementPairs: imported.supplementPairs }, {});
    assert.equal(options.supplementPairs, false);
});

// ---- 5. 格上げの丸めをやめる（短い凸包の辺で二重に補完点が付かない） ----
itest('短い凸包の辺（50px 未満）の補完点を格上げしても、補完点が二重にならない', async () => {
    const gcps = shortEdgeInput();
    const tin = await buildTin(gcps);
    const views = supplementPointsFromCompiled(tin.getCompiled());
    assert.ok(views.length >= 1, '短い辺に補完点が付く入力を使う');
    const [a, b] = tin.getCompiled().supplementPairs[0].edge;
    const length = Math.hypot(gcps[a][0][0] - gcps[b][0][0], gcps[a][0][1] - gcps[b][0][1]);
    assert.ok(length < 50, `凸包の辺が 50px 未満（${length}）`);

    const promoted = supplementPointToGcp(views[0], 0, 'invert');
    const tin2 = await buildTin([...gcps, promoted]);
    assert.equal((tin2.getCompiled().supplementPairs ?? []).length, 0, '格上げした辺に補完点が戻らない');
    assert.equal(tin2.getCompiled().points.length, gcps.length + 1);
    assert.equal(tin2.strict_status, 'strict');
});

itest('follow の地図の格上げ（地理の y の向きを戻す）', async () => {
    const gcps = followInput();
    const tin = await buildTin(gcps, { yaxisMode: 'follow' });
    const views = supplementPointsFromCompiled(tin.getCompiled());
    assert.ok(views.length >= 1, 'follow の地図でも補完点が付く入力を使う');

    const promoted = supplementPointToGcp(views[0], 0, 'follow');
    assert.deepEqual(promoted[0], [views[0].forw[0], views[0].forw[1]]);
    assert.deepEqual(promoted[1], [views[0].bakw[0], -views[0].bakw[1]], 'follow は内部の y を反転して戻す');
    const tin2 = await buildTin([...gcps, promoted], { yaxisMode: 'follow' });
    assert.equal((tin2.getCompiled().supplementPairs ?? []).length, 0);
    assert.equal(tin2.strict_status, 'strict');
});

itest('格上げの Undo から Redo へ戻れる（履歴は 1 件のまま）', async () => {
    const gcps = supplementInput();
    const tin = await buildTin(gcps);
    const views = supplementPointsFromCompiled(tin.getCompiled());
    const doc = { gcps: clone(gcps) };
    const state = () => clone(doc.gcps);
    const stack = new UndoStack(state());
    stack.save();

    doc.gcps.push(supplementPointToGcp(views[0], 0, 'invert'));
    stack.push(state());
    const promoted = state();
    stack.undo();
    doc.gcps = clone(stack.current());
    assert.equal(doc.gcps.length, promoted.length - 1, 'Undo で格上げが消える');
    stack.redo();
    doc.gcps = clone(stack.current());
    assert.deepEqual(state(), promoted, 'Redo 1 回で格上げした状態へ戻る');
    assert.ok(stack.isDirty());
    assert.equal(stack.snapshot().history.length, 2, '履歴は 1 件のまま');
});

// ---- 6. 局所更新・清書で補完点が動いても、isDirty・履歴・下書きは動かない ----
itest('局所更新（applyEdits）と清書（finalize）で補完点が増減・移動しても、isDirty・履歴・下書きは動かない', async () => {
    const { TinWorkerSession } = await import('../src/workers/tinWorkerSession.ts');
    const { trackInputs, planEdits } = await import('../src/utils/tinEditPlanner.ts');
    const before = supplementInput();
    const doc = { gcps: clone(before), edges: [] };
    // 下書き・isDirty の監視対象の縮小形（gcps・edges だけを見る）
    const historyState = () => bits({ gcps: doc.gcps, edges: doc.edges });
    const stack = new UndoStack(historyState());
    stack.save();
    const base = historyState();

    const request = (gcps) => ({
        gcps: clone(gcps), edges: [], index: 0, bounds: [700, 560],
        strict: 'strict', vertex: 'plain', tinOptions: V3, layerKey: 'main', incrementalEdits: true,
    });
    const session = new TinWorkerSession();
    const rebuilt = await session.rebuild(request(doc.gcps));
    assert.ok(rebuilt.stamp && rebuilt.snapshot, '局所更新の網を持つ');
    assert.ok((rebuilt.snapshot.supplementPairs ?? []).length >= 1);
    assert.equal(historyState(), base, 'rebuild で文書は動かない');
    assert.equal(stack.snapshot().history.length, 1);

    // 人間の編集 1 件（補完点が増減・移動する引き金）。履歴はこの 1 件だけ
    doc.gcps[1] = [[...doc.gcps[1][0]], [doc.gcps[1][1][0] + 2500, doc.gcps[1][1][1] + 1500]];
    stack.push(historyState());
    const afterEdit = historyState();
    assert.ok(stack.isDirty(), '人間の編集は未保存の変更');

    const tracked = trackInputs(before, []);
    const plan = planEdits(tracked, doc.gcps, []);
    assert.ok(plan, '局所更新の編集を作る');
    const patched = await session.applyEdits({ layerKey: 'main', edits: plan.edits, base: rebuilt.stamp, index: 0 });
    assert.equal(patched.status, 'patched');
    const afterEdits = await session.getSnapshot({ layerKey: 'main', base: patched.stamp });
    assert.equal(afterEdits.status, 'ok');
    assert.equal(historyState(), afterEdit, 'applyEdits・表示の更新で文書は動かない');
    assert.equal(stack.snapshot().history.length, 2, '補完点の増減・移動で履歴が増えない');

    // 清書（別インスタンスで全部組み直す）
    const finalized = await session.finalize({ request: request(doc.gcps), base: patched.stamp });
    assert.ok(finalized.result, '清書が終わる');
    assert.equal(historyState(), afterEdit, '清書で文書は動かない');
    assert.equal(stack.snapshot().history.length, 2);
});

// ---- 7. 表示用の網が補完点の差分を断ったとき、resnapshot の経路を通る ----
itest('表示用の網が補完点の差分を断つと、resnapshot の経路を通る', async () => {
    const { LayerTinSync } = await import('../src/services/tinEditSync.ts');
    const gcp = (id, forw, bakw) => ({ ref: { kind: 'gcp', id }, forw, bakw });
    const snapshot = (supplementKey) => ({
        vertices: [
            gcp(0, [0, 0], [10, 10]),
            gcp(1, [10, 0], [20, 10]),
            gcp(2, [5, 8], [15, 18]),
            { ref: { kind: 'supplement', key: supplementKey }, forw: [5, -1], bakw: [15, 9] },
        ],
        triangles: [{ id: 0, vertices: [{ kind: 'gcp', id: 0 }, { kind: 'gcp', id: 1 }, { kind: 'gcp', id: 2 }] }],
        supplementPairs: [{
            node: { kind: 'supplement', key: supplementKey },
            kind: 'hullEdge',
            edge: [{ kind: 'gcp', id: 0 }, { kind: 'gcp', id: 1 }],
            anchor: { kind: 'gcp', id: 2 },
        }],
        boundaryStale: false,
    });
    const request = { gcps: [], edges: [], index: 0, bounds: [32, 32], strict: 'strict', vertex: 'plain', tinOptions: V3, layerKey: 'main', incrementalEdits: true };

    // resnapshot が使えるとき: 補完点の差分は断たれるが、全部の取り直しが通って patched のまま
    {
        const calls = [];
        const transport = {
            rebuild: async () => {
                calls.push('rebuild');
                return { result: [0, {}, null], stamp: { generation: 1, revision: 0 }, snapshot: snapshot('a') };
            },
            applyEdits: async () => {
                calls.push('applyEdits');
                return { status: 'patched', stamp: { generation: 1, revision: 1 }, patch: { revision: 1, mode: 'local', supplementPairs: [{ node: { kind: 'supplement', key: 'a' }, kind: 'hullEdge', edge: [], anchor: undefined }] } };
            },
            getCompiled: async () => ({ status: 'ok', result: [0, {}, null], stamp: { generation: 1, revision: 1 } }),
            getSnapshot: async () => {
                calls.push('getSnapshot');
                return { status: 'ok', snapshot: snapshot('b'), stamp: { generation: 1, revision: 1 } };
            },
            restore: async () => ({ status: 'failed', reason: 'unused' }),
            finalize: async () => { throw new Error('unused'); },
            disposeLayer: async () => {},
        };
        const sync = new LayerTinSync(transport, 'main');
        const events = [];
        sync.onDisplayChange((change) => events.push(change.kind));
        await sync.rebuild(request);
        const outcome = await sync.edit([{ type: 'removePoint', id: 999 }], request);
        assert.equal(outcome.kind, 'patched', 'resnapshot で済む');
        assert.ok(calls.includes('getSnapshot'), 'resnapshot の経路を通った');
        assert.deepEqual(events, ['replace', 'replace'], '差分ではなく全部の取り直しで描き直す');
        assert.equal(sync.display.supplementPairs[0].node.key, 'b', '取り直した後の補完点に差し替わる');
    }

    // resnapshot が使えないとき: 全部組み直しへ落ちる（patchRejected）
    {
        const transport = {
            rebuild: async () => ({ result: [0, {}, null], stamp: { generation: 1, revision: 0 }, snapshot: snapshot('a') }),
            applyEdits: async () => ({ status: 'patched', stamp: { generation: 1, revision: 1 }, patch: { revision: 1, mode: 'local', supplementPairs: [{ node: { kind: 'supplement', key: 'a' }, kind: 'hullEdge', edge: [] }] } }),
            getCompiled: async () => ({ status: 'ok', result: [0, {}, null], stamp: { generation: 1, revision: 1 } }),
            getSnapshot: async () => ({ status: 'noMesh' }),
            restore: async () => ({ status: 'failed', reason: 'unused' }),
            finalize: async () => { throw new Error('unused'); },
            disposeLayer: async () => {},
        };
        const sync = new LayerTinSync(transport, 'main');
        await sync.rebuild(request);
        const outcome = await sync.edit([{ type: 'removePoint', id: 999 }], request);
        assert.equal(outcome.kind, 'rebuilt');
        assert.equal(outcome.reason, 'patchRejected', '取り直せなければ全部組み直しへ送り直す');
    }
});

// ---- 8. addSubMap（addLayer）は主図の supplementPairs を引き継ぐ ----
test('addSubMap（addLayer）は主図の supplementPairs を引き継ぐ', async () => {
    const { useLayerTransformState } = await import('../src/composables/useLayerTransformState.ts');
    const options = { strictMode: 'strict', vertexMode: 'plain' };
    const layer = (layerId, buildOptions) => ({
        layerId,
        intent: { setup: 'legacyV2' },
        buildOptions,
        gcps: [],
        edges: [],
        bounds: layerId === 'main' ? [128, 256] : [[0, 0], [128, 0], [128, 256]],
    });
    const fixture = (mainOptions) => useLayerTransformState([layer('main', mainOptions)], {
        history: {
            commit() {},
            undo: () => undefined,
            redo: () => undefined,
            async withoutHistoryAsync(apply) { apply(); },
        },
        buildTin: () => ({ tin: 'tooLessGcps' }),
        prepareAdoption: (copy, selected) => ({ ...copy, ...selected }),
    });

    const off = fixture({ ...options, supplementPairs: false });
    const addedOff = off.addLayer({ gcps: [], edges: [], buildOptions: { ...options, supplementPairs: true } });
    assert.equal(off.layers.value.find((l) => l.layerId === addedOff).buildOptions.supplementPairs, false,
        '主図が false の副層も false');

    const on = fixture({ ...options, supplementPairs: true });
    const addedOn = on.addLayer({ gcps: [], edges: [], buildOptions: { ...options, supplementPairs: false } });
    assert.equal(on.layers.value.find((l) => l.layerId === addedOn).buildOptions.supplementPairs, true,
        '主図が true の副層も true');
});

// ---- 9. Plan A（ワールドファイルだけ）の層では、補完点と表示部品が消える ----
itest('Plan A（ワールドファイルだけ）の層では、補完点と表示部品が消える', async () => {
    const gcps = supplementInput();
    const tin = await buildTin(gcps, { incremental: true, incrementalBand: true });
    const { snapshotFromTin } = await import('../src/workers/tinWorkerSession.ts');
    const mesh = new TinDisplayMesh();
    mesh.replaceAll(snapshotFromTin(tin, tin.getCompiled()));
    const shown = supplementDisplayOf(tin, mesh);
    assert.ok(shown.points.length >= 1, '三角網のある層では補完点が出る');
    assert.ok(shown.decor.auxiliaryVertices.length >= 3, '補助頂点も出る');

    for (const tinLike of ['worldFile', 'tooLessGcps', undefined, null, {}]) {
        const empty = supplementDisplayOf(tinLike, mesh);
        assert.deepEqual(empty.points, [], `${String(tinLike)} では補完点が消える`);
        assert.equal(empty.decor.quadrilateral, null, `${String(tinLike)} では外挿四辺形が消える`);
        assert.deepEqual(empty.decor.auxiliaryVertices, [], `${String(tinLike)} では補助頂点が消える`);
        assert.deepEqual(empty.decor.proportionalPoints, [], `${String(tinLike)} では内分点が消える`);
    }
});

// ---- 10. 表示部品（外挿四辺形・補助頂点・内分点） ----
itest('表示部品（外挿四辺形・補助頂点・内分点）が compiled・表示用の網の両方から読める', async () => {
    // 内分点が出るように、折れ点付きの対応線を 1 本入れる
    const gcps = supplementInput();
    const paperBend = [
        (gcps[5][0][0] + gcps[6][0][0]) / 2 + 30,
        (gcps[5][0][1] + gcps[6][0][1]) / 2 + 25,
    ];
    const geoBend = [15000000 + 100 * paperBend[0] + 12, 4000000 - 100 * paperBend[1] - 9];
    const edges = [[[paperBend], [geoBend], [5, 6]]];

    const tin = await buildTin(gcps, { incremental: true, incrementalBand: true }, edges);
    const compiled = tin.getCompiled();
    const decor = tinDecorFromCompiled(compiled);
    assert.ok(decor.auxiliaryVertices.length >= 3, '補助頂点（vertices_points）が読める');
    assert.ok(decor.quadrilateral, '外挿四辺形の輪がある');
    assert.equal(decor.quadrilateral.forw.length, decor.auxiliaryVertices.length + 1, '輪は閉じている');
    assert.deepEqual(decor.quadrilateral.forw[0], decor.quadrilateral.forw.at(-1));
    assert.ok(decor.proportionalPoints.length >= 1, '内分点（対応線の edgeNodes）が読める');
    assert.equal(decor.proportionalPoints.length,
        (compiled.edgeNodes ?? []).length - (compiled.supplementPairs ?? []).length,
        'edgeNodes のうち補完点を除いたものが内分点');

    const { snapshotFromTin } = await import('../src/workers/tinWorkerSession.ts');
    const mesh = new TinDisplayMesh();
    mesh.replaceAll(snapshotFromTin(tin, compiled));
    const meshDecor = tinDecorFromDisplayMesh(mesh);
    assert.equal(meshDecor.auxiliaryVertices.length, decor.auxiliaryVertices.length);
    assert.equal(meshDecor.proportionalPoints.length, decor.proportionalPoints.length);
    assert.equal(meshDecor.quadrilateral.forw.length, decor.quadrilateral.forw.length, '輪の点の数は同じ');
    for (const [index, position] of decor.quadrilateral.forw.entries()) {
        assert.ok(Math.abs(position[0] - meshDecor.quadrilateral.forw[index][0]) < 1e-6);
        assert.ok(Math.abs(position[1] - meshDecor.quadrilateral.forw[index][1]) < 1e-6);
    }
});
