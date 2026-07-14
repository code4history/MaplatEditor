import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });

async function importSource(relativeEntry, fileName) {
  const workDir = await mkdtemp(path.join(scratchRoot, 'm11-t1-'));
  const outDir = path.join(workDir, 'dist');
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
      rollupOptions: { external: [] },
    },
  });
  const loaded = await import(`${pathToFileURL(path.join(outDir, fileName)).href}?t=${Date.now()}`);
  await rm(workDir, { recursive: true, force: true });
  return loaded;
}

try {
  const { UndoStack } = await importSource(
    'src/services/editorUndoStack.ts',
    'editorUndoStack.mjs',
  );
  const history = new UndoStack('A');
  history.push('B');
  history.save();
  assert.equal(history.canUndo(), true, '保存後も保存前状態へUndoできる');
  assert.equal(history.isDirty(), false, '保存直後はcheckpoint上なのでclean');
  history.undo();
  assert.equal(history.current(), 'A');
  assert.equal(history.isDirty(), true, '保存前へUndoすると未保存になる');
  history.redo();
  assert.equal(history.current(), 'B');
  assert.equal(history.isDirty(), false, 'checkpointへRedoすると再びcleanになる');

  const capped = new UndoStack('saved-before-cap');
  capped.save();
  for (let index = 1; index <= 101; index += 1) capped.push(`state-${index}`);
  while (capped.canUndo()) capped.undo();
  assert.equal(
    capped.isDirty(),
    true,
    '履歴上限で保存checkpointが破棄された後に、先頭履歴を保存済みと誤判定しない',
  );
  console.log('  [1/2] Undo checkpoint preserves history: PASS');
  console.log('  [2/2] Dropped checkpoint stays dirty: PASS');

  const { EDITOR_SAVE_STATE_META } = await importSource(
    'src/components/editor-ui/editorUiTypes.ts',
    'editorUiTypes.mjs',
  );
  assert.deepEqual(Object.keys(EDITOR_SAVE_STATE_META), [
    'dirty',
    'saving',
    'saved',
    'draft-restored',
  ]);
  assert.equal(EDITOR_SAVE_STATE_META.dirty.key, 'editor_ui.save_state.dirty');
  assert.equal(EDITOR_SAVE_STATE_META.saving.key, 'editor_ui.save_state.saving');
  assert.equal(EDITOR_SAVE_STATE_META.saved.key, 'editor_ui.save_state.saved');
  assert.equal(
    EDITOR_SAVE_STATE_META['draft-restored'].key,
    'editor_ui.save_state.draft_restored',
  );
  console.log('  [3/3] Save-state vocabulary is exhaustive: PASS');

  const header = await readFile(
    path.join(projectRoot, 'src/components/editor-ui/EditorActionHeader.vue'),
    'utf8',
  );
  assert.match(
    header,
    /data-editor-action="language"[\s\S]*data-editor-action="undo"[\s\S]*data-editor-action="redo"[\s\S]*<slot name="actions"[\s\S]*data-editor-action="save"/,
    '編集ヘッダーは Lang → Undo → Redo → actions → Save の順序を固定する',
  );
  for (const eventName of ['back', 'update:activeLang', 'undo', 'redo', 'save']) {
    assert.match(header, new RegExp(`"${eventName}"`), `${eventName} eventがない`);
  }
  assert.match(header, /EDITOR_SAVE_STATE_META\[props\.saveState\]/);
  console.log('  [4/4] Editor header action order is fixed: PASS');

  const { validateSlugSyntax, createSlugAvailabilityHarness } = await importSource(
    'scripts/fixtures/m11-t1-slug-harness.ts',
    'slugHarness.mjs',
  );
  assert.equal(validateSlugSyntax(''), 'required');
  assert.equal(validateSlugSyntax('bad slug'), 'invalid');
  assert.equal(validateSlugSyntax('valid_slug-1'), null);

  const calls = [];
  const pending = new Map();
  const { slug, availability } = createSlugAvailabilityHarness({
    initialSlug: 'first',
    delayMs: 20,
    check: ({ slug: requestedSlug, excludeUid: requestedExcludeUid }) => {
      calls.push({ slug: requestedSlug, excludeUid: requestedExcludeUid });
      return new Promise((resolve, reject) => {
        pending.set(requestedSlug, { resolve, reject });
      });
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(calls.length, 0, '入力直後には照会しない');
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(calls.length, 1, 'delay後に1回だけ照会する');
  assert.equal(availability.state.value, 'checking');

  slug.value = 'second';
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 40));
  pending.get('second').resolve(true);
  await Promise.resolve();
  assert.equal(availability.state.value, 'available');
  pending.get('first').resolve(false);
  await Promise.resolve();
  assert.equal(availability.state.value, 'available', '古い応答で後着結果を上書きしない');

  slug.value = 'third';
  const thirdRequest = availability.refresh();
  await Promise.resolve();
  pending.get('third').reject(new Error('offline'));
  await thirdRequest;
  assert.equal(availability.state.value, 'unavailable', '照会失敗を使用可能扱いしない');
  availability.cancel();
  console.log('  [5/5] Slug availability state machine: PASS');

  const { collectLangValueChips } = await importSource(
    'src/utils/langValueChips.ts',
    'langValueChips.mjs',
  );
  const languageOptions = [
    { code: 'ja', nativeName: '日本語' },
    { code: 'en', nativeName: 'English' },
    { code: 'zh-TW', nativeName: '繁體中文' },
  ];
  assert.deepEqual(
    collectLangValueChips(
      { ja: '姫路古地図', en: 'Himeji Historical Map', 'zh-TW': '  姬路古地圖  ' },
      'ja',
      languageOptions,
      'ja',
    ),
    [
      { code: 'en', label: 'EN', nativeName: 'English', value: 'Himeji Historical Map' },
      { code: 'zh-TW', label: 'ZH-TW', nativeName: '繁體中文', value: '姬路古地圖' },
    ],
  );
  assert.deepEqual(
    collectLangValueChips('既定値', 'en', languageOptions, 'ja'),
    [{ code: 'ja', label: 'JA', nativeName: '日本語', value: '既定値' }],
  );
  console.log('  [6/6] Language chips expose only populated non-active values: PASS');

  const chips = await readFile(
    path.join(projectRoot, 'src/components/editor-ui/LangValueChips.vue'),
    'utf8',
  );
  assert.match(chips, /collectLangValueChips\(/);
  assert.match(chips, /:title="previewText\(entry\)"/);
  assert.match(chips, /:aria-label="previewText\(entry\)"/);
  assert.match(chips, /emit\('selectLanguage', entry\.code\)/);
  assert.match(chips, /text-uppercase/);
  assert.match(chips, /t\('editor_ui\.translations'\)/);
  console.log('  [7/7] Language chip SFC exposes accessible preview and trial click: PASS');

  const requiredEditorUiKeys = [
    'back',
    'translations',
    'save_state.dirty',
    'save_state.saving',
    'save_state.saved',
    'save_state.draft_restored',
    'slug_state.checking',
    'slug_state.available',
    'slug_state.taken',
    'slug_state.unavailable',
  ];
  const valueAt = (object, path) => path.split('.').reduce((value, key) => value?.[key], object);
  for (const locale of ['ja', 'en', 'de', 'fr', 'es', 'ko', 'zh', 'zh-TW', 'vi', 'th', 'id']) {
    const messages = JSON.parse(
      await readFile(path.join(projectRoot, 'public/locales', locale, 'translation.json'), 'utf8'),
    );
    for (const key of requiredEditorUiKeys) {
      assert.equal(
        typeof valueAt(messages.editor_ui, key),
        'string',
        `${locale}: editor_ui.${key} がない`,
      );
      assert.notEqual(valueAt(messages.editor_ui, key).trim(), '', `${locale}: editor_ui.${key} が空`);
    }
  }
  console.log('  [8/8] Editor UI vocabulary exists in all 11 locales: PASS');

  const mapEdit = await readFile(path.join(projectRoot, 'src/views/MapEdit.vue'), 'utf8');
  assert.match(
    mapEdit,
    /applySuccess:[\s\S]*?markHistorySaved\(\)/,
    'MapEdit保存成功時は履歴を初期化せず保存checkpointを記録する',
  );
  const appEdit = await readFile(path.join(projectRoot, 'src/views/AppEdit.vue'), 'utf8');
  assert.match(
    appEdit,
    /applySuccess:[\s\S]*?markHistorySaved\(\)/,
    'AppEdit保存成功時も履歴を初期化せず保存checkpointを記録する',
  );
  assert.match(
    mapEdit,
    /const markHistorySaved = \(\) => \{[\s\S]*?recordHistorySnapshot\(\)[\s\S]*?historyStack\.value\.save\(\)/,
    '保存直前の未確定変更を履歴へ積んでからcheckpointを記録する',
  );
  console.log('  [9/9] MapEdit save preserves editor history: PASS');

  const electronFixture = await mkdtemp(path.join(scratchRoot, 'electron-fixture-'));
  const { inspectElectronInstallation, ensureElectronInstallation } = await import(
    `${pathToFileURL(path.join(projectRoot, 'scripts/ensure-electron.mjs')).href}?t=${Date.now()}`
  );
  let repairs = 0;
  assert.equal((await inspectElectronInstallation(electronFixture)).ready, false);
  await ensureElectronInstallation({
    packageDir: electronFixture,
    runInstall: async () => {
      repairs += 1;
      await mkdir(path.join(electronFixture, 'dist'), { recursive: true });
      await writeFile(path.join(electronFixture, 'dist', 'version'), '39.8.6');
      await writeFile(path.join(electronFixture, 'dist', 'electron-bin'), 'fixture');
      await writeFile(path.join(electronFixture, 'path.txt'), 'electron-bin\n');
    },
  });
  assert.equal(repairs, 1, '欠損時だけinstallを実行する');
  await ensureElectronInstallation({
    packageDir: electronFixture,
    runInstall: async () => { repairs += 1; },
  });
  assert.equal(repairs, 1, '正常時はinstallを再実行しない');
  await rm(electronFixture, { recursive: true, force: true });

  const packageJson = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'));
  assert.equal(packageJson.scripts.postinstall, 'node scripts/ensure-electron.mjs');
  assert.equal(packageJson.scripts.predev, 'node scripts/ensure-electron.mjs');
  assert.equal(packageJson.scripts.predist, 'node scripts/ensure-electron.mjs');
  assert.match(
    packageJson.scripts['test:e2e:m11-t4'],
    /^node scripts\/ensure-electron\.mjs && /,
    'Electron E2E本体が起動前にバイナリ欠損を修復する',
  );
  console.log('  [10/10] Electron install guard is idempotent and wired to lifecycle scripts: PASS');
  console.log('M11-T1 UI foundations smoke passed');
} catch (err) {
  console.error('M11-T1 UI foundations smoke FAILED:', err.stack ?? err.message);
  process.exit(1);
}
