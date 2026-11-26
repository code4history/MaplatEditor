// アプリケーションメニューを E2E から読む・操作するための共有ヘルパー。
//
// 出自: tests/e2e/settings-and-about.spec.ts の About ウィンドウの操作。
// wiki-screenshots-extra の Wiki 用スクリーンショット spec が About ウィンドウの自動撮影で同じロジックを
// 必要としたため、複製せずここへ抽出した（恒久指示「同一扱い処理は
// 共通実装へ徹底」。Playwright はスペック間 import を禁止する ∴ 置き場は helpers/ 配下）。
// main で関数を評価する口（evalMain）は helpers/evalMain.ts にある。
import type { ElectronApplication, Page } from '@playwright/test';
import { evalMain } from './evalMain';

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
