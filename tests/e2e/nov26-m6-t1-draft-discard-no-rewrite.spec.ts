// nov26-m6-t1 (#117 E3): 下書きの明示破棄の後に、下書きの記録が書き戻されないこと。
//
// m12-t20 の AC20-3（編集画面の破棄で staging と envelope が回収される）が間欠に落ちていた原因の
// 再現と回帰検査。破棄（draftLifecycle.discard）が envelope を消した後、編集画面が閉じる前に
// slug の可用性確認（400ms の debounce ＋ IPC）が「使用できます」に落ちると、useInitialDraftPersist が
// draftLifecycle.flush() を呼び、エディタの履歴がまだ dirty なので下書きを再び dirty にして
// put し、さらに unmount 時の flushSync が envelope を書き戻していた。
//
// タイミングに依存しないよう、main 側の IPC handler を関門付きに差し替えて操作を物理的に重ねる
// （oct26-mapedit-unmount-during-mount.spec.ts と同じ様式）:
//   1. slug-reservations:check を止めた状態で、復元済みの下書きを編集画面で開く
//   2. 破棄を押し、asset-drafts:remove を止める（envelope の削除の途中）
//   3. slug の確認を通して「使用できます」まで進める（ここで flush が走る）
//   4. remove を通し、一覧へ戻った後に envelope が無いことを確かめる
// 2 本目は 3 の代わりに文書を変える（watcher → schedule(true)。m12-t20 AC20-3 の失敗で実測した
// 書き戻しの経路。画像の取込み後の非同期の変化で起きていた）。新規の破棄は endSession で守る。
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
  await page.evaluate(() => window.settings.set('lang', 'ja'));
  return { app, page };
}

async function openHash(page: Page, hash: string): Promise<void> {
  await page.evaluate((nextHash) => { location.hash = nextHash; }, hash);
  await page.waitForLoadState('domcontentloaded');
}

async function envelopeOf(page: Page, assetUid: string): Promise<unknown> {
  return page.evaluate(async (uid) => window.assetDrafts.get('map', uid), assetUid);
}

type Gates = { slugCalls: number; removeCalls: number; putCalls: number; releaseSlug: () => void; releaseRemove: () => void };

// slug-reservations:check と asset-drafts:remove を関門付きに差し替え、put の回数を数える。
// 元の handler の処理は関門の後でそのまま行う（main の実装を呼ぶ）。
async function installGates(app: ElectronApplication): Promise<void> {
  await app.evaluate(async ({ ipcMain }) => {
    const g = globalThis as unknown as { __m6t1: Gates; __m6t1Orig: Record<string, (...a: unknown[]) => unknown> };
    // ipcMain の handler は公開 API で取り出せないため、内部の表から元の関数を拾う
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (...a: unknown[]) => unknown> })._invokeHandlers;
    const orig = {
      check: handlers.get('slug-reservations:check')!,
      remove: handlers.get('asset-drafts:remove')!,
      put: handlers.get('asset-drafts:put')!,
    };
    if (!orig.check || !orig.remove || !orig.put) throw new Error('handler not found');
    let releaseSlug!: () => void;
    let releaseRemove!: () => void;
    const slugGate = new Promise<void>((resolve) => { releaseSlug = resolve; });
    const removeGate = new Promise<void>((resolve) => { releaseRemove = resolve; });
    g.__m6t1 = { slugCalls: 0, removeCalls: 0, putCalls: 0, releaseSlug, releaseRemove };
    ipcMain.removeHandler('slug-reservations:check');
    ipcMain.handle('slug-reservations:check', async (...args: unknown[]) => {
      g.__m6t1.slugCalls += 1;
      await slugGate;
      return orig.check(...args);
    });
    ipcMain.removeHandler('asset-drafts:remove');
    ipcMain.handle('asset-drafts:remove', async (...args: unknown[]) => {
      g.__m6t1.removeCalls += 1;
      await removeGate;
      return orig.remove(...args);
    });
    ipcMain.removeHandler('asset-drafts:put');
    ipcMain.handle('asset-drafts:put', async (...args: unknown[]) => {
      g.__m6t1.putCalls += 1;
      return orig.put(...args);
    });
  });
}

const gateCount = (app: ElectronApplication, key: 'slugCalls' | 'removeCalls' | 'putCalls') =>
  app.evaluate((_e, k) => (globalThis as unknown as { __m6t1: Gates }).__m6t1[k], key);

async function launchWithRestoredDraft(): Promise<{ app: ElectronApplication; page: Page; draftUid: string }> {
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m6t1-discard-'));
  const { app, page } = await launch(e2eRoot);
  await app.evaluate(async ({ dialog }) => {
    dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox;
  });

  // 下書きを 1 件作る（新規地図・未保存。editor-back の flush で envelope が永続化される）
  await openHash(page, '#/mapedit');
  await expect(page.getByTestId('map-title')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('map-title').fill('m6t1 discard');
  await page.getByTestId('map-slug').fill(`m6t1-discard-${Date.now()}`);
  await expect(page.getByText('使用できます')).toBeVisible({ timeout: 15_000 });
  const draftUid = await page.evaluate(() => new URLSearchParams(location.hash.split('?')[1] ?? '').get('draftUid'));
  expect(draftUid).toBeTruthy();
  await page.getByTestId('editor-back').click();
  await expect(page.getByTestId('map-title')).toBeHidden();
  await expect.poll(async () => envelopeOf(page, draftUid!), { timeout: 10_000 }).toBeTruthy();

  await installGates(app);

  // 1. slug の確認を止めた状態で、復元済みの下書きを開く
  await openHash(page, `#/mapedit?draftUid=${draftUid}`);
  await expect(page.getByTestId('map-title')).toHaveValue('m6t1 discard', { timeout: 20_000 });
  await expect.poll(() => gateCount(app, 'slugCalls'), { timeout: 15_000 }).toBeGreaterThan(0);

  // 2. 破棄を押す。envelope の削除（remove）の途中で止める
  await page.getByTestId('editor-discard-draft').click();
  await expect.poll(() => gateCount(app, 'removeCalls'), { timeout: 15_000 }).toBe(1);
  return { app, page, draftUid: draftUid! };
}

async function finishAndAssertNoRewrite(app: ElectronApplication, page: Page, draftUid: string): Promise<void> {
  // 4. remove を通す → 一覧へ戻る（unmount の flushSync もここで走る）
  await app.evaluate(() => (globalThis as unknown as { __m6t1: Gates }).__m6t1.releaseSlug());
  await app.evaluate(() => (globalThis as unknown as { __m6t1: Gates }).__m6t1.releaseRemove());
  await expect(page.getByTestId('map-title')).toBeHidden({ timeout: 15_000 });
  await expect(page.locator('.resource-list__toolbar')).toBeVisible({ timeout: 15_000 });

  // 破棄の後に envelope が書き戻されていない（put も flushSync も走っていない）
  expect(await envelopeOf(page, draftUid)).toBeNull();
  expect(await gateCount(app, 'putCalls')).toBe(0);
}

test('新規地図の下書きを破棄した後、slug の確認が遅れて完了しても下書きが書き戻されない', async () => {
  test.setTimeout(180_000);
  const { app, page, draftUid } = await launchWithRestoredDraft();
  try {
    // 3. slug の確認を通し、編集画面が「使用できます」に落ちるまで進める（ここで flush が走る）
    await app.evaluate(() => (globalThis as unknown as { __m6t1: Gates }).__m6t1.releaseSlug());
    await expect(page.getByText('使用できます')).toBeVisible({ timeout: 15_000 });
    await finishAndAssertNoRewrite(app, page, draftUid);
  } finally {
    await quitElectronApplication(app);
  }
});

test('新規地図の下書きを破棄した後、編集画面を離れる前に文書が変わっても下書きが書き戻されない', async () => {
  test.setTimeout(180_000);
  const { app, page, draftUid } = await launchWithRestoredDraft();
  try {
    // 3. 破棄の途中に文書が変わる（watcher → draftLifecycle.schedule(isDirty=true)）
    await page.evaluate(() => { (window as any).testDebug.mapData.value.label = 'changed after discard'; });
    await finishAndAssertNoRewrite(app, page, draftUid);
  } finally {
    await quitElectronApplication(app);
  }
});
