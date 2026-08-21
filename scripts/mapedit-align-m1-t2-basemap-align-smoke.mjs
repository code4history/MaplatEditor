// m1-t2「ベースマップ位置合わせモードの新設」の unit + ソーステキスト検査。
// 設計: docs/superpowers/specs/2026-08-21-m1-t2-basemap-align-mode-task-design.md v1.0
//
// 担当 AC:
//   AC14 computeMercatorShift が shift = P_groundTruth − P_reference（C-2）である
//   AC15 符号の unit 固定: 正の X は東・正の Y は北（両符号を両方向で固定）
//   AC21(b) applyShiftOverwrite の 2 回適用が「置換」であり加算でない（C-2 の上書き意味論）
//   AC4  保持値が編集環境ストア（map_base_map_shift）以外へ書かれないことの静的確認:
//        BaseMapEditDocument / 保存経路 / MapEditHistoryState のいずれにも当該フィールドが増えていない
//        （2026-08-21 m1-t4 改訂: HR-6 が HR-4.3 の「非永続」を明示的に逆転させたため表題を改めた。
//          個別 assert は C-3 v1.2 でも全部真のため原則維持 = m1-t4 設計 §7 結果表 #2 / outer rule-0015）
//   AC16 シフト適用が単一実装（C-4）: source.mercatorXShift への代入が
//        applyBaseMapShifts の中だけ・呼び出し 3 箇所以上
//   AC6(c) 系（設計レビュー MIN-3 の処方）: setupBaseMaps 末尾で setSwitchableBaseMaps を
//        相に応じて呼び直している（P1/P2 中の再構築で切替禁止が解けない）
//   AC18 新規 i18n キー 9 件が全 11 言語に実在・空値なし・末尾改行保持・
//        mercator_x/y_shift の訳が appedit.* と同一文言
//   AC22 package.json への結線（outer rule-0012）
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const read = (rel) => readFile(path.join(projectRoot, rel), 'utf8');
const countOf = (haystack, needle) => haystack.split(needle).length - 1;

const LANGS = ['de', 'en', 'es', 'fr', 'id', 'ja', 'ko', 'th', 'vi', 'zh', 'zh-TW'];
const NEW_KEYS = [
  'edit_basemap_align',
  'mercator_x_shift',
  'mercator_y_shift',
  'basemap_align_start',
  'basemap_align_reference_done',
  'basemap_align_ground_truth_done',
  'basemap_align_osm_target_disabled',
  'context_select_reference_point',
  'context_select_ground_truth',
];

// vite lib build で src/utils/basemapAlign.ts を .mjs 化して import する（m6-t10 と同型）。
// 生成物は scratch 配下に残置する（破壊的操作 gate: 一時領域は消さない）
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'mapedit-align-m1-t2-'));
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
        entry: path.join(projectRoot, 'src/utils/basemapAlign.ts'),
        formats: ['es'],
        fileName: () => 'basemapAlign.mjs',
      },
      rollupOptions: { external: [] },
    },
  });
  const mod = await import(pathToFileURL(path.join(outDir, 'basemapAlign.mjs')).href);
  const { computeMercatorShift, applyShiftOverwrite, effectiveShiftOf } = mod;
  assert.equal(typeof computeMercatorShift, 'function', 'computeMercatorShift が export されていない');
  assert.equal(typeof applyShiftOverwrite, 'function', 'applyShiftOverwrite が export されていない');
  assert.equal(typeof effectiveShiftOf, 'function', 'effectiveShiftOf が export されていない');

  // ---------------------------------------------------------------- [1/7]
  // AC14 / AC15: shift = P_groundTruth − P_reference（C-2）。両符号を両方向で固定する。
  // 基準点より GT が東（+X）・北（+Y）→ 画像を東・北へ動かす正のシフト
  {
    const s1 = computeMercatorShift([100, 200], [130, 260]);
    assert.equal(s1.x, 30, 'AC14: GT が東にあるとき x = GT.x − ref.x（正）でない');
    assert.equal(s1.y, 60, 'AC14: GT が北にあるとき y = GT.y − ref.y（正）でない');
    const s2 = computeMercatorShift([15551351.4, 4259837.2], [15551251.4, 4259937.2]);
    assert.equal(s2.x, -100, 'AC15: GT が西にあるとき x が負にならない');
    assert.equal(s2.y, 100, 'AC15: GT が北にあるとき y が正にならない');
    const s3 = computeMercatorShift([0, 0], [0, 0]);
    assert.deepEqual({ x: s3.x, y: s3.y }, { x: 0, y: 0 }, 'AC14: 同一点で 0 にならない');
  }
  console.log('[1/7] AC14/AC15: computeMercatorShift の式と両符号 OK');

  // ---------------------------------------------------------------- [2/7]
  // AC21(b): applyShiftOverwrite の 2 回適用は置換（= であり += でない）。入力を破壊しない
  {
    const r0 = {};
    const r1 = applyShiftOverwrite(r0, 'mapA', { x: 10, y: -20 });
    assert.deepEqual(r1.mapA, { x: 10, y: -20 }, 'AC21: 1 回目の適用が保持されない');
    const r2 = applyShiftOverwrite(r1, 'mapA', { x: 3, y: 4 });
    assert.deepEqual(r2.mapA, { x: 3, y: 4 }, 'AC21(b): 2 回目が置換でなく別値になった');
    assert.notEqual(r2.mapA.x, 13, 'AC21(b): 2 回目が加算になっている');
    assert.deepEqual(r0, {}, 'applyShiftOverwrite が入力を破壊した（immutable でない）');
    assert.deepEqual(r1.mapA, { x: 10, y: -20 }, 'applyShiftOverwrite が前版を破壊した');
    const r3 = applyShiftOverwrite(r2, 'mapB', { x: 1, y: 2 });
    assert.deepEqual(r3.mapA, { x: 3, y: 4 }, '別 mapID への適用が他エントリを壊した');
  }
  console.log('[2/7] AC21(b): applyShiftOverwrite の置換意味論 OK');

  // ---------------------------------------------------------------- [3/7]
  // §5.1 / §5.3: effectiveShiftOf — P1/P2 では対象だけ 0、他は保持値。P0 は保持値
  {
    const shifts = { mapA: { x: 5, y: 6 }, mapB: { x: 7, y: 8 } };
    assert.deepEqual(effectiveShiftOf(shifts, 'mapA', 'P0', null), { x: 5, y: 6 }, 'P0 で保持値が出ない');
    assert.deepEqual(effectiveShiftOf(shifts, 'mapA', 'P1', 'mapA'), { x: 0, y: 0 }, 'P1 の対象が 0 でない（HR-4.6(e)）');
    assert.deepEqual(effectiveShiftOf(shifts, 'mapB', 'P1', 'mapA'), { x: 7, y: 8 }, 'P1 の非対象が保持値でない（HR-4.7(d) の前提）');
    assert.deepEqual(effectiveShiftOf(shifts, 'mapA', 'P2', 'mapA'), { x: 0, y: 0 }, 'P2 の対象が 0 でない');
    assert.deepEqual(effectiveShiftOf(shifts, 'unknown', 'P0', null), { x: 0, y: 0 }, '未計測の既定が 0 でない');
    assert.deepEqual(shifts.mapA, { x: 5, y: 6 }, 'effectiveShiftOf が保持値を書き換えた（§5.1: 保持値は変えない）');
  }
  console.log('[3/7] §5.1/§5.3: effectiveShiftOf の相別実効値 OK');

  const mapEdit = await read('src/views/MapEdit.vue');

  // ---------------------------------------------------------------- [4/7]
  // AC16 / C-4: source への mercatorXShift/YShift 代入が applyBaseMapShifts の中だけ。
  // 呼び出しが 3 箇所以上（setupBaseMaps 末尾・確定時・相遷移時）
  {
    const assignX = mapEdit.match(/mercatorXShift\s*=[^=]/g) || [];
    const assignY = mapEdit.match(/mercatorYShift\s*=[^=]/g) || [];
    const fnStart = mapEdit.indexOf('const applyBaseMapShifts');
    assert.ok(fnStart >= 0, 'AC16: applyBaseMapShifts が定義されていない');
    // 定義本体を関数末尾（次の const 宣言）まで切り出す
    const fnEnd = mapEdit.indexOf('\nconst ', fnStart + 1);
    const fnBody = mapEdit.slice(fnStart, fnEnd);
    assert.equal(assignX.length, countOf(fnBody, 'mercatorXShift ='),
      'AC16: mercatorXShift への代入が applyBaseMapShifts の外にある（C-4 違反）');
    assert.equal(assignY.length, countOf(fnBody, 'mercatorYShift ='),
      'AC16: mercatorYShift への代入が applyBaseMapShifts の外にある（C-4 違反）');
    assert.ok(assignX.length >= 1 && assignY.length >= 1, 'AC16: applyBaseMapShifts が代入を持たない');
    const calls = mapEdit.match(/applyBaseMapShifts\(/g) || [];
    // 定義 1 + 呼び出し 3 以上
    assert.ok(calls.length >= 4,
      `AC16: applyBaseMapShifts の呼び出しが 3 箇所未満（定義込み ${calls.length} 箇所）`);
  }
  console.log('[4/7] AC16/C-4: シフト適用の単一実装 OK');

  // ---------------------------------------------------------------- [5/7]
  // 設計レビュー MIN-3 の処方: setupBaseMaps 末尾で setSwitchableBaseMaps を呼び直す
  {
    const fnStart = mapEdit.indexOf('const setupBaseMaps');
    assert.ok(fnStart >= 0, 'setupBaseMaps が見つからない');
    const fnEnd = mapEdit.indexOf('\nconst ', fnStart + 1);
    const fnBody = mapEdit.slice(fnStart, fnEnd);
    assert.ok(countOf(fnBody, 'applySwitchableBaseMapsForPhase(') >= 1,
      'MIN-3: setupBaseMaps がレイヤ再構築後に切替候補を相に応じて呼び直していない'
      + '（P1/P2 中の再構築で title 退避が失われ切替禁止が解ける）');
    // 相ラッパー自身が単一機構 setSwitchableBaseMaps を通していること（§5.4）
    const wrapStart = mapEdit.indexOf('const applySwitchableBaseMapsForPhase');
    assert.ok(wrapStart >= 0, 'applySwitchableBaseMapsForPhase が定義されていない');
    const wrapBody = mapEdit.slice(wrapStart, mapEdit.indexOf('\nconst ', wrapStart + 1));
    assert.ok(countOf(wrapBody, 'setSwitchableBaseMaps(') >= 1,
      'MIN-3: 相ラッパーが setSwitchableBaseMaps を通していない');
    assert.ok(countOf(fnBody, 'applyBaseMapShifts(') >= 1,
      'C-4: setupBaseMaps がレイヤ再構築後に applyBaseMapShifts を呼んでいない');
  }
  console.log('[5/7] MIN-3: setupBaseMaps 末尾の切替制限復元 OK');

  // ---------------------------------------------------------------- [6/7]
  // AC4 / AC23: 保持値は編集環境ストア以外へ書かない（2026-08-21 m1-t4 改訂・HR-6。
  // 永続化は map_base_map_shift（編集環境ストア）だけが担い、地図文書（Save 対象）・
  // BaseMapEditDocument・MapEditHistoryState（undo）には増えていないことを検査する
  {
    const baseMapDoc = await read('src/utils/baseMapEditorDocument.ts');
    assert.equal(countOf(baseMapDoc, 'mercatorXShift'), 0,
      'AC4: BaseMapEditDocument にシフトフィールドが増えている（C-3 違反）');
    assert.equal(countOf(baseMapDoc, 'baseMapShifts'), 0,
      'AC4: BaseMapEditDocument が保持値に触れている（C-3 違反）');
    // MapEditHistoryState 型ブロック（AC23: undo 対象へ足さない）
    const typeStart = mapEdit.indexOf('type MapEditHistoryState');
    assert.ok(typeStart >= 0, 'MapEditHistoryState 型が見つからない');
    const typeBody = mapEdit.slice(typeStart, mapEdit.indexOf('};', typeStart));
    for (const forbidden of ['baseMapShifts', 'alignPhase', 'alignTarget', 'alignReference', 'alignGroundTruth']) {
      assert.equal(countOf(typeBody, forbidden), 0,
        `AC23: MapEditHistoryState に位置合わせ状態 ${forbidden} が増えている`);
    }
    // 保存経路（mapedit.save の payload 組み立て）に保持値が乗っていない
    assert.equal(countOf(mapEdit, 'baseMapShifts') > 0, true, 'baseMapShifts が実装されていない');
    const saveCallIdx = [...mapEdit.matchAll(/window[^\n]*mapedit\.save\(/g)].map((m) => m.index);
    for (const idx of saveCallIdx) {
      const around = mapEdit.slice(Math.max(0, idx - 2000), idx + 2000);
      assert.equal(countOf(around, 'baseMapShifts'), 0,
        'AC4: 保存呼び出しの近傍に baseMapShifts が現れる（地図文書への書込の疑い）');
    }
  }
  console.log('[6/7] AC4/AC23: 編集環境ストア以外へ書かない・undo 非対象の静的確認 OK');

  // ---------------------------------------------------------------- [7/7]
  // AC18: i18n 9 キー × 11 言語・空値なし・末尾改行・appedit との文言一致
  // AC22: package.json 結線
  {
    for (const lang of LANGS) {
      const raw = await read(`public/locales/${lang}/translation.json`);
      assert.ok(raw.endsWith('\n'), `AC18: ${lang}/translation.json の末尾改行が失われた`);
      const json = JSON.parse(raw);
      for (const key of NEW_KEYS) {
        const val = json.mapedit?.[key];
        assert.equal(typeof val, 'string', `AC18: ${lang} の mapedit.${key} が無い`);
        assert.ok(val.length > 0, `AC18: ${lang} の mapedit.${key} が空`);
      }
      assert.equal(json.mapedit.mercator_x_shift, json.appedit.mercator_x_shift,
        `AC18: ${lang} の mercator_x_shift が appedit と別文言（§5.6: 同一概念は同一語）`);
      assert.equal(json.mapedit.mercator_y_shift, json.appedit.mercator_y_shift,
        `AC18: ${lang} の mercator_y_shift が appedit と別文言`);
    }
    const pkg = JSON.parse(await read('package.json'));
    assert.equal(typeof pkg.scripts['smoke:mapedit-align-m1-t2-basemap-align'], 'string',
      'AC22: smoke が package.json に結線されていない');
    assert.equal(typeof pkg.scripts['test:e2e:mapedit-align-m1-t2'], 'string',
      'AC22: e2e が package.json に結線されていない');
    assert.ok(pkg.scripts['test:e2e:mapedit-align-m1-t2'].includes('mapedit-align-m1-t2-basemap-align.spec.ts'),
      'AC22: e2e script が本タスクの spec を指していない');
  }
  console.log('[7/7] AC18/AC22: i18n 全 11 言語と package.json 結線 OK');

  console.log('mapedit-align-m1-t2-basemap-align-smoke: ALL OK');
} catch (err) {
  console.error('mapedit-align-m1-t2-basemap-align-smoke: FAILED');
  console.error(err);
  process.exitCode = 1;
}
