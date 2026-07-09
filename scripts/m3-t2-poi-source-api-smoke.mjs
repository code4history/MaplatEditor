import { readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);

// poisource:* IPC/preload 境界 (v2, uid/slug契約) の形状検査。
// channel prefix は poisource:* を維持しつつ、旧 saveLocal/validateRemote 契約が
// save/importFile/registerRemote/refreshRemote/cloneToLocal/findReferences へ刷新されていること
const CHANNELS = [
  'poisource:list',
  'poisource:get',
  'poisource:createLocal',
  'poisource:save',
  'poisource:importFile',
  'poisource:registerRemote',
  'poisource:refreshRemote',
  'poisource:cloneToLocal',
  'poisource:findReferences',
  'poisource:delete',
];
const RETIRED_CHANNELS = ['poisource:saveLocal', 'poisource:validateRemote'];

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

  // 各メソッドが対応チャネルを invoke すること
  assert.match(
    preloadSource,
    /list\s*:\s*\(request\s*:\s*any\)\s*=>\s*ipcRenderer\.invoke\s*\(\s*['"]poisource:list['"]\s*,\s*request\s*\)/,
    'preload.ts に list メソッドがない'
  );
  assert.match(
    preloadSource,
    /get\s*:\s*\(uid\s*:\s*string\)\s*=>\s*ipcRenderer\.invoke\s*\(\s*['"]poisource:get['"]\s*,\s*uid\s*\)/,
    'preload.ts に get メソッドがない (uid契約)'
  );
  assert.match(
    preloadSource,
    /createLocal\s*:\s*\(input\s*:\s*any\)\s*=>\s*ipcRenderer\.invoke\s*\(\s*['"]poisource:createLocal['"]\s*,\s*input\s*\)/,
    'preload.ts に createLocal メソッドがない'
  );
  assert.match(
    preloadSource,
    /save\s*:\s*\(uid\s*:\s*string,\s*payload\s*:\s*any\)\s*=>\s*ipcRenderer\.invoke\s*\(\s*['"]poisource:save['"]\s*,\s*uid,\s*payload\s*\)/,
    'preload.ts に save メソッドがない (uid + payload 契約)'
  );
  assert.match(
    preloadSource,
    /importFile\s*:\s*\(input\s*:\s*any\)\s*=>\s*ipcRenderer\.invoke\s*\(\s*['"]poisource:importFile['"]\s*,\s*input\s*\)/,
    'preload.ts に importFile メソッドがない'
  );
  assert.match(
    preloadSource,
    /registerRemote\s*:\s*\(input\s*:\s*any\)\s*=>\s*ipcRenderer\.invoke\s*\(\s*['"]poisource:registerRemote['"]\s*,\s*input\s*\)/,
    'preload.ts に registerRemote メソッドがない'
  );
  assert.match(
    preloadSource,
    /refreshRemote\s*:\s*\(uid\s*:\s*string\)\s*=>\s*ipcRenderer\.invoke\s*\(\s*['"]poisource:refreshRemote['"]\s*,\s*uid\s*\)/,
    'preload.ts に refreshRemote メソッドがない'
  );
  assert.match(
    preloadSource,
    /cloneToLocal\s*:\s*\(uid\s*:\s*string,\s*input\s*:\s*any\)\s*=>\s*ipcRenderer\.invoke\s*\(\s*['"]poisource:cloneToLocal['"]\s*,\s*uid,\s*input\s*\)/,
    'preload.ts に cloneToLocal メソッドがない'
  );
  assert.match(
    preloadSource,
    /findReferences\s*:\s*\(uid\s*:\s*string\)\s*=>\s*ipcRenderer\.invoke\s*\(\s*['"]poisource:findReferences['"]\s*,\s*uid\s*\)/,
    'preload.ts に findReferences メソッドがない'
  );
  assert.match(
    preloadSource,
    /delete\s*:\s*\(uid\s*:\s*string\)\s*=>\s*ipcRenderer\.invoke\s*\(\s*['"]poisource:delete['"]\s*,\s*uid\s*\)/,
    'preload.ts に delete メソッドがない'
  );

  // 旧契約チャネルが残存していないこと
  for (const retired of RETIRED_CHANNELS) {
    assert.doesNotMatch(
      preloadSource,
      new RegExp(`['"]${retired}['"]`),
      `preload.ts に旧チャネル ${retired} が残存している`
    );
  }

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

  assert.match(
    mainSource,
    /import\s*\{\s*registerPoisourceHandlers\s*\}\s*from\s*['"]\.\/ipc\/poisource['"]/,
    'main.ts に registerPoisourceHandlers の import がない'
  );
  assert.match(
    mainSource,
    /registerPoisourceHandlers\s*\(\s*\)/,
    'main.ts で registerPoisourceHandlers() が呼ばれていない'
  );

  // HMR 対策の removeHandler が全チャネル分あること
  for (const channel of CHANNELS) {
    assert.match(
      mainSource,
      new RegExp(`ipcMain\\.removeHandler\\s*\\(\\s*['"]${channel}['"]\\s*\\)`),
      `main.ts に ${channel} の removeHandler がない`
    );
  }
  for (const retired of RETIRED_CHANNELS) {
    assert.doesNotMatch(
      mainSource,
      new RegExp(`['"]${retired}['"]`),
      `main.ts に旧チャネル ${retired} が残存している`
    );
  }

  console.log('  [2/4] main.ts handler registration: PASS');

  // --- Part 3: electron.d.ts type declaration ---
  const electronDts = await readFile(
    path.join(projectRoot, 'src/electron.d.ts'),
    'utf8'
  );

  assert.match(
    electronDts,
    /export\s+interface\s+PoiSourcesAPI/,
    'electron.d.ts に PoiSourcesAPI がない'
  );
  assert.match(
    electronDts,
    /poiSources\s*:\s*PoiSourcesAPI/,
    'Window interface に poiSources がない'
  );

  // メソッド群 (uid/slug 契約)
  assert.match(electronDts, /list\s*\(\s*request\s*:/, 'PoiSourcesAPI に list メソッドがない');
  assert.match(electronDts, /get\s*\(\s*uid\s*:\s*string\s*\)/, 'PoiSourcesAPI に get メソッドがない');
  assert.match(electronDts, /createLocal\s*\(\s*input\s*:\s*\{\s*slug\s*:/, 'PoiSourcesAPI の createLocal が slug 契約でない');
  assert.match(electronDts, /save\s*\(\s*uid\s*:\s*string/, 'PoiSourcesAPI に save メソッドがない');
  assert.match(electronDts, /importFile\s*\(\s*input\s*:/, 'PoiSourcesAPI に importFile メソッドがない');
  assert.match(electronDts, /registerRemote\s*\(\s*input\s*:/, 'PoiSourcesAPI に registerRemote メソッドがない');
  assert.match(electronDts, /refreshRemote\s*\(\s*uid\s*:\s*string\s*\)/, 'PoiSourcesAPI に refreshRemote メソッドがない');
  assert.match(electronDts, /cloneToLocal\s*\(\s*uid\s*:\s*string/, 'PoiSourcesAPI に cloneToLocal メソッドがない');
  assert.match(electronDts, /findReferences\s*\(\s*uid\s*:\s*string\s*\)/, 'PoiSourcesAPI に findReferences メソッドがない');
  assert.match(electronDts, /delete\s*\(\s*uid\s*:\s*string\s*\)/, 'PoiSourcesAPI に delete メソッドがない');

  // 保存結果 union が maps/apps と同形であること
  assert.match(
    electronDts,
    /PoiSourceSaveResult[\s\S]*?\{\s*error\s*:\s*'revision-conflict';\s*current\s*:\s*number\s*\}/,
    'PoiSourceSaveResult に revision-conflict がない'
  );

  console.log('  [3/4] electron.d.ts type declaration: PASS');

  // --- Part 4: IPC handler shape ---
  const poisourceHandler = await readFile(
    path.join(projectRoot, 'electron/ipc/poisource.ts'),
    'utf8'
  );

  assert.match(
    poisourceHandler,
    /ipcMain\.handle/,
    'poisource.ts が ipcMain.handle を使っていない'
  );
  for (const channel of CHANNELS) {
    assert.match(
      poisourceHandler,
      new RegExp(`['"]${channel}['"]`),
      `poisource.ts に ${channel} チャネルがない`
    );
  }
  for (const retired of RETIRED_CHANNELS) {
    assert.doesNotMatch(
      poisourceHandler,
      new RegExp(`['"]${retired}['"]`),
      `poisource.ts に旧チャネル ${retired} が残存している`
    );
  }
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
