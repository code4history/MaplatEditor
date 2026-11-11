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
