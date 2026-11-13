// #147: 旧形（data にマスタ全コピー）のソースを持つアプリの保存と再読込。
//
// 旧形のまま保存すると、所有キー（利用範囲・mercator シフト）が legacyData の中へ入れ子で
// 残り、開き直すと欄が空に見え、書き出しからも落ちていた。ここでは画面で開く → 保存 →
// 開き直すを繰り返し、欄の値と保存した文書の形を断言する。
//   (1) 旧形の往復（開く → 保存 → 開き直す → 保存 → 開き直す）
//   (2) 1.2.0 が保存した形（legacyData の入れ子）の読み戻し
//   (3) マスタが無いソースは値を捨てずに保存し、マスタの登録の後に読み戻す
//   (4) 外側 role:'base'・内側 maptype:'overlay' の形が base のまま保たれる
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';
import { baseMapMasterDoc, seedBaseMap } from './helpers/baseMapSeed';

const projectRoot = path.resolve(import.meta.dirname, '../..');

const ENVELOPE: [number, number][] = [[130.5, 32.5], [131, 32.5], [131, 33], [130.5, 33]];
// 欄に出る順（小窓と同じ西・東・南・北 = DOM 順）
const ENVELOPE_INPUT_ORDER = ['130.5', '131', '32.5', '33'];
const OWNED = { envelopeLngLats: ENVELOPE, mercatorXShift: 1.5, mercatorYShift: -2.25 };

const masterDoc = () => baseMapMasterDoc({
  kind: 'tms',
  maptype: 'overlay',
  url: 'https://example.com/{z}/{x}/{y}.png',
  title: { ja: 'マスタ表題' },
  label: { ja: 'マスタラベル' },
});

// 旧形の data（マスタの全コピー＋所有キー）
const legacyData = (slug: string) => ({
  mapID: slug, kind: 'tms', maptype: 'overlay', lang: 'ja',
  url: 'https://example.com/{z}/{x}/{y}.png',
  title: { ja: 'マスタ表題' }, attr: { ja: '© Test' },
  minZoom: 0, maxZoom: 18,
  ...OWNED,
});

async function launch(e2eRoot: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [projectRoot, `--user-data-dir=${e2eRoot}`],
    cwd: projectRoot,
    env: { ...process.env, VITE_DEV_SERVER_URL: '', MAPLAT_E2E_ROOT: e2eRoot },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(() => window.settings.set('lang', 'ja'));
  await page.route('https://example.com/**', (route) => route.fulfill({ status: 404, body: '' }));
  // AppEdit の保存は main 側の確認ダイアログを挟む
  await app.evaluate(async ({ dialog }) => {
    dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox;
  });
  return { app, page };
}

// sources をそのまま持つアプリを IPC で作る（画面を通さないので、旧形が保存形のまま残る）
async function seedApp(page: Page, appSlug: string, sources: unknown[]): Promise<string> {
  return await page.evaluate(async ({ slug, srcs }) => {
    const saved = await window.appedit.save({ slug, document: {
      appID: slug, appName: { ja: 'Legacy App' }, title: { ja: 'Legacy App' },
      description: {}, keywords: '', siteUrl: '', lang: 'ja',
      sources: srcs, pois: [], httpSettings: {}, appSettings: {}, manifestSettings: {},
    } });
    if (!saved || saved.result !== 'Success') throw new Error(`app create failed: ${JSON.stringify(saved)}`);
    return saved.uid as string;
  }, { slug: appSlug, srcs: sources });
}

async function openApp(page: Page, appUid: string): Promise<void> {
  await page.evaluate((uid: string) => { location.hash = `#/appedit?uid=${uid}`; }, appUid);
  await expect(page.getByTestId('app-id')).toBeVisible({ timeout: 30000 });
}

// 一覧へ移って画面を外し、もう一度開く（画面の再マウントで読み込みからやり直す）
async function reopenApp(page: Page, appUid: string): Promise<void> {
  await page.evaluate(() => { location.hash = '#/applist'; });
  await expect(page.getByTestId('app-id')).toHaveCount(0, { timeout: 30000 });
  await openApp(page, appUid);
}

// ソース以外の欄（キーワード）を変えて保存ボタンを活性にする。ソースは触らない
async function touch(page: Page): Promise<void> {
  await page.getByRole('tab').first().click();
  const keywords = page.getByTestId('app-keywords');
  await expect(keywords).toBeVisible();
  await keywords.fill(`${await keywords.inputValue()}x`);
}

async function saveNow(page: Page): Promise<void> {
  await expect(page.getByTestId('editor-save')).toBeEnabled({ timeout: 30000 });
  await page.getByTestId('editor-save').click();
  await expect(page.getByTestId('editor-save-state')).toHaveText(/保存済み|saved/i, { timeout: 60000 });
}

async function savedSource(page: Page, appUid: string, mapUid: string): Promise<any> {
  const doc = await page.evaluate(async (uid: string) => await window.appedit.request(uid), appUid);
  const found = (doc?.sources ?? []).find((s: any) => s.mapUid === mapUid);
  expect(found, `保存した文書に ${mapUid} のソースがある`).toBeTruthy();
  return found;
}

// ソースのタブを開き、欄の値（mercator シフト 2 つ・利用範囲 4 つ・ラベル）を断言する
async function expectOwnedFields(page: Page, slug: string): Promise<void> {
  await page.getByTestId('app-sources-tab').click();
  const card = page.getByTestId(`app-selected-source-${slug}`);
  await expect(card).toBeVisible({ timeout: 30000 });
  await expect(card.getByTestId('app-source-override-mercatorXShift')).toHaveValue('1.5');
  await expect(card.getByTestId('app-source-override-mercatorYShift')).toHaveValue('-2.25');
  const bbox = card.getByTestId('app-source-override-envelopeLngLats').locator('input');
  await expect(bbox).toHaveCount(4);
  for (let i = 0; i < 4; i += 1) await expect(bbox.nth(i)).toHaveValue(ENVELOPE_INPUT_ORDER[i]);
  await expect(card.getByTestId('app-source-override-label')).toHaveValue('旧ラベル');
}

// 保存形が新形（overrides に所有 3 キー・legacyData と data なし）であることを断言する
function expectNewForm(source: any): void {
  expect(source.overrides).toEqual(OWNED);
  expect(source.label).toEqual({ ja: '旧ラベル' });
  expect('legacyData' in source, '保存形に legacyData が無い').toBe(false);
  expect('data' in source, '保存形に data が無い').toBe(false);
}

async function withEditor(prefix: string, body: (page: Page, suffix: string) => Promise<void>): Promise<void> {
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), prefix));
  const { app, page } = await launch(e2eRoot);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  try {
    await body(page, `${Date.now()}`);
    expect(pageErrors, 'pageerror が出ない').toEqual([]);
  } finally {
    await quitElectronApplication(app);
  }
}

test('旧形のソースを開く → 保存 → 開き直す → 保存 → 開き直すで、利用範囲・シフト・ラベルが保たれる', async () => {
  test.setTimeout(300_000);
  await withEditor('maplat-legacy-roundtrip-1-', async (page, suffix) => {
    const slug = `legacy-base-${suffix}`;
    await seedBaseMap(page, slug, masterDoc());
    const appUid = await seedApp(page, `legacy-app-${suffix}`, [{
      sourceType: 'tms', mapUid: slug, role: 'overlay', startFrom: true,
      label: { ja: '旧ラベル' }, data: legacyData(slug),
    }]);

    await openApp(page, appUid);
    // 開いた直後に欄へ値が出る
    await expectOwnedFields(page, slug);
    // 翻訳で履歴が汚れない
    await expect(page.getByTestId('editor-save-state')).toHaveText(/保存済み/);
    await expect(page.getByTestId('editor-save')).toBeDisabled();

    await touch(page);
    await saveNow(page);
    expectNewForm(await savedSource(page, appUid, slug));

    await reopenApp(page, appUid);
    await expectOwnedFields(page, slug);
    await touch(page);
    await saveNow(page);
    expectNewForm(await savedSource(page, appUid, slug));

    await reopenApp(page, appUid);
    await expectOwnedFields(page, slug);
  });
});

test('1.2.0 が保存した形（legacyData の入れ子）を開くと値が出て、保存で新形になる', async () => {
  test.setTimeout(300_000);
  await withEditor('maplat-legacy-roundtrip-2-', async (page, suffix) => {
    const slug = `legacy-base-${suffix}`;
    await seedBaseMap(page, slug, masterDoc());
    const { mapID: _mapID, ...inner } = legacyData(slug);
    const appUid = await seedApp(page, `legacy-app-${suffix}`, [{
      sourceType: 'tms', mapUid: slug, role: 'overlay', startFrom: true,
      label: { ja: '旧ラベル' }, title: '旧ラベル', legacyData: inner,
    }]);

    await openApp(page, appUid);
    await expectOwnedFields(page, slug);
    await touch(page);
    await saveNow(page);
    expectNewForm(await savedSource(page, appUid, slug));
  });
});

test('マスタが無いソースは値を捨てずに保存し、マスタを登録した後に読み戻せる', async () => {
  test.setTimeout(300_000);
  await withEditor('maplat-legacy-roundtrip-3-', async (page, suffix) => {
    const slug = `legacy-base-${suffix}`;
    const appUid = await seedApp(page, `legacy-app-${suffix}`, [{
      sourceType: 'tms', mapUid: slug, role: 'overlay', startFrom: true,
      label: { ja: '旧ラベル' }, data: legacyData(slug),
    }]);

    await openApp(page, appUid);
    await touch(page);
    await saveNow(page);
    const kept = await savedSource(page, appUid, slug);
    expect('overrides' in kept, 'マスタが無いので翻訳しない').toBe(false);
    expect(kept.legacyData?.envelopeLngLats, '利用範囲を捨てない').toEqual(ENVELOPE);
    expect(kept.legacyData?.mercatorXShift).toBe(1.5);
    expect(kept.legacyData?.mercatorYShift).toBe(-2.25);

    await seedBaseMap(page, slug, masterDoc());
    await reopenApp(page, appUid);
    await expectOwnedFields(page, slug);
    await touch(page);
    await saveNow(page);
    expectNewForm(await savedSource(page, appUid, slug));
  });
});

test('外側 role:base・内側 maptype:overlay の保存形は、開いて保存しても base のまま', async () => {
  test.setTimeout(300_000);
  await withEditor('maplat-legacy-roundtrip-4-', async (page, suffix) => {
    const slug = `legacy-base-${suffix}`;
    await seedBaseMap(page, slug, masterDoc());
    const { mapID: _mapID, ...inner } = legacyData(slug);
    const appUid = await seedApp(page, `legacy-app-${suffix}`, [{
      sourceType: 'tms', mapUid: slug, role: 'base', startFrom: true,
      label: { ja: '旧ラベル' }, title: '旧ラベル', legacyData: inner,
    }]);

    await openApp(page, appUid);
    await touch(page);
    await saveNow(page);
    const saved = await savedSource(page, appUid, slug);
    expect(saved.role).toBe('base');
    expect(saved.overrides).toEqual(OWNED);
  });
});
