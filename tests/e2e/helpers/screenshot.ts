// 画面の写真を撮る共通の補助。
//
// Header.vue の .nav-link は color / background-color に transition（0.2 秒）が掛かっており、
// 画面を移った直後に撮ると前の画面のタブが強調されたまま、あるいは新しいタブの強調が
// 途中で止まったまま写る。撮る前にタブの強調が落ち着くまで待つことで、写真がどの画面の
// どのタブを選んでいるかを正しく伝えるようにする。
import { expect, type Page } from '@playwright/test';

/**
 * タブの強調が transition の途中で止まらなくなるまで待つ。
 * すべての .nav-link の transition が終わり、上部タブの強調が見出し色に落ち着くことを確かめる。
 */
export async function waitForTabHighlight(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          for (const link of Array.from(document.querySelectorAll<HTMLElement>('.nav-link'))) {
            const running = link.getAnimations().some((animation) => animation.playState === 'running');
            if (running) return `transition: ${link.textContent?.trim() ?? ''}`;
          }
          const active = document.querySelector<HTMLElement>('.navbar-nav .nav-link.active');
          if (!active) return 'settled';
          const probe = document.createElement('span');
          probe.style.backgroundColor = 'var(--editor-ui-header-bg-active)';
          document.body.append(probe);
          const highlight = getComputedStyle(probe).backgroundColor;
          probe.remove();
          const background = getComputedStyle(active).backgroundColor;
          return background === highlight ? 'settled' : `highlight: ${background} != ${highlight}`;
        }),
      { timeout: 5000 },
    )
    .toBe('settled');
}

/** タブの強調が落ち着いてから、画面の写真を撮る。 */
export async function takeScreenshot(
  page: Page,
  filePath: string,
  options?: { fullPage?: boolean },
): Promise<void> {
  await waitForTabHighlight(page);
  await page.screenshot({ path: filePath, fullPage: options?.fullPage });
}
