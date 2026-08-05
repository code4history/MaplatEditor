import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';

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
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    const saveFolder = await page.evaluate(() => window.settings.get('saveFolder'));
    // AC14: instance固有userDataDirへ逃げず、両instanceが共有E2E root配下だけを使う
    if (!path.resolve(saveFolder).startsWith(path.resolve(e2eRoot) + path.sep)) {
      throw new Error(`E2E storage isolation failed: ${saveFolder} is outside ${e2eRoot}`);
    }
    return { app, page, userDataDir, saveFolder };
  } catch (error) {
    try { await quitElectronApplication(app); } catch { /* cleanup失敗で元例外を上書きしない */ }
    throw error;
  }
}

async function launchPair(): Promise<{ e2eRoot: string; a: Runtime; b: Runtime }> {
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m11-t7-multi-'));
  let a: Runtime | null = null;
  let b: Runtime | null = null;
  try {
    a = await launch(e2eRoot, 'a');
    b = await launch(e2eRoot, 'b');
    if (path.resolve(a.saveFolder) !== path.resolve(b.saveFolder)) {
      throw new Error(`E2E instances do not share saveFolder: ${a.saveFolder} !== ${b.saveFolder}`);
    }
    if (path.resolve(a.userDataDir) === path.resolve(b.userDataDir)) {
      throw new Error('E2E instances unexpectedly share --user-data-dir');
    }
    return { e2eRoot, a, b };
  } catch (error) {
    await Promise.allSettled(
      [a, b]
        .filter((runtime): runtime is Runtime => runtime !== null)
        .map((runtime) => quitElectronApplication(runtime.app)),
    );
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
  // m6-t1: 新規ベースマップは種別選択が最初の編集。ただし A/B で draft を共有する本 spec では
  // 既に kind が付いた draft を開くことがあるため、tms が活性（kind 未選択）のときだけ選択する。
  const kindTms = page.getByTestId('basemap-kind-tms');
  if (await kindTms.isEnabled()) {
    await kindTms.click();
  }
  await expect(page.getByTestId('basemap-slug')).toBeVisible();
  return page.evaluate(() => new URLSearchParams(location.hash.split('?')[1] ?? '').get('uid') ?? '');
}

// m6-t1: 製品 UI は「同時に2つの provisional 新規 basemap」を保証しない（latestNewDraft が1本）。
// A/B で userData を共有する本 spec の save-race では、B は latestNewDraft 再利用（basemap-new）を
// 使わず、fresh uid で #/basemaps?uid=<new>&new=1 を直開きして、A と異なる uid を保証する。
async function openFreshBaseMap(page: Page): Promise<string> {
  const newUid = crypto.randomUUID();
  await openHash(page, `#/basemaps?uid=${newUid}&new=1`, '[data-master-detail="base-map"]');
  const kindTms = page.getByTestId('basemap-kind-tms');
  if (await kindTms.isEnabled()) {
    await kindTms.click();
  }
  await expect(page.getByTestId('basemap-slug')).toBeVisible();
  return newUid;
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

    // M11-T10: POI作成モーダルは解体済み(HV5)。B は新規追加→POIエディタの SlugField で
    // A の予約中 slug を入力し、reserved-by-other の伝播を検証する（検証意図は不変）。
    await openHash(b.page, '#/poisources', '[data-resource-list="poi-source"]');
    await b.page.locator('[data-resource-new]').click();
    await expect(b.page.locator('.poi-side-pane')).toBeVisible({ timeout: 15000 });
    const bSlug = b.page.getByTestId('poi-slug');
    await bSlug.fill('m11-t7-multi-b-available');
    const field = b.page.locator('.editor-field', { has: bSlug });
    await expect(bSlug).not.toHaveClass(/is-invalid/);

    await bSlug.fill(slug);
    await expect(field.locator('[data-diagnostic-scope="field"]')).toBeVisible();
    await expect(field.locator('[role="status"]')).toHaveText('他で使用中です');
    await expect(bSlug).toHaveClass(/is-invalid/);
  } finally {
    await Promise.all([quitElectronApplication(a.app), quitElectronApplication(b.app)]);
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

    // Aが先にslugを予約し、Bが同じslugで保存を試みるシナリオ。
    const aUid = await openNewBaseMap(a.page);
    expect(aUid).not.toBe('');
    await a.page.getByTestId('basemap-slug').fill(slug);
    await waitForOwnedReservation(a.page, slug, aUid);

    // Bが同じslugで新規basemapを開く
    const bUid = await openFreshBaseMap(b.page);
    // Major-B: 異なるasset UIDで開始されることを確認
    expect(bUid).not.toBe('');
    expect(aUid).not.toBe(bUid);
    await b.page.getByTestId('basemap-slug').fill(slug);
    await b.page.getByTestId('basemap-slug').press('Tab');
    await b.page.getByTestId('basemap-title').fill('B conflict body');
    await b.page.getByTestId('basemap-title').press('Tab');
    await b.page.getByTestId('basemap-url').fill('https://example.test/{z}/{x}/{y}.png');
    await b.page.getByTestId('basemap-url').press('Tab');

    // BのSlugFieldがreserved-by-otherを表示するのを待つ
    const field = b.page.locator('.editor-field', { has: b.page.getByTestId('basemap-slug') });
    await expect(field.locator('[role="status"]')).toHaveText('他で使用中です', { timeout: 15_000 });

    // 保存ボタンが有効になるまで待つ(保存操作の前提条件)
    const saveButton = b.page.getByTestId('editor-save');
    await expect(saveButton).toBeEnabled({ timeout: 15_000 });

    // 保存ボタンを無条件にclickし、operation診断とasset body非生成をassertする(Major-A)。
    // 保存操作はconfirmForSave → reserve再試行 → conflict → operation診断を経る。
    await saveButton.click();
    await expect(b.page.locator('[data-diagnostic-scope="operation"]')).toBeVisible({ timeout: 15_000 });

    // AC6: asset本体は作成されていない
    const created = await b.page.evaluate(async (slug) => (await window.baseMaps.list()).some((row: any) => row.mapID === slug), slug);
    expect(created).toBe(false);
    // AC6: draftも作成されていない
    const draftCreated = await b.page.evaluate(async (uid) =>
      (await window.assetDrafts.get('base-map', uid)) != null, bUid);
    expect(draftCreated).toBe(false);
  } finally {
    await Promise.all([quitElectronApplication(a.app), quitElectronApplication(b.app)]);
  }
});
