// Phase 4 Task 1: useRevisionedAssetSave composable smoke (unit, vite lib build)
// maps/apps/poi_sources 共通の revision 楽観ロック保存フロー（conflict → 読み直す/上書き）を
// fake send / fake window.dialog.showMessageBox で検証する。
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'revisioned-save-'));
const outDir = path.join(workDir, 'dist');

try {
  await build({
    root: projectRoot,
    logLevel: 'error',
    configFile: false,
    build: {
      outDir,
      emptyOutDir: true,
      lib: {
        entry: path.join(projectRoot, 'src/composables/useRevisionedAssetSave.ts'),
        formats: ['es'],
        fileName: () => 'useRevisionedAssetSave.mjs',
      },
      // vue は external にせずバンドルする（composable が ref を使うため）
      rollupOptions: { external: [] },
    },
  });

  const mod = await import(pathToFileURL(path.join(outDir, 'useRevisionedAssetSave.mjs')).href);
  const { useRevisionedAssetSave } = mod;
  assert.equal(typeof useRevisionedAssetSave, 'function');

  // --- テストハーネス ---------------------------------------------------
  // sendResults: send() が順に返す値の配列（尽きたら null）
  // dialogResponses: showMessageBox が順に返す response の配列
  const createHarness = ({ sendResults = [], dialogResponses = [], dirty = false, sendImpl } = {}) => {
    const calls = { send: [], applySuccess: [], onFailure: [], reload: 0, dialogs: [] };
    const responses = [...dialogResponses];
    globalThis.window = {
      dialog: {
        showMessageBox: async (opts) => {
          calls.dialogs.push(opts);
          assert.ok(responses.length > 0, 'unexpected extra showMessageBox call');
          return { response: responses.shift() };
        },
      },
    };
    const results = [...sendResults];
    const handle = useRevisionedAssetSave({
      send:
        sendImpl ??
        (async (ctx) => {
          calls.send.push({ ...ctx });
          return results.length > 0 ? results.shift() : null;
        }),
      applySuccess: (r) => {
        calls.applySuccess.push(r);
      },
      reloadFromStore: async () => {
        calls.reload += 1;
      },
      isDirty: () => dirty,
      onFailure: (r) => {
        calls.onFailure.push({
          result: r,
          // ⑥用: onFailure 呼出「時点」の handle 状態を記録する
          snapshot: { uid: handle.uid.value, revision: handle.revision.value, slug: handle.confirmedSlug.value },
        });
      },
      messages: {
        conflict: 'CONFLICT_MSG',
        discard: 'DISCARD_MSG',
        reload: 'RELOAD_BTN',
        overwrite: 'OVERWRITE_BTN',
      },
    });
    return { handle, calls };
  };

  // ① Success: uid/revision/confirmedSlug が更新され applySuccess が呼ばれる
  {
    const { handle, calls } = createHarness({
      sendResults: [{ result: 'Success', uid: 'uid-1', slug: 'slug-1', revision: 3 }],
    });
    // adoptLoaded で読込状態を取り込み、performSave（省略時）は revision.value を expectedRevision に使う
    handle.adoptLoaded({ uid: 'uid-0', slug: 'slug-0', revision: 2 });
    assert.equal(handle.uid.value, 'uid-0');
    assert.equal(handle.revision.value, 2);
    assert.equal(handle.confirmedSlug.value, 'slug-0');
    await handle.performSave();
    assert.equal(calls.send.length, 1);
    assert.deepEqual(calls.send[0], { uid: 'uid-0', expectedRevision: 2 });
    assert.equal(handle.uid.value, 'uid-1');
    assert.equal(handle.revision.value, 3);
    assert.equal(handle.confirmedSlug.value, 'slug-1');
    assert.equal(calls.applySuccess.length, 1);
    assert.equal(calls.applySuccess[0].result, 'Success');
    assert.equal(calls.onFailure.length, 0);
    assert.equal(calls.dialogs.length, 0);
    assert.equal(handle.saving.value, false);
    console.log('  case 1 (Success updates handle + applySuccess): PASS');
  }

  // ①b 新規作成（adoptLoaded なし）は uid/expectedRevision とも undefined で送る
  {
    const { handle, calls } = createHarness({
      sendResults: [{ result: 'Success', uid: 'uid-new', slug: 'slug-new', revision: 1 }],
    });
    await handle.performSave();
    assert.deepEqual(calls.send[0], { uid: undefined, expectedRevision: undefined });
    assert.equal(handle.uid.value, 'uid-new');
    console.log('  case 1b (create without adoptLoaded): PASS');
  }

  // ② Exist / Invalid / ReadOnly / Error はそれぞれ onFailure に渡る
  {
    const failures = [
      { result: 'Exist' },
      { result: 'Invalid', issues: [{ path: 'fc', message: 'bad' }] },
      { result: 'ReadOnly' },
      { result: 'Error', code: 'EIO', message: 'disk failed' },
    ];
    for (const failure of failures) {
      const { handle, calls } = createHarness({ sendResults: [failure] });
      handle.adoptLoaded({ uid: 'uid-0', slug: 'slug-0', revision: 4 });
      await handle.performSave();
      assert.equal(calls.applySuccess.length, 0, `${failure.result}: applySuccess must not be called`);
      assert.equal(calls.onFailure.length, 1, `${failure.result}: onFailure must be called once`);
      assert.deepEqual(calls.onFailure[0].result, failure);
      // revision 拡張のない失敗では handle は変化しない
      assert.equal(handle.uid.value, 'uid-0');
      assert.equal(handle.revision.value, 4);
      assert.equal(handle.confirmedSlug.value, 'slug-0');
      assert.equal(handle.saving.value, false);
    }
    console.log('  case 2 (Exist/Invalid/ReadOnly/Error -> onFailure): PASS');
  }

  // ③ conflict → 上書き(response:1) → expectedRevision:undefined で再送 → Success 処理
  {
    const { handle, calls } = createHarness({
      sendResults: [
        { error: 'revision-conflict', current: 7 },
        { result: 'Success', uid: 'uid-1', slug: 'slug-1', revision: 8 },
      ],
      dialogResponses: [1],
    });
    handle.adoptLoaded({ uid: 'uid-1', slug: 'slug-1', revision: 5 });
    await handle.performSave();
    assert.equal(calls.dialogs.length, 1);
    assert.equal(calls.dialogs[0].message, 'CONFLICT_MSG');
    assert.equal(calls.dialogs[0].type, 'info');
    assert.equal(calls.dialogs[0].cancelId, 0);
    assert.deepEqual(calls.dialogs[0].buttons, ['RELOAD_BTN', 'OVERWRITE_BTN']);
    assert.equal(calls.send.length, 2);
    assert.equal(calls.send[0].expectedRevision, 5);
    assert.equal(calls.send[1].expectedRevision, undefined, 'overwrite must resend without expectedRevision');
    assert.equal(handle.revision.value, 8);
    assert.equal(calls.applySuccess.length, 1);
    assert.equal(handle.saving.value, false);
    console.log('  case 3 (conflict -> overwrite resend -> Success): PASS');
  }

  // ④ conflict → 読み直す(response:0) + dirty → discard 確認 OK(response:0) → reloadFromStore
  {
    const { handle, calls } = createHarness({
      sendResults: [{ error: 'revision-conflict', current: 7 }],
      dialogResponses: [0, 0],
      dirty: true,
    });
    handle.adoptLoaded({ uid: 'uid-1', slug: 'slug-1', revision: 5 });
    await handle.performSave();
    assert.equal(calls.send.length, 1, 'reload path must not resend');
    assert.equal(calls.dialogs.length, 2);
    assert.equal(calls.dialogs[1].message, 'DISCARD_MSG');
    assert.equal(calls.dialogs[1].cancelId, 1);
    assert.deepEqual(calls.dialogs[1].buttons, ['OK', 'Cancel']);
    assert.equal(calls.reload, 1);
    assert.equal(calls.applySuccess.length, 0);
    assert.equal(calls.onFailure.length, 0);
    assert.equal(handle.saving.value, false);
    console.log('  case 4 (conflict -> reload + dirty -> discard OK -> reloadFromStore): PASS');
  }

  // ④b conflict → 読み直す + not dirty → discard 確認なしで即 reloadFromStore
  {
    const { handle, calls } = createHarness({
      sendResults: [{ error: 'revision-conflict', current: 7 }],
      dialogResponses: [0],
      dirty: false,
    });
    handle.adoptLoaded({ uid: 'uid-1', slug: 'slug-1', revision: 5 });
    await handle.performSave();
    assert.equal(calls.dialogs.length, 1, 'clean state must skip the discard confirmation');
    assert.equal(calls.reload, 1);
    console.log('  case 4b (conflict -> reload + clean -> no discard dialog): PASS');
  }

  // ⑤ discard 確認 Cancel(response:1) → reloadFromStore は呼ばれない
  {
    const { handle, calls } = createHarness({
      sendResults: [{ error: 'revision-conflict', current: 7 }],
      dialogResponses: [0, 1],
      dirty: true,
    });
    handle.adoptLoaded({ uid: 'uid-1', slug: 'slug-1', revision: 5 });
    await handle.performSave();
    assert.equal(calls.reload, 0, 'discard cancel must not reload');
    assert.equal(calls.send.length, 1);
    assert.equal(calls.applySuccess.length, 0);
    assert.equal(calls.onFailure.length, 0);
    assert.equal(handle.saving.value, false);
    console.log('  case 5 (discard cancel -> no reload): PASS');
  }

  // ⑥ Error に revision:5/uid/slug が載る部分成功 → handle へ取り込まれた「後で」onFailure に渡る
  {
    const { handle, calls } = createHarness({
      sendResults: [{ result: 'Error', message: 'file op failed after commit', revision: 5, uid: 'uid-9', slug: 'slug-9' }],
    });
    handle.adoptLoaded({ uid: 'uid-0', slug: 'slug-0', revision: 4 });
    await handle.performSave();
    assert.equal(calls.onFailure.length, 1);
    assert.equal(calls.onFailure[0].result.result, 'Error');
    // onFailure 呼出時点で既に取り込み済みであること（次リトライへの引き継ぎ、MapEdit:2549-2553 移植）
    assert.deepEqual(calls.onFailure[0].snapshot, { uid: 'uid-9', revision: 5, slug: 'slug-9' });
    assert.equal(handle.uid.value, 'uid-9');
    assert.equal(handle.revision.value, 5);
    assert.equal(handle.confirmedSlug.value, 'slug-9');
    console.log('  case 6 (partial-success Error adopted before onFailure): PASS');
  }

  // ⑦ saving 中の再入は no-op（send は 1 回しか呼ばれない）
  {
    let resolveSend;
    const sendCalls = [];
    const { handle, calls } = createHarness({
      sendImpl: (ctx) => {
        sendCalls.push({ ...ctx });
        return new Promise((resolve) => {
          resolveSend = resolve;
        });
      },
    });
    handle.adoptLoaded({ uid: 'uid-1', slug: 'slug-1', revision: 5 });
    const first = handle.performSave();
    assert.equal(handle.saving.value, true, 'saving must be raised synchronously');
    const second = handle.performSave(); // 再入: no-op であること
    await second;
    assert.equal(sendCalls.length, 1, 're-entrant performSave must not send again');
    resolveSend({ result: 'Success', uid: 'uid-1', slug: 'slug-1', revision: 6 });
    await first;
    assert.equal(sendCalls.length, 1);
    assert.equal(calls.applySuccess.length, 1);
    assert.equal(handle.saving.value, false);
    console.log('  case 7 (re-entry while saving is no-op): PASS');
  }

  // ⑧ send が null を返したら安全に終了（saving は false へ、例外にしない）
  {
    const { handle, calls } = createHarness({ sendResults: [null] });
    handle.adoptLoaded({ uid: 'uid-1', slug: 'slug-1', revision: 5 });
    await handle.performSave(); // 例外にならないこと
    assert.equal(handle.saving.value, false, 'saving must be restored after null result');
    assert.equal(calls.applySuccess.length, 0);
    assert.equal(calls.onFailure.length, 0);
    assert.equal(calls.reload, 0);
    assert.equal(calls.dialogs.length, 0);
    // null 終了後も再度保存できる（saving が戻っている実証）
    console.log('  case 8 (null send result terminates safely): PASS');
  }

  // 補: performSave({expectedRevision: undefined}) の明示指定（MapEdit の copy 保存）は
  // handle.revision があっても expectedRevision:undefined で送る
  {
    const { handle, calls } = createHarness({
      sendResults: [{ result: 'Success', uid: 'uid-2', slug: 'slug-2', revision: 1 }],
    });
    handle.adoptLoaded({ uid: 'uid-1', slug: 'slug-1', revision: 5 });
    await handle.performSave({ expectedRevision: undefined });
    assert.equal(calls.send[0].expectedRevision, undefined);
    console.log('  case 9 (explicit expectedRevision:undefined wins over handle.revision): PASS');
  }

  console.log('m4-t1-revisioned-save smoke: PASS');
} finally {
  delete globalThis.window;
  await rm(workDir, { recursive: true, force: true });
}
