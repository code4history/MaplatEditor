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
    supplementPointToGcp, supplementVertexText,
} = await import('../src/utils/supplementPoints.ts');
const { TinDisplayMesh } = await import('../src/utils/tinDisplayMesh.ts');
const { UndoStack } = await import('../src/services/editorUndoStack.ts');
const { resolveTinBuildOptions } = await import('../src/utils/tinOptions.ts');
const storeHandler = await import('../electron/utils/store_handler.ts');

const incrementalTin = typeof Tin.prototype.applyEdits === 'function';
const itest = (name, fn) => test(name, { skip: incrementalTin ? false : '@maplat/tin に applyEdits が無い' }, fn);

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
const V3 = { useV2Algorithm: false, yaxisMode: 'invert', outerTransform: 'extrapolate', strictMode: 'strict' };
const clone = (value) => structuredClone(value);
const bits = (value) => JSON.stringify(value);

async function buildTin(gcps, extra = {}) {
    const tin = new Tin({ ...V3, wh: [700, 560], ...extra });
    tin.setPoints(clone(gcps));
    await tin.updateTinAsync();
    return tin;
}

// ---- 1. 補完点は対応点の表に入らない ----
test('補完点は gcps・compiled.points に入らず、派生データとしてだけ読める', async () => {
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
test('補完点の読み取り・作り直しで文書（gcps・edges・切り替え）は 1 文字も変わらない', async () => {
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
test('格上げで gcps に入り、Undo 1 回で元へ戻る（履歴 1 件）', async () => {
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
test('supplementPairs: false の Tin は補完点を足さない（#91 の時点と同じ形）', async () => {
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

    // 副層にも同じ値を使う（地図最上位の値）
    const options = resolveTinBuildOptions({ crs: { epsg: 3857 }, supplementPairs: imported.supplementPairs }, {});
    assert.equal(options.supplementPairs, false);
});
