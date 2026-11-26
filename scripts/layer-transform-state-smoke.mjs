import assert from 'node:assert/strict';
import { test as nodeTest } from 'node:test';
import { watch } from 'vue';
import { useHistorySuppression } from '../src/composables/useHistorySuppression.ts';
import { useLayerTransformState } from '../src/composables/useLayerTransformState.ts';
import { UndoStack } from '../src/services/editorUndoStack.ts';

function test(name, run) {
    return nodeTest(name, async () => {
        // 応答が返らない壊れ方でも、制御用の Promise を待ち続けずに試験を失敗させる。
        let timer;
        const deadline = new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('試験が時間内に完了しませんでした')), 1000);
        });
        try {
            await Promise.race([run(), deadline]);
        } finally {
            clearTimeout(timer);
        }
    });
}

const options = { strictMode: 'strict', vertexMode: 'plain', yaxisMode: 'invert' };
const subOptions = { strictMode: 'loose', vertexMode: 'birdeye', yaxisMode: 'follow' };
const crs = { epsg: 6674, authority: 'EPSG', code: '6674' };
const worldFile = { xScale: 2, xSkew: 0.5, xOrigin: 0, ySkew: 0, yScale: -2, yOrigin: 0 };
const intentB = { setup: 'B', crs, worldFile };
const gcps = (x = 0) => [
    [[x, 0], [0, 0]], [[1, 0], [2, 0]], [[0, 1], [0, -2]],
];
const edges = [[[[0.5, 0]], [[1, 0]], [0, 1]]];

const layer = (layerId, overrides = {}) => ({
    layerId,
    intent: { setup: 'legacyV2' },
    buildOptions: layerId === 'main' ? options : subOptions,
    gcps: gcps(),
    edges: [],
    bounds: layerId === 'main' ? [128, 256] : [[0, 0], [128, 0], [128, 256]],
    ...overrides,
});

const selection = { intent: intentB, buildOptions: subOptions, gcps: gcps(5), edges };
const fallback = {
    requestedOuterTransform: 'worldFile', outerTransform: 'extrapolate', fallbackReason: 'boundaryFlips',
};
const fakeTin = ({ layer }) => {
    const dropped = layer.intent.setup === 'B' && layer.gcps[0][0][0] > 0;
    return {
        tin: {
            outerTransform: layer.intent.setup === 'B' && !dropped ? 'worldFile' : 'extrapolate',
            gcps: layer.gcps,
            edges: layer.edges,
            bounds: layer.bounds,
            ...layer.buildOptions,
        },
        diagnostics: dropped ? fallback : undefined,
    };
};

function fixture({
    initial = [layer('main')],
    build = fakeTin,
    prepare = (copy, selected) => ({ ...copy, ...selected }),
    makeHistory,
    initialTins,
} = {}) {
    const history = [structuredClone(initial)];
    const requests = [];
    const events = [];
    let pointer = 0;
    const adapters = makeHistory?.(initial, events) ?? {
        commit(snapshot) {
            events.push('履歴記録');
            history.splice(++pointer, history.length, snapshot);
        },
        undo: () => pointer > 0 ? history[--pointer] : undefined,
        redo: () => pointer + 1 < history.length ? history[++pointer] : undefined,
        async withoutHistoryAsync(apply) {
            events.push('抑止開始');
            apply();
            await Promise.resolve();
            events.push('抑止解除');
        },
    };
    const model = useLayerTransformState(initial, {
        history: adapters,
        buildTin(request) {
            requests.push(request);
            return build(request);
        },
        prepareAdoption: prepare,
    }, initialTins);
    return { model, history, requests, events, readPointer: () => pointer };
}

function controlledTin() {
    const waiting = [];
    return {
        waiting,
        build(request) {
            const job = Promise.withResolvers();
            waiting.push({ ...job, request });
            return job.promise;
        },
    };
}

const tick = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
};
const tinState = (model, id = 'main') => model.getTinState(id);
const draft = (model) => JSON.parse(JSON.stringify(model.capture()));
const saved = { ok: true };
const saveFailure = (reason) => ({ ok: false, reason });
const saveThrough = (model, writes) => model.save((payload) => { writes.push(payload); });

test('表 1　点列と対応線の編集を一件記録し対象層だけ再生成する', async () => {
    const jobs = controlledTin();
    const { model, history, requests } = fixture({ build: jobs.build });
    const first = model.requestTin('main');
    await tick();
    jobs.waiting[0].resolve({ tin: '編集前' });
    await first;

    const points = gcps(7);
    const editedLayer = layer('main', { gcps: points, edges, intent: intentB });
    assert.equal(model.editLayer('main', editedLayer), true);
    points[0][0][0] = 90;
    assert.equal(model.editGeneration.value, 1);
    assert.equal(history.length, 2);
    assert.deepEqual(history[1][0].edges, edges);
    assert.equal(history[1][0].gcps[0][0][0], 7);
    assert.deepEqual(history[1][0].intent, { setup: 'legacyV2' });
    assert.equal(tinState(model).status, 'stale');
    assert.equal(tinState(model).tin, '編集前');
    assert.deepEqual(tinState(model).pendingReq, { reqGen: 1, layerId: 'main' });
    await tick();
    assert.deepEqual(requests[1].layer, history[1][0]);
    jobs.waiting[1].resolve({ tin: '編集後' });
    await tick();
    assert.equal(tinState(model).tin, '編集後');
});

test('表 2　importance と priority だけをまとめて変え層順と揮発状態を保つ', async () => {
    const { model, history, requests } = fixture({
        initial: [layer('main'), layer('sub:a', { importance: 1, priority: 2 }), layer('sub:b')],
    });
    await model.requestTin('sub:a');
    const before = tinState(model, 'sub:a');
    assert.equal(model.changeLayerRanks([
        { layerId: 'sub:a', importance: -1, priority: 1 },
        { layerId: 'sub:b', importance: 1, priority: 2 },
    ]), true);
    assert.deepEqual(model.layers.value.map(({ layerId }) => layerId), ['main', 'sub:a', 'sub:b']);
    assert.deepEqual(history[1].slice(1).map(({ importance, priority }) => [importance, priority]), [[-1, 1], [1, 2]]);
    assert.equal(model.editGeneration.value, 1);
    assert.equal(history.length, 2);
    assert.equal(tinState(model, 'sub:a'), before);
    assert.equal(requests.length, 1);
});

test('表 3　層を追加すると固有の ID を記録し空の揮発状態で要求する', async () => {
    const jobs = controlledTin();
    const { model, history } = fixture({ initial: [layer('main'), layer('sub:1')], build: jobs.build });
    const id = model.addLayer({ buildOptions: subOptions, gcps: [], edges: [] });
    assert.ok(id && id !== 'main' && id !== 'sub:1');
    assert.equal(history.length, 2);
    assert.deepEqual(history[1][2], { layerId: id, intent: { setup: 'legacyV2' }, buildOptions: subOptions, gcps: [], edges: [] });
    assert.equal(model.editGeneration.value, 1);
    assert.equal(tinState(model, id).tin, undefined);
    await tick();
    assert.equal(jobs.waiting[0].request.layerId, id);
    assert.equal(jobs.waiting[0].request.reqGen, 1);
    jobs.waiting[0].resolve({ tin: '新しい層' });
    await tick();
    assert.equal(tinState(model, id).tin, '新しい層');
});

test('表 4　層の削除は記録・世代を進めてその層の揮発状態を破棄する', async () => {
    const jobs = controlledTin();
    const { model, history, requests } = fixture({
        initial: [layer('main'), layer('sub:a')], build: jobs.build,
    });
    const pending = model.requestTin('sub:a');
    await tick();
    assert.equal(model.removeLayer('sub:a'), true);
    assert.deepEqual(history[1].map(({ layerId }) => layerId), ['main']);
    assert.equal(model.editGeneration.value, 1);
    assert.equal(tinState(model, 'sub:a'), undefined);
    jobs.waiting[0].resolve({ tin: '削除済み' });
    assert.equal(await pending, false);
    assert.equal(requests.length, 1);
});

for (const [operation, apply] of [
    ['別の層の編集', (model) => model.editLayer('sub:a', { edges })],
    ['順位の変更', (model) => model.changeLayerRanks([{ layerId: 'sub:a', priority: 2 }])],
    ['層の追加', (model) => model.addLayer({ buildOptions: subOptions })],
    ['別の層の削除', (model) => model.removeLayer('sub:a')],
]) {
    test(`生成中の引き継ぎ　${operation}の後も主図の生成が完了する`, async () => {
        const jobs = controlledTin();
        const { model } = fixture({
            initial: [layer('main'), layer('sub:a')], build: jobs.build,
        });
        const original = model.requestTin('main');
        await tick();
        const [old] = jobs.waiting;
        assert.equal(old.request.reqGen, 0);

        assert.ok(apply(model));
        assert.equal(model.editGeneration.value, 1);
        await tick();
        assert.equal(jobs.waiting.filter(({ request }) => request.layerId === 'main').length, 1);
        old.resolve({ tin: '古い主図' });
        assert.equal(await original, false);
        const retries = jobs.waiting.slice(1);
        for (const { request, resolve } of retries) {
            resolve({ tin: request.layerId === 'main' ? '新しい主図' : '操作対象の層' });
        }
        await tick();
        assert.equal(tinState(model).status, 'ready');
        assert.equal(tinState(model).tin, '新しい主図');
        assert.deepEqual(retries.filter(({ request }) => request.layerId === 'main')
            .map(({ request }) => request.reqGen), [1]);
    });
}

test('表 5　採用開始は一時コピーだけを操作し採用 ID 付きで生成する', async () => {
    const jobs = controlledTin();
    const { model, history, events } = fixture({
        build: jobs.build,
        prepare(copy, selected) {
            copy.gcps[0][0][0] = 20;
            return { ...copy, intent: selected.intent };
        },
    });
    const before = draft(model);
    const volatile = tinState(model);
    assert.equal((await model.startAdoption('main', null)).status, 'rejected');
    const adopting = model.startAdoption('main', selection);
    assert.equal(model.adoptionInProgress.value, true);
    await tick();
    const { request } = jobs.waiting[0];
    assert.equal(typeof request.adoptionId, 'number');
    assert.equal(request.layerId, 'main');
    assert.ok(!('reqGen' in request));
    assert.equal(request.layer.gcps[0][0][0], 20);
    assert.equal(model.editGeneration.value, 0);
    assert.equal(history.length, 1);
    assert.deepEqual(draft(model), before);
    assert.equal(tinState(model), volatile);
    assert.deepEqual(events, []);
    assert.equal(model.cancelAdoption(), true);
    assert.equal((await adopting).status, 'cancelled');
    jobs.waiting[0].resolve({ tin: '取消済み' });
});

test('表 6　採用確定は一時の生成結果を一括反映し再生成を要求しない', async () => {
    const { model, history, requests, events } = fixture();
    assert.equal((await model.startAdoption('main', selection)).status, 'adopted');
    assert.deepEqual(events, ['抑止開始', '抑止解除', '履歴記録']);
    assert.equal(history.length, 2);
    assert.equal(model.editGeneration.value, 1);
    assert.equal(model.adoptionInProgress.value, false);
    assert.deepEqual(model.capture()[0], layer('main', selection));
    assert.deepEqual(tinState(model).diagnostics, fallback);
    assert.equal(tinState(model).tin.outerTransform, 'extrapolate');
    assert.equal(requests.length, 1);
});

test('表 7　生成の失敗と取消は一時結果を捨てて採用開始前の状態を保つ', async () => {
    const jobs = controlledTin();
    const { model, history, events } = fixture({ build: jobs.build });
    const before = draft(model);
    const volatile = tinState(model);
    const first = model.startAdoption('main', selection);
    await tick();
    const error = new Error('一時の生成が失敗');
    jobs.waiting[0].reject(error);
    assert.deepEqual(await first, { status: 'failed', error });

    const second = model.startAdoption('main', selection);
    await tick();
    assert.notEqual(jobs.waiting[1].request.adoptionId, jobs.waiting[0].request.adoptionId);
    assert.equal(model.cancelAdoption(), true);
    assert.equal((await second).status, 'cancelled');
    assert.equal(jobs.waiting[1].request.signal.aborted, true);
    jobs.waiting[1].resolve({ tin: '遅延した結果' });
    await tick();
    assert.equal(model.adoptionInProgress.value, false);
    assert.equal(model.editGeneration.value, 0);
    assert.equal(history.length, 1);
    assert.deepEqual(events, []);
    assert.deepEqual(draft(model), before);
    assert.equal(tinState(model), volatile);
});

test('表 8　Undo・Redo・下書きの復元は全層を古くして同じ入力で作り直す', async () => {
    const jobs = controlledTin();
    const { model, history, requests } = fixture({
        initial: [layer('main'), layer('sub:a', { intent: intentB })], build: jobs.build,
    });
    model.editLayer('main', { gcps: gcps(4) });
    const changed = draft(model);
    await tick();
    jobs.waiting[0].resolve({ tin: '編集後' });
    await tick();
    let reqIndex = 1;
    for (const [index, operation, expected] of [
        [2, model.undo, history[0]], [3, model.redo, changed],
        [4, () => model.restoreDraft(history[0]), history[0]],
    ]) {
        const previousTins = new Map(model.layers.value.map(({ layerId }) => [layerId, tinState(model, layerId)?.tin]));
        const restoring = operation();
        assert.equal(model.editGeneration.value, index);
        assert.deepEqual(draft(model), expected);
        assert.equal(tinState(model).status, 'stale');
        assert.equal(tinState(model, 'sub:a').status, 'stale');
        assert.equal(tinState(model).tin, previousTins.get('main'));
        assert.equal(tinState(model, 'sub:a').tin, previousTins.get('sub:a'));
        await tick();
        assert.deepEqual(requests.slice(reqIndex).map(({ layer, reqGen }) => [layer, reqGen]), expected.map((l) => [l, index]));
        for (const job of jobs.waiting.slice(reqIndex)) job.resolve(fakeTin(job.request));
        reqIndex += 2;
        assert.equal(restoring.restored, true);
        assert.equal(await restoring.settled, true);
        assert.equal(tinState(model).status, 'ready');
        assert.equal(tinState(model, 'sub:a').status, 'ready');
    }
    assert.equal(history.length, 2);
});

test('表 9　現存する層への現在世代の成功と失敗だけを反映する', async () => {
    const jobs = controlledTin();
    const { model, history } = fixture({ initial: [layer('main'), layer('sub:a')], build: jobs.build });
    const before = draft(model);
    const success = model.requestTin('main');
    const failure = model.requestTin('sub:a');
    await tick();
    jobs.waiting[0].resolve({ tin: '成功', diagnostics: ['診断'] });
    const error = new Error('現在世代の失敗');
    jobs.waiting[1].reject(error);
    assert.equal(await success, true);
    assert.equal(await failure, true);
    assert.deepEqual(tinState(model), { status: 'ready', tin: '成功', diagnostics: ['診断'] });
    assert.deepEqual(tinState(model, 'sub:a'), { status: 'failed', error });
    assert.deepEqual(draft(model), before);
    assert.equal(model.editGeneration.value, 0);
    assert.equal(history.length, 1);

    const onUnmount = model.requestTin('main');
    await tick();
    const last = tinState(model);
    model.dispose();
    jobs.waiting[2].resolve({ tin: '離脱後の成功' });
    assert.equal(await onUnmount, false);
    assert.equal(tinState(model), last);
});

test('表 10　保存は最新の全層を待ち同じ世代の要求を共有する', async () => {
    const jobs = controlledTin();
    const writes = [];
    const { model, history } = fixture({ initial: [layer('main'), layer('sub:a')], build: jobs.build });
    const inFlight = model.requestTin('sub:a');
    await tick();
    const saving = saveThrough(model, writes);
    await tick();
    assert.deepEqual(jobs.waiting.map(({ request }) => request.layerId), ['sub:a', 'main']);
    jobs.waiting[1].resolve({ tin: '主図' });
    await tick();
    assert.equal(writes.length, 0);
    jobs.waiting[0].resolve({ tin: '副層' });
    await inFlight;
    assert.deepEqual(await saving, saved);
    assert.deepEqual(writes[0].tins, ['主図', '副層']);
    assert.deepEqual(writes[0].layers, model.capture());
    const mainTin = tinState(model);
    assert.deepEqual(await saveThrough(model, writes), saved);
    assert.equal(tinState(model), mainTin);
    assert.equal(jobs.waiting.length, 2);
    assert.equal(history.length, 1);
    assert.equal(model.editGeneration.value, 0);

    model.editLayer('main', { gcps: gcps(7) });
    const supersededSave = saveThrough(model, writes);
    await tick();
    model.editLayer('main', { gcps: gcps(9) });
    await tick();
    jobs.waiting[2].resolve({ tin: '保存中に古くなった結果' });
    jobs.waiting[3].resolve({ tin: '次の編集の結果' });
    assert.deepEqual(await supersededSave, saveFailure('generationChanged'));
    assert.equal(writes.length, 2);
    assert.deepEqual(await saveThrough(model, writes), saved);
    assert.equal(writes[2].tins[0], '次の編集の結果');
});

test('表 11　採用中は編集・順位・追加・削除・復元・保存の入口で拒否する', async () => {
    const jobs = controlledTin();
    const writes = [];
    const { model, history, requests, readPointer } = fixture({
        initial: [layer('main'), layer('sub:a')], build: jobs.build,
    });
    assert.equal(model.editLayer('main', { gcps: gcps(4) }), true);
    await tick();
    jobs.waiting[0].resolve(fakeTin(jobs.waiting[0].request));
    await tick();
    const checked = async (expectedPointer) => {
        const adopting = model.startAdoption('main', selection);
        const before = draft(model);
        const generation = model.editGeneration.value;
        const requestCount = requests.length;
        assert.equal(model.editLayer('main', { edges }), false);
        assert.equal(model.editLayers([{ layerId: 'main', edit: { edges } }]), false);
        assert.equal(model.changeLayerRanks([{ layerId: 'sub:a', priority: 2 }]), false);
        assert.equal(model.addLayer({ buildOptions: options }), undefined);
        assert.equal(model.removeLayer('sub:a'), false);
        const undo = model.undo();
        const redo = model.redo();
        const restored = model.restoreDraft([layer('main')]);
        for (const result of [undo, redo, restored]) {
            assert.equal(result.restored, false);
            assert.equal(await result.settled, false);
        }
        assert.deepEqual(await saveThrough(model, writes), saveFailure('adopting'));
        assert.equal(await model.requestTin('sub:a'), false);
        assert.equal((await model.startAdoption('main', selection)).status, 'rejected');
        assert.deepEqual(draft(model), before);
        assert.equal(history.length, 2);
        assert.equal(readPointer(), expectedPointer);
        assert.equal(model.editGeneration.value, generation);
        assert.equal(requests.length, requestCount + 1);
        assert.equal(writes.length, 0);
        assert.equal(model.cancelAdoption(), true);
        assert.equal((await adopting).status, 'cancelled');
        jobs.waiting.at(-1).resolve({ tin: '取消済み' });
    };

    await checked(1);
    const undo = model.undo();
    assert.equal(undo.restored, true);
    await tick();
    for (const job of jobs.waiting.slice(-2)) job.resolve(fakeTin(job.request));
    assert.equal(await undo.settled, true);
    await checked(0);
});

test('追加 1　生成中に Undo し新しい結果の後に届く古い成功を捨てる', async () => {
    const jobs = controlledTin();
    const { model } = fixture({ build: jobs.build });
    model.editLayer('main', { gcps: gcps(9) });
    await tick();
    const undo = model.undo();
    await tick();
    jobs.waiting[1].resolve({ tin: 'Undo 後' });
    assert.equal(undo.restored, true);
    assert.equal(await undo.settled, true);
    jobs.waiting[0].resolve({ tin: '古い編集' });
    await tick();
    assert.equal(tinState(model).tin, 'Undo 後');
    assert.deepEqual(model.capture()[0].gcps, gcps());
});

test('追加 2　生成中の層削除で同じ配列位置に移った層へ書かない', async () => {
    const jobs = controlledTin();
    const { model } = fixture({
        initial: [layer('main'), layer('sub:a'), layer('sub:b')], build: jobs.build,
    });
    const deleted = model.requestTin('sub:a');
    const survivor = model.requestTin('sub:b');
    await tick();
    jobs.waiting[1].resolve({ tin: '残る層' });
    await survivor;
    assert.equal(model.removeLayer('sub:a'), true);
    assert.equal(model.layers.value[1].layerId, 'sub:b');
    jobs.waiting[0].resolve({ tin: '削除した層' });
    assert.equal(await deleted, false);
    assert.equal(tinState(model, 'sub:b').tin, '残る層');
});

test('追加 3　B から C に降格した後も B の意図を保ち Undo で B・Redo で C を再現する', async () => {
    const { model, history } = fixture({ initial: [layer('main', { intent: intentB })] });
    await model.requestTin('main');
    assert.equal(tinState(model).tin.outerTransform, 'worldFile');
    model.editLayer('main', { gcps: gcps(8) });
    await tick();
    const dropped = tinState(model);
    assert.deepEqual(dropped.diagnostics, fallback);
    assert.equal(dropped.tin.outerTransform, 'extrapolate');
    assert.deepEqual(history[1][0].intent, intentB);
    assert.ok(!('tin' in history[1][0]));
    await model.undo().settled;
    assert.equal(tinState(model).tin.outerTransform, 'worldFile');
    assert.deepEqual(model.capture()[0].intent, intentB);
    await model.redo().settled;
    assert.deepEqual(tinState(model), dropped);
    assert.deepEqual(model.capture()[0].intent, intentB);
});

test('追加 4　A・B・C・降格を含む下書きの再生成で三つの設定と結果が完全一致する', async () => {
    const initial = [
        layer('main', { intent: intentB }), layer('sub:a', { intent: { ...intentB, setup: 'A' } }),
        layer('sub:c', { intent: { setup: 'C', crs } }),
        layer('sub:b', { intent: intentB, gcps: gcps(8), edges }),
    ];
    const { model: before, requests: original } = fixture({ initial });
    await Promise.all(initial.map(({ layerId }) => before.requestTin(layerId)));
    assert.equal(tinState(before, 'sub:a').tin, 'worldFile');
    assert.equal(tinState(before, 'sub:b').tin.outerTransform, 'extrapolate');
    assert.deepEqual(tinState(before, 'sub:b').diagnostics, fallback);
    assert.deepEqual(original.map(({ layer }) => layer.buildOptions), [options, subOptions, subOptions]);

    const { model: after, requests: rebuilt } = fixture();
    assert.equal(await after.restoreDraft(draft(before)).settled, true);
    assert.deepEqual(rebuilt.map(({ layer }) => layer), original.map(({ layer }) => layer));
    for (const { layerId } of initial) assert.deepEqual(tinState(after, layerId), tinState(before, layerId));
});

test('下書き復元で登録した副層 ID を直後の層追加で再使用しない', async () => {
    const { model } = fixture();
    assert.equal(await model.restoreDraft([layer('main'), layer('sub:1')]).settled, true);
    const added = model.addLayer({ buildOptions: subOptions });
    assert.ok(added && added !== 'sub:1');
    assert.deepEqual(model.layers.value.map(({ layerId }) => layerId), ['main', 'sub:1', added]);
});

for (const [invalid, ids] of [
    ['重複する層 ID', ['main', 'sub:1', 'sub:1']],
    ['空の層 ID', ['main', '']],
    ['先頭が主図以外', ['sub:1', 'main']],
]) {
    test(`下書き復元で${invalid}を拒否し状態を保つ`, async () => {
        const { model, history, requests } = fixture({ initial: [layer('main'), layer('sub:a')] });
        await Promise.all(model.layers.value.map(({ layerId }) => model.requestTin(layerId)));
        const before = model.capture();
        const states = before.map(({ layerId }) => tinState(model, layerId));
        const generation = model.editGeneration.value;
        const requestCount = requests.length;

        assert.throws(() => model.restoreDraft(ids.map((id) => layer(id, { gcps: gcps(9) }))),
            /先頭の主図と重複のない層 ID が必要/);
        assert.deepEqual(model.capture(), before);
        assert.equal(model.editGeneration.value, generation);
        assert.deepEqual(history, [before]);
        assert.equal(requests.length, requestCount);
        before.forEach(({ layerId }, index) => assert.equal(tinState(model, layerId), states[index]));
    });
}

test('追加 5　検証待ちの採用中は編集・Undo・保存を拒否する', async () => {
    const validation = Promise.withResolvers();
    const writes = [];
    const { model, requests } = fixture({ prepare: () => validation.promise });
    const adopting = model.startAdoption('main', selection);
    assert.equal(model.editLayer('main', { gcps: gcps(3) }), false);
    assert.equal(await model.undo().settled, false);
    assert.deepEqual(await saveThrough(model, writes), saveFailure('adopting'));
    assert.equal(requests.length, 0);
    assert.equal(writes.length, 0);
    validation.resolve({ ...layer('main'), ...selection });
    assert.equal((await adopting).status, 'adopted');
});

test('追加 6　採用と保存を双方の開始順で排他し失敗・成功後は整合する内容を保存する', async () => {
    const validation = Promise.withResolvers();
    const write = Promise.withResolvers();
    const writes = [];
    let preparing = false;
    const { model } = fixture({ prepare(copy, selected) {
        return preparing ? { ...copy, ...selected } : validation.promise;
    } });
    const save = model.save((payload) => {
        writes.push(payload);
        return write.promise;
    });
    assert.equal((await model.startAdoption('main', selection)).status, 'rejected');
    await tick();
    assert.equal(writes.length, 1);
    assert.equal((await model.startAdoption('main', selection)).status, 'rejected');
    write.resolve();
    assert.deepEqual(await save, saved);

    const failed = model.startAdoption('main', selection);
    assert.deepEqual(await saveThrough(model, writes), saveFailure('adopting'));
    validation.reject(new Error('座標の検証失敗'));
    assert.equal((await failed).status, 'failed');
    assert.deepEqual(await saveThrough(model, writes), saved);
    assert.deepEqual(writes[1], writes[0]);

    preparing = true;
    const adopted = model.startAdoption('main', selection);
    assert.deepEqual(await saveThrough(model, writes), saveFailure('adopting'));
    assert.equal((await adopted).status, 'adopted');
    assert.deepEqual(await saveThrough(model, writes), saved);
    assert.deepEqual(writes[2].layers[0].intent, intentB);
    assert.equal(writes[2].tins[0].outerTransform, 'extrapolate');
    assert.equal(writes.length, 3);
});

test('追加 7　新しい成功の後に古い失敗が届いても揮発状態を上書きしない', async () => {
    const jobs = controlledTin();
    const { model } = fixture({ build: jobs.build });
    const old = model.requestTin('main');
    await tick();
    model.editLayer('main', { gcps: gcps(8) });
    await tick();
    jobs.waiting[1].resolve({ tin: '新しい成功', diagnostics: ['新しい診断'] });
    await tick();
    const latest = tinState(model);
    jobs.waiting[0].reject(new Error('古い失敗'));
    assert.equal(await old, false);
    assert.equal(tinState(model), latest);
    assert.equal(latest.tin, '新しい成功');
    assert.deepEqual(latest.diagnostics, ['新しい診断']);
});

test('追加 8　nextTick の抑止解除後に履歴が一件だけ増え Undo と Redo で採用を往復する', async () => {
    const suppression = useHistorySuppression();
    const initial = [layer('main')];
    const stack = new UndoStack(initial);
    const { model } = fixture({
        initial,
        makeHistory: () => ({
            withoutHistoryAsync: (apply) => suppression.withoutHistoryAsync('adopt-crs', apply),
            commit(snapshot) {
                assert.equal(suppression.suppressed.value, false);
                stack.push(snapshot);
            },
            undo() { stack.undo(); return stack.current(); },
            redo() { stack.redo(); return stack.current(); },
        }),
    });

    const stop = watch(model.layers, () => {
        if (!model.adoptionInProgress.value) return;
        assert.equal(suppression.suppressed.value, true);
        assert.equal(stack.snapshot().history.length, 1);
    });
    try {
        assert.equal((await model.startAdoption('main', selection)).status, 'adopted');
        assert.equal(stack.snapshot().history.length, 2);
        assert.deepEqual(stack.current(), model.capture());
        assert.equal(await model.undo().settled, true);
        assert.deepEqual(draft(model), initial);
        assert.equal(await model.redo().settled, true);
        assert.deepEqual(draft(model), [layer('main', selection)]);
        assert.equal(stack.snapshot().history.length, 2);
    } finally {
        stop();
    }
});

for (const fromUndo of [false, true]) {
    const scenario = fromUndo ? 'Undo 直後の採用' : '生成中の採用';
    test(`再レビュー 1　${scenario}を確定しても副層は最新世代で生成される`, async () => {
        const jobs = controlledTin();
        const applied = Promise.withResolvers();
        const release = Promise.withResolvers();
        const initial = [layer('main'), layer('sub:a')];
        const stack = new UndoStack(initial);
        const { model, requests } = fixture({
            initial,
            build: (request) => request.kind === 'adoption' ? fakeTin(request) : jobs.build(request),
            makeHistory: () => ({
                commit: (snapshot) => stack.push(snapshot),
                undo() { stack.undo(); return stack.current(); },
                redo() { stack.redo(); return stack.current(); },
                async withoutHistoryAsync(apply) {
                    apply();
                    applied.resolve();
                    await release.promise;
                },
            }),
        });
        let pending;
        if (fromUndo) {
            model.editLayer('main', { gcps: gcps(8) });
            await tick();
            jobs.waiting[0].resolve(fakeTin(jobs.waiting[0].request));
            await tick();
            model.undo();
        } else {
            pending = model.requestTin('sub:a');
        }
        await tick();
        const old = jobs.waiting.find(({ request }) => request.layerId === 'sub:a');
        const adopting = model.startAdoption('main', selection);
        await applied.promise;
        assert.equal(model.adoptionInProgress.value, true);

        if (fromUndo) {
            // 抑止が残っている間に古い応答が届く場合を作る。
            for (const job of jobs.waiting.slice(1)) job.resolve({ tin: 'Undo 世代の結果' });
            await tick();
            assert.equal(jobs.waiting.filter(({ request }) => request.layerId === 'sub:a').length, 1);
        }
        release.resolve();
        assert.equal((await adopting).status, 'adopted');
        if (!fromUndo) {
            old.resolve({ tin: '採用前の副層' });
            assert.equal(await pending, false);
        }
        await tick();

        const subRequests = jobs.waiting.filter(({ request }) => request.layerId === 'sub:a');
        assert.equal(subRequests.length, 2);
        const latest = subRequests[1];
        assert.equal(latest.request.reqGen, model.editGeneration.value);
        latest.resolve({ tin: '採用後の副層' });
        await tick();
        assert.equal(tinState(model, 'sub:a').status, 'ready');
        assert.equal(tinState(model, 'sub:a').tin, '採用後の副層');
        assert.equal(tinState(model).tin.outerTransform, 'extrapolate');
        assert.equal(requests.filter(({ layerId, reqGen }) =>
            layerId === 'main' && reqGen === model.editGeneration.value).length, 0);
    });
}

test('再レビュー 1　5 層で Undo 直後に 4 回編集しても待ち行列で走る生成は最新世代だけ', async () => {
    const queue = controlledTin();
    const initial = [layer('main'), ...Array.from({ length: 4 }, (_, i) => layer(`sub:${i}`))];
    const { model } = fixture({ initial, build: queue.build });
    model.editLayer('main', { gcps: gcps(9) });
    await tick();
    queue.waiting.shift().resolve({ tin: 'Undo 前の主図' });
    await tick();
    model.undo();
    await tick();
    assert.equal(queue.waiting.length, 5);
    for (let i = 1; i <= 4; i++) {
        assert.equal(model.editLayer('main', { gcps: gcps(i) }), true);
        await tick();
    }

    const built = [];
    for (let i = 0; queue.waiting.length > 0 && i < 20; i++) {
        const job = queue.waiting.shift();
        assert.equal(typeof job.request.isCurrent, 'function');
        if (job.request.isCurrent()) {
            built.push([job.request.layerId, job.request.reqGen]);
            job.resolve(fakeTin(job.request));
        } else {
            job.reject(new Error('待ち行列の旧世代を破棄'));
        }
        await tick();
    }
    assert.equal(queue.waiting.length, 0);
    assert.equal(built.length, initial.length);
    assert.deepEqual(built.map(([id]) => id).sort(), initial.map(({ layerId }) => layerId).sort());
    assert.ok(built.every(([, generation]) => generation === model.editGeneration.value));
    initial.forEach(({ layerId }) => assert.equal(tinState(model, layerId).status, 'ready'));
});

test('再レビュー 2　3 層の外周設定を一件の履歴と一世代で変え、Undo 一回で戻す', async () => {
    const initial = [
        layer('main'), layer('sub:a', { buildOptions: { ...subOptions, vertexMode: 'plain' } }),
        layer('sub:b', { buildOptions: options }),
    ];
    const { model, history, requests } = fixture({ initial });
    assert.equal(typeof model.editLayers, 'function');
    assert.equal(model.editLayers(initial.map(({ layerId, buildOptions }) => ({
        layerId, edit: { buildOptions: { ...buildOptions, vertexMode: 'birdeye' } },
    }))), true);
    assert.equal(history.length, 2);
    assert.equal(model.editGeneration.value, 1);
    assert.deepEqual(history[1].map(({ buildOptions }) => buildOptions.vertexMode), Array(3).fill('birdeye'));
    await tick();
    assert.deepEqual(requests.map(({ layerId, reqGen }) => [layerId, reqGen]), initial.map(({ layerId }) => [layerId, 1]));
    const undo = model.undo();
    assert.equal(undo.restored, true);
    assert.deepEqual(model.capture(), initial);
    assert.equal(await undo.settled, true);
    assert.equal(model.editGeneration.value, 2);
    assert.equal(history.length, 2);
});

test('再レビュー 3　W1 の履歴抑止が生成の完了を待たず次の編集を記録する', async () => {
    const suppression = useHistorySuppression();
    const jobs = controlledTin();
    const initial = [layer('main'), layer('sub:a')];
    const stack = new UndoStack(initial);
    const { model } = fixture({
        initial,
        build: jobs.build,
        makeHistory: () => ({
            commit(snapshot) {
                if (!suppression.suppressed.value) stack.push(snapshot);
            },
            undo() { stack.undo(); return stack.current(); },
            redo() { stack.redo(); return stack.current(); },
            withoutHistoryAsync: (apply) => suppression.withoutHistoryAsync('adopt-crs', apply),
        }),
    });
    model.editLayer('main', { gcps: gcps(3) });
    await tick();
    jobs.waiting[0].resolve(fakeTin(jobs.waiting[0].request));
    await tick();
    const restoring = suppression.withoutHistoryAsync('W1', () => model.undo());
    assert.equal(suppression.suppressed.value, true);
    assert.deepEqual(model.capture(), initial);
    await tick();
    assert.equal(jobs.waiting.length, 3);
    assert.equal(suppression.suppressed.value, false);
    const undo = await restoring;
    assert.equal(undo.restored, true);
    assert.ok(undo.settled instanceof Promise);
    assert.equal(tinState(model).status, 'stale');

    assert.equal(model.editLayer('main', { gcps: gcps(6) }), true);
    assert.equal(stack.snapshot().pointer, 1);
    assert.deepEqual(stack.current()[0].gcps, gcps(6));
    jobs.waiting[1].resolve(fakeTin(jobs.waiting[1].request));
    jobs.waiting[2].resolve(fakeTin(jobs.waiting[2].request));
    assert.equal(await undo.settled, false);
    for (const job of jobs.waiting.slice(3)) job.resolve(fakeTin(job.request));
    await tick();
    assert.deepEqual(model.capture(), stack.current());
});

test('採用の反映開始後は抑止解除の待ち時間も取消を受け付けない', async () => {
    const entered = Promise.withResolvers();
    const release = Promise.withResolvers();
    const { model, events } = fixture({
        makeHistory: () => ({
            commit: () => events.push('履歴記録'),
            async withoutHistoryAsync(apply) {
                apply();
                entered.resolve();
                await release.promise;
            },
        }),
    });
    const adopting = model.startAdoption('main', selection);
    await entered.promise;
    assert.equal(model.adoptionInProgress.value, true);
    assert.deepEqual(model.capture(), [layer('main', selection)]);
    assert.equal(model.cancelAdoption(), false);
    assert.deepEqual(events, []);
    release.resolve();
    assert.equal((await adopting).status, 'adopted');
    assert.deepEqual(events, ['履歴記録']);
});

test('旧世代の finally が新世代の要求を消さず保存と再要求で同じ完了を待つ', async () => {
    const jobs = controlledTin();
    const { model } = fixture({ build: jobs.build });
    const old = model.requestTin('main');
    await tick();
    model.editLayer('main', { gcps: gcps(4) });
    const current = model.requestTin('main');
    await tick();
    assert.equal(jobs.waiting.length, 2);
    jobs.waiting[0].resolve({ tin: '古い結果' });
    assert.equal(await old, false);
    assert.equal(model.requestTin('main'), current);
    const writes = [];
    const saving = saveThrough(model, writes);
    await tick();
    assert.equal(jobs.waiting.length, 2);
    jobs.waiting[1].resolve({ tin: '現在の結果' });
    assert.equal(await current, true);
    assert.deepEqual(await saving, saved);
    assert.deepEqual(writes[0].tins, ['現在の結果']);
});

test('離脱後は新しい編集・復元・生成・保存を受け付けない', async () => {
    const { model, history, requests } = fixture({ initial: [layer('main'), layer('sub:a')] });
    const before = model.capture();
    model.dispose();
    assert.equal(model.editLayer('main', { edges }), false);
    assert.equal(model.editLayers([{ layerId: 'main', edit: { edges } }]), false);
    assert.equal(model.changeLayerRanks([{ layerId: 'sub:a', priority: 3 }]), false);
    assert.equal(model.removeLayer('sub:a'), false);
    assert.equal(model.addLayer({ buildOptions: options }), undefined);
    assert.equal(model.restoreDraft([layer('main')]).restored, false);
    assert.equal(await model.requestTin('main'), false);
    assert.deepEqual(await model.save(assert.fail), saveFailure('disposed'));
    assert.deepEqual(model.capture(), before);
    assert.deepEqual(history, [before]);
    assert.equal(model.editGeneration.value, 0);
    assert.equal(requests.length, 0);
});

test('生成に失敗した層があれば保存を中断し生成失敗を返す', async () => {
    const { model } = fixture({
        initial: [layer('main'), layer('sub:a')],
        build(request) {
            if (request.layerId === 'sub:a') throw new Error('副層の生成失敗');
            return fakeTin(request);
        },
    });
    assert.deepEqual(await model.save(assert.fail), saveFailure('buildFailed'));
    assert.equal(tinState(model).status, 'ready');
    assert.equal(tinState(model, 'sub:a').status, 'failed');
});

test('順位変更で undefined の鍵を残さず、空編集を変更扱いにしない', async () => {
    const { model } = fixture({ initial: [layer('main'), layer('sub:a')] });
    assert.equal(model.changeLayerRanks([{ layerId: 'sub:a', priority: 2 }]), true);
    assert.equal(Object.hasOwn(model.capture()[1], 'importance'), false);
    assert.equal(model.editLayer('sub:a', {}), false);
});

test('requestTin の直後に別層を編集した場合は古い世代の build を始めず再要求する', async () => {
    const jobs = controlledTin();
    const { model } = fixture({ initial: [layer('main'), layer('sub:a')], build: jobs.build });
    const first = model.requestTin('main');
    assert.equal(model.editLayer('sub:a', { edges }), true);
    await tick();
    const mainRequests = jobs.waiting.filter(({ request }) => request.layerId === 'main');
    assert.equal(mainRequests.length, 1);
    assert.equal(mainRequests[0].request.reqGen, 1);
    assert.equal(await first, false);
    const retry = mainRequests[0];
    retry.resolve({ tin: '現在世代の主図' });
    for (const job of jobs.waiting.filter(({ request }) => request.layerId === 'sub:a')) {
        job.resolve({ tin: '現在世代の副層' });
    }
    await tick();
    assert.equal(tinState(model).tin, '現在世代の主図');
});

test('採用中に届いた古い応答は取消後に持ち越し再要求される', async () => {
    const jobs = controlledTin();
    const { model } = fixture({ initial: [layer('main'), layer('sub:a')], build: jobs.build });
    const old = model.requestTin('sub:a');
    await tick();
    model.editLayer('main', { gcps: gcps(9) });
    const adopting = model.startAdoption('main', selection);
    await tick();
    jobs.waiting[0].resolve({ tin: '古い副層' });
    assert.equal(await old, false);
    assert.equal(model.cancelAdoption(), true);
    assert.equal((await adopting).status, 'cancelled');
    await tick();
    const retry = jobs.waiting.find(({ request }) => request.layerId === 'sub:a' && request.reqGen === model.editGeneration.value);
    assert.ok(retry);
    retry.resolve({ tin: '再要求した副層' });
    await tick();
    assert.equal(tinState(model, 'sub:a').status, 'ready');
    assert.equal(tinState(model, 'sub:a').tin, '再要求した副層');
});

test('主図の削除を拒否し、未知の層の削除で履歴を作らない', async () => {
    const { model, history } = fixture({ initial: [layer('main'), layer('sub:a')] });
    assert.equal(model.removeLayer('main'), false);
    assert.equal(model.removeLayer('sub:unknown'), false);
    assert.equal(history.length, 1);
});

test('addLayer と removeLayer の順位更新を同じ履歴へ含める', async () => {
    const { model } = fixture({ initial: [layer('main'), layer('sub:a', { priority: 1 })] });
    const added = model.addLayer({ buildOptions: subOptions }, [{ layerId: 'sub:a', priority: 4 }]);
    assert.ok(added);
    assert.equal(model.capture()[1].priority, 4);
    assert.equal(model.capture().length, 3);
    assert.equal(model.removeLayer(added, [{ layerId: 'sub:a', priority: 2 }]), true);
    assert.equal(model.capture().length, 2);
    assert.equal(model.capture()[1].priority, 2);
});

test('dispose は未確定の採用を取り消す', async () => {
    const jobs = controlledTin();
    const { model } = fixture({ build: jobs.build });
    const adopting = model.startAdoption('main', selection);
    await tick();
    model.dispose();
    assert.equal((await adopting).status, 'cancelled');
    assert.equal(model.adoptionInProgress.value, false);
    jobs.waiting[0].resolve({ tin: '遅れて届いた採用結果' });
});

test('復元時に生成に失敗した層があれば settled は false', async () => {
    const { model } = fixture({
        initial: [layer('main'), layer('sub:a')],
        build(request) {
            if (request.layerId === 'sub:a') throw new Error('副層の生成失敗');
            return fakeTin(request);
        },
    });
    const restored = model.restoreDraft([layer('main'), layer('sub:a')]);
    assert.equal(restored.restored, true);
    assert.equal(await restored.settled, false);
});

test('editLayers は未知または重複した層 ID を拒否する', async () => {
    const { model, history } = fixture({ initial: [layer('main'), layer('sub:a')] });
    assert.equal(model.editLayers([{ layerId: 'missing', edit: { edges } }]), false);
    assert.equal(model.editLayers([
        { layerId: 'sub:a', edit: { edges } },
        { layerId: 'sub:a', edit: { gcps: gcps(4) } },
    ]), false);
    assert.equal(history.length, 1);
    assert.equal(model.editGeneration.value, 0);
});

test('compiled の種付け後は編集した層だけを生成し、未編集層の保存済み結果を使い続ける', async () => {
    const mainSeed = { tin: { compiled: '以前の主図' }, diagnostics: ['主図の診断'] };
    const subSeed = { tin: { compiled: '以前の副層' } };
    const writes = [];
    const { model, requests } = fixture({
        initial: [layer('main'), layer('sub:a')],
        initialTins: new Map([['main', mainSeed], ['sub:a', subSeed]]),
    });
    assert.deepEqual(tinState(model), { status: 'ready', ...mainSeed });
    assert.deepEqual(await saveThrough(model, writes), saved);
    assert.equal(requests.length, 0);
    assert.equal(writes[0].tins[0], mainSeed.tin);
    assert.equal(writes[0].tins[1], subSeed.tin);

    assert.equal(model.editLayer('main', { gcps: gcps(4) }), true);
    assert.deepEqual(await saveThrough(model, writes), saved);
    assert.deepEqual(requests.map(({ layerId }) => layerId), ['main']);
    assert.notEqual(writes[1].tins[0], mainSeed.tin);
    assert.equal(writes[1].tins[1], subSeed.tin);
    assert.ok(!('tin' in model.capture()[1]));
});

test('保存の書き込み中は文書の変更を拒否し、書き込み失敗の後は編集できる', async () => {
    const started = Promise.withResolvers();
    const write = Promise.withResolvers();
    const { model, history, readPointer } = fixture({ initial: [layer('main'), layer('sub:a')] });
    model.editLayer('main', { edges });
    const before = model.capture();
    const saving = model.save((payload) => {
        started.resolve(payload);
        return write.promise;
    });
    const payload = await started.promise;
    assert.equal(model.saveWriting.value, true);
    assert.deepEqual(payload.layers, before);
    assert.deepEqual(await model.save(assert.fail), saveFailure('saving'));
    assert.equal(model.editLayer('main', { gcps: gcps(5) }), false);
    assert.equal(model.editLayers([{ layerId: 'sub:a', edit: { edges } }]), false);
    assert.equal(model.changeLayerRanks([{ layerId: 'sub:a', priority: 1 }]), false);
    assert.equal(model.addLayer({ buildOptions: options }), undefined);
    assert.equal(model.removeLayer('sub:a'), false);
    assert.equal(model.undo().restored, false);
    assert.equal(model.redo().restored, false);
    assert.equal(model.restoreDraft([layer('main')]).restored, false);
    assert.equal(readPointer(), 1);
    assert.equal(history.length, 2);
    assert.equal(model.editGeneration.value, 1);
    assert.deepEqual(model.capture(), before);

    write.reject(new Error('書き込み失敗'));
    assert.deepEqual(await saving, saveFailure('writeFailed'));
    assert.equal(model.saveWriting.value, false);
    assert.deepEqual(await model.save(() => false), saveFailure('writeFailed'));
    assert.equal(model.editLayer('main', { gcps: gcps(6) }), true);
    assert.deepEqual(await model.save(() => {}), saved);
});

test('値が同じ編集では履歴・世代・揮発状態が変わらない', async () => {
    const { model, history, requests } = fixture();
    await model.requestTin('main');
    const previous = tinState(model);
    const edit = { ...layer('main'), buildOptions: { yaxisMode: 'invert', vertexMode: 'plain', strictMode: 'strict' } };
    assert.equal(model.editLayer('main', edit), false);
    assert.equal(model.editLayer('main', {}), false);
    assert.equal(model.editLayers([]), false);
    assert.equal(history.length, 1);
    assert.equal(model.editGeneration.value, 0);
    assert.equal(tinState(model), previous);
    assert.equal(requests.length, 1);
});

test('履歴アダプターが反映を呼ばなければ採用成功や履歴を返さない', async () => {
    const { model, events } = fixture({
        makeHistory: () => ({
            commit: () => events.push('履歴記録'),
            withoutHistoryAsync: async () => {},
        }),
    });
    const before = model.capture();
    assert.equal((await model.startAdoption('main', selection)).status, 'failed');
    assert.equal(model.adoptionInProgress.value, false);
    assert.equal(model.editGeneration.value, 0);
    assert.deepEqual(model.capture(), before);
    assert.deepEqual(events, []);
});
