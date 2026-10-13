// m1-t1「コンテキストメニュー3件の是正」のソーステキスト検査。
// 設計: docs/superpowers/specs/2026-08-21-m1-t1-mapedit-contextmenu-fixes-task-design.md v1.0
//
// 担当 AC:
//   AC3  是正が共有ライブラリ側 1 箇所であること（呼び出し側 2 画面に幅・折り返しの実装が無い）
//        ※ 設計 §8 の機械検証コマンド（git diff --name-only）は実行不能だったため本検査へ移した
//           （タスク設計レビュー MIN-2 の閉じ方）
//   AC4  フィーチャ命中分岐が F1 → F2 → F0 の順であり、F1 / F2 が 1 項目であること
//   AC5a キャンセル処理が面非依存の共通実装 1 本（cancelPendingNewGcp）であり、
//        3 経路がすべて同じ関数を呼ぶ。面依存の getSource('marker') 引きが残っていない
//   AC6  対応マーカー表示が対応線開始より前に push される
//   AC7  pairingMarker が両面をセンタリングし、ズームが旧実装 parity である
//   AC9  参照する i18n キーが 11 言語すべてに実在する（新規キーを作らない）
//   AC11 package.json への結線（outer rule-0012）
//   MIN-1 editingID の設定が相に依らない（現行挙動を変えない）
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import ts from 'typescript';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const read = (rel) => readFile(path.join(projectRoot, rel), 'utf8');

/** 文字列 needle の出現回数 */
const countOf = (haystack, needle) => haystack.split(needle).length - 1;

try {
  const mapEdit = await read('src/views/MapEdit.vue');
  const poiEditMap = await read('src/components/PoiEditMap.vue');
  const ctxMain = await read('src/libs/ol-contextmenu/main.ts');
  const ctxDom = await read('src/libs/ol-contextmenu/helpers/dom.ts');
  const ctxGrids = await read('src/libs/ol-contextmenu/sass/partials/_grids.scss');

  // ---------------------------------------------------------------- [1/6]
  // AC1 / AC3: 折り返しと上限幅の是正は共有ライブラリ側にある
  assert.doesNotMatch(
    ctxGrids,
    /white-space:\s*nowrap/,
    '_grids.scss に white-space: nowrap が残っている（折り返さない直接原因・HR-1）',
  );
  assert.match(
    ctxGrids,
    /li\s*\{[\s\S]{0,400}?white-space:\s*normal/,
    '_grids.scss の li に white-space: normal がない（折り返しを許していない）',
  );
  assert.match(
    ctxGrids,
    /li\s*\{[\s\S]{0,400}?overflow-wrap:\s*anywhere/,
    '_grids.scss の li に overflow-wrap: anywhere がない（長い連続語が箱を突き破る）',
  );

  // コンテナは固定幅ではなく「上限幅 + 内容幅」であること
  assert.doesNotMatch(
    ctxMain,
    /container\.style\.width\s*=\s*`\$\{this\.options\.width\}px`/,
    'main.ts が固定幅 (container.style.width = `${options.width}px`) を打ったままである',
  );
  assert.match(
    ctxMain,
    /container\.style\.maxWidth\s*=\s*`\$\{this\.options\.width\}px`/,
    'main.ts が options.width を上限幅 (maxWidth) として扱っていない',
  );
  assert.match(
    ctxMain,
    /container\.style\.width\s*=\s*'max-content'/,
    "main.ts のコンテナ幅が 'max-content' になっていない（短い項目で不自然に横長になる）",
  );

  // submenu 側もそろえる（設計 §5.3 #3 / INF-2）
  assert.doesNotMatch(
    ctxDom,
    /ul\.style\.width\s*=\s*`\$\{menuWidth\}px`/,
    'helpers/dom.ts の submenu が固定幅のままである（共有ライブラリの一貫性）',
  );
  assert.match(
    ctxDom,
    /ul\.style\.maxWidth\s*=\s*`\$\{menuWidth\}px`/,
    'helpers/dom.ts の submenu が上限幅 (maxWidth) を使っていない',
  );
  assert.match(
    ctxDom,
    /ul\.style\.width\s*=\s*'max-content'/,
    "helpers/dom.ts の submenu 幅が 'max-content' になっていない",
  );

  // AC3: 呼び出し側 2 画面は width の値を変えず、幅・折り返しを自前で実装しない
  for (const [name, src] of [['MapEdit.vue', mapEdit], ['PoiEditMap.vue', poiEditMap]]) {
    assert.match(
      src,
      /new ContextMenu\(\{[\s\S]{0,120}?width:\s*170/,
      `${name} の ContextMenu 幅指定が 170 から変わっている（AC3: 呼び出し側は変えない）`,
    );
    assert.doesNotMatch(
      src,
      /ol-ctx-menu/,
      `${name} に ol-ctx-menu へのスタイル上書きがある（AC3: 是正は共有ライブラリ 1 箇所）`,
    );
    assert.doesNotMatch(
      src,
      /white-space\s*:/,
      `${name} に white-space の指定がある（AC3: 折り返しは共有ライブラリ側で行う）`,
    );
  }
  console.log('  [1/6] AC1/AC3 共有ライブラリ側の折り返し・上限幅: PASS');

  // ---------------------------------------------------------------- [2/6]
  // AC4: フィーチャ命中分岐の相判定順が F1 → F2 → F0
  const openHandler = mapEdit.match(
    /contextmenu\.on\('open',[\s\S]*?\n  \}\);/,
  );
  assert.ok(openHandler, "createContextMenu の contextmenu.on('open', …) ブロックを取得できない");
  const openSrc = openHandler[0];

  const idxF1 = openSrc.indexOf('newlyAddEdge.value !== undefined');
  const idxF2 = openSrc.indexOf('newGcp.value !== undefined');
  assert.ok(idxF1 > 0, 'open ハンドラに F1（newlyAddEdge）の相判定がない');
  assert.ok(idxF2 > 0, 'open ハンドラに F2（newGcp）の相判定がない');
  assert.ok(
    idxF1 < idxF2,
    'フィーチャ命中分岐が F1 → F2 の順になっていない（設計 §5.2 / 旧実装 mapedit.js:1016,1025）',
  );

  // F1 / F2 の枝がそれぞれ何を push するか（枝の切り出しは相判定の出現位置で行う）
  const idxF0Line = openSrc.indexOf('} else if (isLine) {');
  assert.ok(idxF0Line > idxF2, 'F0（通常の相）の対応線分岐が F2 の後に無い');
  const f1Branch = openSrc.slice(idxF1, idxF2);
  const f2Branch = openSrc.slice(idxF2, idxF0Line);

  assert.equal(
    countOf(f2Branch, 'contextmenu.push('),
    1,
    'F2 の枝が 1 項目以外を push している（§6.1.1: F2 はフィーチャ種別を問わず 1 項目）',
  );
  assert.match(
    f2Branch,
    /mapedit\.context_cancel_add_marker/,
    'F2 の枝が mapedit.context_cancel_add_marker を push していない（Q2 の人間回答）',
  );
  assert.match(
    f2Branch,
    /cancelPendingNewGcp\(\)/,
    'F2 の枝が共通実装 cancelPendingNewGcp を呼んでいない（AC5a）',
  );

  assert.equal(
    countOf(f1Branch, 'contextmenu.push('),
    2,
    'F1 の枝の push が 2 箇所（対応線終了 / 対応線キャンセルの二者択一）になっていない',
  );
  assert.doesNotMatch(
    f1Branch,
    /context_remove_marker|context_correspond_marker|context_home_/,
    'F1 の枝にマーカー削除・対応マーカー表示・ホーム操作が残っている（§6.1.1 F1 行）',
  );
  console.log('  [2/6] AC4 相判定順 F1→F2→F0 と 1 項目契約: PASS');

  // ---------------------------------------------------------------- [3/6]
  // AC5a: 面非依存の共通実装 1 本
  assert.equal(
    countOf(mapEdit, 'const cancelPendingNewGcp = ('),
    1,
    'cancelPendingNewGcp の定義が 1 本でない',
  );
  assert.match(
    mapEdit,
    /const cancelPendingNewGcp = \(\) => \{[\s\S]{0,400}?newGcp\.value = undefined;[\s\S]{0,400}?editingID\.value = '';[\s\S]{0,400}?newlyAddEdge\.value = undefined;[\s\S]{0,400}?gcpsToMarkers\(\);/,
    'cancelPendingNewGcp が現行 removeMarker の "new" 経路と同じ終状態を作っていない',
  );
  assert.equal(
    countOf(mapEdit, 'cancelPendingNewGcp()'),
    3,
    'cancelPendingNewGcp() の呼び出しが 3 箇所でない（F2 命中 / 空き部分 / removeMarker の "new" 分岐）',
  );
  // 旧・面依存コールバックが残っていないこと
  assert.doesNotMatch(
    mapEdit,
    /map\.getSource\('marker'\)\.getFeatures\(\)/,
    "面依存の map.getSource('marker').getFeatures() が残っている（AC5a）",
  );
  assert.doesNotMatch(
    mapEdit,
    /removeMarker\(\s*\{\s*data:/,
    'removeMarker へ合成した引数を渡す旧コールバックが残っている（AC5a）',
  );
  console.log('  [3/6] AC5a 面非依存の共通実装 1 本: PASS');

  // ---------------------------------------------------------------- [4/6]
  // AC6 / AC7 / HR-3: 対応マーカー表示
  assert.equal(
    countOf(mapEdit, 'mapedit.context_correspond_marker'),
    1,
    'mapedit.context_correspond_marker の参照が 1 箇所でない',
  );
  const idxPairing = openSrc.indexOf('mapedit.context_correspond_marker');
  const idxEdgeStart = openSrc.indexOf('mapedit.context_correspond_line_start');
  assert.ok(idxPairing > 0 && idxEdgeStart > 0, 'F0 の確定済みマーカー分岐の項目が取得できない');
  assert.ok(
    idxPairing < idxEdgeStart,
    '対応マーカー表示が対応線開始より後に push されている（AC6 / 旧実装 mapedit.js:1047）',
  );
  // F1 / F2 では出さない
  assert.ok(
    idxPairing > idxF2,
    '対応マーカー表示が F0 より前（F1 / F2 の相）に置かれている（MAJ-2 の決着）',
  );

  assert.equal(countOf(mapEdit, 'const pairingMarker = ('), 1, 'pairingMarker の定義が 1 本でない');
  const pairing = mapEdit.match(/const pairingMarker = \([\s\S]*?\n\};/);
  assert.ok(pairing, 'pairingMarker の本体を取得できない');
  assert.match(pairing[0], /illstView\.setCenter\(/, 'pairingMarker が地図面をセンタリングしていない');
  assert.match(pairing[0], /mercView\.setCenter\(/, 'pairingMarker が地理面をセンタリングしていない');
  assert.match(
    pairing[0],
    /illstView\.setZoom\(illstSource\.maxZoom - 1\)/,
    'pairingMarker の地図面ズームが旧実装 parity（maxZoom - 1）でない',
  );
  assert.match(
    pairing[0],
    /mercView\.setZoom\(17\)/,
    'pairingMarker の地理面ズームが旧実装 parity（17）でない',
  );
  console.log('  [4/6] AC6/AC7 対応マーカー表示の位置と両面センタリング: PASS');

  // ---------------------------------------------------------------- [5/6]
  // MIN-1: editingID の設定は相に依らない（現行 MapEdit.vue:2048 の挙動を変えない）
  const idxEditingId = openSrc.indexOf("editingID.value = String(Number(gcpIndex) + 1)");
  assert.ok(idxEditingId > 0, 'open ハンドラで editingID を設定していない');
  assert.ok(
    idxEditingId < idxF1,
    'editingID の設定が相判定の内側に入っている（MIN-1: F1 / F2 でも従来どおり設定すること）',
  );
  console.log('  [5/6] MIN-1 editingID の設定は相非依存: PASS');

  // ---------------------------------------------------------------- [6/6]
  // AC9: 参照する i18n キーが 11 言語すべてに実在する（新規キーを作らない）
  const localesDir = path.join(projectRoot, 'public/locales');
  const langs = (await readdir(localesDir, { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  assert.equal(langs.length, 11, `locale の言語数が 11 でない: ${langs.join(',')}`);
  for (const lang of langs) {
    const json = JSON.parse(await read(`public/locales/${lang}/translation.json`));
    for (const key of ['context_correspond_marker', 'context_cancel_add_marker']) {
      assert.ok(
        typeof json.mapedit?.[key] === 'string' && json.mapedit[key].length > 0,
        `${lang}: mapedit.${key} が無い（本タスクは新規キーを作らない ∴ 既存キーだけを使う）`,
      );
    }
  }

  // AC11: 検査スクリプトの結線（outer rule-0012）
  const pkg = JSON.parse(await read('package.json'));
  assert.ok(
    pkg.scripts['smoke:mapedit-align-m1-t1-contextmenu'],
    'package.json に smoke:mapedit-align-m1-t1-contextmenu が結線されていない',
  );
  assert.ok(
    pkg.scripts['test:e2e:mapedit-align-m1-t1'],
    'package.json に test:e2e:mapedit-align-m1-t1 が結線されていない',
  );
  console.log('  [6/6] AC9/AC11 i18n キー実在と結線: PASS');


  // nov26-m9-t3b: 現 source のメソッド本体を駆動し、OL の DOM 欠落と通常経路を検査する。
  // class/メソッドの一意性を AST で確認し、製品ロジックを試験側へ複製しない。
  const extractMethod = (source, className, methodName) => {
    const tree = ts.createSourceFile('probe.ts', source, ts.ScriptTarget.Latest, true);
    const methods = [];
    const visit = (node) => {
      if (ts.isClassDeclaration(node) && node.name?.text === className) {
        for (const member of node.members) {
          if (ts.isMethodDeclaration(member) && member.name.getText(tree) === methodName) {
            methods.push(member.getText(tree));
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(tree);
    assert.equal(methods.length, 1, `${className}.${methodName} が一意でない`);
    return methods[0];
  };
  const vueScripts = [...mapEdit.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)];
  assert.equal(vueScripts.length, 1, 'MapEdit の script が一意でない');
  const sourceMethods = {
    setMap: extractMethod(ctxMain, 'ContextMenu', 'setMap'),
    removeListeners: extractMethod(ctxMain, 'ContextMenu', 'removeListeners'),
    move: extractMethod(vueScripts[0][1], 'Drag', 'handleMoveEvent'),
  };
  const compileProbe = (methods, globals = {}) => {
    const compiled = ts.transpileModule(`class Probe extends Control { ${methods.join('\n')} }`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
      reportDiagnostics: true,
    });
    assert.equal(compiled.diagnostics?.filter((d) => d.category === ts.DiagnosticCategory.Error).length, 0);
    return vm.runInNewContext(`${compiled.outputText}\nProbe`, {
      Control: class { setMap(map) { this.superMap = map; } }, ...globals,
    });
  };
  const probeFailures = (methods) => {
    const failures = [];
    const check = (name, fn) => {
      try { fn(); } catch (err) { failures.push(`${name}: ${err.name}: ${err.message}`); }
    };
    for (const hasViewport of [true, false]) {
      check(`viewport=${hasViewport}`, () => {
        const calls = { add: [], remove: [], on: 0, off: 0, entries: 0, move: 0 };
        const viewport = hasViewport ? {
          addEventListener: (...args) => calls.add.push(args),
          removeEventListener: (...args) => calls.remove.push(args),
        } : undefined;
        const Probe = compileProbe([methods.setMap, methods.removeListeners], {
          CustomEventTypes: { ADD_MENU_ENTRY: 'add' }, DEFAULT_ITEMS: [],
          addMenuEntries: () => { calls.entries += 1; }, getLineHeight: () => 8,
        });
        const menu = new Probe();
        const listener = () => {};
        const items = [{ text: '項目' }];
        Object.assign(menu, {
          options: { eventType: 'contextmenu', defaultItems: false, items, width: 170 },
          contextMenuEventListener: listener, container: { firstElementChild: {}, offsetHeight: 20 },
          emitter: { on: () => { calls.on += 1; }, off: () => { calls.off += 1; } },
          getMenuEntriesLength: () => 2,
        });
        const map = { getViewport: () => viewport, on: (name) => {
          assert.equal(name, 'movestart'); calls.move += 1;
        } };
        menu.setMap(map);
        assert.equal(menu.superMap, map);
        assert.equal(menu.map, map);
        assert.equal(menu.items, items);
        assert.equal(menu.lineHeight, 10);
        assert.equal(calls.on, 1); assert.equal(calls.entries, 1); assert.equal(calls.move, 1);
        assert.deepEqual(calls.add, hasViewport ? [['contextmenu', listener, false]] : []);
        menu.removeListeners();
        assert.deepEqual(calls.remove, hasViewport ? [['contextmenu', listener, false]] : []);
        assert.equal(calls.off, 1, 'viewport 欠落時にも emitter を解除する');
      });
    }
    // 解除 guard は登録 guard と独立に測る（登録の TypeError で解除検査を黙らせない）。
    check('欠落viewportの解除', () => {
      const Probe = compileProbe([methods.removeListeners], { CustomEventTypes: { ADD_MENU_ENTRY: 'add' } });
      const menu = new Probe(); let off = 0;
      Object.assign(menu, { map: { getViewport: () => undefined }, emitter: { off: () => { off += 1; } } });
      menu.removeListeners(); assert.equal(off, 1);
    });
    const DragProbe = compileProbe([methods.move]);
    const makeDrag = () => Object.assign(new DragProbe(), { cursor_: 'pointer', previousCursor_: undefined, layerFilter: 'marker' });
    const event = (target, feature, button = 0) => ({ originalEvent: { button }, pixel: [2, 3], map: {
      getTargetElement: () => target,
      forEachFeatureAtPixel: (pixel, callback, options) => {
        assert.deepEqual(pixel, [2, 3]);
        assert.equal(options.layerFilter({ get: () => 'marker' }), true);
        assert.equal(options.layerFilter({ get: () => 'other' }), false);
        return feature ? callback(feature) : undefined;
      },
    } });
    for (const target of [null, undefined]) {
      for (const feature of [{}, undefined]) {
        check(`target=${target},feature=${!!feature}`, () => {
          const drag = makeDrag(); drag.previousCursor_ = 'crosshair';
          drag.handleMoveEvent(event(target, feature));
          assert.equal(drag.previousCursor_, 'crosshair', '欠落時の保存cursorを保つ');
          assert.equal(drag.cursor_, 'pointer');
        });
      }
    }
    check('通常cursorと右ボタン', () => {
      const drag = makeDrag(); const target = { style: { cursor: 'crosshair' } };
      drag.handleMoveEvent(event(target, {}));
      assert.equal(target.style.cursor, 'pointer'); assert.equal(drag.previousCursor_, 'crosshair');
      drag.handleMoveEvent(event(target, {}));
      assert.equal(drag.previousCursor_, 'crosshair', '反復hoverで保存cursorを上書きしない');
      drag.handleMoveEvent(event(target, undefined, 2));
      assert.equal(target.style.cursor, 'pointer'); assert.equal(drag.previousCursor_, 'crosshair');
      drag.handleMoveEvent(event(target, undefined));
      assert.equal(target.style.cursor, 'crosshair'); assert.equal(drag.previousCursor_, undefined);
      drag.handleMoveEvent(event(target, undefined));
      assert.equal(target.style.cursor, 'crosshair');
      drag.handleMoveEvent(event(null, {}, 2));
      assert.equal(drag.previousCursor_, undefined);
    });
    return failures;
  };
  assert.deepEqual(probeFailures(sourceMethods), [], 'nov26-m9-t3b の DOM 欠落/通常経路');

  // guard を source ではなくメモリだけで外し、各検査が元の TypeError を検出することを示す。
  const mutations = [
    ['setMap', 'viewport=false', (s) => s.replace('getViewport()?.addEventListener', 'getViewport().addEventListener')],
    ['removeListeners', '欠落viewportの解除', (s) => s.replace(/getViewport\(\)(\s*)\?\.removeEventListener/, 'getViewport()$1.removeEventListener')],
    ['move', 'target=null,feature=true', (s) => s.replace(/\s*if \(!element\) return;/, '')],
  ];
  for (const [key, label, mutate] of mutations) {
    const changed = mutate(sourceMethods[key]);
    assert.notEqual(changed, sourceMethods[key], `${key} 対照の guard を取得できない`);
    const failures = probeFailures({ ...sourceMethods, [key]: changed });
    assert.ok(failures.some((f) => f.startsWith(`${label}: TypeError:`)), `${key} の旧例外を検出できない: ${failures.join('; ')}`);
    console.log(`  nov26-m9-t3b メモリ対照 ${key}: 旧 TypeError を検出`);
  }
  console.log('  nov26-m9-t3b 実メソッドの欠落/通常経路: PASS');

  console.log('m1-t1 contextmenu smoke passed');
} catch (err) {
  console.error('m1-t1 contextmenu smoke FAILED:', err.message);
  process.exit(1);
}
