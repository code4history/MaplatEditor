import { readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);

try {
  // --- Part 1: preload.ts shape ---
  const preloadSource = await readFile(
    path.join(projectRoot, 'electron/preload.ts'),
    'utf8'
  );

  // poiSources が exposeInMainWorld で公開されていること
  assert.match(
    preloadSource,
    /exposeInMainWorld\s*\(\s*['"]poiSources['"]\s*,/,
    'preload.ts に exposeInMainWorld("poiSources", ...) がない'
  );

  // list メソッドが存在すること
  assert.match(
    preloadSource,
    /list\s*:\s*\(request\s*:\s*any\)\s*=>\s*ipcRenderer\.invoke\s*\(\s*['"]poisource:list['"]\s*,\s*request\s*\)/,
    'preload.ts に list メソッドがない'
  );

  // get メソッドが存在すること
  assert.match(
    preloadSource,
    /get\s*:\s*\(sourceId\s*:\s*string\)\s*=>\s*ipcRenderer\.invoke\s*\(\s*['"]poisource:get['"]\s*,\s*sourceId\s*\)/,
    'preload.ts に get メソッドがない'
  );

  // createLocal メソッドが存在すること
  assert.match(
    preloadSource,
    /createLocal\s*:\s*\(input\s*:\s*any\)\s*=>\s*ipcRenderer\.invoke\s*\(\s*['"]poisource:createLocal['"]\s*,\s*input\s*\)/,
    'preload.ts に createLocal メソッドがない'
  );

  // registerRemote メソッドが存在すること
  assert.match(
    preloadSource,
    /registerRemote\s*:\s*\(input\s*:\s*any\)\s*=>\s*ipcRenderer\.invoke\s*\(\s*['"]poisource:registerRemote['"]\s*,\s*input\s*\)/,
    'preload.ts に registerRemote メソッドがない'
  );

  // validateRemote メソッドが存在すること
  assert.match(
    preloadSource,
    /validateRemote\s*:\s*\(input\s*:\s*any\)\s*=>\s*ipcRenderer\.invoke\s*\(\s*['"]poisource:validateRemote['"]\s*,\s*input\s*\)/,
    'preload.ts に validateRemote メソッドがない'
  );

  // saveLocal メソッドが存在すること
  assert.match(
    preloadSource,
    /saveLocal\s*:\s*\(sourceId\s*:\s*string,\s*geojson\s*:\s*any\)\s*=>\s*ipcRenderer\.invoke\s*\(\s*['"]poisource:saveLocal['"]\s*,\s*sourceId,\s*geojson\s*\)/,
    'preload.ts に saveLocal メソッドがない'
  );

  // delete メソッドが存在すること
  assert.match(
    preloadSource,
    /delete\s*:\s*\(sourceId\s*:\s*string\)\s*=>\s*ipcRenderer\.invoke\s*\(\s*['"]poisource:delete['"]\s*,\s*sourceId\s*\)/,
    'preload.ts に delete メソッドがない'
  );

  // ipcRenderer が exposeInMainWorld で公開されていないこと (m2 security gate 維持)
  assert.doesNotMatch(
    preloadSource,
    /exposeInMainWorld\s*\(\s*['"]ipcRenderer['"]\s*,/,
    'preload.ts に exposeInMainWorld("ipcRenderer", ...) が残存している'
  );

  console.log('  [1/4] preload.ts shape: PASS');

  // --- Part 2: main.ts handler registration ---
  const mainSource = await readFile(
    path.join(projectRoot, 'electron/main.ts'),
    'utf8'
  );

  // registerPoisourceHandlers が import されていること
  assert.match(
    mainSource,
    /import\s*\{\s*registerPoisourceHandlers\s*\}\s*from\s*['"]\.\/ipc\/poisource['"]/,
    'main.ts に registerPoisourceHandlers の import がない'
  );

  // registerPoisourceHandlers() が呼ばれていること
  assert.match(
    mainSource,
    /registerPoisourceHandlers\s*\(\s*\)/,
    'main.ts で registerPoisourceHandlers() が呼ばれていない'
  );

  // poisource:list の removeHandler が存在すること
  assert.match(
    mainSource,
    /ipcMain\.removeHandler\s*\(\s*['"]poisource:list['"]\s*\)/,
    'main.ts に poisource:list の removeHandler がない'
  );

  // poisource:get の removeHandler が存在すること
  assert.match(
    mainSource,
    /ipcMain\.removeHandler\s*\(\s*['"]poisource:get['"]\s*\)/,
    'main.ts に poisource:get の removeHandler がない'
  );

  // poisource:createLocal の removeHandler が存在すること
  assert.match(
    mainSource,
    /ipcMain\.removeHandler\s*\(\s*['"]poisource:createLocal['"]\s*\)/,
    'main.ts に poisource:createLocal の removeHandler がない'
  );

  // poisource:registerRemote の removeHandler が存在すること
  assert.match(
    mainSource,
    /ipcMain\.removeHandler\s*\(\s*['"]poisource:registerRemote['"]\s*\)/,
    'main.ts に poisource:registerRemote の removeHandler がない'
  );

  // poisource:validateRemote の removeHandler が存在すること
  assert.match(
    mainSource,
    /ipcMain\.removeHandler\s*\(\s*['"]poisource:validateRemote['"]\s*\)/,
    'main.ts に poisource:validateRemote の removeHandler がない'
  );

  // poisource:saveLocal の removeHandler が存在すること
  assert.match(
    mainSource,
    /ipcMain\.removeHandler\s*\(\s*['"]poisource:saveLocal['"]\s*\)/,
    'main.ts に poisource:saveLocal の removeHandler がない'
  );

  // poisource:delete の removeHandler が存在すること
  assert.match(
    mainSource,
    /ipcMain\.removeHandler\s*\(\s*['"]poisource:delete['"]\s*\)/,
    'main.ts に poisource:delete の removeHandler がない'
  );

  console.log('  [2/4] main.ts handler registration: PASS');

  // --- Part 3: electron.d.ts type declaration ---
  const electronDts = await readFile(
    path.join(projectRoot, 'src/electron.d.ts'),
    'utf8'
  );

  // PoiSourcesAPI が export されていること
  assert.match(
    electronDts,
    /export\s+interface\s+PoiSourcesAPI/,
    'electron.d.ts に PoiSourcesAPI がない'
  );

  // Window interface に poiSources が含まれていること
  assert.match(
    electronDts,
    /poiSources\s*:\s*PoiSourcesAPI/,
    'Window interface に poiSources がない'
  );

  // PoiSourcesAPI に list メソッドがあること
  assert.match(
    electronDts,
    /list\s*\(\s*request\s*:/,
    'PoiSourcesAPI に list メソッドがない'
  );

  // PoiSourcesAPI に get メソッドがあること
  assert.match(
    electronDts,
    /get\s*\(\s*sourceId\s*:\s*string\s*\)/,
    'PoiSourcesAPI に get メソッドがない'
  );

  // PoiSourcesAPI に createLocal メソッドがあること
  assert.match(
    electronDts,
    /createLocal\s*\(\s*input\s*:/,
    'PoiSourcesAPI に createLocal メソッドがない'
  );

  // PoiSourcesAPI に registerRemote メソッドがあること
  assert.match(
    electronDts,
    /registerRemote\s*\(\s*input\s*:/,
    'PoiSourcesAPI に registerRemote メソッドがない'
  );

  // PoiSourcesAPI に validateRemote メソッドがあること
  assert.match(
    electronDts,
    /validateRemote\s*\(\s*input\s*:/,
    'PoiSourcesAPI に validateRemote メソッドがない'
  );

  // PoiSourcesAPI に saveLocal メソッドがあること
  assert.match(
    electronDts,
    /saveLocal\s*\(\s*sourceId\s*:\s*string/,
    'PoiSourcesAPI に saveLocal メソッドがない'
  );

  // PoiSourcesAPI に delete メソッドがあること
  assert.match(
    electronDts,
    /delete\s*\(\s*sourceId\s*:\s*string\s*\)/,
    'PoiSourcesAPI に delete メソッドがない'
  );

  console.log('  [3/4] electron.d.ts type declaration: PASS');

  // --- Part 4: IPC handler shape ---
  const poisourceHandler = await readFile(
    path.join(projectRoot, 'electron/ipc/poisource.ts'),
    'utf8'
  );

  // ipcMain.handle を使うこと
  assert.match(
    poisourceHandler,
    /ipcMain\.handle/,
    'poisource.ts が ipcMain.handle を使っていない'
  );

  // poisource:list チャネルが定義されていること
  assert.match(
    poisourceHandler,
    /['"]poisource:list['"]/,
    'poisource.ts に poisource:list チャネルがない'
  );

  // poisource:get チャネルが定義されていること
  assert.match(
    poisourceHandler,
    /['"]poisource:get['"]/,
    'poisource.ts に poisource:get チャネルがない'
  );

  // poisource:createLocal チャネルが定義されていること
  assert.match(
    poisourceHandler,
    /['"]poisource:createLocal['"]/,
    'poisource.ts に poisource:createLocal チャネルがない'
  );

  // poisource:registerRemote チャネルが定義されていること
  assert.match(
    poisourceHandler,
    /['"]poisource:registerRemote['"]/,
    'poisource.ts に poisource:registerRemote チャネルがない'
  );

  // poisource:validateRemote チャネルが定義されていること
  assert.match(
    poisourceHandler,
    /['"]poisource:validateRemote['"]/,
    'poisource.ts に poisource:validateRemote チャネルがない'
  );

  // poisource:saveLocal チャネルが定義されていること
  assert.match(
    poisourceHandler,
    /['"]poisource:saveLocal['"]/,
    'poisource.ts に poisource:saveLocal チャネルがない'
  );

  // poisource:delete チャネルが定義されていること
  assert.match(
    poisourceHandler,
    /['"]poisource:delete['"]/,
    'poisource.ts に poisource:delete チャネルがない'
  );

  // registerPoisourceHandlers が export されていること
  assert.match(
    poisourceHandler,
    /export\s+function\s+registerPoisourceHandlers/,
    'poisource.ts に registerPoisourceHandlers の export がない'
  );

  console.log('  [4/4] IPC handler shape: PASS');

  console.log('M3-T2 Electron safe API / preload 境界 smoke passed');
} catch (err) {
  console.error('M3-T2 smoke FAILED:', err.message);
  process.exit(1);
}
