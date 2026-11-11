import { expect, type ElectronApplication } from '@playwright/test';

/** ネイティブ確認の本文・既定ボタンを検査してから、人間の応答を返す。 */
export async function captureNativeConfirmation(app: ElectronApplication) {
  await app.evaluate(({ dialog }) => {
    const state = globalThis as any;
    state.__nativeConfirmationOriginal = dialog.showMessageBox;
    state.__nativeConfirmation = null;
    dialog.showMessageBox = (async (...args: any[]) => {
      const options = args.length > 1 ? args[1] : args[0];
      return new Promise((resolve) => {
        state.__nativeConfirmation = options;
        state.__answerNativeConfirmation = (response: number) => {
          state.__nativeConfirmation = null;
          resolve({ response, checkboxChecked: false });
        };
      });
    }) as typeof dialog.showMessageBox;
  });
  return {
    async restore() {
      await app.evaluate(({dialog}) => { dialog.showMessageBox = (globalThis as any).__nativeConfirmationOriginal; });
    },
    async wait() {
      await expect.poll(() => app.evaluate(() => Boolean((globalThis as any).__nativeConfirmation))).toBe(true);
      return app.evaluate(() => (globalThis as any).__nativeConfirmation as {message:string; detail?:string; buttons:string[]; defaultId?:number; cancelId?:number});
    },
    async answer(response: number) {
      await expect.poll(() => app.evaluate(() => Boolean((globalThis as any).__nativeConfirmation))).toBe(true);
      await app.evaluate((_electron, value) => (globalThis as any).__answerNativeConfirmation(value), response);
    },
  };
}
