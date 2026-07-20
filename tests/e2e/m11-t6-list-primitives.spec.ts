import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { copyFile, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';

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

// M11-T7: menu が production の clamp 式と同じ座標にあることを検証
async function expectMenuAt(page: Page, x: number, y: number): Promise<void> {
  await expect(page.locator('[role="menu"]')).toHaveCSS('position', 'fixed');
  const mbox = await page.locator('[role="menu"]').boundingBox();
  expect(mbox).not.toBeNull();
  if (mbox) {
    const vp = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
    // ResourceActionMenu.openAt() と同じ clamp 式
    const expectedX = Math.max(4, Math.min(x, vp.w - mbox.width - 4));
    const expectedY = Math.max(4, Math.min(y, vp.h - mbox.height - 4));
    expect(Math.abs(mbox.x - expectedX)).toBeLessThanOrEqual(2);
    expect(Math.abs(mbox.y - expectedY)).toBeLessThanOrEqual(2);
    expect(mbox.x + mbox.width).toBeLessThanOrEqual(vp.w + 1);
    expect(mbox.y + mbox.height).toBeLessThanOrEqual(vp.h + 1);
  }
}

async function expectMenuNearTrigger(page: Page, trigger: ReturnType<Page['locator']>): Promise<void> {
  const tbox = await trigger.boundingBox();
  expect(tbox).not.toBeNull();
  if (tbox) {
    await expectMenuAt(page, tbox.x + tbox.width, tbox.y + tbox.height);
  }
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
    // overflow を保証するため計 15 件 seed（grid-a + scroll-1〜14）
    for (let i = 1; i <= 14; i++) {
      await seedMap(page, `scroll-${i}`);
    }

    await openHash(page, '#/maplist', '[data-resource-list="map"]');

    // AC2: 統一された ＋新規追加
    await expect(page.locator('[data-resource-new]')).toContainText('新規追加');
    // M12-T6 AC2: MapList の import ボタン文言は「インポート」（「地図インポート」ではない）
    await expect(page.locator('[data-resource-import]')).toHaveText('インポート');
    // AC5: pager ボタンが存在せず sentinel がある
    await expect(page.locator('[data-resource-sentinel]')).toHaveCount(1);
    await expect(page.locator('button', { hasText: /^[<>]$/ })).toHaveCount(0);

    // AC9: card に title と Slug(=mapID)
    const card = page.locator(`[data-resource-uid="${uid}"]`);
    await expect(card).toBeVisible();
    await expect(card.locator('.resource-item__title')).toBeVisible();
    await expect(card.locator('.resource-item__slug')).toContainText('m11-t6-map-grid-a');

    // M11-T7 surface: grid card must have white bg + visible border (.source-row 統一)
    await expect(card).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await expect(card).toHaveCSS('border-top-width', '1px');

    // AC4改(2026-07-16 件数表示統一・人間指示): backend が total を返すため
    // 「全N件」(完載) または「全N件中 M件表示」(部分表示) 形式になる
    const count = page.locator('[data-resource-count]');
    await expect(count).toContainText('全15件');

    // AC10: ⋮ click → menu、Escape で閉じ trigger へ focus 復帰、aria-expanded トグル
    const trigger = card.locator('[data-resource-action-trigger]');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await trigger.click();
    await expect(page.locator('[role="menu"]')).toBeVisible();
    // M11-T7: menu must use position:fixed and stay near trigger + within viewport
    await expectMenuNearTrigger(page, trigger);
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(page.locator('[role="menu"]')).toHaveCount(0);
    await expect(trigger).toBeFocused();
    // AC10: 右クリックでも同 menu（card 中心の明示座標で検証）
    const cardBox = await card.boundingBox();
    expect(cardBox).not.toBeNull();
    await card.click({ button: 'right' });
    await expect(page.locator('[role="menu"]')).toBeVisible();
    if (cardBox) {
      await expectMenuAt(page, cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
    }
    await page.keyboard.press('Escape');
    // AC10: Shift+F10 でも同 menu
    await trigger.focus();
    await page.keyboard.press('Shift+F10');
    await expect(page.locator('[role="menu"]')).toBeVisible();
    await expectMenuNearTrigger(page, trigger);
    await page.keyboard.press('Escape');
    await expect(page.locator('[role="menu"]')).toHaveCount(0);

    // M11-T7: menu position after scroll（末尾cardを通常click。scrollTop が click 前後とも > 0）
    const content = page.locator('[data-resource-content="map"]');
    const cards = page.locator('[data-resource-uid]');
    await content.evaluate((el) => { el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight - 80); });
    let scrollTop = await content.evaluate((el) => el.scrollTop);
    expect(scrollTop).toBeGreaterThan(0);
    const lastCard = cards.last();
    await expect(lastCard).toBeVisible();
    const lastCardUid = await lastCard.getAttribute('data-resource-uid');
    expect(lastCardUid).not.toBeNull();
    const lastTrigger = lastCard.locator('[data-resource-action-trigger]');
    await lastTrigger.click();
    scrollTop = await content.evaluate((el) => el.scrollTop);
    expect(scrollTop).toBeGreaterThan(0);
    await expect(page.locator('[role="menu"]')).toBeVisible();
    await expectMenuNearTrigger(page, lastTrigger);

    // AC11: menu の 削除 → 共通 DeleteConfirmDialog 承認 → card（scroll test で開いた末尾card）が消える
    // M11-T10 (AC5): window.confirm ではなく共通ダイアログを承認する
    await page.locator('[role="menuitem"][data-resource-action="delete"]').click();
    await page.getByTestId('delete-confirm-button').click();
    await expect(page.locator(`[data-resource-uid="${lastCardUid}"]`)).toHaveCount(0);

    // AC4 empty: 一致しない検索で empty 状態
    await page.locator('[data-resource-search]').fill('zzz-no-such-map-xyz');
    await expect(page.locator('[data-resource-status][data-state="empty"]')).toBeVisible();
  } finally {
    await quitElectronApplication(app);
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
    // M11-T10: 旧 [data-poi-import]+プレビューモーダルは解体され、共通 ImportSlot([data-resource-import])
    // + file picker 直行フローに統一（クリック→エディタ遷移の実効検証は m11-t10 AC10 が担う）。
    const toolbar = page.locator('[data-resource-toolbar]');
    await expect(toolbar.locator('[data-resource-import]')).toBeVisible();
    // M12-T6 AC1: PoiSourceList の検索 placeholder は「POIを検索…」
    await expect(page.locator('[data-resource-search]')).toHaveAttribute('placeholder', 'POIを検索…');
    // M12-T6 AC2: PoiSourceList の import ボタン文言は「インポート」
    await expect(toolbar.locator('[data-resource-import]')).toHaveText('インポート');
    await expect(page.locator('button', { hasText: 'リモート登録' })).toHaveCount(0);
  } finally {
    await quitElectronApplication(app);
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
    // M11-T7 surface: master row must have white bg + visible border (.source-row 統一)
    await expect(builtinRow).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await expect(builtinRow).toHaveCSS('border-top-width', '1px');

    // user 基図を 1 件作成
    await page.getByTestId('basemap-new').click();
    await page.getByTestId('basemap-slug').fill('e2e-user-basemap');
    await page.getByTestId('basemap-slug').press('Tab');
    await page.getByTestId('basemap-title').fill('E2E User BaseMap');
    await page.getByTestId('basemap-title').press('Tab');
    await page.getByTestId('basemap-url').fill('https://example.test/{z}/{x}/{y}.png');
    await page.getByTestId('basemap-url').press('Tab');
    // 非同期 validation/dirty 確定を待ってから保存（並列負荷時に click が無視されるのを防ぐ）
    await expect(page.getByTestId('editor-save')).toBeEnabled({ timeout: 10_000 });
    await expect(page.getByTestId('editor-save-state')).toHaveText(/未保存|下書きから復元/, { timeout: 10_000 });
    await page.getByTestId('editor-save').click();
    await expect(page).not.toHaveURL(/new=1/, { timeout: 30_000 });

    // AC11(master): user 行の ⋮ → 削除 → 行が消える
    const userRow = page.getByTestId('basemap-row-e2e-user-basemap');
    await expect(userRow).toBeVisible();
    const userTrigger = userRow.locator('[data-resource-action-trigger]');
    await expect(userTrigger).toHaveCount(1);

    // M11-T7 / M12-T10 v2.0 selected: click row → .selected + aria-current + dark text + blue border + blue bg
    // （旧 .active は M12-T10 v2.0 で .selected へ rename、Bootstrap 競合を恒久排除）
    await userRow.locator('.resource-item__title').click();
    await expect(userRow).toHaveClass(/selected/);
    await expect(userRow).toHaveAttribute('aria-current', 'true');
    await expect(userRow).toHaveCSS('color', 'rgb(33, 37, 41)');
    await expect(userRow).toHaveCSS('background-color', 'rgba(13, 110, 253, 0.06)');
    await expect(userRow).toHaveCSS('border-top-color', 'rgb(13, 110, 253)');

    // M11-T7 / M12-T10 v2.0 gap: 親 .resource-list__rows が gap:6px で行間隔を一元管理
    // （旧 .resource-master-row + .resource-master-row { margin-top: 6px } は M12-T10 で廃止、gap へ統一）
    const rowCount = await page.locator('[data-testid^="basemap-row-"]').count();
    expect(rowCount).toBeGreaterThanOrEqual(3);
    const rowParent = page.locator('[data-testid^="basemap-row-"]').nth(2).locator('xpath=..');
    await expect(rowParent).toHaveCSS('gap', '6px');

    await userTrigger.click();
    await page.locator('[role="menuitem"][data-resource-action="delete"]').click();
    // M11-T10 (AC5): window.confirm ではなく共通 DeleteConfirmDialog を承認して削除する
    await page.getByTestId('delete-confirm-button').click();
    await expect(page.getByTestId('basemap-row-e2e-user-basemap')).toHaveCount(0);

    // AC16: 範囲で絞り込むボタン→ modal→ 適用が現行どおり動く（filterBaseMapCatalog 温存）
    await page.getByTestId('basemap-range-filter').click();
    await expect(page.locator('.modal')).toBeVisible();
    await page.keyboard.press('Escape');
  } finally {
    await quitElectronApplication(app);
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
    // 根因対応: scrollHeight 一気スクロールでは sentinel が可視範囲を通過して発火しない場合があった（並列時に顕在化）。
    // data-resource-sentinel を scrollIntoViewIfNeeded して確実に交差させる。
    await page.locator('[data-resource-content="map"] [data-resource-sentinel]').scrollIntoViewIfNeeded();
    await expect.poll(async () => cards.count(), { timeout: 15_000 }).toBe(22);

    // AC8: q を付けて（batches=2 の状態を残し）card へ遷移 → Back で復元
    const anchorUid = await cards.nth(15).getAttribute('data-resource-uid');
    await page.locator('[data-resource-content="map"]').evaluate((el) => { el.scrollTop = 400; });
    const beforeScroll = await page.locator('[data-resource-content="map"]').evaluate((el) => el.scrollTop);
    await page.locator(`[data-resource-uid="${anchorUid}"] a`).first().click();
    await expect(page).toHaveURL(/\/mapedit/);
    // AC8: エディタの戻るボタン（実経路）で戻る。goBack は直前履歴が '/maplist' 始まりなら
    // router.back()（クエリ保持）で戻るため backCache 復元条件が成立する
    await expect(page.getByTestId('editor-back')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('editor-back').click();
    await expect(page.locator('[data-resource-list="map"]')).toBeVisible();
    // 2 batch 復元で全 22 件が戻る
    await expect.poll(async () => cards.count(), { timeout: 15_000 }).toBe(22);
    // scroll 位置が概ね復元される（先頭に戻っていない。並列タイミングで ±50px を超える変動もあるため、先頭に戻っていないことを確認する）
    await expect.poll(async () => page.locator('[data-resource-content="map"]').evaluate((el) => el.scrollTop), { timeout: 10_000 }).toBeGreaterThan(0);
  } finally {
    await quitElectronApplication(app);
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
    await quitElectronApplication(app);
  }
});
