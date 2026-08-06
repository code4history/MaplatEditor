// m6-t9: provider/basemap 周辺の是正6件（m6-t4/t5/t6 実装レビュー由来）
// AC1: provider kind（google/mapbox/maplibre）の AppSource は url 入力欄が表示されない。tms（無印）は従来どおり表示される
// AC3: 「マスタから再取得」ボタン押下で、マスタの最新値がアプリソースへ反映される
// AC6: 種別選択ボタン・プリセットボタンで、無効なボタンにのみ ContextHelp が表示され、有効なボタンには出ない
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';
import { seedE2EProviderKeys } from './helpers/providerKeys';

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

// AppEdit.vue の保存成功ハンドラは window.dialog.showMessageBox で OK ダイアログを出す
// (:269)。実 OS ダイアログはヘッドレス Electron では応答が無く saving が finally まで
// 戻らないため、m11-t4-master-detail.spec.ts の installDialogHarness と同型のスタブが必要
async function installMessageBoxHarness(app: ElectronApplication): Promise<void> {
  await app.evaluate(async ({ dialog }) => {
    dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox;
  });
}

async function fillAndCommit(locator: ReturnType<Page['getByTestId']>, value: string): Promise<void> {
  await locator.fill(value);
  await locator.press('Tab');
}

async function seedBaseMap(
  page: Page,
  slug: string,
  tms: Record<string, unknown>,
): Promise<string> {
  const result = await page.evaluate(
    async ({ slug: s, tms: t }) => {
      return await (window as any).baseMaps.saveUser({
        slug: s,
        create: true,
        uid: crypto.randomUUID(),
        tms: t,
      });
    },
    { slug, tms },
  );
  expect(result?.result, `seedBaseMap(${slug}) failed: ${JSON.stringify(result)}`).toBe('Success');
  return result.uid as string;
}

// lang: 'ja' — AppEdit の既定言語（AppEdit.vue:221 currentLang = ref('ja')）と揃え、
// langText('attr') 等の言語キー参照ミスマッチを避ける
const baseTmsDoc = (extra: Record<string, unknown>) => ({
  lang: 'ja',
  title: { ja: 'T' },
  label: { ja: 'T' },
  attr: { ja: '© Test' },
  dataAttr: {},
  license: '',
  dataLicense: '',
  licenseNote: {},
  dataLicenseNote: {},
  minZoom: null,
  maxZoom: null,
  thumbnail: '',
  coverageLngLats: null,
  ...extra,
});

test('m6-t9 AC1/AC6: provider kind hides url field in AppSourceEditor; ContextHelp shows only when actually disabled', async () => {
  test.setTimeout(180_000);
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m6-t9-ac1-'));
  const { app, page } = await launch(e2eRoot);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  try {
    await seedE2EProviderKeys(page);

    const googleSlug = `m6t9-google-${Date.now()}`;
    await seedBaseMap(page, googleSlug, baseTmsDoc({ kind: 'google', maptype: 'google_roadmap', url: '' }));
    const tmsSlug = `m6t9-tms-${Date.now()}`;
    await seedBaseMap(page, tmsSlug, baseTmsDoc({ kind: 'tms', maptype: null, url: 'https://example.com/{z}/{x}/{y}.png' }));

    // ---- AC6: 種別選択ボタン群 — 無効な merc のみ理由が出る。google/mapbox はキー投入済みのため出ない ----
    await page.evaluate(() => { location.hash = '/basemaps'; });
    await page.getByTestId('basemap-new').click();
    await expect(page.getByTestId('basemap-kind-prompt')).toBeVisible();
    await expect(page.getByTestId('basemap-kind-merc-reason')).toBeVisible();
    await expect(page.getByTestId('basemap-kind-google-reason')).toHaveCount(0);
    await expect(page.getByTestId('basemap-kind-mapbox-reason')).toHaveCount(0);
    await expect(page.getByTestId('basemap-kind-maplibre-reason')).toHaveCount(0);
    await expect(page.getByTestId('basemap-kind-tms-reason')).toHaveCount(0);

    // ---- AC1: アプリへソース追加 → provider kind は url 欄が出ない、tms は出る ----
    await page.evaluate(() => { location.hash = '/appedit'; });
    await expect(page.getByTestId('app-id')).toBeVisible();
    const appSlug = `m6t9-app-${Date.now()}`;
    await fillAndCommit(page.getByTestId('app-id'), appSlug);
    await fillAndCommit(page.getByTestId('app-title'), 'M6T9 App');

    await page.getByTestId('app-sources-tab').click();
    await page.getByTestId('app-basemap-mode').click();
    await page.getByTestId('app-basemap-search').fill(googleSlug);
    await expect(page.getByTestId(`app-basemap-row-${googleSlug}`)).toBeVisible();
    await page.getByTestId(`app-basemap-row-${googleSlug}`).click();
    const googleSource = page.getByTestId(`app-selected-source-${googleSlug}`);
    await expect(googleSource).toBeVisible();
    await expect(googleSource.getByTestId('app-source-url-field')).toHaveCount(0);
    await expect(googleSource.getByTestId('app-source-url-provider-note')).toBeVisible();

    await page.getByTestId('app-basemap-search').fill(tmsSlug);
    await expect(page.getByTestId(`app-basemap-row-${tmsSlug}`)).toBeVisible();
    await page.getByTestId(`app-basemap-row-${tmsSlug}`).click();
    const tmsSource = page.getByTestId(`app-selected-source-${tmsSlug}`);
    await expect(tmsSource).toBeVisible();
    await expect(tmsSource.getByTestId('app-source-url-field')).toBeVisible();
    await expect(tmsSource.getByTestId('app-source-url')).toHaveValue('https://example.com/{z}/{x}/{y}.png');

    expect(pageErrors).toEqual([]);
  } finally {
    await quitElectronApplication(app);
  }
});

test('m6-t9 AC3: refetch from master pulls the latest master value into the app source', async () => {
  test.setTimeout(180_000);
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m6-t9-ac3-'));
  const { app, page } = await launch(e2eRoot);
  await installMessageBoxHarness(app);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  try {
    await seedE2EProviderKeys(page);

    // AppEdit の既定言語は 'ja'（AppEdit.vue:221）のため、attr も ja キーで seed する
    const slug = `m6t9-refetch-${Date.now()}`;
    await seedBaseMap(page, slug, baseTmsDoc({
      kind: 'google',
      maptype: 'google_roadmap',
      url: '',
      attr: { ja: 'Old Attr' },
    }));

    // アプリを作成しソースを追加。追加直後は master の attr（Old Attr）がコピーされる
    await page.evaluate(() => { location.hash = '/appedit'; });
    await expect(page.getByTestId('app-id')).toBeVisible();
    const appSlug = `m6t9-app-refetch-${Date.now()}`;
    await fillAndCommit(page.getByTestId('app-id'), appSlug);
    await fillAndCommit(page.getByTestId('app-title'), 'M6T9 Refetch App');
    await page.getByTestId('app-sources-tab').click();
    await page.getByTestId('app-basemap-mode').click();
    await page.getByTestId('app-basemap-search').fill(slug);
    await expect(page.getByTestId(`app-basemap-row-${slug}`)).toBeVisible();
    await page.getByTestId(`app-basemap-row-${slug}`).click();
    const source = page.getByTestId(`app-selected-source-${slug}`);
    await expect(source.getByTestId('app-source-attr')).toHaveValue('Old Attr');

    await expect(page.getByTestId('editor-save')).toBeEnabled();
    await page.getByTestId('editor-save').click();
    await expect(page.getByTestId('editor-save-state')).toHaveText(/保存済み|saved/i, { timeout: 30_000 });
    const savedAppUrl = page.url();

    // マスタ側を編集して attr を更新（UI 経由。selectGooglePreset の attr 上書き防止を踏まえ、
    // 既に非空の attr は自動上書きされないため手動で変更する）
    await page.evaluate(() => { location.hash = '/basemaps'; });
    await page.getByTestId(`basemap-row-${slug}`).click();
    await expect(page.getByTestId('basemap-google-preset-group')).toBeVisible();
    await fillAndCommit(page.getByTestId('basemap-attr'), 'New Attr');
    await expect(page.getByTestId('editor-save')).toBeEnabled();
    await page.getByTestId('editor-save').click();
    await expect(page.getByTestId('editor-save-state')).toHaveText(/保存済み|saved/i, { timeout: 30_000 });

    // アプリ側へ戻り、再取得ボタンで最新値（New Attr）を取り込む
    await page.evaluate((url: string) => { location.href = url; }, savedAppUrl);
    await expect(page.getByTestId('app-sources-tab')).toBeVisible();
    await page.getByTestId('app-sources-tab').click();
    const reopenedSource = page.getByTestId(`app-selected-source-${slug}`);
    await expect(reopenedSource.getByTestId('app-source-attr')).toHaveValue('Old Attr');
    await reopenedSource.getByTestId('app-source-refetch-from-master').click();
    await expect(reopenedSource.getByTestId('app-source-attr')).toHaveValue('New Attr');

    expect(pageErrors).toEqual([]);
  } finally {
    await quitElectronApplication(app);
  }
});
