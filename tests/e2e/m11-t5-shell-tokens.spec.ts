import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { copyFile, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';

const projectRoot = path.resolve(import.meta.dirname, '../..');
const artifactDir = path.join(projectRoot, 'test-results', 'm11-t5-screenshots');

async function launch(e2eRoot: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [projectRoot, `--user-data-dir=${e2eRoot}`],
    cwd: projectRoot,
    env: { ...process.env, VITE_DEV_SERVER_URL: '', MAPLAT_E2E_ROOT: e2eRoot },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  // AC14: 実ユーザーデータへ接続せず、隔離 root 外なら test 開始前に throw する
  const saveFolder = await page.evaluate(() => window.settings.get('saveFolder'));
  if (!path.resolve(saveFolder).startsWith(path.resolve(e2eRoot) + path.sep)) {
    throw new Error(`E2E storage isolation failed: ${saveFolder} is outside ${e2eRoot}`);
  }
  return { app, page };
}

// m11-t4 と同じ dialog stub 先例を踏襲（Electron main の dialog を差し替える）。
async function installDialogHarness(app: ElectronApplication, imagePath: string): Promise<void> {
  await app.evaluate(async ({ dialog }, selectedImage) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [selectedImage] })) as typeof dialog.showOpenDialog;
    dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox;
  }, imagePath);
}

async function openHash(page: Page, hash: string, ready: string): Promise<void> {
  await page.evaluate((nextHash) => { location.hash = nextHash; }, hash);
  await expect(page.locator(ready)).toBeVisible();
}

async function fillAndCommit(locator: ReturnType<Page['getByTestId']>, value: string): Promise<void> {
  await locator.fill(value);
  await locator.press('Tab');
}

// エディタ UI 言語を ja へ確定させる。settings.set → /settings 訪問で
// Settings.vue の onMounted が i18next.changeLanguage('ja') を呼ぶ（OS 既定言語に依存しない）。
async function forceJapanese(page: Page): Promise<void> {
  await page.evaluate(() => window.settings.set('lang', 'ja'));
  await openHash(page, '#/settings', '#langSwitcher');
  await expect(page.locator('#langSwitcher')).toHaveValue('ja');
}

async function seedApp(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const slug = `m11-t5-app-${Date.now()}`;
    const result = await window.appedit.save({ slug, document: {
      appID: slug, appName: { en: 'T5 App' }, title: { en: 'T5 App' }, description: {},
      keywords: '', siteUrl: '', lang: 'en', sources: [], pois: [],
      httpSettings: {}, appSettings: {}, manifestSettings: {},
    }});
    if (!result || result.result !== 'Success') throw new Error(`seed app failed: ${JSON.stringify(result)}`);
    return result.uid;
  });
}

async function seedPoi(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const slug = `m11-t5-poi-${Date.now()}`;
    const result = await window.poiSources.createLocal({ slug, title: { ja: 'T5 POI', en: 'T5 POI' }, lang: 'ja' });
    if (!result || result.result !== 'Success') throw new Error(`seed poi failed: ${JSON.stringify(result)}`);
    return result.uid;
  });
}

async function seedMap(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const slug = `m11-t5-map-${Date.now()}`;
    const result = await window.mapedit.save({ slug, mapObject: {
      mapID: slug, title: { ja: 'T5 地図', en: 'T5 Map' },
      officialTitle: {}, author: {}, era: {}, createdAt: {}, contributor: {}, mapper: {},
      attr: {}, dataAttr: {}, description: {}, license: 'PD', dataLicense: 'CC BY-SA',
      reference: '', url: '', lang: 'ja', imageExtension: 'jpg', width: 400, height: 300,
      gcps: [], edges: [], sub_maps: [], strictMode: 'strict', vertexMode: 'plain', status: 'New',
    }, tins: [] });
    if (!result || result.result !== 'Success') throw new Error(`seed map failed: ${JSON.stringify(result)}`);
    return result.uid;
  });
}

test('shell font, header vocabulary, and header offset use tokens', async () => {
  test.setTimeout(120_000);
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m11-t5-'));
  const { app, page } = await launch(e2eRoot);
  try {
    // AC2: 通常 UI の computed font が system-ui スタック（Inter/Avenir でない）
    const bodyFont = await page.evaluate(() => getComputedStyle(document.querySelector('#app') as Element).fontFamily);
    expect(bodyFont.toLowerCase()).not.toContain('inter');
    expect(bodyFont.toLowerCase()).not.toContain('avenir');

    // AC6: 黒 header が 5管理語彙 + 設定（ja）
    await forceJapanese(page);
    await openHash(page, '#/maplist', '.main-content');
    for (const label of ['地図管理', 'POI管理', 'ベースマップ管理', 'アプリ管理', 'アセット管理', '設定']) {
      await expect(page.locator('.navbar-nav .nav-link', { hasText: label })).toBeVisible();
    }

    // AC6: route / nav 遷移が不変
    await page.locator('.navbar-nav .nav-link', { hasText: 'ベースマップ管理' }).click();
    await expect(page).toHaveURL(/\/basemaps/);
    await page.locator('.navbar-nav .nav-link', { hasText: 'アセット管理' }).click();
    await expect(page).toHaveURL(/\/assets/);

    // AC7: header 高さと main-content offset が一致
    const headerHeight = await page.evaluate(() => (document.querySelector('.navbar') as HTMLElement).offsetHeight);
    const contentOffset = await page.evaluate(() => parseInt(getComputedStyle(document.querySelector('.main-content') as Element).marginTop, 10));
    expect(headerHeight).toBe(50);
    expect(contentOffset).toBe(50);
  } finally {
    await quitElectronApplication(app);
  }
});

test('F1: application-management nav stays active on both AppList and AppEdit', async () => {
  test.setTimeout(120_000);
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m11-t5-'));
  const { app, page } = await launch(e2eRoot);
  try {
    await forceJapanese(page);
    const appUid = await seedApp(page);
    await openHash(page, '#/applist', '.main-content');
    await expect(page.locator('.navbar-nav .nav-link.active', { hasText: 'アプリ管理' })).toBeVisible();
    // AppEdit へ遷移しても section 判定（AppList + AppEdit）で active を維持する
    await openHash(page, `#/appedit?uid=${appUid}`, '[data-testid="app-id"]');
    await expect(page.locator('.navbar-nav .nav-link.active', { hasText: 'アプリ管理' })).toBeVisible();
  } finally {
    await quitElectronApplication(app);
  }
});

test('base map pilot: unified help, field diagnostics, immediate summary, and no master-detail back button', async () => {
  test.setTimeout(120_000);
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m11-t5-'));
  const { app, page } = await launch(e2eRoot);
  try {
    await openHash(page, '#/basemaps', '[data-master-detail="base-map"]');
    await page.getByTestId('basemap-new').click();
    await expect(page.locator('[data-testid="basemap-editor"]')).toBeVisible();

    // AC3: slug 入力が monospace（computed font に mono が含まれる）
    const slugFont = await page.getByTestId('basemap-slug').evaluate((el) => getComputedStyle(el).fontFamily.toLowerCase());
    expect(slugFont).toMatch(/mono|menlo|consolas|courier|sfmono|liberation/);

    // F7: master-detail のヘッダーに「< 一覧へ」back ボタンが無い
    await expect(page.getByTestId('editor-back')).toHaveCount(0);

    // AC10 / F6: slug help（title なし）が focus と hover の双方で同じ editor-ui-help-popover カードを開く
    const slugHelp = page.locator('[data-editor-help]').first();
    await slugHelp.focus();
    await expect(page.locator('.editor-ui-help-popover')).toBeVisible();
    await page.getByTestId('basemap-slug').focus(); // blur で閉じる
    await expect(page.locator('.editor-ui-help-popover')).toHaveCount(0);
    await slugHelp.hover();
    await expect(page.locator('.editor-ui-help-popover')).toBeVisible();
    await page.mouse.move(5, 5); // hover 離脱で閉じる
    await expect(page.locator('.editor-ui-help-popover')).toHaveCount(0);

    // AC10 / F6: coverage help（title 付き）も同じカード・同じ挙動
    const coverageHelp = page.locator('[data-editor-help]').last();
    await coverageHelp.focus();
    await expect(page.locator('.editor-ui-help-popover')).toBeVisible();

    // F3: 新規 draft で必須未入力の section summary が即時表示される（dirty ゲートなし）
    await expect(page.getByTestId('basemap-validation-summary')).toBeVisible();

    // F2 / F3: 不正 slug → is-invalid 赤枠 + field 診断 + section summary
    await page.getByTestId('basemap-slug').fill('bad slug!');
    await page.getByTestId('basemap-slug').press('Tab');
    await expect(page.getByTestId('basemap-slug')).toHaveClass(/is-invalid/);
    await expect(page.locator('[data-diagnostic-scope="field"]').first()).toBeVisible();
    await expect(page.getByTestId('basemap-validation-summary')).toBeVisible();
  } finally {
    await quitElectronApplication(app);
  }
});

test('base map: new-draft discard removes list row and duplicate-id operation diagnostic clears on undo', async () => {
  test.setTimeout(120_000);
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m11-t5-'));
  const { app, page } = await launch(e2eRoot);
  try {
    await installDialogHarness(app, path.join(e2eRoot, 'unused.png'));
    await forceJapanese(page);

    // F5: 新規 draft をヘッダーから破棄すると、左 List の下書き行が消える
    await openHash(page, '#/basemaps', '[data-master-detail="base-map"]');
    await page.getByTestId('basemap-new').click();
    await fillAndCommit(page.getByTestId('basemap-slug'), 'e2e-discard-basemap');
    await fillAndCommit(page.getByTestId('basemap-title'), '破棄予定');
    await fillAndCommit(page.getByTestId('basemap-url'), 'https://example.test/{z}/{x}/{y}.png');
    await page.reload(); // beforeunload flushSync で draft を永続化する
    await expect(page.locator('[data-master-detail="base-map"]')).toBeVisible();
    const draftRow = page.getByRole('button', { name: /新規ベースマップ/ });
    await expect(draftRow).toBeVisible();
    await expect(page.getByTestId('editor-discard-draft')).toBeVisible();
    await page.getByTestId('editor-discard-draft').click();
    await expect(draftRow).toHaveCount(0);

    // F4: ID 重複の operation 診断が Undo（文書変更）で消える
    await page.getByTestId('basemap-new').click();
    await fillAndCommit(page.getByTestId('basemap-slug'), 'e2e-dup-basemap');
    await fillAndCommit(page.getByTestId('basemap-title'), '重複元');
    await fillAndCommit(page.getByTestId('basemap-url'), 'https://example.test/{z}/{x}/{y}.png');
    await page.getByTestId('editor-save').click();
    await expect(page).not.toHaveURL(/new=1/);

    await page.getByTestId('basemap-new').click();
    await fillAndCommit(page.getByTestId('basemap-slug'), 'e2e-dup-basemap');
    await fillAndCommit(page.getByTestId('basemap-title'), '重複先');
    await fillAndCommit(page.getByTestId('basemap-url'), 'https://example.test/{z}/{x}/{y}.png');
    await page.getByTestId('editor-save').click();
    await expect(page.locator('[data-diagnostic-scope="operation"]')).toBeVisible();
    await page.getByTestId('editor-undo').click();
    await expect(page.locator('[data-diagnostic-scope="operation"]')).toHaveCount(0);
  } finally {
    await quitElectronApplication(app);
  }
});

test('F8: editing an asset shows the draft badge live and undo removes it immediately', async () => {
  test.setTimeout(120_000);
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m11-t5-'));
  const imagePath = path.join(e2eRoot, 'e2e-input.png');
  await copyFile(path.join(projectRoot, 'src/assets/img/no_image.png'), imagePath);
  const { app, page } = await launch(e2eRoot);
  try {
    await installDialogHarness(app, imagePath);
    await forceJapanese(page);

    // 既存アセットを 1 件作る
    await openHash(page, '#/assets', '[data-master-detail="image-asset"]');
    await page.getByTestId('asset-new').click();
    await page.getByTestId('asset-pick-file').click();
    await fillAndCommit(page.getByTestId('asset-slug'), 'e2e-f8-asset');
    await fillAndCommit(page.getByTestId('asset-title'), 'F8画像');
    await page.getByTestId('editor-save').click();
    await expect(page).not.toHaveURL(/new=1/);
    await expect(page.getByTestId('asset-draft-badge')).toHaveCount(0);

    // 編集で dirty → 一覧の下書きバッジが即時に付く（一覧の再訪問なし）
    await fillAndCommit(page.getByTestId('asset-title'), 'F8画像編集');
    await expect(page.getByTestId('asset-draft-badge')).toBeVisible();

    // Undo で checkpoint clean に戻すと下書きバッジが即時に消える
    await page.getByTestId('editor-undo').click();
    await expect(page.getByTestId('asset-title')).toHaveValue('F8画像');
    await expect(page.getByTestId('asset-draft-badge')).toHaveCount(0);
  } finally {
    await quitElectronApplication(app);
  }
});

test('captures regression screenshots for human review', async () => {
  test.setTimeout(180_000);
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m11-t5-'));
  const { app, page } = await launch(e2eRoot);
  const shot = (name: string) => page.screenshot({ path: path.join(artifactDir, `${name}.png`), fullPage: true });
  try {
    await forceJapanese(page);

    // 5一覧
    await openHash(page, '#/maplist', '.main-content');       await shot('01-map-list');
    await openHash(page, '#/poisources', '.main-content');    await shot('02-poi-source-list');
    await openHash(page, '#/basemaps', '[data-master-detail="base-map"]'); await shot('03-base-map-list');
    await openHash(page, '#/applist', '.main-content');       await shot('04-app-list');
    await openHash(page, '#/assets', '[data-master-detail="image-asset"]'); await shot('05-asset-list');

    // pilot 2 Edit（新規追加ボタン経由でエディタを開く）
    await openHash(page, '#/basemaps', '[data-master-detail="base-map"]');
    await page.getByTestId('basemap-new').click();
    await expect(page.locator('[data-testid="basemap-editor"]')).toBeVisible();
    await shot('06-base-map-edit');

    await openHash(page, '#/assets', '[data-master-detail="image-asset"]');
    await page.getByTestId('asset-new').click();
    await expect(page.getByTestId('asset-slug')).toBeVisible();
    await shot('07-asset-edit');

    // S3回帰面: MapEdit の到達可能な .card 面（settings タブのベースマップ表示 card）
    const mapUid = await seedMap(page);
    await openHash(page, `#/mapedit?uid=${mapUid}`, '#mapDocumentLanguage');
    // NOTE: データ入出力(inout)タブは現行 MapEdit のタブバーに導線が無い（activeTab==='inout' の setter 不在）。
    // 到達可能な .card 面（設定タブのベースマップ表示 card）を撮る。
    await page.locator('.nav-tabs .nav-link', { hasText: /ベースマップ|Base Map|設定|Settings/ }).first().click().catch(() => undefined);
    await shot('08-map-edit-card');

    // S3回帰面: AppEdit source-row 面
    const appUid = await seedApp(page);
    await openHash(page, `#/appedit?uid=${appUid}`, '[data-testid="app-id"]');
    await page.getByTestId('app-sources-tab').click().catch(() => undefined);
    await page.getByTestId('app-basemap-mode').click().catch(() => undefined); // source-row 一覧を表示
    await shot('09-app-edit-source-row');

    // S3回帰面: PoiEdit 診断面
    const poiUid = await seedPoi(page);
    await openHash(page, `#/poisources/${poiUid}`, '.poi-side-pane');
    await shot('10-poi-edit-diagnostics');
  } finally {
    await quitElectronApplication(app);
  }
});

// F8 Major-1 回帰: 行切替（master-detail の主要導線）を跨いでも draft バッジが store と整合する。
// レビュー v2 の再現 C（編集→行切替でバッジ消失）/ D（Undo クリーン→行切替でバッジ復活）を固定化。
test('F8: draft badges stay consistent across row switching', async () => {
  test.setTimeout(240_000);
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m11-t5-'));
  const imagePath = path.join(e2eRoot, 'e2e-input.png');
  await copyFile(path.join(projectRoot, 'src/assets/img/no_image.png'), imagePath);
  const { app, page } = await launch(e2eRoot);
  try {
    await installDialogHarness(app, imagePath);

    // --- 消失側（旧再現C）: BaseMap A を編集 → 別行 B へ切替してもバッジが残る ---
    await openHash(page, '#/basemaps', '[data-master-detail="base-map"]');
    for (const [slug, title] of [['f8-switch-a', 'F8切替A'], ['f8-switch-b', 'F8切替B']] as const) {
      await page.getByTestId('basemap-new').click();
      await fillAndCommit(page.getByTestId('basemap-slug'), slug);
      await fillAndCommit(page.getByTestId('basemap-title'), title);
      await fillAndCommit(page.getByTestId('basemap-url'), 'https://example.test/{z}/{x}/{y}.png');
      await page.getByTestId('editor-save').click();
      await expect(page).not.toHaveURL(/new=1/);
    }
    await expect(page.getByTestId('basemap-draft-badge')).toHaveCount(0);
    await page.getByTestId('basemap-row-f8-switch-a').click();
    await fillAndCommit(page.getByTestId('basemap-title'), 'F8切替A 変更');
    await expect(page.getByTestId('basemap-draft-badge')).toBeVisible();
    await page.waitForTimeout(1500); // 旧 900ms refresh 窓を跨いでから切り替える
    await page.getByTestId('basemap-row-f8-switch-b').click();
    await page.waitForTimeout(1500); // session flush（store 永続化）を待つ
    const bmDrafts = await page.evaluate(async () => (await window.assetDrafts.list('base-map')).length);
    expect(bmDrafts).toBe(1);
    await expect(page.getByTestId('basemap-draft-badge')).toHaveCount(1);

    // --- 復活側（旧再現D）: Asset A を Undo でクリーン化 → 別行 B へ切替してもバッジが戻らない ---
    await openHash(page, '#/assets', '[data-master-detail="image-asset"]');
    for (const slug of ['f8-asset-a', 'f8-asset-b']) {
      await page.getByTestId('asset-new').click();
      await page.getByTestId('asset-pick-file').click();
      await fillAndCommit(page.getByTestId('asset-slug'), slug);
      await fillAndCommit(page.getByTestId('asset-title'), `F8 ${slug}`);
      await page.getByTestId('editor-save').click();
      await expect(page).not.toHaveURL(/new=1/);
    }
    await expect(page.getByTestId('asset-draft-badge')).toHaveCount(0);
    await page.getByTestId('asset-row-f8-asset-a').click();
    await fillAndCommit(page.getByTestId('asset-title'), 'F8 A 変更');
    await expect(page.getByTestId('asset-draft-badge')).toBeVisible();
    await page.waitForTimeout(3000); // persist(2000ms)+refresh(2300ms) を跨ぎ store 側 draftUids に載せる
    await page.getByTestId('editor-undo').click();
    await expect(page.getByTestId('asset-draft-badge')).toHaveCount(0);
    await page.getByTestId('asset-row-f8-asset-b').click();
    await page.waitForTimeout(1500); // session flush（store から removePersisted）を待つ
    const assetDrafts = await page.evaluate(async () => (await window.assetDrafts.list('image-asset')).length);
    expect(assetDrafts).toBe(0);
    await expect(page.getByTestId('asset-draft-badge')).toHaveCount(0);
  } finally {
    await quitElectronApplication(app);
  }
});
