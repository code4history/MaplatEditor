import { expect, type ElectronApplication } from '@playwright/test';

/**
 * ネイティブ確認の本文・既定ボタンを検査してから、人間の応答を返す。
 *
 * main への evaluate は、どれも async 関数で渡す。確認が出る前後は main が JS の実行で塞がっていることがあり
 * （起動した直後に初めて編集画面を開くとき等）、その間に届いた evaluate は実行中の JS に割り込んで処理される。
 * 同期の値を返す関数だと、結果を運ぶ Promise を V8 の inspector だけが弱く持つので、次の GC で回収されて
 * 「electronApplication.evaluate: Resulting promise was garbage collected.」になる。
 * async 関数なら、Playwright が main の側で返り値の Promise を await して待つので、結果が決まるまで回収されない。
 */
export async function captureNativeConfirmation(app: ElectronApplication) {
  await app.evaluate(async ({ dialog }) => {
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
      await app.evaluate(async ({dialog}) => { dialog.showMessageBox = (globalThis as any).__nativeConfirmationOriginal; });
    },
    async wait() {
      await expect.poll(() => app.evaluate(async () => Boolean((globalThis as any).__nativeConfirmation))).toBe(true);
      return app.evaluate(async () => (globalThis as any).__nativeConfirmation as {message:string; detail?:string; buttons:string[]; defaultId?:number; cancelId?:number});
    },
    async answer(response: number) {
      await expect.poll(() => app.evaluate(async () => Boolean((globalThis as any).__nativeConfirmation))).toBe(true);
      await app.evaluate(async (_electron, value) => { (globalThis as any).__answerNativeConfirmation(value); }, response);
    },
  };
}
