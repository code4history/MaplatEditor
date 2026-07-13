import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const projectRoot = path.resolve(import.meta.dirname, '../..');

async function launch(e2eRoot: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [projectRoot, `--user-data-dir=${e2eRoot}`],
    cwd: projectRoot,
    env: { ...process.env, VITE_DEV_SERVER_URL: '', MAPLAT_E2E_ROOT: e2eRoot },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  return { app, page };
}

async function installNativeDialogHarness(app: ElectronApplication, exportPath: string): Promise<void> {
  await app.evaluate(async ({ dialog }, nextExportPath) => {
    const harness = {
      messageBoxes: [] as Array<{ buttons?: string[]; message?: string }>,
      exportPath: nextExportPath,
    };
    (globalThis as any).__m11T3DialogHarness = harness;

    dialog.showMessageBox = (async (...args: any[]) => {
      const options = (args.length > 1 ? args[1] : args[0]) ?? {};
      harness.messageBoxes.push({ buttons: options.buttons, message: options.message });
      // Busy表示を実画面で観測できるだけの時間、native dialog応答を保留する。
      await new Promise((resolve) => setTimeout(resolve, 350));
      return { response: (options.buttons?.length ?? 0) >= 2 ? options.buttons.length - 1 : 0, checkboxChecked: false };
    }) as typeof dialog.showMessageBox;

    dialog.showSaveDialog = (async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
      return { canceled: false, filePath: harness.exportPath };
    }) as typeof dialog.showSaveDialog;
  }, exportPath);
}

async function seedApp(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const slug = `m11-t3-app-${Date.now()}`;
    const result = await window.appedit.save({
      slug,
      document: {
        appID: slug,
        appName: { en: 'T3 App' },
        title: { en: 'T3 App' },
        description: {},
        keywords: '',
        siteUrl: '',
        lang: 'en',
        sources: [],
        pois: [],
        httpSettings: {},
        appSettings: {},
        manifestSettings: {},
      },
    });
    if (!result || result.result !== 'Success') throw new Error(`Could not seed app: ${JSON.stringify(result)}`);
    return result.uid;
  });
}

async function seedPoi(page: Page): Promise<{ uid: string; slug: string }> {
  return page.evaluate(async () => {
    const slug = `m11-t3-poi-${Date.now()}`;
    const result = await window.poiSources.createLocal({
      slug,
      title: { ja: 'T3 POI 日本語', en: 'T3 POI English' },
    });
    if (!result || result.result !== 'Success') throw new Error(`Could not seed POI: ${JSON.stringify(result)}`);
    return { uid: result.uid, slug };
  });
}

async function openHash(page: Page, hash: string, ready: string): Promise<void> {
  await page.evaluate((nextHash) => { location.hash = nextHash; }, hash);
  await expect(page.locator(ready)).toBeVisible();
}

async function expectHeaderOrder(page: Page): Promise<void> {
  const actions = await page.locator('.editor-action-header__actions [data-editor-action]').evaluateAll(
    (nodes) => nodes.map((node) => node.getAttribute('data-editor-action')),
  );
  expect(actions).toEqual(['language', 'undo', 'redo', 'export', 'save']);
}

test('three editors share Header order; App shortcuts and dirty Export expose Busy', async () => {
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m11-t3-'));
  const exportPath = path.join(e2eRoot, 'saved-poi.geojson');
  const { app, page } = await launch(e2eRoot);

  try {
    const saveFolder = await page.evaluate(() => window.settings.get('saveFolder'));
    expect(path.resolve(saveFolder).startsWith(path.resolve(e2eRoot) + path.sep)).toBe(true);
    await installNativeDialogHarness(app, exportPath);

    const appUid = await seedApp(page);
    const poi = await seedPoi(page);

    await openHash(page, `#/appedit?uid=${appUid}`, '[data-testid="app-id"]');
    await expectHeaderOrder(page);

    const appName = page.getByTestId('app-title');
    await appName.fill('T3 App edited');
    const saveShortcut = process.platform === 'darwin' ? 'Meta+s' : 'Control+s';
    await appName.press(saveShortcut);
    await expect(page.locator('[data-editor-busy-overlay]')).toBeVisible();
    await expect(page.locator('[data-editor-busy-overlay]')).toBeHidden();
    await expect(page.getByTestId('editor-save')).toBeDisabled();

    await appName.fill('T3 App dirty export');
    await page.locator('[data-editor-action="export"]').click();
    await expect(page.locator('[data-editor-busy-overlay]')).toBeVisible();
    await expect(page.locator('[data-editor-busy-overlay]')).toBeHidden();
    const dirtyExportDialog = await app.evaluate(() => {
      const calls = (globalThis as any).__m11T3DialogHarness.messageBoxes;
      return calls.findLast((call: { buttons?: string[] }) => (call.buttons?.length ?? 0) === 3);
    });
    expect(dirtyExportDialog?.buttons).toHaveLength(3);

    await openHash(page, `#/poisources/${poi.uid}`, '.poi-side-pane');
    await expectHeaderOrder(page);
    const language = page.locator('[data-editor-action="language"]');
    await language.selectOption('en');
    await expect(page.getByTestId('poi-title').locator('input')).toHaveValue('T3 POI English');

    await page.locator('[data-editor-action="export"]').click();
    await expect(page.locator('[data-editor-busy-overlay]')).toBeVisible();
    await expect(page.locator('[data-editor-busy-overlay]')).toBeHidden();
    const exported = JSON.parse(await readFile(exportPath, 'utf8'));
    expect(exported.type).toBe('FeatureCollection');
    expect(exported.id).toBe(poi.slug);

    await openHash(page, '#/mapedit', '#mapDocumentLanguage');
    await expectHeaderOrder(page);
    await expect(page.locator('.nav-tabs .nav-link')).toHaveCount(4);
  } finally {
    await app.close();
  }
});
