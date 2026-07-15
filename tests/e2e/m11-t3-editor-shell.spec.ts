import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';

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
      nextResponse: null as number | null,
    };
    (globalThis as any).__m11T3DialogHarness = harness;

    dialog.showMessageBox = (async (...args: any[]) => {
      const options = (args.length > 1 ? args[1] : args[0]) ?? {};
      harness.messageBoxes.push({ buttons: options.buttons, message: options.message });
      // Busy表示を実画面で観測できるだけの時間、native dialog応答を保留する。
      await new Promise((resolve) => setTimeout(resolve, 350));
      const response = harness.nextResponse ?? ((options.buttons?.length ?? 0) >= 2 ? options.buttons.length - 1 : 0);
      harness.nextResponse = null;
      return { response, checkboxChecked: false };
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
      lang: 'ja',
    });
    if (!result || result.result !== 'Success') throw new Error(`Could not seed POI: ${JSON.stringify(result)}`);
    return { uid: result.uid, slug };
  });
}

async function seedMap(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const slug = `m11-t3-map-${Date.now()}`;
    const result = await window.mapedit.save({
      slug,
      mapObject: {
        mapID: slug,
        title: { ja: 'T3 地図', en: 'T3 Map' },
        officialTitle: {}, author: {}, era: {}, createdAt: {}, contributor: {}, mapper: {},
        attr: {}, dataAttr: {}, description: {},
        license: 'PD', dataLicense: 'CC BY-SA', reference: '', url: '', lang: 'ja',
        imageExtension: 'jpg', width: 400, height: 300, gcps: [], edges: [], sub_maps: [],
        strictMode: 'strict', vertexMode: 'plain', status: 'New',
      },
      tins: [],
    });
    if (!result || result.result !== 'Success') throw new Error(`Could not seed map: ${JSON.stringify(result)}`);
    return result.uid;
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
    const mapUid = await seedMap(page);

    await page.evaluate(async (uid) => {
      const saved = await window.appedit.request(uid);
      await window.assetDrafts.put({
        schemaVersion: 1,
        kind: 'app',
        assetUid: uid,
        baseRevision: saved.revision,
        updatedAt: new Date().toISOString(),
        payload: {
          ...saved,
          title: { ...saved.title, en: 'T3 App restored draft' },
          appName: { ...saved.appName, en: 'T3 App restored draft' },
        },
      });
    }, appUid);

    await openHash(page, `#/appedit?uid=${appUid}`, '[data-testid="app-id"]');
    await expectHeaderOrder(page);

    const appName = page.getByTestId('app-title');
    await expect(appName).toHaveValue('T3 App restored draft');
    await expect(page.locator('[data-editor-action="discard-draft"]')).toBeVisible();
    await app.evaluate(() => { (globalThis as any).__m11T3DialogHarness.nextResponse = 0; });
    await page.locator('[data-editor-action="discard-draft"]').click();
    await expect(appName).toHaveValue('T3 App');
    await expect(page.locator('[data-editor-action="discard-draft"]')).toBeHidden();
    await page.waitForTimeout(2200);
    expect(await page.evaluate((uid) => window.assetDrafts.get('app', uid), appUid)).toBeNull();

    await appName.fill('T3 App edited');
    const saveShortcut = process.platform === 'darwin' ? 'Meta+s' : 'Control+s';
    await appName.press(saveShortcut);
    await expect(page.locator('[data-editor-busy-overlay]')).toBeVisible();
    await expect(page.locator('[data-editor-busy-overlay]')).toBeHidden();
    await expect(page.getByTestId('editor-save')).toBeDisabled();

    const appLanguage = page.locator('[data-editor-action="language"]');
    await appLanguage.selectOption('ja');
    await expect(page.getByTestId('app-id')).toBeDisabled();
    await expect(page.locator('[data-editor-document-language]')).toBeDisabled();
    await expect(appName).toBeEnabled();
    await appName.fill('T3 アプリ');
    await page.locator('.editor-action-header__identity strong').click();
    const englishChip = page.locator('.lang-value-chip', { hasText: 'EN' }).first();
    await expect(englishChip).toBeVisible();
    await expect(englishChip).toHaveAttribute('title', /English: T3 App edited/);
    await englishChip.click();
    await expect(appLanguage).toHaveValue('en');
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
    await expect(appLanguage).toHaveValue('en');

    await appLanguage.selectOption('ja');
    await page.getByTestId('app-keywords').fill('姫路,古地図');
    await page.getByTestId('app-manifest-name').fill('姫路案内');
    await page.getByTestId('app-manifest-short-name').fill('姫路');
    await appLanguage.selectOption('en');
    await page.getByTestId('app-keywords').fill('Himeji,historical map');
    await page.getByTestId('app-manifest-name').fill('Himeji Guide');
    await page.getByTestId('app-manifest-short-name').fill('Himeji');
    await page.getByTestId('editor-save').click();
    await expect(page.locator('[data-editor-busy-overlay]')).toBeVisible();
    await expect(page.locator('[data-editor-busy-overlay]')).toBeHidden();
    const localizedApp = await page.evaluate((uid) => window.appedit.request(uid), appUid);
    expect(localizedApp.keywords).toMatchObject({
      ja: '姫路,古地図',
      en: 'Himeji,historical map',
    });
    expect(localizedApp.manifestSettings.name).toMatchObject({
      ja: '姫路案内',
      en: 'Himeji Guide',
    });
    expect(localizedApp.manifestSettings.shortName).toMatchObject({
      ja: '姫路',
      en: 'Himeji',
    });

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
    await expect(language).toHaveValue('ja');
    await language.selectOption('en');
    await expect(page.getByTestId('poi-title').locator('input')).toHaveValue('T3 POI English');
    await expect(page.getByTestId('poi-title').locator('input')).toBeEnabled();
    await expect(page.getByTestId('poi-slug')).toBeDisabled();
    await expect(page.locator('[data-editor-document-language]')).toBeDisabled();
    await page.getByRole('button', { name: /Raw GeoJSON|生GeoJSON/ }).click();
    await expect(page.locator('.poi-raw-textarea')).toHaveAttribute('readonly', '');

    await page.locator('[data-editor-action="export"]').click();
    await expect(page.locator('[data-editor-busy-overlay]')).toBeVisible();
    await expect(page.locator('[data-editor-busy-overlay]')).toBeHidden();
    const exported = JSON.parse(await readFile(exportPath, 'utf8'));
    expect(exported.type).toBe('FeatureCollection');
    expect(exported.id).toBe(poi.slug);
    expect(exported.lang).toBe('ja');

    await openHash(page, `#/mapedit?uid=${mapUid}`, '#mapDocumentLanguage');
    await expectHeaderOrder(page);
    await expect(page.locator('.nav-tabs .nav-link')).toHaveCount(4);
    const mapEnglishChip = page.locator('.lang-value-chip', { hasText: 'EN' }).first();
    await expect(mapEnglishChip).toHaveAttribute('title', 'English: T3 Map');
    await mapEnglishChip.click();
    await expect(page.locator('[data-editor-action="language"]')).toHaveValue('en');
    const mapTitle = page.getByTestId('map-title');
    await expect(page.getByTestId('map-slug')).toBeDisabled();
    await expect(page.locator('[data-editor-document-language]')).toBeDisabled();
    await expect(page.getByTestId('map-label')).toBeEnabled();
    await expect(mapTitle).toHaveValue('T3 Map');
    await mapTitle.fill('T3 Map transient edit');
    await page.locator('.editor-action-header__identity strong').click();
    await expect(page.locator('[data-editor-action="undo"]')).toBeEnabled();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
    await expect(mapTitle).toHaveValue('T3 Map');
    await expect(page.getByTestId('editor-save')).toBeDisabled();
    await page.getByTestId('editor-back').click();
    await expect(page.locator('a[href*="mapedit?uid="]')).toBeVisible();
    expect(await page.evaluate((uid) => window.assetDrafts.get('map', uid), mapUid)).toBeNull();

    await openHash(page, `#/mapedit?uid=${mapUid}`, '#mapDocumentLanguage');
    await page.getByTestId('map-title').fill('T3 Map discarded draft');
    await page.locator('.editor-action-header__identity strong').click();
    await expect(page.locator('[data-editor-action="undo"]')).toBeEnabled();
    await page.getByTestId('editor-back').click();
    expect(await page.evaluate((uid) => window.assetDrafts.get('map', uid), mapUid)).not.toBeNull();

    await openHash(page, `#/mapedit?uid=${mapUid}`, '#mapDocumentLanguage');
    await expect(page.locator('[data-editor-action="discard-draft"]')).toBeVisible();
    await app.evaluate(() => { (globalThis as any).__m11T3DialogHarness.nextResponse = 0; });
    await page.locator('[data-editor-action="discard-draft"]').click();
    await expect(page.getByTestId('map-title')).toHaveValue('T3 地図');
    await page.waitForTimeout(2200);
    await page.getByTestId('editor-back').click();
    expect(await page.evaluate((uid) => window.assetDrafts.get('map', uid), mapUid)).toBeNull();

    // Verify Settings tab does not render double header
    await openHash(page, '#/settings', '#langSwitcher');
    await expect(page.locator('nav.navbar')).toHaveCount(1);
    await page.pause();
  } finally {
    await quitElectronApplication(app);
  }
});
