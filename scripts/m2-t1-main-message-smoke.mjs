import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const workDir = await mkdtemp(path.join(tmpdir(), 'maplat-editor-m2-t1-'));

try {
  // --- Part 1: preload.ts appEvents 定義 ---
  const preloadSource = await readFile(
    path.join(projectRoot, 'electron/preload.ts'),
    'utf8'
  );

  // appEvents を contextBridge.exposeInMainWorld で公開していることを確認
  assert.match(
    preloadSource,
    /contextBridge\.exposeInMainWorld\s*\(\s*['"]appEvents['"]/,
    'preload.ts に appEvents の公開がない'
  );

  // onMainProcessMessage メソッドが存在することを確認
  assert.match(
    preloadSource,
    /onMainProcessMessage\s*\(\s*listener\s*:\s*\(\s*message\s*:\s*string\s*\)\s*=>\s*void\s*\)\s*:\s*\(\s*\)\s*=>\s*void/,
    'preload.ts に onMainProcessMessage メソッドがない'
  );

  // ipcRenderer.on('main-process-message', wrapper) を呼んでいることを確認
  assert.match(
    preloadSource,
    /ipcRenderer\.on\s*\(\s*['"]main-process-message['"]\s*,\s*wrapper\s*\)/,
    'preload.ts が ipcRenderer.on を呼んでいない'
  );

  // ipcRenderer.removeListener を呼ぶ unsubscribe 関数を返していることを確認
  assert.match(
    preloadSource,
    /return\s*\(\)\s*=>\s*\{[\s\S]*?ipcRenderer\.removeListener\s*\(\s*['"]main-process-message['"]\s*,\s*wrapper\s*\)/,
    'preload.ts が unsubscribe 関数を返していない'
  );

  console.log('  [1/3] preload.ts appEvents 定義: PASS');

  // --- Part 2: main.ts 移行確認 ---
  const mainSource = await readFile(
    path.join(projectRoot, 'src/main.ts'),
    'utf8'
  );

  // main.ts が window.appEvents.onMainProcessMessage を使っていることを確認
  assert.match(
    mainSource,
    /window\.appEvents\.onMainProcessMessage\s*\(/,
    'main.ts が window.appEvents.onMainProcessMessage を使っていない'
  );

  // main.ts が window.ipcRenderer.on('main-process-message', ...) を使っていないことを確認
  assert.doesNotMatch(
    mainSource,
    /window\.ipcRenderer\.on\s*\(\s*['"]main-process-message['"]/,
    'main.ts に旧 IPC 呼び出しが残存している'
  );

  // main.ts が listener で payload-only (message のみ) を受け取っていることを確認
  assert.match(
    mainSource,
    /window\.appEvents\.onMainProcessMessage\s*\(\s*\(\s*message\s*\)\s*=>/,
    'main.ts の listener が payload-only (message のみ) を受け取っていない'
  );

  console.log('  [2/3] main.ts 移行確認: PASS');

  // --- Part 3: electron.d.ts 型宣言 ---
  const electronDts = await readFile(
    path.join(projectRoot, 'src/electron.d.ts'),
    'utf8'
  );

  // AppEventsAPI が宣言されていることを確認
  assert.match(
    electronDts,
    /export\s+interface\s+AppEventsAPI/,
    'electron.d.ts に AppEventsAPI がない'
  );

  // onMainProcessMessage のシグネチャを確認
  assert.match(
    electronDts,
    /onMainProcessMessage\s*\(\s*listener\s*:\s*\(\s*message\s*:\s*string\s*\)\s*=>\s*void\s*\)\s*:\s*\(\s*\)\s*=>\s*void/,
    'AppEventsAPI の onMainProcessMessage シグネチャが不正'
  );

  // Window interface に appEvents が含まれていることを確認
  assert.match(
    electronDts,
    /appEvents\s*:\s*AppEventsAPI/,
    'Window interface に appEvents がない'
  );

  console.log('  [3/3] electron.d.ts 型宣言: PASS');

  console.log('M2-T1 main-process-message smoke passed');
} finally {
  await rm(workDir, { recursive: true, force: true });
}
