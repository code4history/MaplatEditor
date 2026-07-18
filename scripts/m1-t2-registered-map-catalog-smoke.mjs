import { readdir, readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import ts from 'typescript';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const workDir = await mkdtemp(path.join(tmpdir(), 'maplat-editor-m1-t2-'));

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
  const shape = { types: {}, interfaces: {} };
  for (const stmt of sf.statements) {
    if (!ts.canHaveModifiers(stmt)) continue;
    const isExported = (ts.getModifiers(stmt) || []).some(m => m.kind === ts.SyntaxKind.ExportKeyword);
    if (!isExported) continue;
    if (ts.isTypeAliasDeclaration(stmt)) {
      shape.types[stmt.name.text] = extractTypeAliasStored(stmt.type, sf);
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
    }
  }
  return shape;
}

function assertTypeAliasEqual(name, a, b) {
  const aIsLiteralUnion = typeof a === 'object' && a !== null && a.kind === 'literal-union';
  const bIsLiteralUnion = typeof b === 'object' && b !== null && b.kind === 'literal-union';
  if (aIsLiteralUnion && bIsLiteralUnion) {
    assert.deepEqual(
      [...a.members].sort(),
      [...b.members].sort(),
      `type ${name} (literal-union) members mismatch`
    );
    return;
  }
  if (aIsLiteralUnion !== bIsLiteralUnion) {
    assert.fail(
      `type ${name} representation diverged: mirror=${aIsLiteralUnion ? 'literal-union' : 'string'} vs truth=${bIsLiteralUnion ? 'literal-union' : 'string'}`
    );
  }
  assert.equal(a, b, `type ${name} (string) mismatch`);
}

try {
  // --- Part 1: AST structure comparison (mirror vs SaaS truth) ---
  const truthPath = path.resolve(projectRoot, '..', 'MaplatEditorSaaS/packages/shared/src/contracts/registered-map-selector.ts');
  const mirrorPath = path.resolve(projectRoot, 'src/services/registeredMapCatalog.ts');

  const sourceOfTruth = await readFile(truthPath, 'utf8');
  const mirror = await readFile(mirrorPath, 'utf8');

  const truth = extractShape(sourceOfTruth);
  const local = extractShape(mirror);

  const REQUIRED_TYPES = ['RegisteredMapCatalogKey', 'RegisteredMapStatus'];
  const REQUIRED_INTERFACES = [
    'RegisteredMapSummary',
    'RegisteredMapListRequest',
    'RegisteredMapListResponse',
    'RegisteredMapCatalog',
    'SelectedRegisteredMapRef',
    'DesktopMapItem',
    'DesktopListResult',
  ];

  for (const name of REQUIRED_TYPES) {
    assert.ok(name in truth.types, `正本に type ${name} が存在しない`);
    assert.ok(name in local.types, `mirror に type ${name} が存在しない`);
    assertTypeAliasEqual(name, local.types[name], truth.types[name]);
  }

  for (const name of REQUIRED_INTERFACES) {
    assert.ok(name in truth.interfaces, `正本に interface ${name} が存在しない`);
    assert.ok(name in local.interfaces, `mirror に interface ${name} が存在しない`);
    assert.deepEqual(local.interfaces[name], truth.interfaces[name], `interface ${name} mismatch`);
  }

  // 未知シンボル検知 (正本→mirror 方向)
  const unknownTypes = Object.keys(truth.types).filter(n => !REQUIRED_TYPES.includes(n));
  const unknownInterfaces = Object.keys(truth.interfaces).filter(n => !REQUIRED_INTERFACES.includes(n));
  assert.deepEqual(
    { unknownTypes, unknownInterfaces },
    { unknownTypes: [], unknownInterfaces: [] },
    `正本に未知の export シンボルが追加されました: ${JSON.stringify({ unknownTypes, unknownInterfaces })}`
  );

  // mirror 側 extra export 検知
  const mirrorExtraTypes = Object.keys(local.types).filter(n => !REQUIRED_TYPES.includes(n));
  const mirrorExtraInterfaces = Object.keys(local.interfaces).filter(n => !REQUIRED_INTERFACES.includes(n));
  assert.deepEqual(
    { mirrorExtraTypes, mirrorExtraInterfaces },
    { mirrorExtraTypes: [], mirrorExtraInterfaces: [] },
    `mirror が正本にない exported type/interface を追加しています: ${JSON.stringify({ mirrorExtraTypes, mirrorExtraInterfaces })}`
  );

  console.log('  [1/4] AST structure comparison: PASS');

  // --- Part 2: window.maplist raw IPC allowlist ---
  const WINDOW_MAPLIST_RAW = /(window\.maplist\.(?:request|delete|on|off)|\(\s*window\s+as\s+any\s*\)\s*\.\s*maplist\.(?:request|delete|on|off))/;
  const ALLOWLIST = new Set([
    'src/views/MapList.vue',
    'src/views/resource-adapters/mapListAdapter.ts', // M11-T6: 一覧データ取得は adapter 層経由

    'src/services/registeredMapCatalog.ts',
    'src/services/desktopMapList.ts',
  ]);

  async function walk(dir, acc = []) {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === 'dist') continue;
        await walk(p, acc);
      } else if (/\.(ts|tsx|vue)$/.test(e.name) && !/\.d\.ts$/.test(e.name)) {
        acc.push(p);
      }
    }
    return acc;
  }

  const offenders = [];
  for (const file of await walk(path.join(projectRoot, 'src'))) {
    const rel = path.relative(projectRoot, file).split(path.sep).join('/');
    if (ALLOWLIST.has(rel)) continue;
    const source = await readFile(file, 'utf8');
    if (WINDOW_MAPLIST_RAW.test(source)) offenders.push(rel);
  }
  assert.deepEqual(offenders, [], `raw window.maplist.* 直呼びが allowlist 外で検出されました: ${offenders.join(', ')}`);
  console.log('  [2/4] window.maplist raw IPC allowlist: PASS');

  // --- Part 3: MapList.vue regression (2-arg + docs + delete) ---
  // M11-T6: 一覧取得は mapListAdapter (2-arg request + result.docs) 経由。delete は MapList 側に残存
  const mapListView = await readFile(path.join(projectRoot, 'src/views/MapList.vue'), 'utf8');
  const mapListAdapterView = await readFile(path.join(projectRoot, 'src/views/resource-adapters/mapListAdapter.ts'), 'utf8');
  assert.match(mapListAdapterView, /window\.maplist\.request\(filter\.q, page\)/, 'mapListAdapter に 2-arg maplist.request() がない');
  assert.match(mapListView, /\(window as any\)\.maplist\.delete\(/, 'MapList.vue に (window as any).maplist.delete() がない');
  assert.match(mapListAdapterView, /result\.docs/, 'mapListAdapter に result.docs がない');
  console.log('  [3/4] MapList.vue regression: PASS');

  // --- Part 4: Unit smoke (adapter functions via dynamic import) ---
  const adapterSource = await readFile(path.join(projectRoot, 'src/services/registeredMapCatalog.ts'), 'utf8');
  const transpiled = ts.transpileModule(adapterSource, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
      strict: true,
    },
  });
  const bundledAdapter = path.join(workDir, 'registeredMapCatalog.mjs');
  await writeFile(bundledAdapter, transpiled.outputText);

  const {
    normalizeDesktopMapItem,
    normalizeDesktopListResult,
    createDesktopRegisteredMapCatalogFromBackend,
  } = await import(pathToFileURL(bundledAdapter).href);

  // 4a: normalizeDesktopMapItem
  const mapped = normalizeDesktopMapItem({
    mapID: 'edo', title: 'Edo', image: 'file://...', width: 190, height: 100,
  });
  assert.deepEqual(mapped, {
    catalogKey: 'desktop:edo',
    runtimeMapId: 'edo',
    title: 'Edo',
    width: 190,
    height: 100,
    thumbnailUrl: 'file://...',
    status: 'unknown',
  });

  // 4b: image: null → thumbnailUrl: null (not undefined)
  const mappedNull = normalizeDesktopMapItem({
    mapID: 'test', title: 'Test', image: null,
  });
  assert.equal(mappedNull.thumbnailUrl, null, 'image null → thumbnailUrl null');
  assert.ok(!('thumbnailUrl' in mappedNull) || mappedNull.thumbnailUrl === null, 'thumbnailUrl must not be undefined');

  // 4c: normalizeDesktopListResult
  const listResult = normalizeDesktopListResult(
    { docs: [{ mapID: 'a', title: 'A', image: null }], prev: false, next: true, pageUpdate: 2 },
    1
  );
  assert.equal(listResult.page, 2, 'pageUpdate takes precedence');
  assert.equal(listResult.hasNext, true);
  assert.equal(listResult.hasPrev, false);

  // 4d: pageUpdate absent → requestedPage
  const listResultNoPageUpdate = normalizeDesktopListResult(
    { docs: [], prev: false, next: false },
    3
  );
  assert.equal(listResultNoPageUpdate.page, 3, 'requestedPage used when pageUpdate absent');

  // 4e: pageSize echo via backend stub
  let receivedPageSize = null;
  const stub = async (query, page, pageSize) => {
    receivedPageSize = pageSize;
    return { docs: [{ mapID: 'x', title: 'X', image: null }], prev: false, next: false };
  };
  const catalog = createDesktopRegisteredMapCatalogFromBackend(stub);
  const resp = await catalog.listMaps({ query: '', page: 1, pageSize: 50 });
  assert.equal(receivedPageSize, 50, 'pageSize forwarded to backend');
  assert.equal(resp.items.length, 1);

  // 4f: invalid pageSize rejects (TypeError)
  for (const bad of [0, -1, 1.5, NaN, '20']) {
    await assert.rejects(
      () => catalog.listMaps({ query: '', page: 1, pageSize: bad }),
      { name: 'TypeError' },
      `pageSize ${JSON.stringify(bad)} should reject`
    );
  }

  // 4g: stub was NOT called for invalid pageSize (assertValidPageSize blocks before backend)
  let callCount = 0;
  const countingStub = async (query, page, pageSize) => {
    callCount++;
    return { docs: [], prev: false, next: false };
  };
  const countingCatalog = createDesktopRegisteredMapCatalogFromBackend(countingStub);
  await assert.rejects(() => countingCatalog.listMaps({ query: '', page: 1, pageSize: 0 }));
  assert.equal(callCount, 0, 'backend should not be called when pageSize is invalid');

  // 4h: createDesktopRegisteredMapCatalog() without window.maplist → Error
  const { createDesktopRegisteredMapCatalog } = await import(pathToFileURL(bundledAdapter).href);
  const savedWindow = globalThis.window;
  try {
    globalThis.window = undefined;
    await assert.rejects(
      () => createDesktopRegisteredMapCatalog().listMaps({ query: '', page: 1, pageSize: 20 }),
      (err) => {
        assert.ok(err instanceof Error, 'should be Error');
        assert.match(err.message, /window\.maplist/, 'error message should mention window.maplist');
        return true;
      },
      'createDesktopRegisteredMapCatalog() should reject when window.maplist is undefined'
    );
  } finally {
    globalThis.window = savedWindow;
  }

  // 4i: preload.ts signature check
  const preloadSource = await readFile(path.join(projectRoot, 'electron/preload.ts'), 'utf8');
  assert.match(
    preloadSource,
    /request:\s*\(query:\s*string,\s*page:\s*number,\s*pageSize\??:\s*number\)/,
    'preload.ts request signature should include optional pageSize'
  );

  console.log('  [4/4] Unit smoke: PASS');
  console.log('M1-T2 registered map catalog smoke passed');
} finally {
  await rm(workDir, { recursive: true, force: true });
}
