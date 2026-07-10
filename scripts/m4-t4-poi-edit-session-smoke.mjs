// Phase 4 Task 4: usePoiEditSession composable smoke (unit, vite lib build)
// POI エディタの編集セッション（明示 commit = 1 Undo 単位、structural sharing、
// UndoStack<PoiEditState> 委譲）を検証する。
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'poi-edit-session-'));
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
        entry: path.join(projectRoot, 'src/composables/usePoiEditSession.ts'),
        formats: ['es'],
        fileName: () => 'usePoiEditSession.mjs',
      },
      // vue は external にせずバンドルする（composable が ref/computed を使うため）
      rollupOptions: { external: [] },
    },
  });

  const mod = await import(pathToFileURL(path.join(outDir, 'usePoiEditSession.mjs')).href);
  const { usePoiEditSession } = mod;
  assert.equal(typeof usePoiEditSession, 'function');

  // --- フィクスチャ --------------------------------------------------------
  // 表示 ID は既存ヘルパ ensureDisplayIds の規則（p1,p2,... の未使用連番）を検証するため
  // "p1"/"p3" を既存として持たせる（新規は p2 になるはず）。
  const makeDetail = () => ({
    slug: 'poi-slug',
    title: { ja: 'タイトル' },
    fc: {
      type: 'FeatureCollection',
      name: { ja: 'レイヤ名' },
      customMeta: { keep: true },
      features: [
        {
          type: 'Feature',
          id: 'p1',
          geometry: { type: 'Point', coordinates: [135, 35] },
          properties: { _maplatUid: 'uid-a', name: { ja: 'A' } },
        },
        {
          type: 'Feature',
          id: 'p3',
          geometry: { type: 'Point', coordinates: [136, 36] },
          properties: { _maplatUid: 'uid-b', name: { ja: 'B' } },
        },
      ],
    },
  });

  const loadSession = () => {
    const session = usePoiEditSession();
    session.load(makeDetail());
    return session;
  };

  // ① load 直後: isDirty=false / canUndo=false / state 構成（layerMeta 分離）
  {
    const session = loadSession();
    assert.equal(session.isDirty.value, false);
    assert.equal(session.canUndo.value, false);
    assert.equal(session.canRedo.value, false);
    const state = session.state.value;
    assert.ok(state, 'state must be loaded');
    assert.equal(state.slug, 'poi-slug');
    assert.deepEqual(state.title, { ja: 'タイトル' });
    assert.equal(state.features.length, 2);
    // fc の features 以外のトップレベルは layerMeta へ（type は再構成側の責務なので含めない）
    assert.deepEqual(state.layerMeta, {
      name: { ja: 'レイヤ名' },
      customMeta: { keep: true },
    });
    assert.equal(session.selectedUid.value, null);
    console.log('  case 1 (load -> clean state + layerMeta split): PASS');
  }

  // ② addFeature: 表示 ID 採番（既存 p1/p3 → 新規は p2、ensureDisplayIds 規則）+ 1 undo で消える
  {
    const session = loadSession();
    const uid = session.addFeature([137, 37]);
    assert.equal(typeof uid, 'string');
    assert.ok(uid.length > 0);
    const state = session.state.value;
    assert.equal(state.features.length, 3);
    const added = state.features[2];
    assert.equal(added.id, 'p2', 'display id must follow ensureDisplayIds numbering');
    assert.equal(added.properties._maplatUid, uid);
    assert.deepEqual(added.geometry, { type: 'Point', coordinates: [137, 37] });
    // 空属性（内部 uid 以外は何も持たない）
    assert.deepEqual(Object.keys(added.properties), ['_maplatUid']);
    assert.equal(session.isDirty.value, true);
    assert.equal(session.canUndo.value, true);
    session.undo(); // 1 commit = 1 undo
    assert.equal(session.state.value.features.length, 2);
    assert.equal(session.isDirty.value, false);
    console.log('  case 2 (addFeature numbering + single undo unit): PASS');
  }

  // ③ patchFeatureProperties 1 回 = 1 undo 単位（undo で旧値へ）
  {
    const session = loadSession();
    session.patchFeatureProperties('uid-a', { name: { ja: 'A2' }, desc: { ja: '説明' } });
    const patched = session.state.value.features.find((f) => f.properties._maplatUid === 'uid-a');
    assert.deepEqual(patched.properties.name, { ja: 'A2' });
    assert.deepEqual(patched.properties.desc, { ja: '説明' });
    assert.equal(session.canUndo.value, true);
    session.undo();
    const reverted = session.state.value.features.find((f) => f.properties._maplatUid === 'uid-a');
    assert.deepEqual(reverted.properties.name, { ja: 'A' });
    assert.equal(reverted.properties.desc, undefined);
    assert.equal(session.canUndo.value, false, 'one patch call must be exactly one undo unit');
    console.log('  case 3 (patchFeatureProperties = one undo unit): PASS');
  }

  // ④ moveFeature / removeFeature 各 1 undo
  {
    const session = loadSession();
    session.moveFeature('uid-b', [140, 40]);
    assert.deepEqual(
      session.state.value.features.find((f) => f.properties._maplatUid === 'uid-b').geometry.coordinates,
      [140, 40],
    );
    session.undo();
    assert.deepEqual(
      session.state.value.features.find((f) => f.properties._maplatUid === 'uid-b').geometry.coordinates,
      [136, 36],
    );
    assert.equal(session.canUndo.value, false, 'one move = one undo unit');

    session.removeFeature('uid-a');
    assert.equal(session.state.value.features.length, 1);
    assert.equal(session.state.value.features[0].properties._maplatUid, 'uid-b');
    session.undo();
    assert.equal(session.state.value.features.length, 2);
    assert.ok(session.state.value.features.some((f) => f.properties._maplatUid === 'uid-a'));
    assert.equal(session.canUndo.value, false, 'one remove = one undo unit');

    // 存在しない uid は commit しない（履歴を汚さない）
    session.moveFeature('uid-missing', [0, 0]);
    session.removeFeature('uid-missing');
    session.patchFeatureProperties('uid-missing', { name: 'x' });
    assert.equal(session.canUndo.value, false, 'unknown uid must not create history entries');
    console.log('  case 4 (moveFeature/removeFeature one undo each + unknown uid no-op): PASS');
  }

  // ⑤ structural sharing: 2 feature 中 1 つを patch → 未変更 feature はオブジェクト同一（===）
  {
    const session = loadSession();
    const before0 = session.state.value.features[0]; // uid-a（未変更側）
    const before1 = session.state.value.features[1]; // uid-b（変更側）
    session.patchFeatureProperties('uid-b', { name: { ja: 'B2' } });
    const after = session.state.value;
    assert.equal(after.features[0], before0, 'unchanged feature must be shared (===) across snapshots');
    assert.notEqual(after.features[1], before1, 'patched feature must be a fresh clone');
    // 旧 snapshot は無傷（clone してから書いている実証）
    assert.deepEqual(before1.properties.name, { ja: 'B' });
    // undo で旧 snapshot のオブジェクトがそのまま戻る
    session.undo();
    assert.equal(session.state.value.features[1], before1);
    assert.equal(session.state.value.features[0], before0);
    console.log('  case 5 (structural sharing across undo snapshots): PASS');
  }

  // ⑥ undo 後に新規 commit → redo 履歴破棄
  {
    const session = loadSession();
    session.patchFeatureProperties('uid-a', { name: { ja: 'A2' } });
    session.undo();
    assert.equal(session.canRedo.value, true);
    session.patchFeatureProperties('uid-b', { name: { ja: 'B2' } });
    assert.equal(session.canRedo.value, false, 'new commit after undo must discard redo history');
    console.log('  case 6 (new commit discards redo history): PASS');
  }

  // ⑦ markSaved 後 isDirty=false。UndoStack.save() の現物セマンティクス（history を
  //   現在 snapshot 1 件へリセット）通り、canUndo/canRedo も false になる
  //   （MapEdit resetHistoryBase と同一挙動）。
  {
    const session = loadSession();
    session.patchFeatureProperties('uid-a', { name: { ja: 'A2' } });
    assert.equal(session.isDirty.value, true);
    session.markSaved();
    assert.equal(session.isDirty.value, false);
    assert.equal(session.canUndo.value, false, 'UndoStack.save() drops history');
    assert.equal(session.canRedo.value, false);
    // 状態は保存時点のまま
    assert.deepEqual(
      session.state.value.features.find((f) => f.properties._maplatUid === 'uid-a').properties.name,
      { ja: 'A2' },
    );
    // markSaved 後も新たな編集で再び dirty になれる
    session.patchFeatureProperties('uid-b', { name: { ja: 'B2' } });
    assert.equal(session.isDirty.value, true);
    assert.equal(session.canUndo.value, true);
    console.log('  case 7 (markSaved resets dirty + history per UndoStack.save()): PASS');
  }

  // ⑧ toSaveFc: layerMeta（name 等 fc トップレベル）を保存し、現在の features を反映
  //   + slug/title も commit 経由で 1 Undo 単位として書き換えられる（仕様 §5）
  {
    const session = loadSession();
    // slug/title 変更 = 各 1 commit（draft の値差し替え。オブジェクトは置換で書く）
    session.commit((draft) => {
      draft.slug = 'renamed-slug';
    });
    session.commit((draft) => {
      draft.title = { ja: '新タイトル', en: 'New title' };
    });
    assert.equal(session.state.value.slug, 'renamed-slug');
    session.undo(); // title 変更を戻す
    assert.deepEqual(session.state.value.title, { ja: 'タイトル' });
    assert.equal(session.state.value.slug, 'renamed-slug', 'slug change is a separate undo unit');
    session.redo();

    session.moveFeature('uid-a', [139, 39]);
    const fc = session.toSaveFc();
    assert.equal(fc.type, 'FeatureCollection');
    assert.deepEqual(fc.name, { ja: 'レイヤ名' }, 'layer metadata must round-trip');
    assert.deepEqual(fc.customMeta, { keep: true }, 'unknown top-level members must round-trip');
    assert.equal(fc.features.length, 2);
    assert.deepEqual(
      fc.features.find((f) => f.properties._maplatUid === 'uid-a').geometry.coordinates,
      [139, 39],
      'toSaveFc must reflect current features',
    );
    console.log('  case 8 (toSaveFc round-trips layerMeta + slug/title commits): PASS');
  }

  // ⑨ MAX_HISTORY(100) 超過: 110 commit 後も破綻せず、isDirty=true、undo が可能な範囲で動く
  {
    const session = loadSession();
    for (let i = 1; i <= 110; i++) {
      session.patchFeatureProperties('uid-a', { counter: i });
    }
    assert.equal(session.isDirty.value, true);
    assert.equal(session.canUndo.value, true);
    assert.equal(
      session.state.value.features.find((f) => f.properties._maplatUid === 'uid-a').properties.counter,
      110,
    );
    let undoCount = 0;
    while (session.canUndo.value) {
      session.undo();
      undoCount += 1;
      assert.ok(undoCount <= 200, 'undo loop must terminate');
    }
    assert.equal(undoCount, 100, 'MAX_HISTORY caps undo depth at 100');
    // 最古の snapshot は commit #10（初期状態と #1〜#9 は drop 済み）
    assert.equal(
      session.state.value.features.find((f) => f.properties._maplatUid === 'uid-a').properties.counter,
      10,
    );
    session.redo();
    assert.equal(
      session.state.value.features.find((f) => f.properties._maplatUid === 'uid-a').properties.counter,
      11,
    );
    console.log('  case 9 (MAX_HISTORY overflow stays consistent): PASS');
  }

  // 補: selectedUid は Undo 対象外だが、選択中 feature が現在 snapshot から消えたら解除される
  {
    const session = loadSession();
    session.selectedUid.value = 'uid-a';
    session.patchFeatureProperties('uid-b', { name: { ja: 'B2' } });
    assert.equal(session.selectedUid.value, 'uid-a', 'unrelated commits keep the selection');
    session.removeFeature('uid-a');
    assert.equal(session.selectedUid.value, null, 'removing the selected feature clears selection');
    session.undo(); // uid-a 復活（選択は Undo 対象外なので null のまま）
    assert.equal(session.selectedUid.value, null);
    session.selectedUid.value = 'uid-a';
    session.redo(); // remove を redo → 再び消えるので解除
    assert.equal(session.selectedUid.value, null, 'redoing a removal clears the selection too');
    console.log('  case 10 (selectedUid outside undo, cleared when feature vanishes): PASS');
  }

  console.log('m4-t4-poi-edit-session smoke: PASS');
} finally {
  await rm(workDir, { recursive: true, force: true });
}
