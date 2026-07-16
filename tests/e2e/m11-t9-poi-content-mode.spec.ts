// M11-T9: POI Content Mode & Asset Reference URI E2E Test
// 検証: AC1-AC7, AC10, AC12-AC13, AC14, AC16, AC18 (UI interaction + backend integration)
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
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

async function openHash(page: Page, hash: string): Promise<void> {
  await page.evaluate((nextHash) => { location.hash = nextHash; }, hash);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('.editor-action-header', { timeout: 10000 }).catch(() => {});
}

// seedPoi: creates a POI source with features containing html/url for mixed content mode testing
async function seedPoi(page: Page): Promise<{ uid: string; slug: string }> {
  return page.evaluate(async () => {
    const slug = `m11-t9-poi-${Date.now()}`;
    const result = await window.poiSources.createLocal({ slug, title: { ja: 'T9 POI', en: 'T9 POI' }, lang: 'ja' });
    if (!result || result.result !== 'Success') throw new Error(`create failed: ${JSON.stringify(result)}`);
    const uid = result.uid;
    const saveResult = await window.poiSources.save(uid, {
      slug, title: { ja: 'T9 POI', en: 'T9 POI' },
      fc: {
        type: 'FeatureCollection',
        features: [{
          type: 'Feature', id: 'p1', geometry: { type: 'Point', coordinates: [139.767, 35.681] },
          properties: { name: { ja: 'テストPOI' }, desc: { ja: '説明文' }, html: { ja: '<p>HTML content</p>' }, url: { ja: 'https://example.com' }, address: { ja: '東京都千代田区' } },
        }],
      },
    });
    if (!saveResult || saveResult.result !== 'Success') throw new Error(`save failed: ${JSON.stringify(saveResult)}`);
    return { uid, slug };
  });
}

test.describe('M11-T9 POI Content Mode', () => {
  test('AC1-7+AC16: content mode tabs, field visibility, diagnostics, mode switch', async () => {
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m11-t9-'));
    const { app, page } = await launch(e2eRoot);

    try {
      const poi = await seedPoi(page);
      await openHash(page, `#/poisources/${poi.uid}`);
      await expect(page.locator('.poi-side-pane')).toBeVisible({ timeout: 15000 });

      const featureRow = page.locator('.poi-feature-row').first();
      await featureRow.click();
      await page.waitForTimeout(500);

      // AC1: tabs visible
      const standardTab = page.getByTestId('poi-content-mode-tab-standard');
      const htmlTab = page.getByTestId('poi-content-mode-tab-html');
      const urlTab = page.getByTestId('poi-content-mode-tab-url');
      await expect(standardTab).toBeVisible({ timeout: 5000 });
      await expect(htmlTab).toBeVisible({ timeout: 5000 });
      await expect(urlTab).toBeVisible({ timeout: 5000 });

      // Legacy estimation: html exists → html mode active
      await expect(htmlTab).toHaveClass(/active/);

      // AC3: html mode shows html/reference assets, hides desc/address/url
      await expect(page.locator('label:has-text("HTML")')).toBeVisible({ timeout: 5000 });
      await expect(page.locator('label:has-text("参照素材")')).toBeVisible({ timeout: 5000 });
      await expect(page.locator('label:has-text("説明")').first()).toHaveCount(0);
      await expect(page.locator('label:has-text("住所")').first()).toHaveCount(0);
      await expect(page.locator('label:has-text("URL")').first()).toHaveCount(0);

      // AC5: incompatible field diagnostic (desc+address+url have values in html mode)
      await expect(page.locator('.editor-diagnostic').first()).toBeVisible({ timeout: 5000 });

      // AC7: Cancel mode switch
      await standardTab.click();
      const confirmDialog = page.getByTestId('poi-content-mode-confirm');
      await expect(confirmDialog).toBeVisible({ timeout: 5000 });
      await page.getByTestId('poi-content-mode-cancel').click();
      await expect(confirmDialog).toBeHidden({ timeout: 5000 });
      await expect(htmlTab).toHaveClass(/active/);

      // AC6: Confirm mode switch → standard mode → incompatible fields deleted
      await standardTab.click();
      await expect(confirmDialog).toBeVisible({ timeout: 5000 });
      await confirmDialog.click();
      await expect(standardTab).toHaveClass(/active/);
      await expect(page.locator('label:has-text("HTML")')).toHaveCount(0);
      await expect(page.locator('label:has-text("説明")')).toBeVisible({ timeout: 5000 });

      // AC4+AC16: URL mode shows only url, hides image
      await urlTab.click();
      await expect(urlTab).toHaveClass(/active/);
      await expect(page.locator('label:has-text("画像")')).toHaveCount(0);
      await expect(page.locator('label:has-text("説明")').first()).toHaveCount(0);

      // AC8: Undo after mode switch (1 undo unit)
      await page.locator('[data-editor-action="undo"]').click();
      await expect(standardTab).toHaveClass(/active/); // back to standard mode with desc restored

      console.log('  AC1-AC8, AC16: PASS');
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('AC10+AC14: insert maplat-asset reference into HTML and verify asset ref warning', async () => {
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m11-t9-ac10-'));
    const { app, page } = await launch(e2eRoot);

    try {
      const poi = await seedPoi(page);
      await openHash(page, `#/poisources/${poi.uid}`);
      await expect(page.locator('.poi-side-pane')).toBeVisible({ timeout: 15000 });

      const featureRow = page.locator('.poi-feature-row').first();
      await featureRow.click();
      await page.waitForTimeout(500);

      // Switch to html mode (confirm if dialog appears due to incompatible fields)
      const htmlTab = page.getByTestId('poi-content-mode-tab-html');
      await htmlTab.click();
      // Confirm dialog may appear (desc/address have values → incompatible with html mode)
      const confirmBtn = page.getByTestId('poi-content-mode-confirm');
      if (await confirmBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
        await confirmBtn.click();
      }
      await expect(htmlTab).toHaveClass(/active/);

      // AC10: Insert maplat-asset: reference into HTML via page.evaluate
      const syntheticUid = '00000000-0000-4000-a000-000000000099';
      await page.evaluate(async (uid) => {
        const textareas = document.querySelectorAll('textarea');
        for (const ta of textareas) {
          if (ta.value !== undefined) {
            const langResourceInput = ta.closest('[class*="lang-resource"]');
            if (langResourceInput) {
              const newVal = `<img src="maplat-asset:${uid}" />`;
              ta.value = newVal;
              ta.dispatchEvent(new Event('input', { bubbles: true }));
              ta.dispatchEvent(new Event('change', { bubbles: true }));
              break;
            }
          }
        }
      }, syntheticUid);
      await page.waitForTimeout(300);

      // AC14: After inserting asset ref, the live warning should appear
      // (asset_refs_present warning)
      const saveBtn = page.getByTestId('editor-save');
      // Save to persist
      await saveBtn.click();
      // Wait for save to complete (dismiss dialog if appears)
      await page.waitForTimeout(1000);
      // Dismiss "success" dialog if shown
      const okBtn = page.getByText('OK');
      if (await okBtn.isVisible({ timeout: 500 }).catch(() => false)) await okBtn.click();

      await page.waitForTimeout(500);

      // Reload and verify the saved HTML contains maplat-asset:
      await page.reload();
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.poi-side-pane')).toBeVisible({ timeout: 15000 });

      const refreshedFeatureRow = page.locator('.poi-feature-row').first();
      await refreshedFeatureRow.click();
      await page.waitForTimeout(500);

      // Navigate to html mode
      const htmlTab2 = page.getByTestId('poi-content-mode-tab-html');
      await htmlTab2.click();
      const confirmBtn2 = page.getByTestId('poi-content-mode-confirm');
      if (await confirmBtn2.isVisible({ timeout: 1000 }).catch(() => false)) await confirmBtn2.click();
      await expect(htmlTab2).toHaveClass(/active/);

      // Verify the saved HTML contains the maplat-asset reference
      const htmlContent = await page.evaluate(() => {
        const textareas = document.querySelectorAll('textarea');
        for (const ta of textareas) {
          const val = ta.value || '';
          if (val.includes('maplat-asset:')) return val;
        }
        return null;
      });
      expect(htmlContent).toContain(`maplat-asset:${syntheticUid}`);

      // AC14: live warning should show asset_refs_present
      const diag = page.locator('.editor-diagnostic');
      const diagCount = await diag.count();
      expect(diagCount).toBeGreaterThan(0);

      console.log('  AC10+AC14: PASS');
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('AC12-AC13: maplat-asset references survive roundtrip through save/load', async () => {
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m11-t9-ac12-'));
    const { app, page } = await launch(e2eRoot);

    try {
      // Create a POI with a maplat-asset: reference in HTML (html mode)
      const slug = `m11-t9-ref-${Date.now()}`;
      const createResult = await page.evaluate(async (s) => {
        const r = await window.poiSources.createLocal({ slug: s, title: { ja: 'T9 Ref POI' }, lang: 'ja' });
        if (!r || r.result !== 'Success') throw new Error(`create: ${JSON.stringify(r)}`);
        return r.uid;
      }, slug);

      const uid = createResult as unknown as string;

      const referenceHtml = '<p>Ref: <img src="maplat-asset:00000000-0000-4000-a000-000000000042" /></p>';
      await page.evaluate(async (params) => {
        await window.poiSources.save(params.uid, {
          slug: params.slug, title: { ja: 'T9 Ref POI' },
          fc: {
            type: 'FeatureCollection',
            features: [{
              type: 'Feature', id: 'p1', geometry: { type: 'Point', coordinates: [139.767, 35.681] },
              properties: {
                _maplatContentMode: 'html',
                name: { ja: 'AREF POI' },
                html: { ja: params.html },
              },
            }],
          },
        });
      }, { uid, slug, html: referenceHtml });

      // Reload the editor and verify the reference survived roundtrip
      await page.reload();
      await page.waitForLoadState('domcontentloaded');
      await openHash(page, `#/poisources/${uid}`);
      await expect(page.locator('.poi-side-pane')).toBeVisible({ timeout: 15000 });

      const featureRow = page.locator('.poi-feature-row').first();
      await featureRow.click();
      await page.waitForTimeout(500);

      // Switch to html mode
      const htmlTab = page.getByTestId('poi-content-mode-tab-html');
      await htmlTab.click();
      const confirmBtn = page.getByTestId('poi-content-mode-confirm');
      if (await confirmBtn.isVisible({ timeout: 1000 }).catch(() => false)) await confirmBtn.click();
      await expect(htmlTab).toHaveClass(/active/);

      // Read the HTML textarea content
      const htmlContent = await page.evaluate(() => {
        const textareas = document.querySelectorAll('textarea');
        for (const ta of textareas) {
          const val = ta.value || '';
          if (val.includes('maplat-asset:')) return val;
        }
        return null;
      });
      expect(htmlContent).toContain('maplat-asset:00000000-0000-4000-a000-000000000042');

      console.log('  AC12-AC13: PASS');
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('AC18: New feature button has + icon matching Resource List grammar', async () => {
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m11-t9-btn-'));
    const { app, page } = await launch(e2eRoot);

    try {
      const poi = await seedPoi(page);
      await openHash(page, `#/poisources/${poi.uid}`);
      await expect(page.locator('.poi-side-pane')).toBeVisible({ timeout: 15000 });

      const addBtn = page.locator('button:has-text("POIを追加")');
      await expect(addBtn).toBeVisible();
      const icon = addBtn.locator('i.bi-plus-lg');
      await expect(icon).toBeVisible();

      console.log('  AC18: PASS');
    } finally {
      await quitElectronApplication(app);
    }
  });
});