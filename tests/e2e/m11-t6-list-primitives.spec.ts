import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { copyFile, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const projectRoot = path.resolve(import.meta.dirname, '../..');
const artifactDir = path.join(projectRoot, 'test-results', 'm11-t6-screenshots');

async function launch(e2eRoot: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [projectRoot, `--user-data-dir=${e2eRoot}`],
    cwd: projectRoot,
    env: { ...process.env, VITE_DEV_SERVER_URL: '', MAPLAT_E2E_ROOT: e2eRoot },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  // AC15: 実ユーザーデータへ接続せず、隔離 root 外なら test 開始前に throw する
  const saveFolder = await page.evaluate(() => window.settings.get('saveFolder'));
  if (!path.resolve(saveFolder).startsWith(path.resolve(e2eRoot) + path.sep)) {
    throw new Error(`E2E storage isolation failed: ${saveFolder} is outside ${e2eRoot}`);
  }
  return { app, page };
}

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

async function forceJapanese(page: Page): Promise<void> {
  await page.evaluate(() => window.settings.set('lang', 'ja'));
  await openHash(page, '#/settings', '#langSwitcher');
  await expect(page.locator('#langSwitcher')).toHaveValue('ja');
}

// 削除確認 confirm() を常に承認へ倒す（grid/master の削除導線は window.confirm を使う）
async function approveConfirm(page: Page): Promise<void> {
  await page.evaluate(() => { window.confirm = () => true; });
}

async function seedMap(page: Page, tag: string): Promise<string> {
  return page.evaluate(async (slugTag) => {
    const slug = `m11-t6-map-${slugTag}`;
    const result = await window.mapedit.save({ slug, mapObject: {
      mapID: slug, title: { ja: `T6 地図 ${slugTag}`, en: `T6 Map ${slugTag}` },
      officialTitle: {}, author: {}, era: {}, createdAt: {}, contributor: {}, mapper: {},
      attr: {}, dataAttr: {}, description: {}, license: 'PD', dataLicense: 'CC BY-SA',
      reference: '', url: '', lang: 'ja', imageExtension: 'jpg', width: 400, height: 300,
      gcps: [], edges: [], sub_maps: [], strictMode: 'strict', vertexMode: 'plain', status: 'New',
    }, tins: [] });
    if (!result || result.result !== 'Success') throw new Error(`seed map failed: ${JSON.stringify(result)}`);
    return result.uid;
  }, tag);
}

async function seedPoi(page: Page, tag: string): Promise<string> {
  return page.evaluate(async (slugTag) => {
    const slug = `m11-t6-poi-${slugTag}`;
    const result = await window.poiSources.createLocal({ slug, title: { ja: `T6 POI ${slugTag}`, en: `T6 POI ${slugTag}` }, lang: 'ja' });
    if (!result || result.result !== 'Success') throw new Error(`seed poi failed: ${JSON.stringify(result)}`);
    return result.uid;
  }, tag);
}

test('grid list (Map) uses unified new-item, slug, result status, action menu, and menu-based delete', async () => {
  test.setTimeout(180_000);
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m11-t6-'));
  const { app, page } = await launch(e2eRoot);
  try {
    await forceJapanese(page);
    await approveConfirm(page);
    const uid = await seedMap(page, 'grid-a');

    await openHash(page, '#/maplist', '[data-resource-list="map"]');

    // AC2: 統一された ＋新規追加
    await expect(page.locator('[data-resource-new]')).toContainText('新規追加');
    // AC5: pager ボタンが存在せず sentinel がある
    await expect(page.locator('[data-resource-sentinel]')).toHaveCount(1);
    await expect(page.locator('button', { hasText: /^[<>]$/ })).toHaveCount(0);

    // AC9: card に title と Slug(=mapID)
    const card = page.locator(`[data-resource-uid="${uid}"]`);
    await expect(card).toBeVisible();
    await expect(card.locator('.resource-item__title')).toBeVisible();
    await expect(card.locator('.resource-item__slug')).toContainText('m11-t6-map-grid-a');

    // AC4: Map は total=null → 「M件表示中」（全N件…にはならない）
    const count = page.locator('[data-resource-count]');
    await expect(count).toContainText('件表示中');
    await expect(count).not.toContainText('全');

    // AC10: ⋮ click → menu、Escape で閉じ trigger へ focus 復帰、aria-expanded トグル
    const trigger = card.locator('[data-resource-action-trigger]');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await trigger.click();
    await expect(page.locator('[role="menu"]')).toBeVisible();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(page.locator('[role="menu"]')).toHaveCount(0);
    await expect(trigger).toBeFocused();
    // AC10: 右クリックでも同 menu
    await card.click({ button: 'right' });
    await expect(page.locator('[role="menu"]')).toBeVisible();
    await page.keyboard.press('Escape');
    // AC10: Shift+F10 でも同 menu
    await trigger.focus();
    await page.keyboard.press('Shift+F10');
    await expect(page.locator('[role="menu"]')).toBeVisible();

    // AC11: menu の 削除 → confirm 承認 → card が消える
    await page.locator('[role="menuitem"][data-resource-action="delete"]').click();
    await expect(page.locator(`[data-resource-uid="${uid}"]`)).toHaveCount(0);

    // AC4 empty: 一致しない検索で empty 状態
    await page.locator('[data-resource-search]').fill('zzz-no-such-map-xyz');
    await expect(page.locator('[data-resource-status][data-state="empty"]')).toBeVisible();
  } finally {
    await app.close();
  }
});

test('poi list shows real total, keeps Import in secondary slot, and hides flag-suppressed Remote registration', async () => {
  test.setTimeout(180_000);
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m11-t6-'));
  const imagePath = path.join(e2eRoot, 'e2e-input.png');
  await copyFile(path.join(projectRoot, 'src/assets/img/no_image.png'), imagePath);
  const { app, page } = await launch(e2eRoot);
  try {
    await installDialogHarness(app, imagePath);
    await forceJapanese(page);
    await seedPoi(page, 'total-a');

    await openHash(page, '#/poisources', '[data-resource-list="poi-source"]');

    // AC4: POI は実 total → 「全N件・…」
    await expect(page.locator('[data-resource-count]')).toContainText('全');

    // AC12: Import は toolbar secondary slot にあり、Remote 登録ボタンは DOM に無い（フラグ抑制 D13）
    const toolbar = page.locator('[data-resource-toolbar]');
    await expect(toolbar.locator('[data-poi-import]')).toBeVisible();
    await expect(page.locator('button', { hasText: 'リモート登録' })).toHaveCount(0);

    // AC12: Import クリックで（stub された）ファイル選択後にモーダルが開き、閉じられる
    await page.locator('[data-poi-import]').click();
    await expect(page.locator('.modal .modal-title')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.modal .modal-title')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('base map master: builtin rows expose no action menu, user row deletes via menu, range filter still works', async () => {
  test.setTimeout(180_000);
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m11-t6-'));
  const { app, page } = await launch(e2eRoot);
  try {
    await forceJapanese(page);
    await approveConfirm(page);

    await openHash(page, '#/basemaps', '[data-master-detail="base-map"]');
    // AC2: master も resource_list.new_item（新規追加）
    await expect(page.getByTestId('basemap-new')).toContainText('新規追加');

    // AC17: builtin 行（osm）は ⋮ トリガーを持たない
    const builtinRow = page.getByTestId('basemap-row-osm');
    await expect(builtinRow).toBeVisible();
    await expect(builtinRow.locator('[data-resource-action-trigger]')).toHaveCount(0);

    // user 基図を 1 件作成
    await page.getByTestId('basemap-new').click();
    await page.getByTestId('basemap-slug').fill('e2e-user-basemap');
    await page.getByTestId('basemap-slug').press('Tab');
    await page.getByTestId('basemap-title').fill('E2E User BaseMap');
    await page.getByTestId('basemap-title').press('Tab');
    await page.getByTestId('basemap-url').fill('https://example.test/{z}/{x}/{y}.png');
    await page.getByTestId('basemap-url').press('Tab');
    await page.getByTestId('editor-save').click();
    await expect(page).not.toHaveURL(/new=1/);

    // AC11(master): user 行の ⋮ → 削除 → 行が消える
    const userRow = page.getByTestId('basemap-row-e2e-user-basemap');
    await expect(userRow).toBeVisible();
    const userTrigger = userRow.locator('[data-resource-action-trigger]');
    await expect(userTrigger).toHaveCount(1);
    await userTrigger.click();
    await page.locator('[role="menuitem"][data-resource-action="delete"]').click();
    await expect(page.getByTestId('basemap-row-e2e-user-basemap')).toHaveCount(0);

    // AC16: 範囲で絞り込むボタン→ modal→ 適用が現行どおり動く（filterBaseMapCatalog 温存）
    await page.getByTestId('basemap-range-filter').click();
    await expect(page.locator('.modal')).toBeVisible();
    await page.keyboard.press('Escape');
  } finally {
    await app.close();
  }
});

test('infinite scroll replaces the pager and Back restores query and scroll (grid)', async () => {
  test.setTimeout(300_000);
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m11-t6-'));
  const { app, page } = await launch(e2eRoot);
  try {
    await forceJapanese(page);
    // maplist page size は 20。22 件 seed → 初期 20、スクロールで 22（2 batch）。
    for (let i = 0; i < 22; i += 1) {
      await seedMap(page, `scroll-${String(i).padStart(2, '0')}`);
    }

    await openHash(page, '#/maplist', '[data-resource-list="map"]');
    const cards = page.locator('[data-resource-uid]');
    await expect.poll(async () => cards.count()).toBeGreaterThan(0);
    const initial = await cards.count();
    expect(initial).toBeLessThan(22); // 初期は 1 batch（20）で total 未満

    // sentinel まで scroll → 2 batch 目が読まれ件数が増える
    await page.locator('[data-resource-content="map"]').evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await expect.poll(async () => cards.count(), { timeout: 15_000 }).toBe(22);

    // AC8: q を付けて（batches=2 の状態を残し）card へ遷移 → Back で復元
    const anchorUid = await cards.nth(15).getAttribute('data-resource-uid');
    await page.locator('[data-resource-content="map"]').evaluate((el) => { el.scrollTop = 400; });
    const beforeScroll = await page.locator('[data-resource-content="map"]').evaluate((el) => el.scrollTop);
    await page.locator(`[data-resource-uid="${anchorUid}"] a`).first().click();
    await expect(page).toHaveURL(/\/mapedit/);
    await page.goBack();
    await expect(page.locator('[data-resource-list="map"]')).toBeVisible();
    // 2 batch 復元で全 22 件が戻る
    await expect.poll(async () => cards.count(), { timeout: 15_000 }).toBe(22);
    // scroll 位置が概ね復元される（先頭に戻っていない）
    await expect.poll(async () => page.locator('[data-resource-content="map"]').evaluate((el) => el.scrollTop), { timeout: 10_000 }).toBeGreaterThan(0);
    expect(beforeScroll).toBeGreaterThan(0);
  } finally {
    await app.close();
  }
});

test('captures list screenshots for human review', async () => {
  test.setTimeout(180_000);
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m11-t6-'));
  const { app, page } = await launch(e2eRoot);
  const shot = (name: string) => page.screenshot({ path: path.join(artifactDir, `${name}.png`), fullPage: true });
  try {
    await forceJapanese(page);
    await seedMap(page, 'shot');
    await seedPoi(page, 'shot');
    await openHash(page, '#/maplist', '[data-resource-list="map"]');            await shot('01-map-list');
    await openHash(page, '#/poisources', '[data-resource-list="poi-source"]');  await shot('02-poi-source-list');
    await openHash(page, '#/basemaps', '[data-master-detail="base-map"]');       await shot('03-base-map-list');
    await openHash(page, '#/applist', '[data-resource-list="app"]');             await shot('04-app-list');
    await openHash(page, '#/assets', '[data-master-detail="image-asset"]');      await shot('05-asset-list');
  } finally {
    await app.close();
  }
});
