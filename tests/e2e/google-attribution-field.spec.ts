// Google の地図の帰属表記の欄 E2E
// Google の地図の帰属表記は Google が返す著作権の表示を使う（Viewer が全文と Google Maps のロゴを出す）。
// エディタは入力させず、理由を ? で示し、保存済みの値も読まず、保存すると消す。
// case 1: 新規の Google の地図は帰属表記を入れずに保存でき、保存した値に attr が無い
// case 2: 以前の版で帰属表記を入れて保存した Google の地図は、開くと入力できない形で出て、保存し直すと消える
import { expect, test, type Page } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';
import { launch } from './helpers/launchIsolated';
import { seedE2EProviderKeys } from './helpers/providerKeys';

async function forceJapanese(page: Page): Promise<void> {
  await page.evaluate(() => window.settings.set('lang', 'ja'));
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
}

async function fillAndCommit(locator: ReturnType<Page['getByTestId']>, value: string): Promise<void> {
  await locator.fill(value);
  await locator.press('Tab');
}

// 保存したユーザー定義のベースマップの data を slug で引く
async function savedData(page: Page, slug: string): Promise<Record<string, any>> {
  const list = await page.evaluate(async () => await (window as any).baseMaps.list());
  const found = (list as any[]).find((item) => item.mapID === slug);
  expect(found, `保存したベースマップ ${slug} がある`).toBeTruthy();
  return found.data as Record<string, any>;
}

function hasAttrText(attr: unknown): boolean {
  if (typeof attr === 'string') return attr.trim() !== '';
  if (attr && typeof attr === 'object') return Object.values(attr).some((v) => typeof v === 'string' && v.trim() !== '');
  return false;
}

async function expectReadOnlyAttribution(page: Page): Promise<void> {
  await expect(page.getByTestId('basemap-attr')).toHaveCount(0);
  const field = page.getByTestId('basemap-attr-google');
  await expect(field).toBeDisabled();
  await expect(field).toHaveValue('Google が返す著作権の表示');
  const reason = page.getByTestId('basemap-attr-google-reason');
  await expect(reason).toHaveAttribute('aria-label', '「地図画像帰属」を使えない理由');
  await reason.click();
  await expect(page.locator('.popover')).toContainText('Google が返す著作権の表示を使います', { timeout: 5000 });
  await expect(page.locator('.popover')).toContainText('Google Maps のロゴ');
  await page.keyboard.press('Escape');
}

async function saveAndWait(page: Page): Promise<void> {
  await expect(page.getByTestId('editor-save')).toBeEnabled({ timeout: 30_000 });
  await page.getByTestId('editor-save').click();
  await expect(page.getByTestId('editor-save-state')).toHaveText(/保存済み/, { timeout: 30_000 });
}

test('Google の地図の帰属表記は入力できず、保存済みの値も保存し直すと消える', async () => {
  test.setTimeout(240_000);
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-google-attribution-'));
  const { app, page } = await launch(e2eRoot);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  try {
    await seedE2EProviderKeys(page);
    await forceJapanese(page);
    // case 2 の材料: 以前の版で帰属表記を入れて保存した Google の地図
    await page.evaluate(async () => {
      const result = await (window as any).baseMaps.saveUser({
        slug: 'google-saved-attr',
        create: true,
        uid: crypto.randomUUID(),
        tms: {
          kind: 'google', maptype: 'google_satellite', lang: 'ja',
          title: { ja: '保存済みの Google 航空写真' }, label: { ja: '保存済み' },
          attr: { ja: '勝手な帰属表記' }, dataAttr: {}, license: 'All right reserved', dataLicense: 'All right reserved',
          licenseNote: {}, dataLicenseNote: {}, url: '', minZoom: 0, maxZoom: 22,
          thumbnail: 'basemap_icons/google_satellite.png', coverageLngLats: null,
        },
      });
      if (!result?.uid) throw new Error(`seed failed: ${JSON.stringify(result)}`);
    });

    // case 1
    await page.evaluate(() => { location.hash = '/basemaps?page=3'; });
    await page.getByTestId('basemap-new').click();
    await expect(page.getByTestId('basemap-editor')).toBeVisible();
    await page.getByTestId('basemap-kind-google').click();
    await page.getByTestId('basemap-google-preset-roadmap').click();
    await expect(page.getByTestId('basemap-google-preset-roadmap')).toHaveClass(/btn-primary/);
    await expectReadOnlyAttribution(page);
    await fillAndCommit(page.getByTestId('basemap-slug'), 'google-new-road');
    await fillAndCommit(page.getByTestId('basemap-title'), 'Google 道路地図');
    await saveAndWait(page);
    expect(hasAttrText((await savedData(page, 'google-new-road')).attr)).toBe(false);

    // case 2
    expect(hasAttrText((await savedData(page, 'google-saved-attr')).attr)).toBe(true);
    await page.evaluate(() => { location.hash = '/basemaps'; });
    await page.getByTestId('basemap-row-google-saved-attr').click();
    await expect(page.getByTestId('basemap-google-preset-satellite')).toHaveClass(/btn-primary/);
    await expectReadOnlyAttribution(page);
    await fillAndCommit(page.getByTestId('basemap-title'), '保存し直した Google 航空写真');
    await saveAndWait(page);
    expect(hasAttrText((await savedData(page, 'google-saved-attr')).attr)).toBe(false);

    expect(pageErrors).toEqual([]);
  } finally {
    await quitElectronApplication(app);
  }
});
