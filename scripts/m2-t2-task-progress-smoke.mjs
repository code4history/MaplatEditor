import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const workDir = await mkdtemp(path.join(tmpdir(), 'maplat-editor-m2-t2-'));

try {
  // --- Part 1: preload.ts mapedit.onProgress 定義 ---
  const preloadSource = await readFile(
    path.join(projectRoot, 'electron/preload.ts'),
    'utf8'
  );

  // mapedit API 内に onProgress メソッドが存在することを確認
  assert.match(
    preloadSource,
    /onProgress\s*\(\s*listener\s*:\s*\(\s*progress\s*:\s*any\s*\)\s*=>\s*void\s*\)\s*:\s*\(\s*\)\s*=>\s*void/,
    'preload.ts に onProgress メソッドがない'
  );

  // ipcRenderer.on('mapedit:taskProgress', wrapper) を呼んでいることを確認
  assert.match(
    preloadSource,
    /ipcRenderer\.on\s*\(\s*['"]mapedit:taskProgress['"]\s*,\s*wrapper\s*\)/,
    'preload.ts が ipcRenderer.on を呼んでいない'
  );

  // ipcRenderer.removeListener を呼ぶ unsubscribe 関数を返していることを確認
  assert.match(
    preloadSource,
    /return\s*\(\)\s*=>\s*\{[\s\S]*?ipcRenderer\.removeListener\s*\(\s*['"]mapedit:taskProgress['"]\s*,\s*wrapper\s*\)/,
    'preload.ts が unsubscribe 関数を返していない'
  );

  console.log('  [1/3] preload.ts mapedit.onProgress 定義: PASS');

  // --- Part 2: MapEdit.vue 移行確認 ---
  const mapeditSource = await readFile(
    path.join(projectRoot, 'src/views/MapEdit.vue'),
    'utf8'
  );

  // MapEdit.vue が window.mapedit.onProgress を使っていることを確認
  assert.match(
    mapeditSource,
    /window\.mapedit\.onProgress\s*\(/,
    'MapEdit.vue が window.mapedit.onProgress を使っていない'
  );

  // MapEdit.vue が (window as any).ipcRenderer.on('mapedit:taskProgress', ...) を使っていないことを確認
  assert.doesNotMatch(
    mapeditSource,
    /\(window\s+as\s+any\)\.ipcRenderer\.on\s*\(\s*['"]mapedit:taskProgress['"]/,
    'MapEdit.vue に旧 IPC 呼び出しが残存している (on)'
  );

  // MapEdit.vue が (window as any).ipcRenderer.off('mapedit:taskProgress', ...) を使っていないことを確認
  assert.doesNotMatch(
    mapeditSource,
    /\(window\s+as\s+any\)\.ipcRenderer\.off\s*\(\s*['"]mapedit:taskProgress['"]/,
    'MapEdit.vue に旧 IPC 呼び出しが残存している (off)'
  );

  // unsubscribe() が finally ブロックで呼ばれていることを確認 (4 blocks)
  const unsubscribeCalls = mapeditSource.match(/unsubscribe\(\)/g);
  assert.ok(
    unsubscribeCalls && unsubscribeCalls.length >= 4,
    `MapEdit.vue で unsubscribe() が 4 回呼ばれていない (実際: ${unsubscribeCalls ? unsubscribeCalls.length : 0} 回)`
  );

  console.log('  [2/3] MapEdit.vue 移行確認: PASS');

  // --- Part 3: electron.d.ts 型宣言 ---
  const electronDts = await readFile(
    path.join(projectRoot, 'src/electron.d.ts'),
    'utf8'
  );

  // MapEditAPI が宣言されていることを確認
  assert.match(
    electronDts,
    /export\s+interface\s+MapEditAPI/,
    'electron.d.ts に MapEditAPI がない'
  );

  // onProgress のシグネチャを確認
  assert.match(
    electronDts,
    /onProgress\s*\(\s*listener\s*:\s*\(\s*progress\s*:\s*any\s*\)\s*=>\s*void\s*\)\s*:\s*\(\s*\)\s*=>\s*void/,
    'MapEditAPI の onProgress シグネチャが不正'
  );

  // Window interface に mapedit が含まれていることを確認
  assert.match(
    electronDts,
    /mapedit\s*:\s*MapEditAPI/,
    'Window interface に mapedit がない'
  );

  console.log('  [3/3] electron.d.ts 型宣言: PASS');

  console.log('M2-T2 task-progress smoke passed');
} finally {
  await rm(workDir, { recursive: true, force: true });
}
