// m1-t6-hotfix-1: useHistorySuppression composable smoke (unit, vite lib build)
// 設計 docs/superpowers/specs/2026-08-01-m1-t6-hotfix-1-mapedit-history-derived-write-design.md v1.9
// AC2 (a)-(h) を検証する。方式は scripts/m4-t4-poi-edit-session-smoke.mjs と同一
// （vite の build() を lib モードで呼び .mjs を出力 → import → node:assert）。
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'history-suppression-'));
const outDir = path.join(workDir, 'dist');

// setTimeout(0) の発火（マクロタスク）まで待つ。マイクロタスクもここで flush される
const macrotask = () => new Promise((resolve) => setTimeout(resolve, 0));
// マイクロタスクだけを flush する。同期スコープの解除（nextTick）はここで走るが、
// スナップショットタイマー（setTimeout(0)）はまだ発火しない
const microtask = async () => { await Promise.resolve(); await Promise.resolve(); };

try {
  await build({
    root: projectRoot,
    logLevel: 'error',
    configFile: false,
    build: {
      outDir,
      emptyOutDir: true,
      lib: {
        entry: path.join(projectRoot, 'src/composables/useHistorySuppression.ts'),
        formats: ['es'],
        fileName: () => 'useHistorySuppression.mjs',
      },
      // vue は external にせずバンドルする（composable が ref/nextTick を使うため）
      rollupOptions: { external: [] },
    },
  });

  const mod = await import(pathToFileURL(path.join(outDir, 'useHistorySuppression.mjs')).href);
  const { useHistorySuppression, mergeOrigin } = mod;
  assert.equal(typeof useHistorySuppression, 'function');
  assert.equal(typeof mergeOrigin, 'function', 'mergeOrigin は純粋関数として単体 export される');

  // ===== AC2(d): mergeOrigin（純粋関数） =====
  {
    assert.deepEqual(mergeOrigin(null, ['W2']), ['W2'], 'prev=null なら next をそのまま返す');
    assert.deepEqual(mergeOrigin(['W2'], ['(none)']), ['W2', '(none)'], 'W 由来と非スコープ書き込みの混在を失わない');
    assert.deepEqual(mergeOrigin(['W2'], ['W2']), ['W2'], '重複を作らない');
    assert.deepEqual(mergeOrigin(['W2', 'W1'], ['W3', 'W1']), ['W2', 'W1', 'W3'], '順序を保った和集合');
    assert.deepEqual(mergeOrigin([], ['W1']), ['W1']);
    const prev = ['W2'];
    mergeOrigin(prev, ['W1']);
    assert.deepEqual(prev, ['W2'], '引数を破壊しない');
    console.log('  AC2(d) mergeOrigin: PASS');
  }

  // ===== AC2(c): snapshotScope =====
  {
    const h = useHistorySuppression();
    assert.deepEqual(h.snapshotScope(), ['(none)'], 'スコープ外は (none)');
    h.withoutHistory('W2', () => {
      assert.deepEqual(h.snapshotScope(), ['W2']);
      h.withoutHistory('W1', () => {
        assert.deepEqual(h.snapshotScope(), ['W2', 'W1'], 'ネストは外側→内側の順で全タグ');
      });
    });
    console.log('  AC2(c) snapshotScope: PASS');
  }

  // ===== AC2(a): 無効化タグもタグスタックに積まれる / W1 は無効化できない =====
  {
    const h = useHistorySuppression({ disabledTags: ['W2', 'W1'] });
    assert.equal(h.isScopeEnabled('W2'), false, 'disabledTags で W2 は無効');
    assert.equal(h.isScopeEnabled('W1'), true, 'W1 は常時 ON（disabledTags に含まれても無視）');
    h.withoutHistory('W2', () => {
      assert.deepEqual(h.snapshotScope(), ['W2'], '無効タグでもタグスタックには積まれる');
      assert.equal(h.suppressed.value, false, '無効タグは実効抑止を起こさない');
    });
    h.withoutHistory('W1', () => {
      assert.equal(h.suppressed.value, true, 'W1 は常に実効抑止する');
    });
    console.log('  AC2(a) disabledTags とタグスタック: PASS');
  }

  // ===== AC2(b): 同期版は nextTick まで抑止が続く =====
  {
    const h = useHistorySuppression();
    h.withoutHistory('W2', () => {});
    assert.equal(h.suppressed.value, true, '同期版から返った直後（nextTick 前）は抑止が継続する');
    await macrotask();
    assert.equal(h.suppressed.value, false, 'nextTick 後は解除されている');
    console.log('  AC2(b) 同期版の解除タイミング: PASS');
  }

  // ===== 例外時も深度が戻る（§5.2 要件6） =====
  {
    const h = useHistorySuppression();
    assert.throws(() => h.withoutHistory('W2', () => { throw new Error('boom'); }), /boom/);
    await macrotask();
    assert.equal(h.suppressed.value, false, 'fn が投げても深度は復元される');
    assert.deepEqual(h.snapshotScope(), ['(none)']);
    console.log('  §5.2 要件6 例外時の深度復元: PASS');
  }

  // ===== AC2(e): タイマー単位 provenance =====
  {
    // 合成: W2 スコープ内で1回・スコープ外で1回 → 1回だけ発火し ['W2','(none)']
    const h = useHistorySuppression({ disabledTags: ['W2'] }); // 抑止せずタグだけ載せる
    const got = [];
    h.withoutHistory('W2', () => { h.scheduleWithOrigin((o) => got.push(o)); });
    // 同期スコープの解除は nextTick（マイクロタスク）。タイマー（マクロタスク）はまだ発火しない
    await microtask();
    assert.deepEqual(h.snapshotScope(), ['(none)'], 'スコープは解除済み・タイマーは未発火');
    h.scheduleWithOrigin((o) => got.push(o));
    assert.equal(h.hasPendingSnapshot(), true, '発火前は保留がある');
    await macrotask();
    assert.equal(got.length, 1, 'デバウンスされ発火は1回だけ');
    assert.deepEqual(got[0], ['W2', '(none)'], '再スケジュールで前の origin が消えず合成される');
    assert.equal(h.hasPendingSnapshot(), false, 'take-and-clear 後は保留なし');

    // 次の窓は前回 origin を引き継がない
    got.length = 0;
    h.scheduleWithOrigin((o) => got.push(o));
    await macrotask();
    assert.deepEqual(got[0], ['(none)'], '前回の origin を引き継がない');

    // 終端廃棄
    h.scheduleWithOrigin(() => { throw new Error('発火してはならない'); });
    const discarded = h.cancelPendingSnapshot();
    assert.deepEqual(discarded, ['(none)'], 'cancelPendingSnapshot が保留 origin を返す');
    assert.equal(h.hasPendingSnapshot(), false, '同時にタイマーも消える');
    await macrotask(); // 発火しないこと

    // 抑止中は fn を呼ばずタイマーと origin を終端廃棄
    const h2 = useHistorySuppression();
    h2.scheduleWithOrigin(() => { throw new Error('発火してはならない'); });
    h2.withoutHistory('W1', () => { h2.scheduleWithOrigin(() => { throw new Error('発火してはならない'); }); });
    assert.equal(h2.hasPendingSnapshot(), false, '抑止中の schedule は保留を終端廃棄する');
    await macrotask();
    console.log('  AC2(e) タイマー単位 provenance: PASS');
  }

  // ===== AC2(f): C7（進入直前フラッシュ） =====
  {
    const calls = [];
    let suppressedAtFlush = null;
    let pendingAtFlush;
    const h = useHistorySuppression({
      onBeforeFirstScope: () => {
        suppressedAtFlush = h.suppressed.value;
        pendingAtFlush = h.cancelPendingSnapshot();
        calls.push('flush');
      },
    });
    h.scheduleWithOrigin(() => { throw new Error('発火してはならない'); });
    h.withoutHistory('W1', () => {
      assert.equal(h.suppressed.value, true, 'コールバック実行後にスコープが push される');
      h.withoutHistory('W1', () => {}); // ネスト
    });
    assert.equal(calls.length, 1, 'ネストでもコールバックは1回だけ');
    assert.equal(suppressedAtFlush, false, 'INV-5: 呼び出し時点で suppressed === false');
    assert.deepEqual(pendingAtFlush, ['(none)'], '保留 origin を受け取れる');
    await macrotask();

    // 保留が無いときも呼ばれるが、cancelPendingSnapshot は null を返す
    calls.length = 0;
    h.withoutHistory('W1', () => {});
    assert.equal(calls.length, 1);
    assert.equal(pendingAtFlush, null, '保留が無ければ null（呼び出し側が recordHistorySnapshot を呼ばない判断材料）');
    await macrotask();

    // 無効化されたタグでは有効深度が上がらないため発火しない
    calls.length = 0;
    const h3 = useHistorySuppression({
      disabledTags: ['W2'],
      onBeforeFirstScope: () => calls.push('flush'),
    });
    h3.withoutHistory('W2', () => {});
    assert.equal(calls.length, 0, '無効タグでは C7 が発火しない');
    await macrotask();

    // コールバックが投げてもスコープ進入・離脱が完了する
    const h4 = useHistorySuppression({ onBeforeFirstScope: () => { throw new Error('flush boom'); } });
    let ran = false;
    h4.withoutHistory('W1', () => { ran = true; });
    assert.equal(ran, true, 'C7 が投げてもスコープ内処理は実行される');
    await macrotask();
    assert.equal(h4.suppressed.value, false, '深度が 0 に戻る');
    assert.equal(h4.diagnosticErrorCount(), 0, 'onDiagnostic 未指定なら hook 例外は発生しない');
    console.log('  AC2(f) C7 進入直前フラッシュ: PASS');
  }

  // ===== AC2(g): 診断報告経路 =====
  {
    const events = [];
    const h = useHistorySuppression({ onDiagnostic: (e) => events.push(e) });

    // schedule 報告（合成後 origin）
    h.scheduleWithOrigin(() => {});
    const sched = events.filter((e) => e.type === 'schedule');
    assert.equal(sched.length, 1);
    assert.deepEqual(sched[0].origin, ['(none)'], 'schedule は合成後の origin を報告する');
    await macrotask();

    // discard-suppressed（take が報告より先）
    events.length = 0;
    h.scheduleWithOrigin(() => { throw new Error('発火してはならない'); });
    h.withoutHistory('W1', () => { h.scheduleWithOrigin(() => { throw new Error('発火してはならない'); }); });
    const discard = events.filter((e) => e.type === 'discard-suppressed');
    assert.equal(discard.length, 1, 'discard-suppressed をちょうど1回受け取る');
    assert.deepEqual(discard[0].origin, ['(none)'], 'take 済みの origin が渡る');
    assert.ok(discard[0].scopeStack.includes('W1'), 'どのスコープが抑止したかが判る');
    assert.equal(h.hasPendingSnapshot(), false, '報告の直後に保留は無い（take が先）');
    await macrotask();

    // flush-error
    events.length = 0;
    const h2 = useHistorySuppression({
      onBeforeFirstScope: () => { throw new Error('flush boom'); },
      onDiagnostic: (e) => events.push(e),
    });
    h2.withoutHistory('W1', () => {});
    const fe = events.filter((e) => e.type === 'flush-error');
    assert.equal(fe.length, 1, 'flush-error をちょうど1回受け取る');
    assert.match(String(fe[0].error?.message ?? fe[0].error), /flush boom/);
    await macrotask();
    assert.equal(h2.suppressed.value, false);

    // INV-6 の外形保証: onDiagnostic 未指定でも例外なく動作する
    const h3 = useHistorySuppression();
    h3.scheduleWithOrigin(() => {});
    await macrotask();
    assert.equal(h3.diagnosticErrorCount(), 0);
    console.log('  AC2(g) 診断報告経路: PASS');
  }

  // ===== AC2(h): onDiagnostic の非中断契約（§5.6.6a・INV-7） =====
  {
    const thrower = () => { throw new Error('hook boom'); };

    // (h)1 抑止中に hook が throw しても送出せず、fn も呼ばれず、origin は復元されない
    const h = useHistorySuppression({ onDiagnostic: thrower });
    h.withoutHistory('W1', () => {
      h.scheduleWithOrigin(() => { throw new Error('発火してはならない'); });
    });
    assert.equal(h.hasPendingSnapshot(), false, '報告失敗でも origin は復元されない');
    await macrotask();

    // (h)2 C7 が throw し、flush-error を受けた hook も throw してもスコープが完了する
    const h2 = useHistorySuppression({
      onBeforeFirstScope: () => { throw new Error('flush boom'); },
      onDiagnostic: thrower,
    });
    let ran = false;
    h2.withoutHistory('W1', () => { ran = true; });
    assert.equal(ran, true, 'hook が throw してもスコープ内処理へ進む');
    await macrotask();
    assert.equal(h2.suppressed.value, false, '深度が 0 に戻る');

    // (h)3 diagnosticErrorCount が増える
    assert.ok(h.diagnosticErrorCount() >= 1, 'C4 経路の hook 例外が計上される');
    assert.ok(h2.diagnosticErrorCount() >= 1, 'C7 経路の hook 例外が計上される');

    // (h)4 throw を受けた当の呼び出し自身が完了する（非抑止 schedule）
    const h3 = useHistorySuppression({ onDiagnostic: thrower });
    const got = [];
    h3.scheduleWithOrigin((o) => got.push(o));
    assert.equal(h3.hasPendingSnapshot(), true, 'schedule 報告で throw してもタイマーは張られる');
    await macrotask();
    assert.deepEqual(got[0], ['(none)'], '発火時に正しい origin が届く');
    assert.ok(h3.diagnosticErrorCount() >= 1);
    // 以降の別呼び出しも正常
    got.length = 0;
    h3.scheduleWithOrigin((o) => got.push(o));
    await macrotask();
    assert.deepEqual(got[0], ['(none)'], 'hook 例外後も状態は壊れていない');
    console.log('  AC2(h) onDiagnostic 非中断契約: PASS');
  }

  // ===== withoutHistoryAsync =====
  {
    const h = useHistorySuppression();
    let inside = null;
    await h.withoutHistoryAsync('W1', async () => {
      await Promise.resolve();
      inside = h.suppressed.value;
    });
    assert.equal(inside, true, 'await を跨いでも抑止が続く');
    assert.equal(h.suppressed.value, false, 'await 完了 + nextTick 後に解除される');

    await assert.rejects(
      () => h.withoutHistoryAsync('W1', async () => { throw new Error('async boom'); }),
      /async boom/,
    );
    assert.equal(h.suppressed.value, false, '非同期版でも例外時に深度が復元される');
    console.log('  withoutHistoryAsync: PASS');
  }

  console.log('m1-t6-hotfix-1-history-suppression smoke: PASS');
} finally {
  await rm(workDir, { recursive: true, force: true });
}
