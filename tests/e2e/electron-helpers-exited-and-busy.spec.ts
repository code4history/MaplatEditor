import { expect, test, type ElectronApplication } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';
import { evalMain } from './helpers/evalMain';
import { launch } from './helpers/launchIsolated';
import { captureNativeConfirmation } from './helpers/nativeConfirmation';

// e2e の共通 helper が、実物の Electron の 2 つの状態で壊れないことを固定する:
//   1. アプリが自分で終わり、Playwright が ElectronApplication を破棄した後
//   2. main が JS の実行で塞がっている間
// どちらも runner の速さで出たり出なかったりする順序なので、ここではその状態をわざと作る。

/**
 * main を、メモリを確保し続ける JS で細切れに塞ぐ（1 区切り busyMs。区切りの間は 1 回だけ手を離す）。
 * 塞いでいる間に届いた evaluate は実行中の JS に割り込んで処理される。結果を運ぶ Promise は、解決した後は
 * V8 の inspector（弱い参照）しか持たない。inspector が受け取るのは塞いでいる JS が終わって microtask が流れるとき
 * なので、それより前に GC が走ると回収されて「Resulting promise was garbage collected.」になる。
 *
 * - dialogAtRound: その区切りの終わりにネイティブの確認を出す
 * - gcInMicrotask: 区切りの終わりに塞ぐ側が microtask を 1 つ積み、その中で GC を走らせる。
 *   async 関数を渡しただけの evaluate は、結果の Promise が解決するのが microtask の流れの中になり、
 *   inspector が受け取るより先にこの microtask が走るので、同じ文で落ちる（同期の値を返す形より窓が狭いだけ。
 *   強制の GC でなく、microtask の中でメモリを確保するだけでも 1〜2 割は落ちる）
 */
async function startBusyMain(
  app: ElectronApplication,
  options: { busyMs: number; rounds: number; dialogAtRound?: number; gcInMicrotask?: boolean },
): Promise<void> {
  await evalMain(app, async ({ dialog }, { busyMs, rounds, dialogAtRound, gcInMicrotask }) => {
    const state = globalThis as any;
    state.__busyRounds = 0;
    state.__busyStop = false;
    let gc: (() => void) | undefined; // 強制の GC（V8 の --expose-gc を後から立てて取り出す）
    if (gcInMicrotask) {
      const builtin = (name: string) => (process as any).getBuiltinModule(name);
      builtin('node:v8').setFlagsFromString('--expose-gc');
      gc = builtin('node:vm').runInNewContext('gc');
    }
    const burn = () => {
      const end = Date.now() + busyMs;
      const keep: unknown[] = [];
      while (Date.now() < end) {
        for (let i = 0; i < 2000; i++) keep.push({ i, text: 'x'.repeat(64) + i });
        if (keep.length > 200_000) keep.length = 0;
      }
      // gc は引数なしで呼ぶ（引数があると強制の GC にならない）
      if (gc) void Promise.resolve().then(() => gc());
      state.__busyRounds += 1;
      if (state.__busyRounds === dialogAtRound) {
        void dialog.showMessageBox({ message: 'busy-main', buttons: ['いいえ', 'はい'] })
          .then((result) => { state.__busyAnswer = result.response; });
      }
      if (!state.__busyStop && state.__busyRounds < rounds) setTimeout(burn, 0);
    };
    setTimeout(burn, 0);
  }, options);
}

/** 塞ぐのを止め、ここまでに塞いだ区切りの数を返す */
function stopBusyMain(app: ElectronApplication): Promise<number> {
  return evalMain(app, () => {
    const state = globalThis as any;
    state.__busyStop = true;
    return state.__busyRounds as number;
  });
}

test.describe('e2e の共通 helper（終わったアプリ・忙しい main）', () => {
  test.setTimeout(60_000);

  test('アプリが自分で終わって Playwright が破棄した後でも、quitElectronApplication は投げずに戻る', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'maplat-helper-exited-'));
    const { app } = await launch(root);
    const child = app.process();
    try {
      const closed = new Promise<void>((resolve) => app.once('close', () => resolve()));
      await evalMain(app, async ({ app: electronApp }) => {
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
      // 2 回目の区切りで確認を出す
      await startBusyMain(app, { busyMs: 250, rounds: 40, dialogAtRound: 2 });

      const prompt = await confirmation.wait();
      expect(prompt.message).toBe('busy-main');
      expect(prompt.buttons).toEqual(['いいえ', 'はい']);
      await confirmation.answer(1);
      await expect.poll(() => evalMain(app, () => (globalThis as any).__busyAnswer)).toBe(1);
      await confirmation.restore();

      // ここまでの間、main は塞がり続けていた（塞ぐ区切りを使い切っていない）
      const rounds = await stopBusyMain(app);
      expect(rounds).toBeGreaterThanOrEqual(2);
      expect(rounds).toBeLessThan(40);
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('main を塞ぐ側が microtask を積み、その中で GC が走っても、main の値を取れてネイティブの確認に答えられる', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'maplat-helper-busy-gc-'));
    const { app } = await launch(root);
    try {
      const confirmation = await captureNativeConfirmation(app);
      await startBusyMain(app, { busyMs: 150, rounds: 200, dialogAtRound: 2, gcInMicrotask: true });

      // 確認が出ている間は、何度待っても同じ内容が返る
      for (let i = 0; i < 8; i++) {
        const prompt = await confirmation.wait();
        expect(prompt.message).toBe('busy-main');
        expect(prompt.buttons).toEqual(['いいえ', 'はい']);
      }
      await confirmation.answer(1);
      await expect.poll(() => evalMain(app, () => (globalThis as any).__busyAnswer)).toBe(1);
      await confirmation.restore();

      // 同期の値を返す関数・async 関数・引数つきのどれでも、main の値がそのまま返る
      for (let i = 0; i < 6; i++) {
        expect(await evalMain(app, (_electron, n: number) => n * 2, i)).toBe(i * 2);
        expect(await evalMain(app, async (_electron, n: number) => ({ n, name: 'async' }), i)).toEqual({ n: i, name: 'async' });
      }
      // main の関数が投げた例外は、そのままの文で届く（「garbage collected」にすり替わらない）
      await expect(evalMain(app, () => { throw new Error('main-side failure'); })).rejects.toThrow(/main-side failure/);

      const rounds = await stopBusyMain(app);
      expect(rounds).toBeGreaterThanOrEqual(2);
      expect(rounds).toBeLessThan(200);
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('main が JS で塞がっている間でも、evalMain は main の関数を 1 回だけ走らせる', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'maplat-helper-busy-once-'));
    const { app } = await launch(root);
    try {
      await startBusyMain(app, { busyMs: 250, rounds: 120 });

      // 「garbage collected」が出たとき main の関数は実行済みなので、呼び直すと副作用が 2 回走る
      const calls = 12;
      for (let i = 0; i < calls; i++) {
        await evalMain(app, () => {
          const state = globalThis as any;
          state.__sideEffects = (state.__sideEffects ?? 0) + 1;
        });
      }
      expect(await evalMain(app, () => (globalThis as any).__sideEffects)).toBe(calls);

      const rounds = await stopBusyMain(app);
      expect(rounds).toBeGreaterThanOrEqual(2);
      expect(rounds).toBeLessThan(120);
    } finally {
      await quitElectronApplication(app);
    }
  });
});
