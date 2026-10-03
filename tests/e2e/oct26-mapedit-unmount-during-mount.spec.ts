// MapEdit の async な onMounted が、mount の途中（await 中）に画面を離れたあとも続きを実行する不具合の E2E。
//
// 不具合（EDITOR-FLAKY-E2E-SUGI の調査で発見）:
//   - onMounted の await 中に一覧へ移ると、続きの router.replace が「離れた先の一覧」の URL に ?draftUid=… を付ける
//   - 続きで登録される keydown と main-process のリスナーは onBeforeUnmount の後に登録されるため、外されずに残る
//
// 再現の作り方: main process の mapedit:getWmtsFolder（onMounted の最初の await）を関門で止め、
// MapEdit が mount を始めて関門で止まっている間に一覧へ移る。一覧が出てから関門を開ける。
//
// 確かめること: 一覧の URL が #/maplist のまま・window の keydown リスナー数が開く前と同じ（CDP で数える）。
// main-process のリスナーは preload（sandbox の isolated world）の ipcRenderer に付くためテストから数えられない。
// MapEdit は keydown と同じ箇所で登録・解除しているので、keydown の数で代わりに確かめる。
import { expect, test, type Page } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';
import { launch } from './helpers/launchIsolated';

// 関門を開けたあと、onMounted の続き（router.replace・リスナー登録）が走りきるまで待つ時間
const SETTLE_MS = 2_000;

async function keydownListenerCount(page: Page): Promise<number> {
  const cdp = await page.context().newCDPSession(page);
  try {
    const { result } = await cdp.send('Runtime.evaluate', { expression: 'window' });
    const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId! });
    return listeners.filter((l) => l.type === 'keydown').length;
  } finally {
    await cdp.detach();
  }
}

test.describe('MapEdit: mount の途中で画面を離れたとき', () => {
  test('一覧の URL に draftUid が付かず、keydown リスナーが残らない', async () => {
    test.setTimeout(120_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-mapedit-unmount-'));
    const { app, page } = await launch(e2eRoot);
    try {
      await expect(page.locator('.map-list')).toBeVisible({ timeout: 15000 });
      const saveFolder: string = await page.evaluate(() => window.settings.get('saveFolder'));
      const wmtsFolder = path.join(saveFolder, 'wmts');

      // onMounted の最初の await（mapedit:getWmtsFolder）を関門で止める
      await app.evaluate(({ ipcMain }, folder) => {
        const g = globalThis as unknown as { __unmountGate: { calls: number; release: () => void } };
        let release!: () => void;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        g.__unmountGate = { calls: 0, release };
        ipcMain.removeHandler('mapedit:getWmtsFolder');
        ipcMain.handle('mapedit:getWmtsFolder', async () => {
          g.__unmountGate.calls += 1;
          await gate;
          return folder;
        });
      }, wmtsFolder);

      const keydownBefore = await keydownListenerCount(page);

      // 新規地図の編集画面を開き、onMounted が関門で止まるのを待つ
      await page.evaluate(() => { location.hash = '#/mapedit?new=1'; });
      await expect.poll(() => app.evaluate(() =>
        (globalThis as unknown as { __unmountGate: { calls: number } }).__unmountGate.calls), { timeout: 20000 }).toBe(1);

      // mount の途中で一覧へ移り、一覧が出て編集画面が消えるのを待つ
      await page.evaluate(() => { location.hash = '#/maplist'; });
      await expect(page.locator('.map-list')).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId('map-title')).toHaveCount(0);
      expect(await page.evaluate(() => location.hash)).toBe('#/maplist');

      // 関門を開け、onMounted の続きが走りきるのを待つ
      await app.evaluate(() => {
        (globalThis as unknown as { __unmountGate: { release: () => void } }).__unmountGate.release();
      });
      await page.waitForTimeout(SETTLE_MS);

      expect.soft(await page.evaluate(() => location.hash), '一覧の URL に draftUid が付かない').toBe('#/maplist');
      expect.soft(await keydownListenerCount(page), 'keydown リスナーが残らない').toBe(keydownBefore);
      await expect(page.locator('.map-list')).toBeVisible();

      // 対照: mount を最後まで終えた編集画面では keydown リスナーが付き、離れると外れる
      // （上の検査が「数え方の誤りで常に通る」ものでないことの確認）
      await page.evaluate(() => { location.hash = '#/mapedit?new=1'; });
      await expect(page.getByTestId('map-title')).toBeVisible({ timeout: 20000 });
      await expect.poll(() => page.evaluate(() => location.hash), { timeout: 15000 }).toContain('draftUid=');
      await expect.poll(() => keydownListenerCount(page), { timeout: 15000 }).toBe(keydownBefore + 1);
      await page.evaluate(() => { location.hash = '#/maplist'; });
      await expect(page.locator('.map-list')).toBeVisible({ timeout: 15000 });
      await expect.poll(() => keydownListenerCount(page), { timeout: 15000 }).toBe(keydownBefore);
    } finally {
      await quitElectronApplication(app);
    }
  });
});
