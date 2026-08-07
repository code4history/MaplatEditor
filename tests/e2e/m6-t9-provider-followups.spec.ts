// m6-t9: provider/basemap 周辺の是正6件（m6-t4/t5/t6 実装レビュー由来）
// AC1: provider kind（google/mapbox/maplibre）の AppSource は url 入力欄が表示されない。
//      【m6-t10 §3.3 / AC14 で上位規則へ吸収】url の上書き欄は **全種別** から撤去された。
//      ベースマップの同一性そのものを変える操作であり、マスタ側で別のベースマップを作るべきもの。
//      ∴ 「provider は出ない / tms は出る」という m6-t9 当時の対比は成立しなくなった。
//      本テストは「url 入力欄が出ないこと」を provider と tms の**両方**で固定し、
//      注記が provider 専用（app-source-url-provider-note）から共通（app-source-url-note）へ
//      移ったことを併せて固定する。撤去そのものの意図は m6-t10 の E2E が受け持つ
// AC3: 【v1.4 で撤去・m6-t10 へ移管】「マスタから再取得」機能自体を m6-t9 から撤去したため、当該テストも削除
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

    // ---- AC1: アプリへソース追加 → url 欄は provider / tms のいずれでも出ない（m6-t10 §3.3）----
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
    await expect(googleSource.getByTestId('app-source-url-note')).toBeVisible();

    await page.getByTestId('app-basemap-search').fill(tmsSlug);
    await expect(page.getByTestId(`app-basemap-row-${tmsSlug}`)).toBeVisible();
    await page.getByTestId(`app-basemap-row-${tmsSlug}`).click();
    const tmsSource = page.getByTestId(`app-selected-source-${tmsSlug}`);
    await expect(tmsSource).toBeVisible();
    // m6-t10 AC14: tms でも url 欄は出ない。注記は provider と共通のものになった
    await expect(tmsSource.getByTestId('app-source-url-field')).toHaveCount(0);
    await expect(tmsSource.getByTestId('app-source-url')).toHaveCount(0);
    await expect(tmsSource.getByTestId('app-source-url-note')).toBeVisible();

    expect(pageErrors).toEqual([]);
  } finally {
    await quitElectronApplication(app);
  }
});
