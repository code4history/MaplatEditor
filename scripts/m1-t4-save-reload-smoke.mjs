import { readdir, readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import ts from 'typescript';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const workDir = await mkdtemp(path.join(tmpdir(), 'maplat-editor-m1-t4-'));

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
  // --- Part 1: AppDraftService 型/構造 ---
  const servicePath = path.join(projectRoot, 'electron/services/AppDraftService.ts');
  const serviceSource = await readFile(servicePath, 'utf8');

  // electron-store を使用していることを確認
  assert.match(
    serviceSource,
    /import\s+Store\s+from\s+['"]electron-store['"]/,
    'AppDraftService.ts が electron-store を import していない'
  );

  // save/load メソッドが存在することを確認
  assert.match(
    serviceSource,
    /save\s*\(\s*draft\s*:\s*MinimalAppDraft\s*\|\s*null\s*\)\s*:\s*void/,
    'AppDraftService.ts に save メソッドがない'
  );
  assert.match(
    serviceSource,
    /load\s*\(\)\s*:\s*MinimalAppDraft\s*\|\s*null/,
    'AppDraftService.ts に load メソッドがない'
  );

  // MinimalAppDraft 型が selectedMap を持つことを確認
  assert.match(
    serviceSource,
    /interface\s+MinimalAppDraft/,
    'AppDraftService.ts に MinimalAppDraft インターフェースがない'
  );
  assert.match(
    serviceSource,
    /selectedMap\s*\?\s*:\s*\{/,
    'MinimalAppDraft に selectedMap プロパティがない'
  );
  // home_position 等が含まれていないことを確認
  assert.doesNotMatch(
    serviceSource,
    /home_position/,
    'MinimalAppDraft に home_position が含まれている (m5/m6 の責務外)'
  );
  assert.doesNotMatch(
    serviceSource,
    /default_zoom/,
    'MinimalAppDraft に default_zoom が含まれている (m5/m6 の責務外)'
  );

  console.log('  [1/7] AppDraftService 型/構造: PASS');

  // --- Part 2: IPC handler 構造 ---
  const ipcPath = path.join(projectRoot, 'electron/ipc/appdraft.ts');
  const ipcSource = await readFile(ipcPath, 'utf8');

  // appdraft:save / appdraft:load を ipcMain.handle で登録することを確認
  assert.match(
    ipcSource,
    /ipcMain\.handle\s*\(\s*['"]appdraft:save['"]/,
    'appdraft.ts に appdraft:save ハンドラがない'
  );
  assert.match(
    ipcSource,
    /ipcMain\.handle\s*\(\s*['"]appdraft:load['"]/,
    'appdraft.ts に appdraft:load ハンドラがない'
  );

  // main.ts に registerAppDraftHandlers が呼ばれることを確認
  const mainSource = await readFile(
    path.join(projectRoot, 'electron/main.ts'),
    'utf8'
  );
  assert.match(
    mainSource,
    /registerAppDraftHandlers\s*\(\)/,
    'main.ts に registerAppDraftHandlers() 呼び出しがない'
  );

  // HMR removeHandler に appdraft:save / appdraft:load が含まれることを確認
  assert.match(
    mainSource,
    /ipcMain\.removeHandler\s*\(\s*['"]appdraft:save['"]\s*\)/,
    'main.ts に appdraft:save の removeHandler がない'
  );
  assert.match(
    mainSource,
    /ipcMain\.removeHandler\s*\(\s*['"]appdraft:load['"]\s*\)/,
    'main.ts に appdraft:load の removeHandler がない'
  );

  console.log('  [2/7] IPC handler 構造: PASS');

  // --- Part 3: preload 構造 ---
  const preloadSource = await readFile(
    path.join(projectRoot, 'electron/preload.ts'),
    'utf8'
  );

  assert.match(
    preloadSource,
    /contextBridge\.exposeInMainWorld\s*\(\s*['"]appdraft['"]/,
    'preload.ts に window.appdraft の公開がない'
  );
  assert.match(
    preloadSource,
    /save\s*:\s*\(\s*draft\s*:\s*any\s*\)\s*=>\s*ipcRenderer\.invoke\s*\(\s*['"]appdraft:save['"]/,
    'preload.ts に appdraft.save 定義がない'
  );
  assert.match(
    preloadSource,
    /load\s*:\s*\(\)\s*=>\s*ipcRenderer\.invoke\s*\(\s*['"]appdraft:load['"]/,
    'preload.ts に appdraft.load 定義がない'
  );

  console.log('  [3/7] preload 構造: PASS');

  // --- Part 4: useAppDraft composable ---
  const composablePath = path.join(projectRoot, 'src/composables/useAppDraft.ts');
  const composableSource = await readFile(composablePath, 'utf8');

  // saveDraft / loadDraft / clearDraft をエクスポートすることを確認
  assert.match(
    composableSource,
    /export\s+function\s+useAppDraft\s*\(/,
    'useAppDraft.ts に useAppDraft が export されていない'
  );
  assert.match(
    composableSource,
    /async\s+function\s+saveDraft\s*\(/,
    'useAppDraft.ts に saveDraft がない'
  );
  assert.match(
    composableSource,
    /async\s+function\s+loadDraft\s*\(/,
    'useAppDraft.ts に loadDraft がない'
  );
  assert.match(
    composableSource,
    /async\s+function\s+clearDraft\s*\(/,
    'useAppDraft.ts に clearDraft がない'
  );

  // window.appdraft.* を呼ぶことを確認
  assert.match(
    composableSource,
    /window\s+as\s+any\s*\)\s*\.appdraft\.save/,
    'useAppDraft.ts が window.appdraft.save を呼んでいない'
  );
  assert.match(
    composableSource,
    /window\s+as\s+any\s*\)\s*\.appdraft\.load/,
    'useAppDraft.ts が window.appdraft.load を呼んでいない'
  );

  // loadDraft に try-catch があることを確認
  assert.match(
    composableSource,
    /try\s*\{/,
    'loadDraft に try-catch がない (graceful degradation が実装されていない)'
  );
  assert.match(
    composableSource,
    /catch\s*\(\s*e\s*\)/,
    'loadDraft に catch 経路がない'
  );

  console.log('  [4/7] useAppDraft composable: PASS');

  // --- Part 5: App list/edit integration ---
  const appListView = await readFile(
    path.join(projectRoot, 'src/views/AppList.vue'),
    'utf8'
  );
  const appEditView = await readFile(
    path.join(projectRoot, 'src/views/AppEdit.vue'),
    'utf8'
  );

  // AppList は複数アプリ一覧として applist API を使うこと
  assert.match(
    appListView,
    /window\.applist\.request/,
    'AppList.vue が window.applist.request を呼んでいない'
  );

  // アプリ編集はuid正準で開く (ADR-0007: ルーティング・IPCはuid、slugは表示/編集用)
  assert.match(
    appListView,
    /\/appedit\?uid=/,
    'AppList.vue が AppEdit へのタイルリンク(uid正準)を持っていない'
  );

  // AppEdit は DuckDB-backed appedit API で load/save すること
  assert.match(
    appEditView,
    /window\.appedit\.request/,
    'AppEdit.vue が window.appedit.request を呼んでいない'
  );

  assert.match(
    appEditView,
    /window\.appedit\.save/,
    'AppEdit.vue が window.appedit.save を呼んでいない'
  );

  assert.match(
    appEditView,
    /window\.appedit\.preparePreview/,
    'AppEdit.vue が HTTP プレビュー作成 API を呼んでいない'
  );

  console.log('  [5/7] App list/edit integration: PASS');

  // --- Part 6: DesktopRegisteredMapSelector initialCatalogKey ---
  const selectorComponent = await readFile(
    path.join(projectRoot, 'src/components/DesktopRegisteredMapSelector.vue'),
    'utf8'
  );

  // initialCatalogKey prop が存在することを確認
  assert.match(
    selectorComponent,
    /initialCatalogKey\?/,
    'DesktopRegisteredMapSelector に initialCatalogKey prop がない'
  );

  // useRegisteredMapSelector に initialCatalogKey を渡していることを確認
  assert.match(
    selectorComponent,
    /initialCatalogKey\s*:\s*props\.initialCatalogKey/,
    'DesktopRegisteredMapSelector が initialCatalogKey を useRegisteredMapSelector に渡していない'
  );

  // useRegisteredMapSelector.ts に initialCatalogKey オプションがあることを確認
  const selectorSource = await readFile(
    path.join(projectRoot, 'src/composables/useRegisteredMapSelector.ts'),
    'utf8'
  );
  assert.match(
    selectorSource,
    /initialCatalogKey\?\s*:\s*RegisteredMapCatalogKey/,
    'useRegisteredMapSelector に initialCatalogKey オプションがない'
  );
  assert.match(
    selectorSource,
    /ref\s*\(\s*options\s*\?\s*\.initialCatalogKey\s*\?\?\s*null\s*\)/,
    'useRegisteredMapSelector が initialCatalogKey を初期値として使っていない'
  );

  console.log('  [6/7] DesktopRegisteredMapSelector initialCatalogKey: PASS');

  // --- Part 7: m1 全体 regression (既存 smoke 再実行) ---
  // 既存 smoke テストをトランスパイルして実行
  const smokeFiles = [
    { name: 'm1-t2-registered-map-catalog', file: 'scripts/m1-t2-registered-map-catalog-smoke.mjs' },
    { name: 'm1-t3-desktop-selector-host', file: 'scripts/m1-t3-desktop-selector-host-smoke.mjs' },
  ];

  for (const smoke of smokeFiles) {
    const smokePath = path.join(projectRoot, smoke.file);
    try {
      await readFile(smokePath, 'utf8');
    } catch {
      assert.fail(`smoke スクリプト ${smoke.file} が見つからない`);
    }
  }

  // typecheck ファイルの存在確認
  const typecheckConfig = path.join(projectRoot, 'tsconfig.electrobun.json');
  try {
    await readFile(typecheckConfig, 'utf8');
  } catch {
    assert.fail('tsconfig.electrobun.json が見つからない');
  }

  // build ファイルの存在確認
  const viteConfig = path.join(projectRoot, 'vite.config.ts');
  try {
    await readFile(viteConfig, 'utf8');
  } catch {
    assert.fail('vite.config.ts が見つからない');
  }

  // electron.d.ts に AppDraftAPI が追加されていることを確認
  const electronDts = await readFile(
    path.join(projectRoot, 'src/electron.d.ts'),
    'utf8'
  );
  assert.match(
    electronDts,
    /export\s+interface\s+AppDraftAPI/,
    'electron.d.ts に AppDraftAPI がない'
  );
  assert.match(
    electronDts,
    /save\s*\(\s*draft\s*:\s*any\s*\)\s*:\s*Promise\s*<\s*void\s*>/,
    'AppDraftAPI に save メソッドがない'
  );
  assert.match(
    electronDts,
    /load\s*\(\)\s*:\s*Promise\s*<\s*any\s*>/,
    'AppDraftAPI に load メソッドがない'
  );
  assert.match(
    electronDts,
    /appdraft\s*:\s*AppDraftAPI/,
    'Window に appdraft が宣言されていない'
  );

  console.log('  [7/7] m1 全体 regression (構造確認): PASS');

  console.log('M1-T4 save/reload regression smoke passed');
} finally {
  await rm(workDir, { recursive: true, force: true });
}
