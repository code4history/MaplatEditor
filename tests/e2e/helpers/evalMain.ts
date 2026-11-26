// main process（Electron モジュール名前空間）で関数を評価する、e2e でただ 1 つの口。
//
// tests/ の中では ElectronApplication.evaluate() を直接呼ばず、必ずここを通す
// （scripts/e2e-main-evaluate-smoke.mjs が、直接の呼び出しを弾く）。
// 出自: tests/e2e/settings-and-about.spec.ts の evalMain()（後に helpers/electronMenu.ts へ移した）。
import type { ElectronApplication } from '@playwright/test';

type ElectronModule = typeof import('electron');

/**
 * main process 上で fn を評価し、その結果を返す。
 *
 * ElectronApplication.evaluate() に関数をそのまま渡すと、main が JS の実行で塞がっている間
 * （起動した直後に初めて編集画面を開くとき等）に届いた呼び出しが
 * 「electronApplication.evaluate: Resulting promise was garbage collected.」で落ちることがある。
 *
 * 塞がっている間に届いた evaluate は、実行中の JS に割り込んで処理される。結果を運ぶ Promise は、
 * 解決した後は V8 の inspector（弱い参照）しか持たない。inspector がそれを受け取るのは、塞いでいる JS が
 * 終わって microtask が流れるときなので、それより前に GC が走ると回収されてこの文になる。
 *
 * - 同期の値を返す関数: 割り込みの中で解決するので、塞いでいる JS が終わるまでずっと窓が開く（実測でほぼ毎回落ちる）
 * - async 関数にしただけ: 解決するのが microtask の流れの中になり、窓は狭まる。それでも、塞ぐ側が積んだ
 *   microtask が inspector の受け取りより先に走り、その中で GC が起きると同じように落ちる
 *
 * ここでは fn の結果が決まった後、main の側でマクロタスクを 1 つ（setImmediate）待ってから値を返す。
 * 待っている間の Promise は setImmediate の待ち行列が強く持つ。解決するのは塞いでいた JS と、そこで積まれた
 * microtask が流れ終わった後の新しい回なので、inspector が間を置かずに受け取る。
 *
 * この文が出たとき、main の側の fn は実行済みである。呼び直し（retry）で吸収してはいけない
 * （副作用のある fn が 2 回走る）。
 *
 * fn は Playwright の evaluate と同じく文字列にして main へ送るので、外の変数を閉じ込められない。
 * 値は arg で渡す（JSHandle を含むオブジェクトも渡せる）。
 */
export async function evalMain<R, Arg = any>(
  app: ElectronApplication,
  fn: (electron: ElectronModule, arg: Arg) => R | Promise<R>,
  arg?: Arg,
): Promise<R> {
  if (typeof fn !== 'function') throw new TypeError('evalMain: fn must be a function');
  return app.evaluate(
    async (electron, { source, arg: inner }) => {
      const nextMacrotask = () => new Promise<void>((resolve) => setImmediate(resolve));
      let value: unknown;
      try {
        value = await (0, eval)(`(${source})`)(electron, inner);
      } catch (error) {
        // 例外も同じ道で運ばれるので、同じように待ってから投げ直す
        await nextMacrotask();
        throw error;
      }
      await nextMacrotask();
      return value;
    },
    { source: fn.toString(), arg },
  ) as Promise<R>;
}
