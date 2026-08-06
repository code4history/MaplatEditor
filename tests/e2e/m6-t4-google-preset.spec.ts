// m6-t4 Google プリセット E2E
// AC4: kind=google で4プリセット表示・選択
// AC5: kind=google で URL 非表示
// AC6: 保存→再読込で maptype 復元
// AC8: 4プリセット seed 後すべて disabled
// AC9(a): 登録済み理由にプリセット名
// AC16: 保存 payload / 一覧経路は smoke+本E2Eの再オープンで担保
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';
import { seedE2EProviderKeys } from './helpers/providerKeys';

const projectRoot = path.resolve(import.meta.dirname, '../..');
const PRESETS = [
  { value: 'google_roadmap', suffix: 'roadmap' },
  { value: 'google_satellite', suffix: 'satellite' },
  { value: 'google_hybrid', suffix: 'hybrid' },
  { value: 'google_terrain', suffix: 'terrain' },
] as const;

async function launch(e2eRoot: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [projectRoot, `--user-data-dir=${e2eRoot}`],
    cwd: projectRoot,
    env: { ...process.env, VITE_DEV_SERVER_URL: '', MAPLAT_E2E_ROOT: e2eRoot },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  const saveFolder = await page.evaluate(() => window.settings.get('saveFolder'));
  if (!path.resolve(saveFolder).startsWith(path.resolve(e2eRoot) + path.sep)) {
    throw new Error(`E2E storage isolation failed: ${saveFolder} is outside ${e2eRoot}`);
  }
  return { app, page };
}

async function fillAndCommit(locator: ReturnType<Page['getByTestId']>, value: string): Promise<void> {
  await locator.fill(value);
  await locator.press('Tab');
}

async function seedGoogleBasemap(
  page: Page,
  preset: (typeof PRESETS)[number],
  slug: string,
): Promise<string> {
  const result = await page.evaluate(
    async ({ slug: s, maptype, thumb }) => {
      return await (window as any).baseMaps.saveUser({
        slug: s,
        create: true,
        uid: crypto.randomUUID(),
        tms: {
          kind: 'google',
          maptype,
          lang: 'en',
          title: { en: s },
          label: { en: s },
          attr: { en: '© Test' },
          dataAttr: {},
          license: '',
          dataLicense: '',
          licenseNote: {},
          dataLicenseNote: {},
          url: '',
          minZoom: null,
          maxZoom: null,
          thumbnail: thumb,
          coverageLngLats: null,
        },
      });
    },
    { slug, maptype: preset.value, thumb: `basemap_icons/google_${preset.suffix}.png` },
  );
  expect(result?.result).toBe('Success');
  return result.uid as string;
}

test('Google preset: select/save/reload, URL hidden, uniqueness UI', async () => {
  test.setTimeout(180_000);
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m6-t4-'));
  const { app, page } = await launch(e2eRoot);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  try {
    // m6-t6 (§3.6): basemap-kind-google は BaseMapEdit.vue のエディタ用キー gate 対象
    await seedE2EProviderKeys(page);
    await page.evaluate(() => {
      location.hash = '/basemaps?page=3';
    });
    await page.getByTestId('basemap-new').click();
    await expect(page.getByTestId('basemap-editor')).toBeVisible();

    // AC4/AC5
    await page.getByTestId('basemap-kind-google').click();
    await expect(page.getByTestId('basemap-google-preset-group')).toBeVisible();
    await expect(page.getByTestId('basemap-url')).toHaveCount(0);
    for (const p of PRESETS) {
      await expect(page.getByTestId(`basemap-google-preset-${p.suffix}`)).toBeEnabled();
    }
    await page.getByTestId('basemap-google-preset-roadmap').click();
    await expect(page.getByTestId('basemap-google-preset-roadmap')).toHaveClass(/btn-primary/);

    // AC6: 保存 → 再オープン
    const slug = `m6t4-road-${Date.now()}`;
    await fillAndCommit(page.getByTestId('basemap-slug'), slug);
    await fillAndCommit(page.getByTestId('basemap-title'), 'M6T4 Roadmap');
    await fillAndCommit(page.getByTestId('basemap-attr'), '© Test Attr');
    await expect(page.getByTestId('editor-save')).toBeEnabled();
    await page.getByTestId('editor-save').click();
    await expect(page).not.toHaveURL(/new=1/, { timeout: 30_000 });
    await expect(page.getByTestId('editor-save-state')).toHaveText(/保存済み|saved/i);

    await page.getByTestId(`basemap-row-${slug}`).click();
    await expect(page.getByTestId('basemap-google-preset-group')).toBeVisible();
    await expect(page.getByTestId('basemap-google-preset-roadmap')).toHaveClass(/btn-primary/);
    await expect(page.getByTestId('basemap-url')).toHaveCount(0);

    // AC8/AC9: 残り3プリセットを seed → 新規 google で全 disabled + 理由に名前
    await seedGoogleBasemap(page, PRESETS[1], `m6t4-sat-${Date.now()}`);
    await seedGoogleBasemap(page, PRESETS[2], `m6t4-hyb-${Date.now()}`);
    await seedGoogleBasemap(page, PRESETS[3], `m6t4-ter-${Date.now()}`);

    await page.evaluate(() => {
      location.hash = '/basemaps';
    });
    await page.getByTestId('basemap-new').click();
    await page.getByTestId('basemap-kind-google').click();
    await expect(page.getByTestId('basemap-google-preset-group')).toBeVisible();
    for (const p of PRESETS) {
      await expect(page.getByTestId(`basemap-google-preset-${p.suffix}`)).toBeDisabled();
    }
    // m6-t9 §3.5: 固定 text-danger ブロック（basemap-google-preset-registered-reason）は廃止され
    // ContextHelp（? アイコン、data-testid: basemap-google-preset-{suffix}-reason）へ置き換わった。
    // m12-t11-description-grammar.spec.ts:68-70 の確立済みパターン（click → .popover 内容確認 → Escape）を踏襲
    const reasonHelp = page.getByTestId('basemap-google-preset-roadmap-reason');
    await expect(reasonHelp).toBeVisible();
    await reasonHelp.click();
    await expect(page.locator('.popover')).toContainText(/Roadmap|道路/, { timeout: 5000 });
    await page.keyboard.press('Escape');

    expect(pageErrors).toEqual([]);
  } finally {
    await quitElectronApplication(app);
  }
});
