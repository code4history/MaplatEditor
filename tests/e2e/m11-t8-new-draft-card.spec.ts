// m11-t8 回帰テスト: 新規(未保存)下書きカードの識別情報表示と削除
// (人間検証 2026-07-16 添付1/2: タイトル・slugが表示されず、削除手段もない幽霊カード問題の再発防止)
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';

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

test('new-app draft card shows label/slug and can be deleted from the list', async () => {
  test.setTimeout(180_000);
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-draftcard-'));
  const { app, page } = await launch(e2eRoot);

  await page.evaluate(() => window.settings.set('lang', 'ja'));

  // 新規(未保存)アプリの下書きを直接シード (baseRevision: null = 新規)
  const draftUid = 'cccccccc-dddd-eeee-ffff-000000000001';
  await page.evaluate(async (uid) => {
    await window.assetDrafts.put({
      schemaVersion: 1,
      kind: 'app',
      assetUid: uid,
      baseRevision: null,
      updatedAt: new Date().toISOString(),
      payload: {
        appID: 'apptest', appName: { ja: 'アプリテ' }, title: { ja: 'アプリテ' },
        description: {}, keywords: '', siteUrl: '', lang: 'ja', sources: [], pois: [],
        httpSettings: {}, appSettings: {}, manifestSettings: {},
      },
    });
  }, draftUid);

  await page.evaluate(() => { location.hash = '#/applist'; });
  await expect(page.locator('.resource-list__toolbar')).toBeVisible();

  // 下書きカードに label と slug が表示される
  const card = page.locator(`[data-resource-uid="${draftUid}"]`);
  await expect(card).toBeVisible();
  await expect(card.locator('.resource-item__title')).toHaveText('アプリテ');
  await expect(card.locator('.resource-item__slug')).toHaveText('apptest');
  await expect(card.locator('.badge')).toHaveText('下書き');

  // 操作メニューから「下書きを削除」できる
  page.on('dialog', (dialog) => void dialog.accept());
  await card.getByRole('button', { name: '操作メニュー' }).click();
  await page.getByRole('menuitem', { name: '下書きを削除' }).click();

  await expect(card).not.toBeVisible();
  const remaining = await page.evaluate(async () => (await window.assetDrafts.list('app')).length);
  expect(remaining).toBe(0);

  await quitElectronApplication(app);
});

test('slug-less save shows visible error, recovers on edit, and new draft is discardable from editor', async () => {
  test.setTimeout(180_000);
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-draftcard2-'));
  const { app, page } = await launch(e2eRoot);
  // main process の showMessageBox を先頭ボタン(=実行)応答で stub (既存 m11-t4 等と同型)
  await app.evaluate(async ({ dialog }) => {
    dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox;
  });
  await page.evaluate(() => window.settings.set('lang', 'ja'));

  // 1. slug なし保存: DBに行は作られず、エラーがヘッダ直下に可視表示される
  await page.evaluate(() => { location.hash = '#/appedit'; });
  await page.getByTestId('app-title').fill('スラッグなしテスト');
  await page.getByRole('button', { name: '保存' }).click();
  await expect(page.getByText('アプリIDを指定してください。')).toBeVisible();
  const appCount = await page.evaluate(async () => (await (window as any).search.apps({ page: 1, pageSize: 10 })).total);
  expect(appCount).toBe(0);
  // 保存ボタンは一旦 disabled になるが、文書編集で診断が解消され再度押せる (F4同型)
  await expect(page.getByRole('button', { name: '保存' })).toBeDisabled();
  await page.getByTestId('app-title').fill('スラッグなしテスト2');
  await expect(page.getByText('アプリIDを指定してください。')).not.toBeVisible();
  await expect(page.getByRole('button', { name: '保存' })).toBeEnabled();

  // 2. 新規下書きをエディタから破棄できる: 下書きを seed して復元状態で開く
  const draftUid = 'dddddddd-eeee-ffff-0000-000000000002';
  await page.evaluate(async (uid) => {
    await window.assetDrafts.put({
      schemaVersion: 1,
      kind: 'app',
      assetUid: uid,
      baseRevision: null,
      updatedAt: new Date().toISOString(),
      payload: {
        appID: 'discard-target', appName: { ja: '破棄対象' }, title: { ja: '破棄対象' },
        description: {}, keywords: '', siteUrl: '', lang: 'ja', sources: [], pois: [],
        httpSettings: {}, appSettings: {}, manifestSettings: {},
      },
    });
  }, draftUid);
  await page.evaluate(() => { location.hash = '#/applist'; });
  await expect(page.locator('.resource-list__toolbar')).toBeVisible();
  await page.evaluate((uid) => { location.hash = `#/appedit?draftUid=${uid}`; }, draftUid);
  await expect(page.getByText('下書きから復元')).toBeVisible();

  const discardBtn = page.getByTestId('editor-discard-draft');
  await expect(discardBtn).toBeVisible();
  await discardBtn.click();

  // stub 済み dialog が「削除」を返す → 下書きが消え、一覧へ強制帰還する
  await expect(page.locator('.resource-list__toolbar')).toBeVisible({ timeout: 15_000 });
  // 第1部の dirty セッションが hot-exit 下書きを残すのは仕様のため、破棄対象 uid のみ確認する
  const remainingAfterDiscard = await page.evaluate(
    async (uid) => (await window.assetDrafts.list('app')).filter((d) => d.assetUid === uid).length,
    draftUid,
  );
  expect(remainingAfterDiscard).toBe(0);

  await quitElectronApplication(app);
});
