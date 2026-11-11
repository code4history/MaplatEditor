import { expect, type Page } from '@playwright/test';

// 通知だけのものは、ネイティブのダイアログではなく画面上部のバナー（operation-notice）に出る（docs/ui-grammar.md §5.3）。
// 1 行目が message、2 行目からが detail（1 行 1 件）。

/** 出ているバナーを閉じる（前の操作の通知を次の操作の結果と取り違えないため） */
export async function dismissOperationNotice(page: Page): Promise<void> {
  const notice = page.getByTestId('operation-notice');
  if (await notice.count() === 0) return;
  await notice.locator('[data-diagnostic-dismiss]').click();
  await expect(notice).toHaveCount(0);
}

/** バナーが出るのを待って、ネイティブのダイアログと同じ形（message・detail）で返す */
export async function readOperationNotice(page: Page, options: { timeout?: number } = {}): Promise<{ message: string; detail: string }> {
  const notice = page.getByTestId('operation-notice');
  await expect(notice).toBeVisible({ timeout: options.timeout ?? 30_000 });
  const lines = await notice.locator('.editor-diagnostic__message').allTextContents();
  return { message: lines[0] ?? '', detail: lines.slice(1).join('\n') };
}

/**
 * 失敗の通知が出ていないことを確かめる。operation の診断（保存の失敗など）が無く、
 * バナーは「出ていない」か「成功（success）」のどちらか。バナーを一律に除外すると、
 * バナーに出た失敗を見逃す。
 */
export async function expectNoFailureNotice(page: Page): Promise<void> {
  await expect(page.locator('[data-diagnostic-scope="operation"]:not([data-testid="operation-notice"])')).toHaveCount(0);
  const notice = page.getByTestId('operation-notice');
  await expect.poll(async () => (await notice.count()) === 0 ? 'none' : await notice.getAttribute('data-diagnostic-severity'))
    .toMatch(/^(?:none|success)$/);
}
