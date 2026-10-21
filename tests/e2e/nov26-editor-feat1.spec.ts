// nov26-editor-feat1: 一覧トップの検索条件の記憶とワンクリック再実行（実操作）
//
// 設計: .nayuta/2026-10-21-nov26-editor-feat1-design.md（v1.0）§6
// 設計レビュー NOV26-DR-EDITOR-FEATURES-0456 の指示 1-4 を実経路で確かめる:
//   1. 入力の確定（Enter / blur の @change）で即時記録する
//   2. 変換中（compositionstart〜compositionend）は記録しない
//   3. 左右ペインは uid 変化時と unmount で flush する（ここでは選択後のチップ適用で uid 保持を見る）
//   4. 現在の q と一致するチップは active
import { expect, test, type Page } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { launch } from './helpers/launchIsolated';
import { quitElectronApplication } from './helpers/electronLifecycle';

const CHIPS = '[data-testid="recent-search-chips"]';

async function openHash(page: Page, hash: string, ready: string): Promise<void> {
  await page.evaluate((nextHash) => { location.hash = nextHash; }, hash);
  await expect(page.locator(ready)).toBeVisible();
}

// 設定ファイルに載った履歴（electron-store の recentSearches）を kind ごとに読む
async function storedSearches(page: Page, kind: string): Promise<Array<{ q: string; at: number }>> {
  return page.evaluate(async (targetKind) => {
    const all = await window.settings.get('recentSearches');
    const list = all && typeof all === 'object' ? all[targetKind] : undefined;
    return Array.isArray(list) ? list : [];
  }, kind);
}

// fill + Tab（blur）で @change を発火させる = レビュー指示 1 の即時記録の契機
async function commitByBlur(input: ReturnType<Page['locator']>, value: string): Promise<void> {
  await input.fill(value);
  await input.press('Tab');
}

test('AC7/AC8/AC10 + active: 停止 800 ms で記録し、変換中は記録せず、画面ごとに独立で再起動後も残る', async () => {
  test.setTimeout(180_000);
  const root = await mkdtemp(path.join(os.tmpdir(), 'maplat-nov26-feat1-a-'));
  let running = await launch(root);
  try {
    await openHash(running.page, '#/maplist', '[data-resource-list="map"]');
    const search = running.page.locator('[data-resource-search]');
    await search.click();
    await search.pressSequentially('tokyo', { delay: 80 });
    // AC10: 入力中の各文字は履歴に入らず、停止後にまとめて 1 件
    await running.page.waitForTimeout(1500);
    const mapEntries = await storedSearches(running.page, 'map');
    expect(mapEntries).toHaveLength(1);
    expect(mapEntries[0].q).toBe('tokyo');
    await expect(running.page.locator('[data-recent-search]')).toHaveCount(1);
    // レビュー指示 4: 現在の q と一致するチップは active
    await expect(running.page.locator('[data-recent-search="tokyo"]')).toHaveClass(/active/);

    // AC8: 履歴は画面ごとに独立（地図管理の q がアプリ管理に出ない）
    await openHash(running.page, '#/applist', '[data-resource-list="app"]');
    await expect(running.page.locator(CHIPS)).toHaveCount(0);

    // レビュー指示 2: 変換中（compositionstart〜compositionend）は 800 ms の予約をしない
    await running.page.evaluate(() => {
      const input = document.querySelector('[data-resource-list="app"] [data-resource-search]') as HTMLInputElement;
      input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      input.value = 'とうきょう';
      input.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true, data: 'とうきょう' }));
    });
    await running.page.waitForTimeout(1500);
    expect(await storedSearches(running.page, 'app')).toHaveLength(0);

    // 変換確定後は記録される（変換後の値で予約し直す）
    await running.page.evaluate(() => {
      const input = document.querySelector('[data-resource-list="app"] [data-resource-search]') as HTMLInputElement;
      input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: 'とうきょう' }));
      input.dispatchEvent(new InputEvent('input', { bubbles: true, data: 'とうきょう' }));
    });
    await running.page.waitForTimeout(1500);
    const appEntries = await storedSearches(running.page, 'app');
    expect(appEntries).toHaveLength(1);
    expect(appEntries[0].q).toBe('とうきょう');
    await expect(running.page.locator('[data-recent-search="とうきょう"]')).toHaveCount(1);
    await expect(running.page.locator('[data-recent-search="とうきょう"]')).toHaveClass(/active/);

    // AC7: 再起動後も残る（electron-store に保存されている）
    await quitElectronApplication(running.app);
    running = await launch(root);
    await openHash(running.page, '#/applist', '[data-resource-list="app"]');
    await expect(running.page.locator('[data-recent-search="とうきょう"]')).toHaveCount(1);
  } finally {
    await quitElectronApplication(running.app);
  }
});

test('AC4/AC5/AC6/AC9: 件数上限・× の 1 件削除・ワンクリック絞り込み・uid 保持', async () => {
  test.setTimeout(240_000);
  const root = await mkdtemp(path.join(os.tmpdir(), 'maplat-nov26-feat1-b-'));
  const running = await launch(root);
  try {
    // AC5: 全面（グリッド）は 10 件まで
    await openHash(running.page, '#/maplist', '[data-resource-list="map"]');
    const mapSearch = running.page.locator('[data-resource-search]');
    for (let index = 1; index <= 11; index += 1) await commitByBlur(mapSearch, `map${index}`);
    await expect(running.page.locator('[data-recent-search]')).toHaveCount(10);
    await expect(running.page.locator('[data-recent-search]').first()).toHaveAttribute('data-recent-search', 'map11');

    // レビュー指示 1: Enter でも即時記録する（blur だけでないこと）
    await mapSearch.fill('enter-commit');
    await mapSearch.press('Enter');
    await expect(running.page.locator('[data-recent-search]').first()).toHaveAttribute('data-recent-search', 'enter-commit');
    await expect(running.page.locator('[data-recent-search]')).toHaveCount(10);

    // AC4: × は該当 1 件だけを消し、入力欄の値と現在の検索条件（q）は変えない
    const beforeHash = await running.page.evaluate(() => location.hash);
    await running.page.locator('[data-recent-search-remove="map5"]').click();
    await expect(running.page.locator('[data-recent-search="map5"]')).toHaveCount(0);
    await expect(running.page.locator('[data-recent-search]')).toHaveCount(9);
    expect(await running.page.evaluate(() => location.hash)).toBe(beforeHash);
    await expect(mapSearch).toHaveValue('enter-commit');

    // 【NOV26-IR-EDITOR-FEAT1-0463 MAJOR-1】チップを押した直後（800 ms 以内）に同じチップの × を押しても、
    // 消した履歴が予約の記録で戻らない
    await running.page.locator('[data-recent-search="map7"]').click();
    await running.page.locator('[data-recent-search-remove="map7"]').click();
    await running.page.waitForTimeout(1200);
    await expect(running.page.locator('[data-recent-search="map7"]')).toHaveCount(0);

    // AC5: 左右ペインは 5 件まで
    await openHash(running.page, '#/basemaps', '[data-master-detail="base-map"]');
    const baseSearch = running.page.getByTestId('basemap-search');
    for (let index = 1; index <= 6; index += 1) await commitByBlur(baseSearch, `GSI${index}`);
    await expect(running.page.locator('[data-recent-search]')).toHaveCount(5);

    // AC6/AC9: チップ 1 クリックでその q の絞り込みが走り、選択中の uid を落とさない
    await commitByBlur(baseSearch, 'GSI');
    await expect(running.page.getByTestId('basemap-row-gsi_ortho')).toBeVisible();
    await running.page.getByTestId('basemap-row-gsi_ortho').click();
    await expect(running.page).toHaveURL(/uid=/);
    await commitByBlur(baseSearch, 'OSM');
    await expect(running.page).toHaveURL(/q=OSM/);
    await expect(running.page.getByTestId('basemap-row-gsi_ortho')).toHaveCount(0);
    await running.page.locator('[data-recent-search="GSI"]').click();
    await expect(running.page).toHaveURL(/q=GSI/);
    await expect(running.page).toHaveURL(/uid=/); // AC9: uid を保つ
    await expect(running.page.getByTestId('basemap-row-gsi_ortho')).toBeVisible();
    await expect(running.page.getByTestId('basemap-row-osm')).toHaveCount(0);
    // レビュー指示 4: 適用したチップが active になる
    await expect(running.page.locator('[data-recent-search="GSI"]')).toHaveClass(/active/);
    await expect(running.page.locator('[data-recent-search="OSM"]')).not.toHaveClass(/active/);
  } finally {
    await quitElectronApplication(running.app);
  }
});
