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
assert.match(header, /data-testid="editor-back"/);
assert.match(header, /data-testid="editor-save"/);
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
assert.match(mapEdit, /editor_ui\.export_dirty_prompt/);
assert.match(mapEdit, /editor_ui\.export_save_and_run/);
assert.match(mapEdit, /editor_ui\.export_saved_only/);
assert.match(mapEdit, /editor_ui\.busy_exporting/);
assert.match(mapEdit, /window\.mapedit\.previewSource\(mapUid\.value/);
assert.match(mapEdit, /key === ['"]s['"][\s\S]*saveMap\(\)/);
assert.match(mapEdit, /data-editor-document-language/);
const mapMenuHandler = mapEdit.slice(
  mapEdit.indexOf('const onMainProcessMessage ='),
  mapEdit.indexOf('/**', mapEdit.indexOf('const onMainProcessMessage =')),
);
assert.match(mapMenuHandler, /if \(saving\.value \|\| exporting\.value\) return/);
assert.match(mapEdit, /modalShow\(t\(['"]editor_ui\.busy_exporting['"]\)\)/);
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
console.log('  [5/6] Map editor uses the shared shell and saved-state Export: PASS');

const appEdit = await readFile(path.join(projectRoot, 'src/views/AppEdit.vue'), 'utf8');
assert.match(appEdit, /import EditorActionHeader from/);
assert.match(appEdit, /import EditorBusyOverlay from/);
assert.match(appEdit, /import \{ runEditorExportDecision \} from/);
assert.match(appEdit, /<EditorActionHeader[\s\S]*@save="saveApp"/);
assert.match(appEdit, /data-editor-action="export"[\s\S]*@click="exportApp"/);
assert.match(appEdit, /<EditorBusyOverlay[\s\S]*:visible="saving \|\| exporting"/);
assert.match(appEdit, /const saveState = computed/);
assert.match(appEdit, /draftLifecycle\.draftRestored\.value/);
assert.match(appEdit, /runEditorExportDecision\(/);
assert.match(appEdit, /editor_ui\.export_dirty_prompt/);
assert.match(appEdit, /editor_ui\.export_save_and_run/);
assert.match(appEdit, /editor_ui\.export_saved_only/);
assert.match(appEdit, /editor_ui\.busy_exporting/);
assert.match(appEdit, /window\.appedit\.request\(appUid\.value/);
assert.match(appEdit, /key === ['"]s['"][\s\S]*saveApp\(\)/);
assert.match(appEdit, /key === ['"]z['"][\s\S]*performUndo\(\)/);
assert.match(appEdit, /key === ['"]y['"][\s\S]*performRedo\(\)/);
assert.match(appEdit, /isEditableElement\(/);
assert.match(appEdit, /data-editor-document-language/);
const appUndoRedo = appEdit.slice(
  appEdit.indexOf('function performUndo()'),
  appEdit.indexOf('function onEditorKeydown'),
);
assert.doesNotMatch(
  appUndoRedo,
  /currentLang\.value\s*=\s*appData\.value\.lang/,
  'Undo/Redo must not reset the independent editor language',
);
assert.match(appEdit, /activeTab === 'preview'/, 'Preview tab must remain available');
assert.doesNotMatch(
  appEdit,
  /:disabled="isDirty \|\| !onlyOne \|\| exporting"/,
  'dirty App Export must offer a choice instead of being disabled',
);
console.log('  [6/8] App editor uses the shared shell, shortcuts, and saved-state Export: PASS');

const poiEdit = await readFile(path.join(projectRoot, 'src/views/PoiEdit.vue'), 'utf8');
assert.match(poiEdit, /import EditorActionHeader from/);
assert.match(poiEdit, /import EditorBusyOverlay from/);
assert.match(poiEdit, /import \{ runEditorExportDecision \} from/);
assert.match(poiEdit, /<EditorActionHeader[\s\S]*:save-visible="!readOnly"/);
assert.match(poiEdit, /data-editor-action="export"[\s\S]*@click="exportSource"/);
assert.match(poiEdit, /<EditorBusyOverlay[\s\S]*:visible="saving \|\| exporting \|\| cloning"/);
assert.match(poiEdit, /<PoiAttributeForm[\s\S]*:active-lang="currentLang"/);
assert.match(poiEdit, /<LangResourceInput[\s\S]*:active-lang="currentLang"/);
assert.match(poiEdit, /window\.poiSources\.exportFile\(uid\)/);
assert.match(poiEdit, /key === ['"]s['"][\s\S]*saveSource\(\)/);
assert.match(poiEdit, /const saveState = computed/);
assert.doesNotMatch(poiEdit, /class="poi-saving-overlay/);

const poiAttributes = await readFile(
  path.join(projectRoot, 'src/components/PoiAttributeForm.vue'),
  'utf8',
);
assert.match(poiAttributes, /activeLang:\s*LangCode/);
assert.match(poiAttributes, /languageOptions:\s*readonly/);
assert.match(poiAttributes, /:active-lang="activeLang"/);
assert.match(poiAttributes, /emit\(['"]selectLanguage['"],\s*code\)/);
console.log('  [7/8] POI editor shares Header, Busy, language, and saved export contracts: PASS');

const poiIpc = await readFile(path.join(projectRoot, 'electron/ipc/poisource.ts'), 'utf8');
const preload = await readFile(path.join(projectRoot, 'electron/preload.ts'), 'utf8');
const declarations = await readFile(path.join(projectRoot, 'src/electron.d.ts'), 'utf8');
const electronMain = await readFile(path.join(projectRoot, 'electron/main.ts'), 'utf8');
assert.match(poiIpc, /ipcMain\.handle\(['"]poisource:exportFile['"]/);
assert.match(poiIpc, /dialog\.showSaveDialog/);
assert.match(poiIpc, /poiSourceService\.exportForm\(uid\)/);
assert.match(poiIpc, /fs\.writeFile\([^,]+,\s*JSON\.stringify\(fc, null, 2\),\s*['"]utf8['"]\)/);
assert.doesNotMatch(poiIpc, /filePath\s*:\s*input|input\.filePath/);
assert.match(preload, /exportFile:\s*\(uid:\s*string\)\s*=>\s*ipcRenderer\.invoke\(['"]poisource:exportFile['"],\s*uid\)/);
assert.match(declarations, /exportFile\(uid:\s*string\):\s*Promise<PoiSourceExportResult>/);
assert.match(electronMain, /removeHandler\(['"]poisource:exportFile['"]\)/);

const editorUiKeys = [
  'export_button',
  'export_dirty_prompt',
  'export_save_and_run',
  'export_saved_only',
  'export_success',
  'export_failed',
  'busy_exporting',
];
for (const locale of ['ja', 'en', 'de', 'fr', 'es', 'ko', 'zh', 'zh-TW', 'vi', 'th', 'id']) {
  const messages = JSON.parse(
    await readFile(path.join(projectRoot, 'public/locales', locale, 'translation.json'), 'utf8'),
  );
  for (const key of editorUiKeys) {
    assert.equal(typeof messages.editor_ui?.[key], 'string', `${locale}: editor_ui.${key} missing`);
    assert.notEqual(messages.editor_ui[key].trim(), '', `${locale}: editor_ui.${key} empty`);
  }
}
console.log('  [8/8] POI native export boundary and 11-locale vocabulary: PASS');

console.log('m11-t3 editor shell smoke: PASS');
