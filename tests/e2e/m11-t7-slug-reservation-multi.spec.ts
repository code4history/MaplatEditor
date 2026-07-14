import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const projectRoot = path.resolve(import.meta.dirname, '../..');

interface Runtime {
  app: ElectronApplication;
  page: Page;
  userDataDir: string;
  saveFolder: string;
}

async function launch(e2eRoot: string, instance: string): Promise<Runtime> {
  const userDataDir = path.join(e2eRoot, `instance-${instance}`);
  await mkdir(userDataDir, { recursive: true });
  const app = await electron.launch({
    args: [projectRoot, `--user-data-dir=${userDataDir}`],
    cwd: projectRoot,
    env: { ...process.env, VITE_DEV_SERVER_URL: '', MAPLAT_E2E_ROOT: e2eRoot },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  const saveFolder = await page.evaluate(() => window.settings.get('saveFolder'));
  // AC14: instance固有userDataDirへ逃げず、両instanceが共有E2E root配下だけを使う
  if (!path.resolve(saveFolder).startsWith(path.resolve(e2eRoot) + path.sep)) {
    await app.close();
    throw new Error(`E2E storage isolation failed: ${saveFolder} is outside ${e2eRoot}`);
  }
  return { app, page, userDataDir, saveFolder };
}

async function launchPair(): Promise<{ e2eRoot: string; a: Runtime; b: Runtime }> {
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m11-t7-multi-'));
  const a = await launch(e2eRoot, 'a');
  try {
    const b = await launch(e2eRoot, 'b');
    if (path.resolve(a.saveFolder) !== path.resolve(b.saveFolder)) {
      await Promise.all([a.app.close(), b.app.close()]);
      throw new Error(`E2E instances do not share saveFolder: ${a.saveFolder} !== ${b.saveFolder}`);
    }
    if (path.resolve(a.userDataDir) === path.resolve(b.userDataDir)) {
      await Promise.all([a.app.close(), b.app.close()]);
      throw new Error('E2E instances unexpectedly share --user-data-dir');
    }
    return { e2eRoot, a, b };
  } catch (error) {
    await a.app.close();
    throw error;
  }
}

async function openHash(page: Page, hash: string, ready: string): Promise<void> {
  await page.evaluate((nextHash) => { location.hash = nextHash; }, hash);
  await expect(page.locator(ready)).toBeVisible();
}

async function forceJapanese(page: Page): Promise<void> {
  await page.evaluate(() => window.settings.set('lang', 'ja'));
  await openHash(page, '#/settings', '#langSwitcher');
  await expect(page.locator('#langSwitcher')).toHaveValue('ja');
}

async function installDialogHarness(app: ElectronApplication): Promise<void> {
  await app.evaluate(async ({ dialog }) => {
    dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox;
  });
}

async function openNewBaseMap(page: Page): Promise<string> {
  await openHash(page, '#/basemaps', '[data-master-detail="base-map"]');
  await page.getByTestId('basemap-new').click();
  await expect(page.getByTestId('basemap-slug')).toBeVisible();
  return page.evaluate(() => new URLSearchParams(location.hash.split('?')[1] ?? '').get('uid') ?? '');
}

async function waitForOwnedReservation(page: Page, slug: string, uid: string): Promise<void> {
  await expect.poll(async () => page.evaluate(
    async ({ slug, uid }) => ({
      ownerView: await window.slugReservations.check({ slug, excludeUid: uid }),
      outsiderView: await window.slugReservations.check({ slug }),
    }),
    { slug, uid },
  ), { timeout: 15_000 }).toEqual({ ownerView: 'available', outsiderView: 'reserved-by-other' });
}

test('instance B reports reserved-by-other when instance A reserves the slug', async () => {
  test.setTimeout(180_000);
  const { a, b } = await launchPair();
  try {
    await forceJapanese(a.page);
    await forceJapanese(b.page);
    const slug = 'm11-t7-multi-owned-by-a';
    const aUid = await openNewBaseMap(a.page);
    expect(aUid).not.toBe('');
    await a.page.getByTestId('basemap-slug').fill(slug);
    await waitForOwnedReservation(a.page, slug, aUid);

    await openNewBaseMap(b.page);
    const bSlug = b.page.getByTestId('basemap-slug');
    await bSlug.fill(slug);
    const field = b.page.locator('.editor-field', { has: bSlug });
    await expect(field.locator('[data-diagnostic-scope="field"]')).toBeVisible();
    await expect(field.locator('[role="status"]')).not.toHaveText('');
    await expect(bSlug).toHaveClass(/is-invalid/);
  } finally {
    await Promise.all([a.app.close(), b.app.close()]);
  }
});

test('instance B save conflicts with instance A reservation and creates no asset body', async () => {
  test.setTimeout(180_000);
  const { a, b } = await launchPair();
  try {
    await forceJapanese(a.page);
    await forceJapanese(b.page);
    await installDialogHarness(b.app);
    const slug = 'm11-t7-multi-save-race';

    // Bがfield確認を通した直後に予約を手放し、Aが同slugを予約する保存直前raceを作る。
    const bUid = await openNewBaseMap(b.page);
    expect(bUid).not.toBe('');
    await b.page.getByTestId('basemap-slug').fill(slug);
    await b.page.getByTestId('basemap-slug').press('Tab');
    await b.page.getByTestId('basemap-title').fill('B conflict body');
    await b.page.getByTestId('basemap-title').press('Tab');
    await b.page.getByTestId('basemap-url').fill('https://example.test/{z}/{x}/{y}.png');
    await b.page.getByTestId('basemap-url').press('Tab');
    await waitForOwnedReservation(b.page, slug, bUid);
    await expect(b.page.getByTestId('editor-save')).toBeEnabled();
    await b.page.evaluate(async ({ slug, uid }) => window.slugReservations.release({ slug, assetUid: uid }), { slug, uid: bUid });

    const aUid = await openNewBaseMap(a.page);
    expect(aUid).not.toBe('');
    await a.page.getByTestId('basemap-slug').fill(slug);
    await waitForOwnedReservation(a.page, slug, aUid);

    await b.page.getByTestId('editor-save').click();
    await expect(b.page.locator('[data-diagnostic-scope="operation"]')).toBeVisible();
    const created = await b.page.evaluate(async (slug) => (await window.baseMaps.list()).some((row) => row.mapID === slug), slug);
    expect(created).toBe(false);
  } finally {
    await Promise.all([a.app.close(), b.app.close()]);
  }
});
