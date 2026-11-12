import type { ElectronApplication, Page } from '@playwright/test';

/**
 * 画像アセットを API で用意するための token を得る。
 *
 * `imageAssets.add` は renderer からパスを受け取らない（読み元は pickImageFile が発行する token か、
 * 複製元アセットの uid だけ）。そこで main の選択ダイアログを 1 回だけ差し替えて `filePath` を
 * 選ばせ、`pickImageFile` が返す token を受け取る。差し替えは 1 回で元の関数へ戻す
 * （spec が先に入れたダイアログのスタブも壊さない）。
 */
export async function pickImageToken(app: ElectronApplication, page: Page, filePath: string): Promise<string> {
  await app.evaluate(({ dialog }, target) => {
    const original = dialog.showOpenDialog;
    dialog.showOpenDialog = (async () => {
      dialog.showOpenDialog = original;
      return { canceled: false, filePaths: [target] };
    }) as typeof dialog.showOpenDialog;
  }, filePath);
  const picked = await page.evaluate(() => window.imageAssets.pickImageFile());
  if (!picked?.token) throw new Error(`pickImageFile did not return a token: ${JSON.stringify(picked)}`);
  return picked.token;
}
