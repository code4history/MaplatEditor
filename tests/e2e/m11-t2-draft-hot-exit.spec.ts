import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const projectRoot = path.resolve(import.meta.dirname, '../..');

async function launch(userDataDir: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [projectRoot, `--user-data-dir=${userDataDir}`],
    cwd: projectRoot,
    env: { ...process.env, VITE_DEV_SERVER_URL: '', MAPLAT_E2E_ROOT: userDataDir },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  return { app, page };
}

async function quitApplication(app: ElectronApplication): Promise<void> {
  const exited = new Promise<void>((resolve) => app.process().once('exit', () => resolve()));
  await app.evaluate(({ app: electronApp }) => {
    setTimeout(() => electronApp.quit(), 0);
  });
  await exited;
}

async function createApp(page: Page): Promise<{ uid: string; revision: number }> {
  return page.evaluate(async () => {
    const slug = `draft-e2e-${Date.now()}`;
    const result = await window.appedit.save({
      slug,
      document: {
        appID: slug,
        appName: { en: 'Draft E2E' },
        title: { en: 'Draft E2E' },
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
    return { uid: result.uid, revision: result.revision };
  });
}

async function openApp(page: Page, uid: string): Promise<void> {
  await page.evaluate((nextUid) => { location.hash = `#/appedit?uid=${nextUid}`; }, uid);
  await expect(page.getByTestId('app-id')).toBeVisible();
}

test('hot exit restores drafts, shows badge, resolves revision conflicts, and flushes on quit', async () => {
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'maplat-m11-t2-'));
  let runtime = await launch(userDataDir);
  const saveFolder = await runtime.page.evaluate(() => window.settings.get('saveFolder'));
  expect(saveFolder.startsWith(userDataDir)).toBe(true);

  await runtime.page.evaluate(() => { location.hash = '#/appedit'; });
  await expect(runtime.page.getByTestId('app-id')).toBeVisible();
  await runtime.page.getByTestId('app-id').fill('provisional-app-draft');
  await runtime.page.getByTestId('app-id').blur();
  await runtime.page.getByTestId('editor-back').click();
  const provisionalDraft = runtime.page.locator('a[href*="/appedit?draftUid="]').filter({ hasText: /Draft|下書き/ });
  await expect(provisionalDraft).toBeVisible();
  await provisionalDraft.click();
  await expect(runtime.page.getByTestId('app-id')).toHaveValue('provisional-app-draft');
  await runtime.page.getByTestId('editor-back').click();
  await expect(runtime.page.getByTestId('app-id')).toBeHidden();

  const seeded = await createApp(runtime.page);

  await openApp(runtime.page, seeded.uid);
  await runtime.page.getByTestId('app-id').fill('draft-restored-after-route');
  await runtime.page.getByTestId('app-id').blur();
  await runtime.page.getByTestId('editor-back').click();
  await expect(runtime.page.locator('.badge').filter({ hasText: /Draft|下書き/ }).first()).toBeVisible();

  await openApp(runtime.page, seeded.uid);
  await expect(runtime.page.getByTestId('app-id')).toHaveValue('draft-restored-after-route');

  await runtime.page.evaluate(() => { location.hash = '#/applist'; });
  await expect(runtime.page.getByTestId('app-id')).toBeHidden();
  await runtime.page.evaluate(async ({ uid, revision }) => {
    await window.assetDrafts.put({
      schemaVersion: 1,
      kind: 'app',
      assetUid: uid,
      baseRevision: revision - 1,
      updatedAt: new Date().toISOString(),
      payload: {
        appID: 'conflicting-draft', appName: { en: 'Conflict' }, title: { en: 'Conflict' },
        description: {}, keywords: '', siteUrl: '', lang: 'en', sources: [], pois: [],
        httpSettings: {}, appSettings: {}, manifestSettings: {},
      },
    });
  }, seeded);
  await openApp(runtime.page, seeded.uid);
  await expect(runtime.page.getByText(/Draft differs|下書きと保存済み版/)).toBeVisible();
  await runtime.page.getByRole('button', { name: /Apply draft|下書きを適用/ }).click();
  await expect(runtime.page.getByTestId('app-id')).toHaveValue('conflicting-draft');

  await runtime.page.evaluate(async (uid) => window.assetDrafts.remove('app', uid), seeded.uid);
  await runtime.page.evaluate(() => { location.hash = '#/applist'; });
  await expect(runtime.page.getByTestId('app-id')).toBeHidden();
  await openApp(runtime.page, seeded.uid);
  await runtime.page.getByTestId('app-id').fill('flush-on-electron-quit');
  await runtime.page.getByTestId('app-id').blur();
  await quitApplication(runtime.app);

  runtime = await launch(userDataDir);
  await openApp(runtime.page, seeded.uid);
  await expect(runtime.page.getByTestId('app-id')).toHaveValue('flush-on-electron-quit');
  await quitApplication(runtime.app);
});
