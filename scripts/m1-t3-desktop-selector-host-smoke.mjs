import { readdir, readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import ts from 'typescript';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const workDir = await mkdtemp(path.join(tmpdir(), 'maplat-editor-m1-t3-'));

const NORMALIZE_TYPE = (s) =>
  s.replace(/\s+/g, ' ').replace(/\s*([<>(),;|&?:])\s*/g, '$1').trim();

function extractTypeAliasStored(typeNode, sf) {
  if (ts.isUnionTypeNode(typeNode)) {
    const literals = [];
    let allStringLiteral = true;
    for (const t of typeNode.types) {
      if (ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal)) {
        literals.push(t.literal.text);
      } else {
        allStringLiteral = false;
        break;
      }
    }
    if (allStringLiteral) {
      return { kind: 'literal-union', members: new Set(literals) };
    }
  }
  return NORMALIZE_TYPE(typeNode.getText(sf));
}

function extractShape(source) {
  const sf = ts.createSourceFile('x.ts', source, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TS);
  const shape = { types: {}, interfaces: {}, exports: [] };
  for (const stmt of sf.statements) {
    if (!ts.canHaveModifiers(stmt)) continue;
    const isExported = (ts.getModifiers(stmt) || []).some(m => m.kind === ts.SyntaxKind.ExportKeyword);
    if (!isExported) continue;
    if (ts.isTypeAliasDeclaration(stmt)) {
      shape.types[stmt.name.text] = extractTypeAliasStored(stmt.type, sf);
      shape.exports.push(stmt.name.text);
    } else if (ts.isInterfaceDeclaration(stmt)) {
      const members = {};
      for (const m of stmt.members) {
        if (ts.isPropertySignature(m)) {
          const name = m.name.getText(sf);
          const optional = !!m.questionToken;
          const typeText = m.type ? NORMALIZE_TYPE(m.type.getText(sf)) : '';
          members[name] = { kind: 'property', optional, typeText };
        } else if (ts.isMethodSignature(m)) {
          const name = m.name.getText(sf);
          const optional = !!m.questionToken;
          const parameters = m.parameters.map((p) => ({
            name: p.name.getText(sf),
            optional: !!p.questionToken,
            typeText: p.type ? NORMALIZE_TYPE(p.type.getText(sf)) : '',
          }));
          const returnType = m.type ? NORMALIZE_TYPE(m.type.getText(sf)) : 'void';
          members[name] = { kind: 'method', optional, parameters, returnType };
        }
      }
      shape.interfaces[stmt.name.text] = members;
      shape.exports.push(stmt.name.text);
    } else if (ts.isFunctionDeclaration(stmt)) {
      shape.exports.push(stmt.name?.text || '<anonymous>');
    }
  }
  return shape;
}

try {
  // --- Part 1: useRegisteredMapSelector 型チェック ---
  const selectorSource = await readFile(
    path.join(projectRoot, 'src/composables/useRegisteredMapSelector.ts'),
    'utf8'
  );

  // SelectedRegisteredMapHostState が export されていることを確認
  assert.match(
    selectorSource,
    /export\s+interface\s+SelectedRegisteredMapHostState/,
    'useRegisteredMapSelector.ts に SelectedRegisteredMapHostState が export されていない'
  );

  // select 関数が SelectedRegisteredMapHostState を返すことを確認
  assert.match(
    selectorSource,
    /select\s*\([^)]*\)\s*:\s*SelectedRegisteredMapHostState/,
    'select 関数の戻り型が SelectedRegisteredMapHostState でない'
  );

  // search, nextPage, prevPage が void を返さず Promise<void> を返すことを確認
  assert.match(
    selectorSource,
    /async\s+function\s+search\s*\(/,
    'search が async でない'
  );
  assert.match(
    selectorSource,
    /async\s+function\s+nextPage\s*\(/,
    'nextPage が async でない'
  );
  assert.match(
    selectorSource,
    /async\s+function\s+prevPage\s*\(/,
    'prevPage が async でない'
  );

  // nextPage に hasNext guard があることを確認
  assert.match(
    selectorSource,
    /if\s*\(\s*!hasNext\.value\s*\)\s*return/,
    'nextPage に hasNext guard がない'
  );

  // loadMaps に catch があることを確認
  assert.match(
    selectorSource,
    /catch\s*\(\s*e\s*\)/,
    'loadMaps に catch 経路がない'
  );

  console.log('  [1/6] useRegisteredMapSelector 型チェック: PASS');

  // --- Part 2: useAppSourceHost 型チェック ---
  const hostSource = await readFile(
    path.join(projectRoot, 'src/composables/useAppSourceHost.ts'),
    'utf8'
  );

  // SelectedRegisteredMapHostState を受け取ることを確認
  assert.match(
    hostSource,
    /selectMap\s*\(\s*hostState\s*:\s*Readonly<SelectedRegisteredMapHostState>/,
    'useAppSourceHost.selectMap の引数型が Readonly<SelectedRegisteredMapHostState> でない'
  );

  // module singleton であることを確認
  assert.match(
    hostSource,
    /const\s+state\s*:\s*Ref<SelectedRegisteredMapHostState\s*\|\s*null>/,
    'useAppSourceHost が module singleton の ref を持っていない'
  );

  console.log('  [2/6] useAppSourceHost 型チェック: PASS');

  // --- Part 3: DesktopRegisteredMapSelector.vue 存在チェック ---
  const selectorComponentPath = path.join(projectRoot, 'src/components/DesktopRegisteredMapSelector.vue');
  const selectorComponent = await readFile(selectorComponentPath, 'utf8');

  // emit が SelectedRegisteredMapHostState であることを確認
  assert.match(
    selectorComponent,
    /select:\s*\[\s*state\s*:\s*SelectedRegisteredMapHostState\s*\]/,
    'DesktopRegisteredMapSelector の emit 型が SelectedRegisteredMapHostState でない'
  );

  // thumbnailUrl が string の場合のみ画像を表示することを確認
  assert.match(
    selectorComponent,
    /typeof\s+item\.thumbnailUrl\s*===\s*['"]string['"]/,
    'DesktopRegisteredMapSelector が thumbnailUrl の string 判定をしていない'
  );

  // initialSelection prop がないことを確認
  assert.doesNotMatch(
    selectorComponent,
    /initialSelection/,
    'DesktopRegisteredMapSelector に initialSelection prop が存在する'
  );

  console.log('  [3/6] DesktopRegisteredMapSelector.vue 存在チェック: PASS');

  // --- Part 4: AppList/AppEdit.vue 整合性 ---
  const appListView = await readFile(
    path.join(projectRoot, 'src/views/AppList.vue'),
    'utf8'
  );
  const appEditView = await readFile(
    path.join(projectRoot, 'src/views/AppEdit.vue'),
    'utf8'
  );

  // AppList は app list API を使って一覧を表示することを確認
  // M11-T8b: 一覧データ取得は bbox 対応 search adapter 経由
  assert.match(
    appListView,
    /createAppListAdapter/,
    'AppList.vue が createAppListAdapter を使っていない'
  );
  const appListAdapterSource = await readFile(
    path.join(projectRoot, 'src/views/resource-adapters/appListAdapter.ts'),
    'utf8'
  );
  assert.match(
    appListAdapterSource,
    /window\.search\.apps/,
    'appListAdapter.ts が window.search.apps を呼んでいない'
  );

  // AppEdit は共通 map search adapter で地図一覧を表示する
  assert.match(
    appEditView,
    /createMapListAdapter/,
    'AppEdit.vue が共通 map search adapter を使っていない'
  );

  // applist.not_implement が消えていることを確認
  assert.doesNotMatch(
    appListView,
    /applist\.not_implement/,
    'AppList.vue に applist.not_implement が残存している'
  );

  // AppEdit は選択された map を source に追加することを確認
  assert.match(
    appEditView,
    /addMapSource/,
    'AppEdit.vue に addMapSource がない'
  );

  console.log('  [4/6] AppList/AppEdit.vue 整合性: PASS');

  // --- Part 5: ユニット smoke (composable 動作確認 via dynamic import) ---
  const selectorSourceForTranspile = await readFile(
    path.join(projectRoot, 'src/composables/useRegisteredMapSelector.ts'),
    'utf8'
  );
  const hostSourceForTranspile = await readFile(
    path.join(projectRoot, 'src/composables/useAppSourceHost.ts'),
    'utf8'
  );
  const catalogSourceForTranspile = await readFile(
    path.join(projectRoot, 'src/services/registeredMapCatalog.ts'),
    'utf8'
  );

  // registeredMapCatalog.ts をトランスパイル
  const transpiledCatalog = ts.transpileModule(catalogSourceForTranspile, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
      strict: true,
    },
  });
  const bundledCatalog = path.join(workDir, 'registeredMapCatalog.mjs');
  await writeFile(bundledCatalog, transpiledCatalog.outputText);

  // useRegisteredMapSelector.ts をトランスパイル（import を外部化）
  const transpiledSelector = ts.transpileModule(selectorSourceForTranspile, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
      strict: true,
    },
  });
  // import を解決するためにスタブを注入
  const selectorWithDeps = transpiledSelector.outputText
    .replace(
      /from\s+["']\.\.\/services\/registeredMapCatalog["']/,
      `from "${pathToFileURL(bundledCatalog).href}"`
    )
    .replace(
      /from\s+["']vue["']/,
      'from "data:text/javascript,export function ref(v){return{value:v}}"'
    );
  const bundledSelector = path.join(workDir, 'useRegisteredMapSelector.mjs');
  await writeFile(bundledSelector, selectorWithDeps);

  const { useRegisteredMapSelector } = await import(pathToFileURL(bundledSelector).href);

  // 5a: backend stub で listMaps を検証
  let receivedArgs = null;
  const stub = async (query, page, pageSize) => {
    receivedArgs = { query, page, pageSize };
    return {
      docs: [
        { mapID: 'edo', title: 'Edo Map', image: 'file://...', width: 190, height: 100 },
        { mapID: 'tokyo', title: 'Tokyo Map', image: null, width: null, height: null },
      ],
      prev: false,
      next: true,
    };
  };

  const { createDesktopRegisteredMapCatalogFromBackend } = await import(pathToFileURL(bundledCatalog).href);
  const catalog = createDesktopRegisteredMapCatalogFromBackend(stub);
  const selector = useRegisteredMapSelector(catalog, { pageSize: 20 });

  await selector.loadMaps();
  assert.deepEqual(receivedArgs, { query: '', page: 1, pageSize: 20 }, 'listMaps に正しい引数が渡された');
  assert.equal(selector.items.value.length, 2, 'items が 2 件');
  assert.equal(selector.hasNext.value, true, 'hasNext が true');

  // 5b: search が page をリセットし query を渡す
  receivedArgs = null;
  await selector.search('edo');
  assert.equal(receivedArgs.query, 'edo', 'search 後に query が渡された');
  assert.equal(receivedArgs.page, 1, 'search 後に page が 1 にリセットされた');

  // 5c: nextPage が page を進める
  receivedArgs = null;
  await selector.nextPage();
  assert.equal(receivedArgs.page, 2, 'nextPage で page が 2 になった');

  // 5d: prevPage が page を戻す
  receivedArgs = null;
  await selector.prevPage();
  assert.equal(receivedArgs.page, 1, 'prevPage で page が 1 に戻った');

  // 5e: prevPage が page < 1 にしない
  receivedArgs = null;
  await selector.prevPage();
  assert.equal(receivedArgs.page, 1, 'prevPage で page が 1 以下にならない');

  // 5f: select が SelectedRegisteredMapHostState を返す
  const summary = selector.items.value[0];
  const hostState = selector.select(summary);
  assert.equal(hostState.ref.kind, 'registered-map', 'hostState.ref.kind が registered-map');
  assert.equal(hostState.ref.runtimeMapId, 'edo', 'hostState.ref.runtimeMapId');
  assert.equal(hostState.ref.catalogKey, 'desktop:edo', 'hostState.ref.catalogKey');
  assert.equal(hostState.title, 'Edo Map', 'hostState.title');
  assert.equal(hostState.status, 'unknown', 'hostState.status');
  assert.equal(selector.selectedKey.value, 'desktop:edo', 'selectedKey が更新された');

  // 5g: deselect で selectedKey が null に
  selector.deselect();
  assert.equal(selector.selectedKey.value, null, 'deselect で selectedKey が null');

  // 5h: hasNext=false で nextPage が no-op
  const stubNoNext = async (query, page, pageSize) => {
    receivedArgs = { query, page, pageSize };
    return {
      docs: [
        { mapID: 'test', title: 'Test', image: null, width: null, height: null },
      ],
      prev: true,
      next: false,
    };
  };
  const catalogNoNext = createDesktopRegisteredMapCatalogFromBackend(stubNoNext);
  const selectorNoNext = useRegisteredMapSelector(catalogNoNext, { pageSize: 20 });
  await selectorNoNext.loadMaps(); // page 1, hasNext=false
  assert.equal(selectorNoNext.hasNext.value, false, 'hasNext が false');

  receivedArgs = null;
  await selectorNoNext.nextPage(); // hasNext=false なので no-op
  assert.equal(receivedArgs, null, 'hasNext=false で nextPage は backend を呼ばない');
  assert.equal(selectorNoNext.currentPage.value, 1, 'hasNext=false で page が変わらない');

  // 5i: backend throw 時に error.value が設定され loading が false に戻る
  const stubError = async () => {
    throw new Error('backend error');
  };
  const catalogError = createDesktopRegisteredMapCatalogFromBackend(stubError);
  const selectorError = useRegisteredMapSelector(catalogError, { pageSize: 20 });

  assert.equal(selectorError.loading.value, false, '初期 loading が false');
  assert.equal(selectorError.error.value, null, '初期 error が null');

  await selectorError.loadMaps();
  assert.equal(selectorError.error.value, 'backend error', 'loadMaps throw 後に error.value が設定された');
  assert.equal(selectorError.loading.value, false, 'loadMaps throw 後に loading.value が false に戻った');

  console.log('  [5/6] ユニット smoke: PASS');

  // --- Part 6: useAppSourceHost 動作確認 ---
  // useAppSourceHost.ts をトランスパイル
  const transpiledHost = ts.transpileModule(hostSourceForTranspile, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
      strict: true,
    },
  });
  const hostWithDeps = transpiledHost.outputText
    .replace(
      /from\s+["']\.\/useRegisteredMapSelector["']/,
      `from "${pathToFileURL(bundledSelector).href}"`
    )
    .replace(
      /from\s+["']vue["']/,
      'from "data:text/javascript,export function ref(v){return{value:v}}"'
    );
  const bundledHost = path.join(workDir, 'useAppSourceHost.mjs');
  await writeFile(bundledHost, hostWithDeps);

  const { useAppSourceHost } = await import(pathToFileURL(bundledHost).href);

  // 6a: selectMap が state を保持
  const host = useAppSourceHost();
  const testState = {
    ref: { kind: 'registered-map', runtimeMapId: 'test', catalogKey: 'desktop:test' },
    title: 'Test Map',
    status: 'ready',
  };
  host.selectMap(testState);
  assert.deepEqual(host.state.value, testState, 'selectMap 後に state が保持される');

  // 6b: clearMap で state が null に
  host.clearMap();
  assert.equal(host.state.value, null, 'clearMap で state が null に');

  // 6c: module singleton の検証（2 回目の呼び出しで同じ ref が返る）
  const host2 = useAppSourceHost();
  host.selectMap(testState);
  assert.deepEqual(host2.state.value, testState, 'module singleton: 別の呼び出しでも同じ state を参照');

  console.log('  [6/6] useAppSourceHost 動作確認: PASS');

  console.log('M1-T3 desktop selector host smoke passed');
} finally {
  await rm(workDir, { recursive: true, force: true });
}
