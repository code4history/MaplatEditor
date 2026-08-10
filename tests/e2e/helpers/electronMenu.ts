// main process（Electron モジュール名前空間）を E2E から評価・操作するための共有ヘルパー。
//
// 出自: tests/e2e/m19-t4a-settings-and-about.spec.ts:26-39 の evalMain()。
// m20-t6 の Wiki 用スクリーンショット spec が About ウィンドウの自動撮影で同じロジックを
// 必要としたため、複製せずここへ抽出した（m20-t6 設計書 §5.2。恒久指示「同一扱い処理は
// 共通実装へ徹底」。Playwright はスペック間 import を禁止する ∴ 置き場は helpers/ 配下。
// launchIsolated.ts / electronLifecycle.ts に続く 3 本目の共有ヘルパー）。
import type { ElectronApplication, Page } from '@playwright/test';

/**
 * main process 上で fn を評価する。
 *
 * ElectronApplication.evaluate() は稀に「Resulting promise was garbage collected」で失敗する
 * （Playwright 側の既知の不安定挙動。ラウンドトリップの参照が早期に解放される競合で、
 * 起動直後の呼び出しで観測されやすい。実測: 3回に1回程度）。テスト対象のロジックとは無関係の
 * ハーネス側の揺らぎなので、その1エラーメッセージに限定して1回だけ再試行する。
 */
export async function evalMain<T>(
  app: ElectronApplication,
  fn: (electron: typeof import('electron'), arg: any) => T | Promise<T>,
  arg?: unknown,
): Promise<T> {
  const run = (): Promise<T> =>
    (arg === undefined
      ? (app.evaluate(fn as any) as Promise<T>)
      : (app.evaluate(fn as any, arg as any) as Promise<T>));
  try {
    return await run();
  } catch (error) {
    if (error instanceof Error && error.message.includes('garbage collected')) {
      return await run();
    }
    throw error;
  }
}

/** アプリケーションメニューのトップレベル label 一覧を返す。 */
export async function applicationMenuLabels(app: ElectronApplication): Promise<string[]> {
  return evalMain<string[]>(app, ({ Menu }) =>
    (Menu.getApplicationMenu()?.items ?? []).map((item) => item.label),
  );
}

/**
 * アプリメニュー（先頭のトップレベル項目）配下から `labelFragment` を含む項目を click し、
 * 開いた新規 BrowserWindow の Page を返す。About ウィンドウの起動に使う。
 * label は UI 言語で変わるため、呼び出し側がその言語の断片を渡す（例: 'About' / 'について'）。
 */
export async function openAboutWindow(app: ElectronApplication, labelFragment: string): Promise<Page> {
  const aboutWindowPromise = app.waitForEvent('window');
  await evalMain<void>(
    app,
    ({ Menu }, fragment: string) => {
      const appMenu = (Menu.getApplicationMenu()?.items ?? [])[0];
      const aboutItem = appMenu?.submenu?.items.find((item) => item.label?.includes(fragment));
      if (!aboutItem) throw new Error(`About menu item not found: ${fragment}`);
      aboutItem.click();
    },
    labelFragment,
  );
  const aboutPage = await aboutWindowPromise;
  await aboutPage.waitForLoadState('domcontentloaded');
  return aboutPage;
}
