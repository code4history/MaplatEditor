import { expect, type Page } from '@playwright/test';

// m6-t4a AC5: ベースマップ一覧行のサムネイル <img> が実際にロード・描画されたことを確認する。
// ResourceMasterRow.vue の v-if="item.thumbnailUrl && !thumbBroken" により、ファイル欠損時は
// <img> 自体が存在しなくなる（v-else の placeholder span へ切り替わる）ため、locator('img') の
// 要素数チェックだけでも壊れた状態を検出できるが、naturalWidth>0 まで確認することで
// 「デコード済みで実際に描画された」ところまで担保する。
export async function assertRowThumbnailRendered(page: Page, mapID: string): Promise<void> {
  const rowImg = page.getByTestId(`basemap-row-${mapID}`).locator('img');
  // loading="lazy" のため viewport 外だと naturalWidth が 0 のまま張り付く。明示スクロールで回避する。
  await rowImg.scrollIntoViewIfNeeded();
  await expect(rowImg).toBeVisible();
  await expect
    .poll(() => rowImg.evaluate((el: HTMLImageElement) => el.naturalWidth))
    .toBeGreaterThan(0);
}
