// nov26-m6-t1 (#117 E3) smoke: 下書きの明示破棄の後に、下書きの記録が書き戻されないこと。
//
// m12-t20 の AC20-3 の間欠失敗の原因（製品の競合）の再発防止。破棄（discard）が envelope を消した後に、
// 編集画面が閉じる前の flush（slug の予約成功で useInitialDraftPersist が呼ぶ・エディタの履歴は dirty の
// まま）が下書きを再び dirty にして put し、unmount の flushSync も envelope を書き戻していた。
// タイミングに依存しないよう、書き戻しの経路（flush / flushSync / 自動保存のタイマー）を直接呼ぶ。
// remove は関門付きの偽 API で止め、破棄の途中に flush を重ねる。
//
// 実行: pnpm smoke:nov26-m6-t1-draft-discard
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'nov26-m6-t1-discard-'));

async function importSource(relativeEntry, fileName) {
  const outDir = path.join(workDir, fileName.replace(/\.mjs$/, ''));
  await build({
    root: projectRoot,
    logLevel: 'error',
    configFile: false,
    build: {
      outDir,
      emptyOutDir: true,
      lib: { entry: path.join(projectRoot, relativeEntry), formats: ['es'], fileName: () => fileName },
    },
  });
  return import(pathToFileURL(path.join(outDir, fileName)).href);
}

// 関門付きの偽 API。remove は gate が開くまで止まる。呼び出しを記録する。
function makeApi() {
  const calls = { put: 0, remove: 0, flushSync: 0 };
  const store = new Map();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const api = {
    async put(draft) { calls.put += 1; store.set(draft.assetUid, draft); },
    async remove(_kind, assetUid) { calls.remove += 1; await gate; store.delete(assetUid); },
    flushSync(draft) { calls.flushSync += 1; store.set(draft.assetUid, draft); return { ok: true }; },
    async get(_kind, assetUid) { return store.get(assetUid) ?? null; },
  };
  return { api, calls, store, release: () => release() };
}

// setTimeout を手で進める（自動保存のタイマーを決定的に発火させる）
function manualTimers() {
  const pending = new Map();
  let seq = 0;
  return {
    setTimeoutFn: (cb) => { const id = ++seq; pending.set(id, cb); return id; },
    clearTimeoutFn: (id) => { pending.delete(id); },
    async runAll() { for (const [id, cb] of [...pending]) { pending.delete(id); await cb(); } },
    get size() { return pending.size; },
  };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

try {
  const { createAssetDraftLifecycleCore } = await importSource(
    'src/composables/assetDraftLifecycleCore.ts', 'core.mjs');

  // [1] 核: 破棄の途中（remove が止まっている間）は破棄済みとして扱い、破棄の後の unmount の flushSync・
  //     自動保存のタイマーで put も flushSync も走らない（flush の forced 経路は [3] で composable を通して見る）
  {
    const { api, calls, store, release } = makeApi();
    const timers = manualTimers();
    const core = createAssetDraftLifecycleCore({ api, setTimeoutFn: timers.setTimeoutFn, clearTimeoutFn: timers.clearTimeoutFn });
    core.open({ kind: 'map', assetUid: 'A', baseRevision: null }, () => ({ title: 'x' }));
    core.schedule(true);
    await core.flush();
    assert.equal(calls.put, 1, '前提: 破棄の前の下書きは put される');
    assert.ok(store.has('A'));

    const discarding = core.discard();
    await tick();
    assert.equal(calls.remove, 1, '前提: 破棄で remove が呼ばれる');
    assert.equal(core.isDiscarded(), true, '破棄の途中は破棄済みとして扱う');
    release();
    await discarding;
    // 破棄の後に、unmount の flushSync と自動保存のタイマーが来る
    core.flushSync();
    await timers.runAll();
    assert.equal(store.has('A'), false, '破棄の後に envelope が書き戻された');
    assert.equal(calls.put, 1, '破棄の後に put が走った');
    assert.equal(calls.flushSync, 0, '破棄の後に flushSync が走った');
    console.log('ok: [1] core: 破棄の後は flushSync・自動保存のタイマーで書き戻さない');
  }

  // [2] 核: 破棄の後の利用者の編集（schedule(true)）では、ふたたび下書きを残す（hot exit の保護を失わない）
  {
    const { api, calls, store, release } = makeApi();
    release();
    const timers = manualTimers();
    const core = createAssetDraftLifecycleCore({ api, setTimeoutFn: timers.setTimeoutFn, clearTimeoutFn: timers.clearTimeoutFn });
    core.open({ kind: 'map', assetUid: 'B', baseRevision: 3 }, () => ({ title: 'y' }));
    core.schedule(true);
    await core.discard();
    assert.equal(store.has('B'), false);
    core.schedule(true); // 破棄の後に利用者が編集した
    assert.equal(core.isDiscarded(), false, '利用者の編集で破棄済みの状態が解ける');
    await timers.runAll();
    assert.equal(store.has('B'), true, '破棄の後の利用者の編集が下書きに残らない');
    assert.equal(calls.put, 1);
    console.log('ok: [2] core: 破棄の後の利用者の編集は下書きに残る');
  }

  // [2b] 核: 新規 asset の破棄（endSession）は、破棄の途中・後に文書の変化（watcher の schedule(true)）が
  //      来ても、unmount の flushSync・自動保存のタイマーで書き戻さない
  {
    const { api, calls, store, release } = makeApi();
    const timers = manualTimers();
    const core = createAssetDraftLifecycleCore({ api, setTimeoutFn: timers.setTimeoutFn, clearTimeoutFn: timers.clearTimeoutFn });
    core.open({ kind: 'map', assetUid: 'D', baseRevision: null }, () => ({ title: 'w' }));
    core.schedule(true);
    await core.flush();
    assert.equal(calls.put, 1);
    const discarding = core.discard({ endSession: true });
    await tick();
    core.schedule(true); // 破棄の途中に非同期の文書の変化
    release();
    await discarding;
    core.schedule(true); // 破棄の後、unmount までの間の文書の変化
    await timers.runAll();
    core.flushSync(); // unmount
    assert.equal(store.has('D'), false, 'endSession の破棄の後に envelope が書き戻された');
    assert.equal(calls.put, 1, 'endSession の破棄の後に put が走った');
    assert.equal(calls.flushSync, 0, 'endSession の破棄の後に flushSync が走った');
    console.log('ok: [2b] core: 新規 asset の破棄（endSession）は以後の文書の変化でも書き戻さない');
  }

  // [3] composable: 破棄の途中に flush()（useInitialDraftPersist が slug の予約成功で呼ぶ経路・
  //     shouldPersist は true のまま）を重ねても、破棄の後に put も flushSync も走らない
  {
    const { api, calls, store, release } = makeApi();
    const listeners = new Map();
    globalThis.window = {
      assetDrafts: api,
      addEventListener: (type, fn) => listeners.set(type, fn),
      removeEventListener: (type) => listeners.delete(type),
    };
    const origWarn = console.warn;
    console.warn = () => undefined; // onMounted 等をコンポーネントの外で呼ぶ警告を黙らせる
    let mod;
    try {
      mod = await importSource('src/composables/useAssetDraftLifecycle.ts', 'composable.mjs');
    } finally {
      console.warn = origWarn;
    }
    console.warn = () => undefined;
    try {
      const lifecycle = mod.useAssetDraftLifecycle({
        kind: 'map',
        serialize: () => ({ title: 'z' }),
        apply: () => undefined,
        shouldPersist: () => true, // エディタの履歴は dirty のまま
      });
      await api.put({ schemaVersion: 1, kind: 'map', assetUid: 'C', baseRevision: null, updatedAt: new Date().toISOString(), payload: { title: 'z' } });
      calls.put = 0;
      await lifecycle.open('C', null);
      assert.equal(lifecycle.draftRestored.value, true, '前提: 下書きが復元される');

      const discarding = lifecycle.discard();
      await tick();
      assert.equal(calls.remove, 1, '前提: 破棄で remove が呼ばれる');
      const flushing = lifecycle.flush(); // slug の予約成功 → flushDraft
      release();
      await discarding;
      await flushing;
      lifecycle.flushSync(); // unmount の flushSync
      assert.equal(store.has('C'), false, '破棄の途中の flush で envelope が書き戻された');
      assert.equal(calls.put, 0, '破棄の途中の flush で put が走った');
      assert.equal(calls.flushSync, 0, '破棄の後に flushSync が走った');
    } finally {
      console.warn = origWarn;
      delete globalThis.window;
    }
    console.log('ok: [3] composable: 破棄の途中の flush（slug 予約成功の経路）でも書き戻さない');
  }

  console.log('nov26-m6-t1 draft discard smoke: ALL PASS');
} finally {
  await rm(workDir, { recursive: true, force: true });
}
