import { expect, test } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';
import { launch } from './helpers/launchIsolated';
import { captureNativeConfirmation } from './helpers/nativeConfirmation';

// e2e の共通 helper が、実物の Electron の 2 つの状態で壊れないことを固定する:
//   1. アプリが自分で終わり、Playwright が ElectronApplication を破棄した後
//   2. main が JS の実行で塞がっている間
// どちらも runner の速さで出たり出なかったりする順序なので、ここではその状態をわざと作る。

test.describe('e2e の共通 helper（終わったアプリ・忙しい main）', () => {
  test.setTimeout(60_000);

  test('アプリが自分で終わって Playwright が破棄した後でも、quitElectronApplication は投げずに戻る', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'maplat-helper-exited-'));
    const { app } = await launch(root);
    const child = app.process();
    try {
      const closed = new Promise<void>((resolve) => app.once('close', () => resolve()));
      await app.evaluate(async ({ app: electronApp }) => {
        setTimeout(() => electronApp.quit(), 0);
      }).catch(() => undefined); // 終わるのが速いと evaluate の応答が届かない
      await closed;

      // Playwright が 'close' を出すのは、子プロセスが終わって stdio も閉じた後。ここから先は app.process() が投げる
      expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
      expect(() => app.process()).toThrow(TypeError);

      await expect(quitElectronApplication(app)).resolves.toBeUndefined();
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
  });

  test('main が JS で塞がっている間でも、ネイティブの確認を待って答えられる', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'maplat-helper-busy-'));
    const { app } = await launch(root);
    try {
      const confirmation = await captureNativeConfirmation(app);

      // main を、メモリを確保し続ける JS で細切れに塞ぐ。塞いでいる間に届いた evaluate は実行中の JS に割り込んで
      // 処理され、同期の値を返す evaluate だと、結果を運ぶ Promise が次の GC で回収されて
      // 「Resulting promise was garbage collected.」になる。2 回目の区切りで確認を出す
      await app.evaluate(async ({ dialog }, { busyMs, rounds }) => {
        const state = globalThis as any;
        state.__busyRounds = 0;
        state.__busyStop = false;
        const burn = () => {
          const end = Date.now() + busyMs;
          const keep: unknown[] = [];
          while (Date.now() < end) {
            for (let i = 0; i < 2000; i++) keep.push({ i, text: 'x'.repeat(64) + i });
            if (keep.length > 200_000) keep.length = 0;
          }
          state.__busyRounds += 1;
          if (state.__busyRounds === 2) {
            void dialog.showMessageBox({ message: 'busy-main', buttons: ['いいえ', 'はい'] })
              .then((result) => { state.__busyAnswer = result.response; });
          }
          if (!state.__busyStop && state.__busyRounds < rounds) setTimeout(burn, 0);
        };
        setTimeout(burn, 0);
      }, { busyMs: 250, rounds: 40 });

      const prompt = await confirmation.wait();
      expect(prompt.message).toBe('busy-main');
      expect(prompt.buttons).toEqual(['いいえ', 'はい']);
      await confirmation.answer(1);
      await expect.poll(() => app.evaluate(async () => (globalThis as any).__busyAnswer)).toBe(1);
      await confirmation.restore();

      // ここまでの間、main は塞がり続けていた（塞ぐ区切りを使い切っていない）
      const rounds = await app.evaluate(async () => {
        const state = globalThis as any;
        state.__busyStop = true;
        return state.__busyRounds as number;
      });
      expect(rounds).toBeGreaterThanOrEqual(2);
      expect(rounds).toBeLessThan(40);
    } finally {
      await quitElectronApplication(app);
    }
  });
});
