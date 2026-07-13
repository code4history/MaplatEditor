import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });

async function importSource(relativeEntry, fileName) {
  const workDir = await mkdtemp(path.join(scratchRoot, 'm11-t3-'));
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
          entry: path.join(projectRoot, relativeEntry),
          formats: ['es'],
          fileName: () => fileName,
        },
      },
    });
    return await import(`${pathToFileURL(path.join(outDir, fileName)).href}?t=${Date.now()}`);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

const header = await readFile(
  path.join(projectRoot, 'src/components/editor-ui/EditorActionHeader.vue'),
  'utf8',
);
assert.match(
  header,
  /data-editor-action="language"[\s\S]*data-editor-action="undo"[\s\S]*data-editor-action="redo"[\s\S]*<slot name="actions"[\s\S]*data-editor-action="save"/,
  'Header action order must remain Lang → Undo → Redo → actions → Save',
);
assert.match(header, /saveVisible\?: boolean/);
assert.match(header, /actionsDisabled\?: boolean/);
assert.match(header, /v-if="saveVisible"/);
assert.match(header, /saving \|\| actionsDisabled \|\| !canUndo/);
assert.match(header, /saving \|\| actionsDisabled \|\| saveDisabled/);
console.log('  [1/4] Shared Header visibility and disable contract: PASS');

const busy = await readFile(
  path.join(projectRoot, 'src/components/editor-ui/EditorBusyOverlay.vue'),
  'utf8',
);
assert.match(busy, /v-if="visible"/);
assert.match(busy, /aria-busy="true"/);
assert.match(busy, /role="status"/);
assert.match(busy, /position:\s*fixed/);
assert.match(busy, /z-index:/);
console.log('  [2/4] Busy overlay blocks the workspace accessibly: PASS');

const languageInput = await readFile(
  path.join(projectRoot, 'src/components/LangResourceInput.vue'),
  'utf8',
);
assert.match(languageInput, /activeLang\?:\s*LangCode/);
assert.match(languageInput, /languageOptions\?:\s*readonly/);
assert.match(languageInput, /<LangValueChips/);
assert.match(languageInput, /:active-lang="activeLang"/);
assert.match(languageInput, /emit\(['"]selectLanguage['"],\s*code\)/);
assert.doesNotMatch(languageInput, /const activeLang = ref/);
assert.doesNotMatch(languageInput, /class="nav nav-tabs lang-tabs"/);
console.log('  [3/4] Multilingual input follows the editor language: PASS');

const { runEditorExportDecision } = await importSource(
  'src/composables/useEditorExportDecision.ts',
  'editorExportDecision.mjs',
);

async function exercise({ dirty, hasSaved, choice = 'cancel', saveResult = true, exportResult = true }) {
  const calls = [];
  const result = await runEditorExportDecision({
    dirty,
    hasSaved,
    choose: async (choiceHasSaved) => {
      calls.push(['choose', choiceHasSaved]);
      return choice;
    },
    save: async () => {
      calls.push(['save']);
      return saveResult;
    },
    exportSaved: async () => {
      calls.push(['export']);
      return exportResult;
    },
  });
  return { calls, result };
}

assert.deepEqual(await exercise({ dirty: false, hasSaved: true }), {
  calls: [['export']],
  result: 'exported',
});
assert.deepEqual(await exercise({ dirty: true, hasSaved: true, choice: 'saved' }), {
  calls: [['choose', true], ['export']],
  result: 'exported',
});
assert.deepEqual(await exercise({ dirty: true, hasSaved: true, choice: 'save' }), {
  calls: [['choose', true], ['save'], ['export']],
  result: 'exported',
});
assert.deepEqual(await exercise({ dirty: true, hasSaved: false, choice: 'save', saveResult: false }), {
  calls: [['choose', false], ['save']],
  result: 'save-failed',
});
assert.deepEqual(await exercise({ dirty: true, hasSaved: false, choice: 'saved' }), {
  calls: [['choose', false]],
  result: 'canceled',
});
assert.deepEqual(await exercise({ dirty: true, hasSaved: true, choice: 'cancel' }), {
  calls: [['choose', true]],
  result: 'canceled',
});
assert.deepEqual(await exercise({ dirty: false, hasSaved: false }), {
  calls: [],
  result: 'save-failed',
});
console.log('  [4/5] Saved-state Export decision edge cases: PASS');

const mapEdit = await readFile(path.join(projectRoot, 'src/views/MapEdit.vue'), 'utf8');
assert.match(mapEdit, /import EditorActionHeader from/);
assert.match(mapEdit, /import EditorBusyOverlay from/);
assert.match(mapEdit, /import \{ runEditorExportDecision \} from/);
assert.match(mapEdit, /<EditorActionHeader[\s\S]*@save="saveMap"/);
assert.match(mapEdit, /data-editor-action="export"[\s\S]*@click="exportMap"/);
assert.match(mapEdit, /<EditorBusyOverlay[\s\S]*:visible="saving \|\| exporting"/);
assert.match(mapEdit, /const saveState = computed/);
assert.match(mapEdit, /draftLifecycle\.draftRestored\.value/);
assert.match(mapEdit, /runEditorExportDecision\(/);
assert.match(mapEdit, /window\.mapedit\.previewSource\(mapUid\.value/);
assert.match(mapEdit, /key === ['"]s['"][\s\S]*saveMap\(\)/);
assert.match(mapEdit, /data-editor-document-language/);
assert.doesNotMatch(
  mapEdit,
  /@click\.prevent="activeTab = 'inout'"/,
  'Map入出力tabは表示しない',
);
assert.match(
  mapEdit,
  /v-show="activeTab === 'inout'"/,
  'WMTS/CSV実装は後続再配置まで保持する',
);
console.log('  [5/5] Map editor uses the shared shell and saved-state Export: PASS');

console.log('m11-t3 editor shell smoke: PASS');
