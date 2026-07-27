// M12-T31: アプリ編集でプレビューを表示すると「一覧へ」が機能しなくなるバグの回帰 E2E。
// 設計書 `docs/superpowers/specs/2026-07-27-m12-t31-appedit-preview-back-navigation-design.md`
// §7.1 の手順どおり、1テスト内で直列に実施する。
//
// 原因（設計 §3 で実測確定）: preview iframe 内の Maplat viewer (@maplat/ui 同梱の page.js
// hashbang ルータ) が joint session history に pushState でエントリを積み、goBack の
// router.back()（= history.go(-1)）が top ではなく iframe 側のエントリを戻すだけになる。
// iframe 生存中は戻すたびに viewer が再 push して脱出不能、iframe 破棄後も残存エントリへの
// go(-1) が no-op になり恒久的に壊れる。
//
// 修正後は goBack が navigateBackToList（router.push(state.back のフルパス)）に統一され、
// joint history の汚染状態に関係なく top が必ず遷移する。
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

// 保存成功ダイアログ (appedit.success_save) を自動 OK する stub（m12-t30-pois-roundtrip.spec.ts:35 と同文法）
async function stubMessageBoxAutoOk(app: ElectronApplication): Promise<void> {
  await app.evaluate(async ({ dialog }) => {
    dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox;
  });
}

// ユーザーベースマップを1件作成する（m14-t3-wiki-screenshots.spec.ts:186-200 と同文法）
async function seedUserBaseMap(page: Page, slug: string): Promise<void> {
  const result = await page.evaluate(async (baseMapSlug: string) => {
    return (window as any).baseMaps.saveUser({
      slug: baseMapSlug,
      tms: {
        lang: 'ja', title: { ja: 'M12-T31 ベースマップ' }, label: { ja: 'M12-T31 ベースマップ' },
        attr: {}, url: 'https://example.com/tiles/{z}/{x}/{y}.png', minZoom: 0, maxZoom: 18, thumbnail: '',
        coverageLngLats: [[139.60, 35.60], [139.90, 35.60], [139.90, 35.80], [139.60, 35.80]],
      },
      create: true,
    });
  }, slug);
  if (!result || result.result !== 'Success') throw new Error(`Base map seed failed: ${JSON.stringify(result)}`);
}

// bbox 絞り込み（139.5,35.5,139.9,35.9）に合致するアプリを1件作成し、AppList を開く
// （m12-t9-app-list-range-filter.spec.ts:29-55 と同文法）
async function seedAppAndOpenList(page: Page): Promise<{ appUid: string; appSlug: string }> {
  const seeded = await page.evaluate(async () => {
    const appSlug = `t31-app-${Date.now()}`;
    const appUid = crypto.randomUUID();
    const appR = await window.appedit.save({
      uid: appUid,
      slug: appSlug,
      create: true,
      document: {
        appID: appSlug, appName: { ja: 't31 app' }, title: { ja: 't31 app' },
        description: {}, keywords: '', siteUrl: '', lang: 'ja',
        sources: [], pois: [], httpSettings: {}, appSettings: {},
        manifestSettings: {},
        coverageLngLats: [[139.5, 35.5], [139.9, 35.9]],
      },
    });
    if (!appR || appR.result !== 'Success') throw new Error(JSON.stringify(appR));
    return { appUid, appSlug };
  });
  await openHash(page, '#/applist');
  await expect(page.locator(`[data-resource-uid="${seeded.appUid}"]`)).toBeVisible({ timeout: 15000 });
  return seeded;
}

test.describe('M12-T31: preview 表示後の「一覧へ」復帰', () => {
  test('AC31-1/2/3: preview 汚染下でも一覧へ1クリックで復帰し、クエリと絞り込み状態が保持される', async () => {
    test.setTimeout(300_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-t31-preview-back-'));
    const { app, page } = await launch(e2eRoot);
    try {
      await stubMessageBoxAutoOk(app);

      // --- seed: ユーザーベースマップ1件 + bbox 絞り込みに合致するアプリ1件 ---
      const baseMapSlug = `t31-basemap-${Date.now()}`;
      await openHash(page, '#/basemaps');
      await seedUserBaseMap(page, baseMapSlug);
      const seeded = await seedAppAndOpenList(page);

      // 手順2: #/applist へ bbox クエリを付与（m12-t9 AC4 と同文法）
      await page.evaluate(() => {
        const hash = location.hash.split('?')[0];
        location.hash = `${hash}?bbox=139.5,35.5,139.9,35.9`;
      });
      await expect(page.getByTestId('app-range-clear')).toBeVisible({ timeout: 15000 });

      // 手順3: 実カードクリックで appedit へ（push 遷移。location.hash 直接代入は replace
      // 扱いになり state.back が更新されないため、router.back 相当分岐の前提を保証できない
      // — m12-t9-app-list-range-filter.spec.ts:171-176 の既知事実と同文法）
      await page.locator(`[data-resource-uid="${seeded.appUid}"] a`).first().click();
      await expect(page.getByTestId('app-id')).toBeVisible({ timeout: 15000 });

      // 前提 assert: state.back が /applist?bbox= で始まる（prefix 一致分岐を通ることの保証。
      // vue-router createWebHashHistory は state.back を browser history.state.back に格納する）
      const stateBack = await page.evaluate(() => history.state && history.state.back);
      expect(typeof stateBack === 'string' && stateBack.startsWith('/applist?bbox=')).toBe(true);

      // 手順4: sources タブ → ベースマップ追加 → 保存（dirty を残さない）
      await page.getByTestId('app-sources-tab').click();
      await page.getByTestId('app-basemap-mode').click();
      await page.getByTestId('app-basemap-search').fill(baseMapSlug);
      await page.locator(`[data-testid="app-basemap-row-${baseMapSlug}"]`).click({ timeout: 15000 });
      await expect(page.locator('.selected-source').first()).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId('editor-save')).toBeEnabled({ timeout: 10000 });
      const historyLenBeforePreview = await page.evaluate(() => history.length);
      await page.getByTestId('editor-save').click();
      await expect(page.getByTestId('editor-save-state')).toHaveText(/保存済み|saved/i, { timeout: 30000 });

      // プレビュータブへ
      await page.locator('[role="tab"]', { hasText: 'プレビュー' }).click();
      await expect(page.locator('iframe.preview-map')).toBeVisible({ timeout: 25000 });

      // 手順5: 汚染発生の前提 assert（将来 viewer が履歴を積まなくなった場合にこのテストが
      // 空洞化せず、意識的に見直せるようにするガード。§3.2 実測では1秒以内に +3）
      await expect.poll(() => page.evaluate(() => history.length), { timeout: 10000 })
        .toBeGreaterThan(historyLenBeforePreview);

      // 手順6: AC31-1/2 本体 — 「一覧へ」1クリックで復帰、クエリ保持、絞り込み状態復元
      await page.getByTestId('editor-back').click();
      await expect(page.locator('[data-resource-list="app"]')).toBeVisible({ timeout: 15000 });
      await expect.poll(() => page.evaluate(() => location.hash), { timeout: 15000 }).toContain('#/applist');
      const hashAfterBack = await page.evaluate(() => location.hash);
      expect(hashAfterBack).toContain('bbox=');
      await expect(page.getByTestId('app-range-clear')).toBeVisible({ timeout: 15000 });

      // 手順7: 再度カードクリック → appedit → プレビュータブ → 他タブへ移動（iframe 破棄）
      // → 「一覧へ」で復帰できること（AC31-3: 破棄後残存エントリ経路）
      await page.locator(`[data-resource-uid="${seeded.appUid}"] a`).first().click();
      await expect(page.getByTestId('app-id')).toBeVisible({ timeout: 15000 });
      await page.locator('[role="tab"]', { hasText: 'プレビュー' }).click();
      await expect(page.locator('iframe.preview-map')).toBeVisible({ timeout: 25000 });

      // メタデータタブへ移動（iframe を v-if で破棄。AppEdit.vue:587-593 watch(activeTab)）
      await page.locator('[role="tab"]', { hasText: 'メタデータ編集' }).click();
      await expect(page.locator('iframe.preview-map')).toHaveCount(0, { timeout: 15000 });

      await page.getByTestId('editor-back').click();
      await expect(page.locator('[data-resource-list="app"]')).toBeVisible({ timeout: 15000 });
      await expect.poll(() => page.evaluate(() => location.hash), { timeout: 15000 }).toContain('#/applist');

      console.log('  M12-T31: PASS');
    } finally {
      await quitElectronApplication(app);
    }
  });
});
