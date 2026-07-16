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
