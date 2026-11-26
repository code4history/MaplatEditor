import { expect, type ElectronApplication } from '@playwright/test';
import { evalMain } from './evalMain';

/**
 * ネイティブ確認の本文・既定ボタンを検査してから、人間の応答を返す。
 *
 * 確認が出る前後は main が JS の実行で塞がっていることがある（起動した直後に初めて編集画面を開くとき等）。
 * main への evaluate は、どれも evalMain を通す（塞がっている間に届いても落ちない理由は helpers/evalMain.ts）。
 */
export async function captureNativeConfirmation(app: ElectronApplication) {
  await evalMain(app, ({ dialog }) => {
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
  const pending = () => evalMain(app, () => Boolean((globalThis as any).__nativeConfirmation));
  return {
    async restore() {
      await evalMain(app, ({ dialog }) => { dialog.showMessageBox = (globalThis as any).__nativeConfirmationOriginal; });
    },
    async wait() {
      await expect.poll(pending).toBe(true);
      return evalMain(app, () => (globalThis as any).__nativeConfirmation as {message:string; detail?:string; buttons:string[]; defaultId?:number; cancelId?:number});
    },
    async answer(response: number) {
      await expect.poll(pending).toBe(true);
      await evalMain(app, (_electron, value: number) => { (globalThis as any).__answerNativeConfirmation(value); }, response);
    },
  };
}
