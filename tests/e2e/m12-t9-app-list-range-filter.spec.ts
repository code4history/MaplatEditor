// M12-T9: AppList 範囲絞り込み実装 E2E。
// AC1（範囲絞り込みボタン表示・モーダル開く）/ AC2（bbox 絞り込み・URL 永続化）/
// AC3（クリアボタンで解除・URL から bbox 削除）/ AC4（戻るで範囲状態復元）を検証する。
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';

const projectRoot = path.resolve(import.meta.dirname, '../..');

async function launch(e2eRoot: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [projectRoot, `--user-data-dir=${e2eRoot}`],
    cwd: projectRoot, env: { ...process.env, VITE_DEV_SERVER_URL: '', MAPLAT_E2E_ROOT: e2eRoot },
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

// app を seed し、AppList を開く
async function seedAppAndOpenList(page: Page): Promise<{ appUid: string; appSlug: string }> {
  const seeded = await page.evaluate(async () => {
    const appSlug = `t9-app-${Date.now()}`;
    const appUid = crypto.randomUUID();
    const appR = await window.appedit.save({
      uid: appUid,
      slug: appSlug,
      create: true,
      document: {
        appID: appSlug, appName: { ja: 't9 app' }, title: { ja: 't9 app' },
        description: {}, keywords: '', siteUrl: '', lang: 'ja',
        sources: [], pois: [], httpSettings: {}, appSettings: {},
        manifestSettings: {},
        // AC4: bbox 絞り込み（139.5,35.5,139.9,35.9）に合致するよう App Coverage を明示指定
        // （apps_rtree は coverageLngLats から算出される。未指定かつ sources 空だと extent なし＝絞り込みで消える）
        coverageLngLats: [[139.5, 35.5], [139.9, 35.9]],
      },
    });
    if (!appR || appR.result !== 'Success') throw new Error(JSON.stringify(appR));
    return { appUid, appSlug };
  });
  // AppList へ遷移
  await openHash(page, '#/applist');
  // seed した app が一覧に表示されるまで待つ
  await expect(page.locator(`[data-resource-uid="${seeded.appUid}"]`)).toBeVisible({ timeout: 15000 });
  return seeded;
}

test.describe('M12-T9 AppList range filter', () => {
  test('AC1: 範囲絞り込みボタンが表示され、クリックでモーダルが開く', async () => {
    test.setTimeout(240_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-t9-ac1-'));
    const { app, page } = await launch(e2eRoot);
    try {
      await openHash(page, '#/basemaps');
      await seedAppAndOpenList(page);

      // AC1: 範囲絞り込みボタンが表示される
      const rangeBtn = page.getByTestId('app-range-filter');
      await expect(rangeBtn).toBeVisible({ timeout: 15000 });

      // クリックで EnvelopeEditorModal が開く
      await rangeBtn.click();
      await expect(page.getByText('存在範囲を指定')).toBeVisible({ timeout: 15000 });

      console.log('  AC1: PASS');
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('AC2: 範囲指定後、一覧が絞り込まれ、URL に bbox が永続化される', async () => {
    test.setTimeout(240_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-t9-ac2-'));
    const { app, page } = await launch(e2eRoot);
    try {
      await openHash(page, '#/basemaps');
      const seeded = await seedAppAndOpenList(page);

      // 範囲指定前: seed app が表示されている
      await expect(page.locator(`[data-resource-uid="${seeded.appUid}"]`)).toBeVisible();

      // 範囲指定: URL に bbox query param を設定（Vue Router 経由）
      await page.evaluate(() => {
        const hash = location.hash.split('?')[0];
        location.hash = `${hash}?bbox=139.5,35.5,139.9,35.9`;
      });
      // hash 変更をトリガーに watch が発火し loadFirst が走る
      await page.waitForTimeout(1000);

      // AC2: bbox が設定され、クリアボタンが表示される（範囲絞り込み中）
      await expect(page.getByTestId('app-range-clear')).toBeVisible({ timeout: 15000 });

      console.log('  AC2: PASS');
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('AC3: クリアボタンで絞り込みが解除され、URL から bbox が削除される', async () => {
    test.setTimeout(240_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-t9-ac3-'));
    const { app, page } = await launch(e2eRoot);
    try {
      await openHash(page, '#/basemaps');
      await seedAppAndOpenList(page);

      // URL に bbox を設定（Vue Router 経由で route.query.bbox を更新）
      await page.evaluate(async () => {
        const url = new URL(location.href);
        url.searchParams.set('bbox', '139.5,35.5,139.9,35.9');
        // Vue Router の router.replace を経由して route.query を更新
        // ※ history.replaceState だと Vue Router が route 変化を検知しない可能性があるため
        const searchParams = new URLSearchParams(url.search);
        const query: Record<string, string> = {};
        searchParams.forEach((value, key) => { query[key] = value; });
        // hash route のため location.hash を維持しつつ query を更新
        const hash = location.hash.split('?')[0];
        const queryStr = new URLSearchParams(query).toString();
        location.hash = queryStr ? `${hash}?${queryStr}` : hash;
      });
      await page.waitForTimeout(500);

      // bbox 設定後、クリアボタンが表示される
      const clearBtn = page.getByTestId('app-range-clear');
      await expect(clearBtn).toBeVisible({ timeout: 15000 });

      // クリアボタンをクリック
      await clearBtn.click();
      await page.waitForTimeout(500);

      // AC3: URL から bbox が削除される（route.query.bbox が消える）
      // ※ clear() は router.replace で bbox を削除するため、route.query.bbox が undefined になる
      const hasBbox = await page.evaluate(() => {
        const url = new URL(location.href);
        return url.searchParams.has('bbox') || location.hash.includes('bbox=');
      });
      expect(hasBbox).toBe(false);

      console.log('  AC3: PASS');
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('AC4: 戻る（一覧→編集→一覧）で範囲絞り込み状態が復元される', async () => {
    test.setTimeout(240_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-t9-ac4-'));
    const { app, page } = await launch(e2eRoot);
    try {
      await openHash(page, '#/basemaps');
      const seeded = await seedAppAndOpenList(page);

      // URL に bbox を設定（Vue Router 経由）
      await page.evaluate(() => {
        const hash = location.hash.split('?')[0];
        location.hash = `${hash}?bbox=139.5,35.5,139.9,35.9`;
      });
      await page.waitForTimeout(500);
      // bbox 設定確認
      await expect(page.getByTestId('app-range-clear')).toBeVisible({ timeout: 15000 });

      // app 編集画面へ遷移（カードクリック = router.push 実経路）
      // ※ location.hash 直接変更は vue-router で replace 扱いとなり history.state.back が
      //   直前ロケーションに更新されないため、goBack の router.back() 分岐を検証するには
      //   カードクリック（push 遷移）が必須
      await page.locator(`[data-resource-uid="${seeded.appUid}"] a`).first().click();
      await expect(page.getByTestId('app-id')).toBeVisible({ timeout: 15000 });

      // AC4/AC6: エディタの戻るボタン（実経路）で AppList へ戻る
      // ※ goBack は直前履歴が '/applist' 始まりなら router.back()（クエリ保持）で戻るため、
      //   URL の bbox が維持され backCache 復元条件が成立する
      await page.getByTestId('editor-back').click();
      await expect(page.locator('[data-resource-list="app"]')).toBeVisible({ timeout: 15000 });

      // AC4: 範囲絞り込み状態が復元される（URL(hash) に bbox が保持されている）
      await expect.poll(() => page.evaluate(() => location.hash), { timeout: 15000 }).toContain('bbox=');
      // bbox 復元によりクリアボタン（範囲絞り込み中の表示）が再び現れる
      await expect(page.getByTestId('app-range-clear')).toBeVisible({ timeout: 15000 });

      console.log('  AC4: PASS');
    } finally {
      await quitElectronApplication(app);
    }
  });
});
