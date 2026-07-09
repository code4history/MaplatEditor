import { readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);

try {
  const undoStack = await readFile(
    path.join(projectRoot, 'src/services/editorUndoStack.ts'),
    'utf8'
  );

  assert.match(undoStack, /const\s+MAX_HISTORY\s*=\s*100/, 'UndoStack must keep SaaS MAX_HISTORY=100');
  assert.match(undoStack, /export\s+class\s+UndoStack<T>/, 'UndoStack class is missing');
  assert.match(undoStack, /canUndo\s*\(\)\s*:\s*boolean/, 'UndoStack.canUndo() is missing');
  assert.match(undoStack, /canRedo\s*\(\)\s*:\s*boolean/, 'UndoStack.canRedo() is missing');
  assert.match(undoStack, /isDirty\s*\(\)\s*:\s*boolean/, 'UndoStack.isDirty() is missing');
  assert.match(undoStack, /static\s+fromSnapshot<T>/, 'UndoStack.fromSnapshot() is missing');

  console.log('  [1/3] UndoStack SaaS parity surface: PASS');

  const mapEdit = await readFile(
    path.join(projectRoot, 'src/views/MapEdit.vue'),
    'utf8'
  );

  assert.match(mapEdit, /import\s+\{\s*UndoStack/, 'MapEdit.vue must import UndoStack');
  assert.match(mapEdit, /type\s+MapEditHistoryState/, 'MapEdit.vue must define MapEditHistoryState');
  assert.match(mapEdit, /captureHistoryState\s*\(\)/, 'MapEdit.vue must capture editable state');
  assert.match(mapEdit, /restoreHistoryState\s*\(/, 'MapEdit.vue must restore editable state');
  assert.match(mapEdit, /historyStack\s*=\s*ref<UndoStack<MapEditHistoryState>\s*\|\s*null>/, 'MapEdit.vue must own an UndoStack ref');
  assert.match(mapEdit, /canUndo\s*=\s*computed/, 'MapEdit.vue must expose canUndo');
  assert.match(mapEdit, /canRedo\s*=\s*computed/, 'MapEdit.vue must expose canRedo');
  assert.match(mapEdit, /performUndo\s*=\s*async/, 'MapEdit.vue must implement performUndo');
  assert.match(mapEdit, /performRedo\s*=\s*async/, 'MapEdit.vue must implement performRedo');
  assert.match(mapEdit, /recordHistorySnapshot/, 'MapEdit.vue must record history snapshots');
  assert.match(mapEdit, /historyRestoring/, 'MapEdit.vue must guard restore from recording new history');

  console.log('  [2/3] MapEdit history integration surface: PASS');

  assert.match(mapEdit, /@click="performUndo"/, 'MapEdit.vue must wire Undo button');
  assert.match(mapEdit, /@click="performRedo"/, 'MapEdit.vue must wire Redo button');
  assert.match(mapEdit, /:disabled="!canUndo"/, 'Undo button must be disabled when unavailable');
  assert.match(mapEdit, /:disabled="!canRedo"/, 'Redo button must be disabled when unavailable');
  assert.match(mapEdit, /keydown/, 'MapEdit.vue must register keyboard shortcuts');
  assert.match(mapEdit, /metaKey\s*\|\|\s*event\.ctrlKey/, 'Keyboard shortcuts must support Cmd/Ctrl');
  assert.match(mapEdit, /performUndo\s*\(\)/, 'Keyboard shortcut must call performUndo');
  assert.match(mapEdit, /performRedo\s*\(\)/, 'Keyboard shortcut must call performRedo');
  assert.match(mapEdit, /historyStack\.value\.save\s*\(\)/, 'Save success must reset dirty history base');
  assert.match(mapEdit, /onMainProcessMessage/, 'MapEdit.vue must handle Electron menu undo/redo messages');

  const saveSuccessBlock = mapEdit.match(/if\s*\(result\s*&&\s*result\.result\s*===\s*'Success'\)\s*\{[\s\S]*?\}\s*else\s+if\s*\(result\s*&&\s*result\.result\s*===\s*'Exist'\)/)?.[0] ?? '';
  assert.ok(saveSuccessBlock, 'MapEdit.vue save success branch could not be located');
  assert.doesNotMatch(saveSuccessBlock, /mapedit\.request/, 'Save success must not reload the map after saving');

  const electronMain = await readFile(
    path.join(projectRoot, 'electron/main.ts'),
    'utf8'
  );
  assert.match(electronMain, /menu:undo/, 'Electron menu must send an app undo message');
  assert.match(electronMain, /menu:redo/, 'Electron menu must send an app redo message');
  assert.doesNotMatch(electronMain, /role:\s*['"]undo['"]/, 'Electron Undo menu must not use native role only');
  assert.doesNotMatch(electronMain, /role:\s*['"]redo['"]/, 'Electron Redo menu must not use native role only');

  console.log('  [3/3] Undo/Redo UI and shortcut wiring: PASS');
  console.log('M4 Undo/Redo smoke passed');
} catch (err) {
  console.error('M4 Undo/Redo smoke FAILED:', err.message);
  process.exit(1);
}
