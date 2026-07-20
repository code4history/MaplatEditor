import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { copyFile, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { quitElectronApplication } from './helpers/electronLifecycle';

const projectRoot = path.resolve(import.meta.dirname, '../..');
const artifactDir = path.join(projectRoot, 'test-results', 'm11-t7-screenshots');

async function launch(e2eRoot: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [projectRoot, `--user-data-dir=${e2eRoot}`],
    cwd: projectRoot,
    env: { ...process.env, VITE_DEV_SERVER_URL: '', MAPLAT_E2E_ROOT: e2eRoot },
  });
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForLoadState('domcontentloaded');
    // AC14: 実ユーザーデータへ接続せず、隔離 root 外なら test 開始前に throw する
    const saveFolder = await page.evaluate(() => window.settings.get('saveFolder'));
    if (!path.resolve(saveFolder).startsWith(path.resolve(e2eRoot) + path.sep)) {
      throw new Error(`E2E storage isolation failed: ${saveFolder} is outside ${e2eRoot}`);
    }
    return { app, page };
  } catch (error) {
    try { await quitElectronApplication(app); } catch { /* cleanup失敗で元例外を上書きしない */ }
    throw error;
  }
}

// dialog を承認へ倒しつつ、表示 message を main プロセス側 global に記録する
// (copy_or_move が「出ない」ことを message 履歴で検証するため)
async function installDialogHarness(app: ElectronApplication, imagePath?: string): Promise<void> {
  await app.evaluate(async ({ dialog }, selectedImage) => {
    (globalThis as any).__dialogMessages = [];
    if (selectedImage) {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [selectedImage] })) as typeof dialog.showOpenDialog;
    }
    dialog.showMessageBox = (async (...args: any[]) => {
      const opts = args.length > 1 ? args[1] : args[0];
      (globalThis as any).__dialogMessages.push(String(opts?.message ?? ''));
      return { response: 0, checkboxChecked: false };
    }) as typeof dialog.showMessageBox;
  }, imagePath ?? null);
}

async function dialogMessages(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(() => ((globalThis as any).__dialogMessages ?? []) as string[]);
}

async function installDeferredReserveHarness(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ ipcMain }) => {
    const channel = 'slug-reservations:reserve';
    const moveChannel = 'slug-reservations:move';
    const checkChannel = 'slug-reservations:check';
    const handlers = (ipcMain as any)._invokeHandlers as Map<string, (...args: any[]) => any> | undefined;
    const original = handlers?.get(channel);
    const originalMove = handlers?.get(moveChannel);
    const originalCheck = handlers?.get(checkChannel);
    if (typeof original !== 'function') throw new Error(`Original ${channel} handler not found`);
    if (typeof originalMove !== 'function') throw new Error(`Original ${moveChannel} handler not found`);
    if (typeof originalCheck !== 'function') throw new Error(`Original ${checkChannel} handler not found`);
    const harness = {
      original,
      originalMove,
      originalCheck,
      calls: [] as any[],
      checks: [] as any[],
      // 同一 slug の重複登録で上書き消失しないよう、slug → resolver 配列 で保持する
      pending: new Map<string, Array<{ resolve: () => void }>>(),
    };
    (globalThis as any).__m11T7ReserveHarness = harness;
    const deferUntilResolved = async (slug: string): Promise<void> => {
      const entry = { resolve: undefined as unknown as () => void };
      await new Promise<void>((resolve) => {
        entry.resolve = resolve;
        const list = harness.pending.get(slug) ?? [];
        list.push(entry);
        harness.pending.set(slug, list);
      });
      // 自分の entry だけを除去し、空になったら map からも削除する
      // (重複登録された他の pending wrapper を巻き込まない)
      const list = harness.pending.get(slug);
      if (list) {
        const index = list.indexOf(entry);
        if (index >= 0) list.splice(index, 1);
        if (list.length === 0) harness.pending.delete(slug);
      }
    };
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, async (event: any, payload: any) => {
      harness.calls.push(payload);
      await deferUntilResolved(String(payload.slug));
      return original(event, payload);
    });
    ipcMain.removeHandler(moveChannel);
    ipcMain.handle(moveChannel, async (event: any, payload: any) => {
      harness.calls.push(payload);
      await deferUntilResolved(String(payload.toSlug));
      return originalMove(event, payload);
    });
    ipcMain.removeHandler(checkChannel);
    ipcMain.handle(checkChannel, async (event: any, payload: any) => {
      const result = await originalCheck(event, payload);
      harness.checks.push(payload);
      return result;
    });
  });
}

// pending 未登録(false)・一過性の context destroyed(throw)の両方を expect.poll で retry する。
// 既に resolve 済み(pending なし かつ calls に slug あり)も冪等に true 扱いとする。
async function resolveDeferredReserve(app: ElectronApplication, slug: string): Promise<void> {
  await expect.poll(async () => app.evaluate((_, targetSlug) => {
    const harness = (globalThis as any).__m11T7ReserveHarness;
    const pendingList = harness?.pending?.get(targetSlug);
    if (pendingList && pendingList.length > 0) {
      for (const entry of pendingList) entry.resolve();
      return true;
    }
    // 既に解決済み(wrapper が pending から除去して original へ進んだ)場合は冪等に true
    const alreadyCalled = (harness?.calls ?? []).some((payload: any) => payload.slug === targetSlug || payload.toSlug === targetSlug);
    return alreadyCalled && !(harness?.pending?.has(targetSlug) ?? false);
  }, slug), { timeout: 15_000 }).toBe(true);
}

async function restoreDeferredReserveHarness(app: ElectronApplication): Promise<void> {
  try {
    await app.evaluate(({ ipcMain }) => {
      const channel = 'slug-reservations:reserve';
      const moveChannel = 'slug-reservations:move';
      const checkChannel = 'slug-reservations:check';
      const harness = (globalThis as any).__m11T7ReserveHarness;
      if (!harness) return;
      // 残存する全 pending wrapper を解放してから handler を復元する
      for (const list of harness.pending.values()) {
        for (const entry of list) entry.resolve();
      }
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, harness.original);
      ipcMain.removeHandler(moveChannel);
      ipcMain.handle(moveChannel, harness.originalMove);
      ipcMain.removeHandler(checkChannel);
      ipcMain.handle(checkChannel, harness.originalCheck);
      delete (globalThis as any).__m11T7ReserveHarness;
    });
  } catch { /* 本体失敗後の context destroyed 等は無視(harness 放棄で十分) */ }
}

async function installReleaseFailureHarness(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ ipcMain }) => {
    const channel = 'slug-reservations:release';
    const handlers = (ipcMain as any)._invokeHandlers as Map<string, (...args: any[]) => any> | undefined;
    const original = handlers?.get(channel);
    if (typeof original !== 'function') throw new Error(`Original ${channel} handler not found`);
    const harness = { original, calls: [] as any[], fail: true };
    (globalThis as any).__m11T7ReleaseHarness = harness;
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, async (event: any, payload: any) => {
      harness.calls.push(payload);
      if (harness.fail) throw new Error('injected release failure');
      return original(event, payload);
    });
  });
}

async function setReleaseFailure(app: ElectronApplication, fail: boolean): Promise<void> {
  await app.evaluate((_, shouldFail) => {
    const harness = (globalThis as any).__m11T7ReleaseHarness;
    if (!harness) throw new Error('Release harness not installed');
    harness.fail = shouldFail;
  }, fail);
}

async function restoreReleaseFailureHarness(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ ipcMain }) => {
    const channel = 'slug-reservations:release';
    const harness = (globalThis as any).__m11T7ReleaseHarness;
    if (!harness) return;
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, harness.original);
    delete (globalThis as any).__m11T7ReleaseHarness;
  });
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

async function seedMap(page: Page, tag: string): Promise<string> {
  return page.evaluate(async (slugTag) => {
    const slug = `m11-t7-map-${slugTag}`;
    const result = await window.mapedit.save({ slug, mapObject: {
      mapID: slug, title: { ja: `T7 地図 ${slugTag}`, en: `T7 Map ${slugTag}` },
      officialTitle: {}, author: {}, era: {}, createdAt: {}, contributor: {}, mapper: {},
      attr: { ja: 'E2E image copyright' }, dataAttr: {}, description: {}, license: 'PD', dataLicense: 'CC BY-SA',
      reference: '', url: '', lang: 'ja', imageExtension: 'jpg', width: 400, height: 300,
      gcps: [], edges: [], sub_maps: [], strictMode: 'strict', vertexMode: 'plain', status: 'New',
    }, tins: [] });
    if (!result || !('result' in result) || result.result !== 'Success') throw new Error(`seed map failed: ${JSON.stringify(result)}`);
    return result.uid;
  }, tag);
}

async function seedApp(page: Page, tag: string, mapRef?: { uid: string; slug: string }): Promise<string> {
  return page.evaluate(async ({ slugTag, mapRef }) => {
    const slug = `m11-t7-app-${slugTag}`;
    const result = await window.appedit.save({
      document: {
        appID: slug,
        title: { ja: `T7 アプリ ${slugTag}` },
        lang: 'ja',
        sources: mapRef ? [{ mapUid: mapRef.uid, mapSlug: mapRef.slug, sourceType: 'map', role: 'overlay' }] : [],
        pois: [],
        status: 'New',
      },
      slug,
    });
    if (!result || !('result' in result) || result.result !== 'Success') throw new Error(`seed app failed: ${JSON.stringify(result)}`);
    return result.uid;
  }, { slugTag: tag, mapRef });
}

async function seedPoi(page: Page, tag: string): Promise<string> {
  return page.evaluate(async (slugTag) => {
    const slug = `m11-t7-poi-${slugTag}`;
    const result = await window.poiSources.createLocal({ slug, title: { ja: `T7 POI ${slugTag}` }, lang: 'ja' });
    if (!result || !('result' in result) || result.result !== 'Success') throw new Error(`seed poi failed: ${JSON.stringify(result)}`);
    return result.uid;
  }, tag);
}

// slug 欄が共通 SlugField であること: editor-ui-mono + role="status" の状態通知 +
// 一意性確認ボタンが editor 内に存在しないこと(AC1)
async function expectSlugField(page: Page, testid: string): Promise<void> {
  const input = page.getByTestId(testid);
  await expect(input).toBeVisible();
  await expect(input).toHaveClass(/editor-ui-mono/);
  // SlugField 内蔵の accessible 状態(role=status)が同じ editor-field 内にある
  const field = page.locator('.editor-field', { has: input });
  await expect(field.locator('[role="status"]')).toHaveCount(1);
  await expect(page.locator('button', { hasText: /一意性/ })).toHaveCount(0);
}

// タイトル → スラッグ (ID) → デフォルト言語 の視覚順(AC7): DOM 上の出現順で判定する
async function expectHeadOrder(page: Page, titleLabel: string | RegExp): Promise<void> {
  const title = page.locator('label, .form-label').filter({ hasText: titleLabel }).first();
  await expect(title).toBeVisible();
  await expect(page.locator('label', { hasText: 'スラッグ (ID)' }).first()).toBeVisible();
  await expect(page.locator('label', { hasText: 'デフォルト言語' }).first()).toBeVisible();
  const labels = await title.evaluate((element) => {
    const group = element.closest('.row');
    if (!group) throw new Error('leading field group (.row) not found');
    return Array.from(group.querySelectorAll('label, .form-label')).map((label) => (label.textContent ?? '').trim());
  });
  const titleAt = labels.findIndex((text) => typeof titleLabel === 'string' ? text.includes(titleLabel) : titleLabel.test(text));
  const slugAt = labels.findIndex((text) => text.includes('スラッグ (ID)'));
  const langAt = labels.findIndex((text) => text.includes('デフォルト言語'));
  expect(titleAt).toBeGreaterThanOrEqual(0);
  expect(titleAt).toBeLessThan(slugAt);
  expect(slugAt).toBeLessThan(langAt);

  const slug = page.locator('label', { hasText: 'スラッグ (ID)' }).first();
  const lang = page.locator('label', { hasText: 'デフォルト言語' }).first();
  const [titleBox, slugBox, langBox] = await Promise.all([
    title.locator('xpath=..').boundingBox(),
    slug.locator('xpath=..').boundingBox(),
    lang.locator('xpath=..').boundingBox(),
  ]);
  expect(titleBox).not.toBeNull();
  expect(slugBox).not.toBeNull();
  expect(langBox).not.toBeNull();
  const visuallyBefore = (a: NonNullable<typeof titleBox>, b: NonNullable<typeof titleBox>) =>
    a.y + 2 < b.y || (Math.abs(a.y - b.y) <= 2 && a.x < b.x);
  expect(visuallyBefore(titleBox!, slugBox!)).toBe(true);
  expect(visuallyBefore(slugBox!, langBox!)).toBe(true);
}

// title inputs と slug inputs の top-edge と height が揃っていること (form-control-sm で高さ統一)
async function expectSlugInputAlignment(page: Page, slugTestId: string, titleTestId: string): Promise<void> {
  const slugInput = page.getByTestId(slugTestId);
  const titleInput = page.getByTestId(titleTestId);
  await expect(slugInput).toBeVisible();
  await expect(titleInput).toBeVisible();
  const [slugBox, titleBox] = await Promise.all([
    slugInput.boundingBox(),
    titleInput.boundingBox(),
  ]);
  expect(slugBox).not.toBeNull();
  expect(titleBox).not.toBeNull();
  if (slugBox && titleBox) {
    expect(Math.abs(titleBox.y - slugBox.y)).toBeLessThanOrEqual(3);
    expect(Math.abs(titleBox.height - slugBox.height)).toBeLessThanOrEqual(2);
  }
}

test('five edits share SlugField with unified head order and §9 tabs', async () => {
  test.setTimeout(300_000);
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m11-t7-'));
  const { app, page } = await launch(e2eRoot);
  const shot = (name: string) => page.screenshot({ path: path.join(artifactDir, `${name}.png`), fullPage: true });
  try {
    await installDialogHarness(app);
    await forceJapanese(page);
    const mapUid = await seedMap(page, 'shape');
    const appUid = await seedApp(page, 'shape');
    const poiUid = await seedPoi(page, 'shape');

    // --- Map Edit (AC1/AC7/AC9) ---
    await openHash(page, `#/mapedit?uid=${mapUid}`, '#mapDocumentLanguage');
    await expectSlugField(page, 'map-slug');
    await expectHeadOrder(page, '地図名称');
    await expectSlugInputAlignment(page, 'map-slug', 'map-title');
    // AC9: §9 tab 語彙 + role/aria。画像未登録 seed のため対応点編集は disabled
    const mapTabs = page.locator('.nav-tabs [role="tab"]');
    await expect(mapTabs).toHaveCount(4);
    await expect(mapTabs.nth(0)).toHaveText(/メタデータ編集/);
    await expect(mapTabs.nth(1)).toHaveText(/対応点編集/);
    await expect(mapTabs.nth(2)).toHaveText(/ベースマップ選択/);
    await expect(mapTabs.nth(3)).toHaveText(/POI選択/);
    await expect(mapTabs.nth(0)).toHaveAttribute('aria-selected', 'true');
    await expect(mapTabs.nth(1)).toHaveAttribute('aria-disabled', 'true');
    await expect(mapTabs.nth(1)).toHaveAttribute('title', /地図画像/);
    const mapTabOverflow = await page.locator('.editor-ui-tabs').evaluate((el) => ({
      overflowX: getComputedStyle(el).overflowX,
      flexWrap: getComputedStyle(el).flexWrap,
    }));
    expect(mapTabOverflow).toEqual({ overflowX: 'auto', flexWrap: 'nowrap' });
    // focus 移動: metadata から ArrowRight → disabled の対応点編集を skip してベースマップ選択へ
    await mapTabs.nth(0).focus();
    await page.keyboard.press('ArrowRight');
    await expect(mapTabs.nth(2)).toHaveAttribute('aria-selected', 'true');
    await expect(mapTabs.nth(2)).toBeFocused();
    await mapTabs.nth(0).click();
    await shot('01-map');
    await shot('06-map-tabs');

    // --- App Edit (AC1/AC7/AC9) ---
    await openHash(page, `#/appedit?uid=${appUid}`, '[data-testid="app-id"]');
    await expectSlugField(page, 'app-id');
    await expectHeadOrder(page, 'アプリ名');
    await expectSlugInputAlignment(page, 'app-id', 'app-title');
    const appTabs = page.locator('.nav-tabs [role="tab"]');
    await expect(appTabs).toHaveCount(4);
    await expect(appTabs.nth(0)).toHaveText(/メタデータ編集/);
    await expect(appTabs.nth(1)).toHaveText(/地図選択/);
    await expect(appTabs.nth(2)).toHaveText(/POI選択/);
    await expect(appTabs.nth(3)).toHaveText(/プレビュー/);
    await expect(appTabs.nth(0)).toHaveAttribute('aria-selected', 'true');
    await appTabs.nth(0).focus();
    await page.keyboard.press('ArrowRight');
    await expect(appTabs.nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(appTabs.nth(1)).toBeFocused();
    const appTabOverflow = await page.locator('.editor-ui-tabs').evaluate((el) => ({
      overflowX: getComputedStyle(el).overflowX,
      flexWrap: getComputedStyle(el).flexWrap,
    }));
    expect(appTabOverflow).toEqual({ overflowX: 'auto', flexWrap: 'nowrap' });
    await appTabs.nth(0).click();
    await shot('02-app');
    await shot('07-app-tabs');

    // --- POI Edit (AC1/AC7) ---
    await openHash(page, `#/poisources/${poiUid}`, '[data-testid="poi-slug"]');
    await expectSlugField(page, 'poi-slug');
    await expectHeadOrder(page, 'タイトル');
    await expectSlugInputAlignment(page, 'poi-slug', 'poi-title');
    await shot('03-poi');

    // --- BaseMap Edit (AC1/AC7) ---
    await openHash(page, '#/basemaps', '[data-master-detail="base-map"]');
    await page.getByTestId('basemap-new').click();
    await expectSlugField(page, 'basemap-slug');
    await expectHeadOrder(page, 'タイトル');
    await expectSlugInputAlignment(page, 'basemap-slug', 'basemap-title');
    await shot('04-basemap');

    // --- Asset Edit (AC1/AC7) ---
    await openHash(page, '#/assets', '[data-master-detail="image-asset"]');
    await page.getByTestId('asset-new').click();
    await expectSlugField(page, 'asset-slug');
    await expectHeadOrder(page, 'タイトル');
    await expectSlugInputAlignment(page, 'asset-slug', 'asset-title');
    await shot('05-asset');
  } finally {
    await quitElectronApplication(app);
  }
});

test('map rename keeps the uid, passes renameFromSlug, and never shows copy_or_move', async () => {
  test.setTimeout(300_000);
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m11-t7-'));
  const { app, page } = await launch(e2eRoot);
  try {
    await installDialogHarness(app);
    await forceJapanese(page);
    const mapUid = await seedMap(page, 'rename');
    const appUid = await seedApp(page, 'rename-ref', { uid: mapUid, slug: 'm11-t7-map-rename' });

    await openHash(page, `#/mapedit?uid=${mapUid}`, '#mapDocumentLanguage');
    const slugInput = page.getByTestId('map-slug');
    await expect(slugInput).toHaveValue('m11-t7-map-rename');
    await slugInput.fill('m11-t7-map-renamed');
    // SlugField の debounce 確認成功 → reserve が自 uid 所有で成立するのを決定的に待つ
    await expect.poll(async () =>
      page.evaluate(async ({ slug, uid }) => window.slugReservations.check({ slug, excludeUid: uid }),
        { slug: 'm11-t7-map-renamed', uid: mapUid }),
    { timeout: 15_000 }).toBe('available');
    await expect(page.getByTestId('editor-save')).toBeEnabled();
    await page.getByTestId('editor-save').click();

    // AC5: 保存後も同一 uid のまま mapID が更新される(request は uid 正準)
    await expect.poll(async () =>
      page.evaluate(async (uid) => (await window.mapedit.request(uid))?.mapID, mapUid),
    { timeout: 20_000 }).toBe('m11-t7-map-renamed');
    // 旧 slug の行は存在しない(複製されていない)
    const stale = await page.evaluate(async () => {
      const result = await window.assets.checkSlug({ slug: 'm11-t7-map-rename' });
      return result;
    });
    expect(stale).toBe(true); // 旧 slug は空きに戻っている
    // copy_or_move 確認は一度も表示されない(D5改: dialog 履歴に複製確認が無い)
    const messages = await dialogMessages(app);
    expect(messages.some((message) => /コピー|複製|copy/i.test(message))).toBe(false);
    // App の Map 参照は slug 文字列ではなく uid 正準なので、Map 改名後も同じ uid を指す
    const appDocument = await page.evaluate(async (uid) => window.appedit.request(uid), appUid);
    expect(appDocument?.sources?.[0]?.mapUid).toBe(mapUid);
  } finally {
    await quitElectronApplication(app);
  }
});

test('diagnostics use field and operation scopes without legacy banners', async () => {
  test.setTimeout(300_000);
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m11-t7-'));
  const { app, page } = await launch(e2eRoot);
  try {
    await installDialogHarness(app);
    await forceJapanese(page);
    const mapBUid = await seedMap(page, 'dup-b');

    await openHash(page, `#/mapedit?uid=${mapBUid}`, '#mapDocumentLanguage');
    const slugInput = page.getByTestId('map-slug');

    // AC8 field: 不正 slug で SlugField の field 診断 + is-invalid
    await slugInput.fill('bad slug!');
    await expect(page.locator('[data-diagnostic-scope="field"]').first()).toBeVisible();
    await expect(slugInput).toHaveClass(/is-invalid/);

    // AC8 operation: field 可用確認後〜保存直前に別 uid が同slugを予約する実レースを作る
    const raceSlug = 'm11-t7-map-race';
    await slugInput.fill(raceSlug);
    await expect(page.getByTestId('editor-save')).toBeEnabled();
    await page.evaluate(async ({ slug, ownUid }) => {
      await window.slugReservations.release({ slug, assetUid: ownUid });
      await window.slugReservations.reserve({
        slug,
        assetUid: 'e2e-foreign-map-uid',
        assetKind: 'map',
        draftUid: 'e2e-foreign-draft-uid',
      });
    }, { slug: raceSlug, ownUid: mapBUid });
    await page.getByTestId('editor-save').click();
    await expect(page.locator('[data-diagnostic-scope="operation"]')).toBeVisible({ timeout: 20_000 });
    // 旧 legacy banner(alert-danger)は editor に出ない
    await expect(page.locator('.alert.alert-danger')).toHaveCount(0);
    // 編集(文書変更)で operation 診断が解消する(F4 同型)
    await slugInput.fill('m11-t7-map-dup-b2');
    await expect(page.locator('[data-diagnostic-scope="operation"]')).toHaveCount(0);
  } finally {
    await quitElectronApplication(app);
  }
});

// AC6: 新規作成の順序保証 — UID採番 → slug予約成功 → 初期draft即時保存 → save(create:true + uid)
// 予約失敗時は asset 本体も draft も残さない(D7/AC6)。
test('new base map creation mints uid, reserves slug, and persists initial draft before save', async () => {
  test.setTimeout(300_000);
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m11-t7-'));
  const { app, page } = await launch(e2eRoot);
  try {
    await installDialogHarness(app);
    await forceJapanese(page);

    // 新規ベースマップを開く(UID事前採番済み)
    await openHash(page, '#/basemaps', '[data-master-detail="base-map"]');
    await page.getByTestId('basemap-new').click();
    await expect(page.getByTestId('basemap-slug')).toBeVisible();

    // UIDがroute queryから取得できる = 事前採番済み
    const newUid = await page.evaluate(() => new URLSearchParams(location.hash.split('?')[1] ?? '').get('uid') ?? '');
    expect(newUid).not.toBe('');
    expect(newUid).toMatch(/^[0-9a-f]{8}-/);

    // slugを入力 → 予約成功を待つ
    const slug = 'e2e-t7-ac6-new-basemap';
    await page.getByTestId('basemap-slug').fill(slug);
    await page.getByTestId('basemap-slug').press('Tab');
    await expect.poll(async () =>
      page.evaluate(async ({ slug, uid }) =>
        window.slugReservations.check({ slug, excludeUid: uid }),
        { slug, uid: newUid }),
    { timeout: 15_000 }).toBe('available');

    // AC6: 予約成功後、初期draftが即時保存されている(GC保護リンケージ確立)
    await expect.poll(async () =>
      page.evaluate(async (uid) => (await window.assetDrafts.get('base-map', uid!)) != null, newUid),
    { timeout: 10_000 }).toBe(true);

    // 必須フィールドを埋めて保存
    await page.getByTestId('basemap-title').fill('AC6新規ベースマップ');
    await page.getByTestId('basemap-title').press('Tab');
    await page.getByTestId('basemap-url').fill('https://example.test/{z}/{x}/{y}.png');
    await page.getByTestId('basemap-url').press('Tab');
    await expect(page.getByTestId('editor-save')).toBeEnabled();

    // UI保存ボタンをクリック → renderer save() → confirmForSave → preload → main → transaction
    await page.getByTestId('editor-save').click();

    // 保存成功: basemapがlistに出現し、uidが一致することを確認
    await expect.poll(async () => {
      const rows = await page.evaluate(async (s) => {
        const all = await window.baseMaps.list();
        return all.find((r: any) => r.mapID === s)?.uid ?? null;
      }, slug);
      return rows;
    }, { timeout: 15_000 }).toBe(newUid);

    // 予約は消化済み(promote成功)
    const reservedAfter = await page.evaluate(async ({ slug, uid }) =>
      window.slugReservations.check({ slug, excludeUid: uid }), { slug, uid: newUid });
    expect(reservedAfter).toBe('available');
  } finally {
    await quitElectronApplication(app);
  }
});

// AC6: 他instanceが予約中のslugで保存しようとすると、asset本体もdraftも作られない
test('new base map save fails cleanly when slug is reserved by another owner', async () => {
  test.setTimeout(300_000);
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m11-t7-'));
  const { app, page } = await launch(e2eRoot);
  try {
    await installDialogHarness(app);
    await forceJapanese(page);

    // 別uidがslugを予約する
    const foreignUid = 'e2e-ac6-foreign-uid';
    const clashSlug = 'e2e-t7-ac6-clash';
    await page.evaluate(async ({ slug, uid }) => {
      await window.slugReservations.reserve({
        slug, assetUid: uid, assetKind: 'base-map', draftUid: 'foreign-draft',
      });
    }, { slug: clashSlug, uid: foreignUid });

    // 新規ベースマップで同slugを入力 → reserved-by-other
    await openHash(page, '#/basemaps', '[data-master-detail="base-map"]');
    await page.getByTestId('basemap-new').click();
    const newUid = await page.evaluate(() => new URLSearchParams(location.hash.split('?')[1] ?? '').get('uid') ?? '');
    expect(newUid).not.toBe('');
    await page.getByTestId('basemap-slug').fill(clashSlug);
    const field = page.locator('.editor-field', { has: page.getByTestId('basemap-slug') });
    await expect(field.locator('[data-diagnostic-scope="field"]')).toBeVisible({ timeout: 15_000 });
    await expect(field.locator('[role="status"]')).toHaveText('他で使用中です');

    // 保存を試みる → confirmForSaveが拒否 → assetは作成されない
    await page.getByTestId('basemap-title').fill('AC6 Clash');
    await page.getByTestId('basemap-title').press('Tab');
    await page.getByTestId('basemap-url').fill('https://example.test/{z}/{x}/{y}.png');
    await page.getByTestId('basemap-url').press('Tab');
    const saveButton = page.getByTestId('editor-save');
    // reserved-by-other状態では保存ボタンが無効の場合がある
    // (field-level danger diagnostic が is-invalid を付与し、form dirty でも button disabled)
    if (await saveButton.isEnabled()) {
      await saveButton.click();
      await expect(page.locator('[data-diagnostic-scope="operation"]')).toBeVisible({ timeout: 15_000 });
    }
    // AC6: asset本体は作成されていない
    const assetCreated = await page.evaluate(async (slug) =>
      (await window.baseMaps.list()).some((row) => row.mapID === slug), clashSlug);
    expect(assetCreated).toBe(false);
    // AC6: draftも作成されていない
    const draftCreated = await page.evaluate(async (uid) =>
      (await window.assetDrafts.get('base-map', uid)) != null, newUid);
    expect(draftCreated).toBe(false);
  } finally {
    await quitElectronApplication(app);
  }
});

test('checkpoint clean removes the persisted draft immediately and it stays gone across relaunch', async () => {
  test.setTimeout(300_000);
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m11-t7-'));
  const imagePath = path.join(e2eRoot, 'e2e-input.png');
  await copyFile(path.join(projectRoot, 'src/assets/img/no_image.png'), imagePath);
  let runtime = await launch(e2eRoot);
  try {
    await installDialogHarness(runtime.app, imagePath);
    await forceJapanese(runtime.page);

    // 既存 basemap を 1 件保存
    await openHash(runtime.page, '#/basemaps', '[data-master-detail="base-map"]');
    await runtime.page.getByTestId('basemap-new').click();
    await runtime.page.getByTestId('basemap-slug').fill('e2e-t7-draft-base');
    await runtime.page.getByTestId('basemap-slug').press('Tab');
    await runtime.page.getByTestId('basemap-title').fill('T7ドラフト');
    await runtime.page.getByTestId('basemap-title').press('Tab');
    await runtime.page.getByTestId('basemap-url').fill('https://example.test/{z}/{x}/{y}.png');
    await runtime.page.getByTestId('basemap-url').press('Tab');
    await runtime.page.getByTestId('editor-save').click();

    // 保存成功: basemapがlistに出現するまで待つ
    await expect.poll(async () => {
      const rows = await runtime.page.evaluate(async () => {
        const all = await window.baseMaps.list();
        return all.find((r: any) => r.mapID === 'e2e-t7-draft-base')?.uid ?? null;
      });
      return rows;
    }, { timeout: 15_000 }).not.toBeNull();

    const uid = await runtime.page.evaluate(async () => {
      const rows = await window.baseMaps.list();
      return rows.find((row) => row.mapID === 'e2e-t7-draft-base')?.uid ?? null;
    });
    expect(uid).not.toBeNull();

    // 編集 → 2 秒 throttle の永続 put を待つ → draft が store に存在
    await runtime.page.getByTestId('basemap-title').fill('T7ドラフト編集');
    await runtime.page.getByTestId('basemap-title').press('Tab');
    await expect.poll(async () =>
      runtime.page.evaluate(async (assetUid) => (await window.assetDrafts.get('base-map', assetUid!)) != null, uid),
    { timeout: 15_000 }).toBe(true);

    // Undo で checkpoint clean → AC10: store から即時除去(D9)
    await runtime.page.getByTestId('editor-undo').click();
    const draftImmediatelyAfterUndo = await runtime.page.evaluate(async (assetUid) =>
      window.assetDrafts.get('base-map', assetUid!), uid);
    expect(draftImmediatelyAfterUndo).toBeNull();

    // 再起動(同一 root)しても draft は復活しない
    await quitElectronApplication(runtime.app);
    runtime = await launch(e2eRoot);
    await forceJapanese(runtime.page);
    const restored = await runtime.page.evaluate(async (assetUid) =>
      (await window.assetDrafts.get('base-map', assetUid!)) != null, uid);
    expect(restored).toBe(false);
    await openHash(runtime.page, '#/basemaps', '[data-master-detail="base-map"]');
    await expect(runtime.page.getByTestId('basemap-row-e2e-t7-draft-base')).toBeVisible();
    await expect(runtime.page.getByTestId('editor-discard-draft')).toHaveCount(0);
  } finally {
    await quitElectronApplication(runtime.app);
  }
});

// Major 1 / AC4: preload→IPC→SettingsService→SqliteDataService.saveUserBaseMap の実経路を通し、
// foreign reservationによるpromote conflictがregistry/body双方をrollbackすることを証明する。
test('actual base map save service rolls back registry and body on promote conflict', async () => {
  test.setTimeout(300_000);
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m11-t7-save-service-'));
  const { app, page } = await launch(e2eRoot);
  const slug = 'actual-service-promote-clash';
  const foreignUid = '11111111-1111-4111-8111-111111111111';
  const targetUid = '22222222-2222-4222-8222-222222222222';
  try {
    await page.evaluate(async () => { await window.baseMaps.list(); });
    const saveFolder = await page.evaluate(() => window.settings.get('saveFolder'));
    const reserved = await page.evaluate(async ({ slug, foreignUid }) =>
      window.slugReservations.reserve({
        slug,
        assetUid: foreignUid,
        assetKind: 'base-map',
        draftUid: 'foreign-draft',
      }), { slug, foreignUid });
    expect(reserved).toEqual({ result: 'ok' });

    const result = await page.evaluate(async ({ slug, targetUid }) =>
      window.baseMaps.saveUser({
        create: true,
        uid: targetUid,
        slug,
        tms: { mapID: slug, title: { ja: 'AC4 conflict' }, url: 'https://example.test/{z}/{x}/{y}.png' },
      }), { slug, targetUid });
    expect(result).toEqual({ result: 'Exist' });

    const rows = await page.evaluate(async () => window.baseMaps.list());
    expect(rows.some((row) => row.mapID === slug || row.uid === targetUid)).toBe(false);

    const db = new DatabaseSync(path.join(saveFolder, 'maplat.sqlite'));
    let dbState: { registry: number; body: number; reservationOwner: string };
    try {
      dbState = {
        registry: Number((db.prepare('SELECT COUNT(*) AS count FROM asset_registry WHERE slug = ? OR uid = ?').get(slug, targetUid) as any).count),
        body: Number((db.prepare('SELECT COUNT(*) AS count FROM base_maps WHERE slug = ? OR uid = ?').get(slug, targetUid) as any).count),
        reservationOwner: String((db.prepare('SELECT asset_uid FROM slug_reservations WHERE slug = ?').get(slug) as any)?.asset_uid ?? ''),
      };
    } finally {
      db.close();
    }
    expect(dbState).toEqual({ registry: 0, body: 0, reservationOwner: foreignUid });
  } finally {
    await quitElectronApplication(app);
  }
});

// Major 2: 実SlugFieldでA/B reserveを同時pendingにし、stale Aだけが完了しても
// 最新Bの成功前にはavailable/state-change/initial draftが発火しないことを証明する。
test('stale reserve completion cannot publish available or create a draft while latest reserve is pending', async () => {
  test.setTimeout(300_000);
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m11-t7-latest-'));
  const { app, page } = await launch(e2eRoot);
  let harnessInstalled = false;
  try {
    await installDialogHarness(app);
    await forceJapanese(page);
    await installDeferredReserveHarness(app);
    harnessInstalled = true;

    await openHash(page, '#/basemaps', '[data-master-detail="base-map"]');
    await page.getByTestId('basemap-new').click();
    await expect(page.getByTestId('basemap-slug')).toBeVisible();
    const uid = await page.evaluate(() => new URLSearchParams(location.hash.split('?')[1] ?? '').get('uid') ?? '');
    expect(uid).not.toBe('');

    await page.getByTestId('basemap-slug').fill('latest-slug-a');
    await page.getByTestId('basemap-slug').press('Tab');
    await expect.poll(() => app.evaluate(() =>
      (globalThis as any).__m11T7ReserveHarness?.pending?.has('latest-slug-a') ?? false
    ), { timeout: 15_000 }).toBe(true);

    // Aを未解決のままBへ変更し、両requestを同時pendingにする。
    await page.getByTestId('basemap-slug').fill('latest-slug-b');
    await page.getByTestId('basemap-slug').press('Tab');
    await expect.poll(() => app.evaluate(() =>
      ((globalThis as any).__m11T7ReserveHarness?.checks ?? [])
        .some((payload: any) => payload.slug === 'latest-slug-b')
    ), { timeout: 15_000 }).toBe(true);
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));

    const field = page.locator('.editor-field', { has: page.getByTestId('basemap-slug') });
    await expect(field.locator('[role="status"]').first()).not.toHaveText('使用できます');
    expect(await page.evaluate(async (u) =>
      (await window.assetDrafts.get('base-map', u)) != null, uid
    )).toBe(false);

    // stale Aだけを完了させる。Bは未解決なのでavailable/draftは禁止。
    await resolveDeferredReserve(app, 'latest-slug-a');
    await expect.poll(() => app.evaluate(() => ({
      a: (globalThis as any).__m11T7ReserveHarness?.pending?.has('latest-slug-a') ?? false,
      b: (globalThis as any).__m11T7ReserveHarness?.pending?.has('latest-slug-b') ?? false,
    })), { timeout: 15_000 }).toEqual({ a: false, b: true });
    await expect(field.locator('[role="status"]').first()).not.toHaveText('使用できます');
    expect(await page.evaluate(async (u) =>
      (await window.assetDrafts.get('base-map', u)) != null, uid)
    ).toBe(false);

    // 最新B完了後にだけavailableとinitial draftを公開する。
    await resolveDeferredReserve(app, 'latest-slug-b');
    await expect(field.locator('[role="status"]').first()).toHaveText('使用できます', { timeout: 15_000 });
    await expect.poll(() => page.evaluate(async (u) =>
      (await window.assetDrafts.get('base-map', u)) != null, uid
    ), { timeout: 15_000 }).toBe(true);

    const foreignView = await page.evaluate(async () =>
      window.slugReservations.check({
        slug: 'latest-slug-b',
        excludeUid: '33333333-3333-4333-8333-333333333333',
      }));
    expect(foreignView).toBe('reserved-by-other');
  } finally {
    if (harnessInstalled) await restoreDeferredReserveHarness(app);
    await quitElectronApplication(app);
  }
});

// Major 3: 実SlugField + BaseMap discard callerを通し、release reject時は
// operation feedbackを表示してclose/reset/draft削除を止め、再試行成功時だけ完了する。
test('release failure keeps the editor uid and draft until discard retry succeeds', async () => {
  test.setTimeout(300_000);
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m11-t7-release-'));
  const { app, page } = await launch(e2eRoot);
  let harnessInstalled = false;
  try {
    await installDialogHarness(app);
    await forceJapanese(page);
    await installReleaseFailureHarness(app);
    harnessInstalled = true;

    await openHash(page, '#/basemaps', '[data-master-detail="base-map"]');
    await page.getByTestId('basemap-new').click();
    await expect(page.getByTestId('basemap-slug')).toBeVisible();
    const uid = await page.evaluate(() => new URLSearchParams(location.hash.split('?')[1] ?? '').get('uid') ?? '');
    expect(uid).not.toBe('');
    await page.getByTestId('basemap-slug').fill('release-discard-test');
    await page.getByTestId('basemap-slug').press('Tab');
    await page.getByTestId('basemap-title').fill('Release Discard Test');
    await page.getByTestId('basemap-title').press('Tab');
    await expect.poll(() => page.evaluate(async (assetUid) =>
      (await window.assetDrafts.get('base-map', assetUid)) != null, uid
    ), { timeout: 15_000 }).toBe(true);
    const hashBefore = await page.evaluate(() => location.hash);

    // 1回目はrelease reject。callerはclose/reset/draft削除へ進んではならない。
    await page.getByTestId('editor-discard-draft').click();
    await expect.poll(() => app.evaluate(() =>
      ((globalThis as any).__m11T7ReleaseHarness?.calls ?? []).length
    )).toBe(1);
    const firstCall = await app.evaluate(() => (globalThis as any).__m11T7ReleaseHarness.calls[0]);
    expect(firstCall).toMatchObject({ slug: 'release-discard-test', assetUid: uid });
    await expect(page.locator('[data-diagnostic-scope="operation"]')).toBeVisible();
    await expect(page.getByTestId('basemap-editor')).toBeVisible();
    expect(await page.evaluate(() => location.hash)).toBe(hashBefore);
    expect(await page.evaluate(async (assetUid) =>
      (await window.assetDrafts.get('base-map', assetUid)) != null, uid
    )).toBe(true);

    // 2回目は実original handlerへ通し、release成功後にだけclose/draft削除が完了する。
    await setReleaseFailure(app, false);
    await page.getByTestId('editor-discard-draft').click();
    await expect.poll(() => app.evaluate(() =>
      ((globalThis as any).__m11T7ReleaseHarness?.calls ?? []).length
    )).toBe(2);
    await expect(page.getByTestId('basemap-editor')).toHaveCount(0);
    await expect.poll(() => page.evaluate(async (assetUid) =>
      (await window.assetDrafts.get('base-map', assetUid)) == null, uid
    )).toBe(true);
  } finally {
    if (harnessInstalled) await restoreReleaseFailureHarness(app);
    await quitElectronApplication(app);
  }
});
