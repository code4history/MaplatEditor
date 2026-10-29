// nov26-m6-t6: UI保存往復・任意欄・viewer情報ダイアログを実物で確認する。
import { _electron as electron, expect, test, type Page } from '@playwright/test';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';

const projectRoot = path.resolve(import.meta.dirname, '../..');
const keys = ['createdAt', 'era', 'contributor', 'mapper', 'reference', 'description'];
const values = Object.fromEntries(keys.map(key => [key, { ja: `${key} 日本語`, en: `${key} English` }]));
async function launch() {
  const fixtureDir = path.join(projectRoot, '.tmp-smoke');
  await mkdir(fixtureDir, { recursive: true });
  const e2eRoot = await mkdtemp(path.join(fixtureDir, 'nov26-m6-t6-e2e-'));
  const app = await electron.launch({ args: [projectRoot, `--user-data-dir=${e2eRoot}`], cwd: projectRoot,
    env: { ...process.env, VITE_DEV_SERVER_URL: '', MAPLAT_E2E_ROOT: e2eRoot } });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  const saveFolder = await page.evaluate(() => window.settings.get('saveFolder'));
  expect(path.resolve(saveFolder).startsWith(e2eRoot + path.sep)).toBe(true);
  await page.evaluate(() => window.settings.set('lang', 'ja'));
  const tile = await readFile(path.join(projectRoot, 'tests/e2e/fixtures/fake-osm-tile.png'));
  await page.route('https://metadata.example.test/**', route => route.fulfill({ status: 200, contentType: 'image/png', body: tile }));
  return { app, page };
}
async function seed(page: Page, metadata = false) {
  const slug = `nov26-meta-${Date.now()}`;
  const result = await page.evaluate(async ({ slug, meta }) => (window as any).baseMaps.saveUser({
    create: true, uid: crypto.randomUUID(), slug,
    tms: { kind: 'tms', lang: 'ja', title: { ja: slug }, label: { ja: slug }, attr: { ja: '出典' },
      url: 'https://metadata.example.test/{z}/{x}/{y}.png', minZoom: 0, maxZoom: 18, thumbnail: '', coverageLngLats: null, ...meta },
  }), { slug, meta: metadata ? values : {} });
  expect(result.result).toBe('Success');
  return { uid: result.uid as string, slug };
}
async function open(page: Page, slug: string) {
  await page.evaluate(() => { location.hash = '/basemaps'; });
  await page.getByTestId(`basemap-row-${slug}`).click();
  await expect(page.getByTestId('basemap-title')).toBeVisible();
}

test('AC1: 6項目を日本語と英語で入力し保存・一覧へ戻る・再読込で保つ', async () => {
 test.setTimeout(180000);
 const { app, page } = await launch();
 try {
  const item = await seed(page);
  await open(page, item.slug);
  await page.getByTestId('basemap-source-metadata').locator('summary').click();
  for (const lang of ['ja', 'en'] as const) {
   await page.getByTestId('editor-language').selectOption(lang);
   for (const key of keys) {
    await page.getByTestId(`basemap-meta-${key}`).fill(values[key][lang]);
    await page.getByTestId(`basemap-meta-${key}`).press('Tab');
   }
  }
  await expect(page.getByTestId('editor-save')).toBeEnabled();
  await page.getByTestId('editor-save').click();
  await expect(page.getByTestId('editor-save-state')).toHaveText(/保存済み|saved/i);
  // 広い画面のmaster/detailでは戻るボタンがないため、一覧ルートへ戻して文書を閉じる。
  await page.evaluate(() => { location.hash = '/basemaps'; });
  await expect(page.getByTestId('basemap-title')).toHaveCount(0);
  await open(page, item.slug);
  await expect(page.getByTestId('basemap-source-metadata')).toHaveAttribute('open', '');
  for (const lang of ['ja', 'en'] as const) {
   await page.getByTestId('editor-language').selectOption(lang);
   for (const key of keys) await expect(page.getByTestId(`basemap-meta-${key}`)).toHaveValue(values[key][lang]);
  }
 } finally { await quitElectronApplication(app); }
});

test('保存の直後に一覧へ戻ると、一覧の読み直しが遅れても編集画面が開き直さない', async () => {
 test.setTimeout(180000);
 const { app, page } = await launch();
 try {
  const item = await seed(page);
  await open(page, item.slug);
  await page.getByTestId('basemap-source-metadata').locator('summary').click();
  await page.getByTestId('basemap-meta-era').fill('era 日本語');
  await page.getByTestId('basemap-meta-era').press('Tab');
  // 保存の後の一覧の読み直しを遅らせる（遅い CI と同じ順序を確実に作る）
  await app.evaluate(({ ipcMain }) => {
   const handlers = (ipcMain as any)._invokeHandlers as Map<string, (...args: unknown[]) => unknown>;
   const original = handlers.get('search:baseMaps');
   if (!original) throw new Error('search:baseMaps の handler がない');
   ipcMain.removeHandler('search:baseMaps');
   ipcMain.handle('search:baseMaps', async (...args) => {
    await new Promise(resolve => setTimeout(resolve, 1500));
    return original(...args);
   });
  });
  await expect(page.getByTestId('editor-save')).toBeEnabled();
  await page.getByTestId('editor-save').click();
  await expect(page.getByTestId('editor-save-state')).toHaveText(/保存済み|saved/i);
  await page.evaluate(() => { location.hash = '/basemaps'; });
  await expect(page.getByTestId('basemap-title')).toHaveCount(0);
  // 遅らせた読み直しが終わった後も、一覧のままである
  await page.waitForTimeout(3000);
  await expect(page.getByTestId('basemap-title')).toHaveCount(0);
  expect(await page.evaluate(() => location.hash)).toBe('#/basemaps');
 } finally { await quitElectronApplication(app); }
});

test('AC4: 未設定では閉じて始まりビルトインには任意欄がない', async () => {
 const { app, page } = await launch();
 try {
  const item = await seed(page);
  await open(page, item.slug);
  await expect(page.getByTestId('basemap-source-metadata')).not.toHaveAttribute('open', '');
  // 広い画面のmaster/detailでは戻るボタンがないため、一覧ルートへ戻して文書を閉じる。
  await page.evaluate(() => { location.hash = '/basemaps'; });
  await expect(page.getByTestId('basemap-title')).toHaveCount(0);
  await page.getByTestId('basemap-row-osm').click();
  await expect(page.getByTestId('basemap-editor-readonly')).toBeVisible();
  await expect(page.getByTestId('basemap-source-metadata')).toHaveCount(0);
 } finally { await quitElectronApplication(app); }
});

test('AC3: 最初に表示するベースマップの6項目がプレビュー情報ダイアログへ届く', async () => {
 test.setTimeout(180000);
 const { app, page } = await launch();
 try {
  const item = await seed(page, true);
  const appSlug = `nov26-meta-app-${Date.now()}`;
  const saved = await page.evaluate(async ({ item, appSlug }) => window.appedit.save({ slug: appSlug, document: {
    appID: appSlug, appName: { ja: '出典プレビュー' }, title: { ja: '出典プレビュー' }, lang: 'ja',
    description: {}, keywords: '', siteUrl: '', pois: [],
    sources: [{ sourceType: 'tms', role: 'base', baseMapUid: item.uid, mapID: item.slug, startFrom: true, overrides: {} }],
    appSettings: { homeLng: 141.35, homeLat: 43.06, defaultZoom: 14 },
  } }), { item, appSlug });
  expect(saved.result).toBe('Success');
  await page.evaluate(() => { location.hash = '/applist'; });
  await page.locator('[data-resource-uid] a').first().click();
  await expect(page.getByTestId('app-id')).toBeVisible();
  await page.locator('[role="tab"]').filter({ hasText: /プレビュー|Preview/ }).click();
  const handle = await page.locator('iframe.preview-map').elementHandle();
  const frame = await handle!.contentFrame();
  if (!frame) throw new Error('プレビューiframeなし');
  await frame.waitForFunction(() => !!(window as any).__maplatPreview, undefined, { timeout: 90000 });
  await frame.locator('.modalBase').waitFor({ state: 'hidden', timeout: 30000 });
  await frame.locator('.ol-copyright button').click();
  for (const key of keys) await expect(frame.locator(`.modal_map .${key}_div`)).toContainText(values[key].ja);
 } finally { await quitElectronApplication(app); }
});
