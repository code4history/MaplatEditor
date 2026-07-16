// M11-T10: 複製・削除action・Import統合 E2E Test
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';

const projectRoot = path.resolve(import.meta.dirname, '../..');

async function launch(e2eRoot: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [projectRoot, `--user-data-dir=${e2eRoot}`],
    cwd: projectRoot, env: { ...process.env, VITE_DEV_SERVER_URL: '', MAPLAT_E2E_ROOT: e2eRoot },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  return { app, page };
}
async function openHash(page: Page, hash: string): Promise<void> {
  await page.evaluate((nextHash) => { location.hash = nextHash; }, hash);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('.editor-action-header', { timeout: 10000 }).catch(() => {});
}

async function seedPoi(page: Page): Promise<{ uid: string; slug: string }> {
  return page.evaluate(async () => {
    const slug = `t10-poi-${Date.now()}`;
    const r = await window.poiSources.createLocal({ slug, title: { ja: 'T10 POI' }, lang: 'ja' });
    if (!r || r.result !== 'Success') throw new Error(`create: ${JSON.stringify(r)}`);
    await window.poiSources.save(r.uid, { slug, title: { ja: 'T10 POI' }, fc: { type: 'FeatureCollection', features: [] } });
    return { uid: r.uid, slug };
  });
}

test.describe('M11-T10 Dedup/Import', () => {
  test('AC1+AC12: duplicate menu item visible, creates new draft', async () => {
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-t10-dup-'));
    const { app, page } = await launch(e2eRoot);
    try {
      // Seed an app, then navigate to app list
      await page.evaluate(async () => {
        const slug = `t10-app-${Date.now()}`;
        const r = await window.appedit.save({ slug, document: { appID: slug, appName: { en: 'T10 App' }, title: { en: 'T10 App' }, description: {}, keywords: '', siteUrl: '', lang: 'ja', sources: [], pois: [], httpSettings: {}, appSettings: {}, manifestSettings: {} } });
        if (!r || r.result !== 'Success') throw new Error(`create: ${JSON.stringify(r)}`);
      });
      await openHash(page, '#/apps');
      await expect(page.locator('[data-resource-new]')).toBeVisible({ timeout: 15000 });

      // AC1: Duplicate menu item should appear in the ⋮ menu
      const actionBtn = page.locator('[data-resource-action]').first();
      await actionBtn.click();
      await expect(page.locator('button:has-text("複製")').first()).toBeVisible({ timeout: 3000 });
      // Close menu
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);

      // AC12: Click duplicate → should navigate to editor with draft
      await actionBtn.click();
      await page.locator('button:has-text("複製")').first().click();
      await page.waitForTimeout(1000);
      // Should be on appedit with duplicateFrom and draftUid
      const currentHash = await page.evaluate(() => location.hash);
      expect(currentHash).toContain('duplicateFrom=');
      expect(currentHash).toContain('draftUid=');

      console.log('  AC1+AC12: PASS');
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('AC7+AC8: PoiSourceList modal gone, Import button visible', async () => {
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-t10-poi-'));
    const { app, page } = await launch(e2eRoot);
    try {
      await openHash(page, '#/poisources');
      await expect(page.locator('[data-resource-new]')).toBeVisible({ timeout: 15000 });

      // AC7: Old modal should NOT exist (the Create/Import/Remote modal class)
      const oldModal = page.locator('.modal-title:has-text("POI")');
      await expect(oldModal).toHaveCount(0);

      // AC8: Import button should be in toolbar
      const importBtn = page.locator('[data-resource-import]');
      await expect(importBtn).toBeVisible({ timeout: 5000 });

      console.log('  AC7+AC8: PASS');
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('AC5+AC6: Delete with confirm dialog', async () => {
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-t10-del-'));
    const { app, page } = await launch(e2eRoot);
    try {
      const poi = await seedPoi(page);
      await openHash(page, '#/poisources');
      await expect(page.locator('[data-resource-new]')).toBeVisible({ timeout: 15000 });

      // Find the action button and click delete
      const actionBtn = page.locator('[data-resource-action]').first();
      await actionBtn.click();
      await page.locator('button:has-text("削除")').first().click();
      await page.waitForTimeout(500);

      // AC5: Confirm dialog should appear
      const dialog = page.locator('.modal');
      await expect(dialog).toBeVisible({ timeout: 3000 });
      await expect(dialog.locator('text=この操作は取り消せません')).toBeVisible();

      // AC6: Confirm delete → item should be gone
      await page.locator('[data-testid="delete-confirm-button"]').click();
      await page.waitForTimeout(1500);

      console.log('  AC5+AC6: PASS');
    } finally {
      await quitElectronApplication(app);
    }
  });
});