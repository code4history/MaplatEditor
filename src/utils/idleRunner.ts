/**
 * 「最後の呼び出しから一定時間、何も無かったら 1 回だけ実行する」仕掛け（デバウンス）。
 * 三角網の差分更新で、編集が止まって 1 秒後に清書するのに使う（MaplatTin#100・設計書 §9.3 の 3）。
 * 時計は差し替えられる（試験用）。
 */
export interface IdleRunner {
  /** 待ちを始める（待っている間に呼ばれたら、最初から数え直す） */
  schedule(): void;
  /** 待ちをやめる */
  cancel(): void;
  /** 待っているか */
  readonly pending: boolean;
}

export interface IdleClock {
  setTimeout(task: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const realClock: IdleClock = {
  setTimeout: (task, ms) => setTimeout(task, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function createIdleRunner(run: () => void, delayMs: number, clock: IdleClock = realClock): IdleRunner {
  let handle: unknown;
  let waiting = false;
  const cancel = () => {
    if (waiting) clock.clearTimeout(handle);
    waiting = false;
    handle = undefined;
  };
  return {
    schedule() {
      cancel();
      waiting = true;
      handle = clock.setTimeout(() => {
        waiting = false;
        handle = undefined;
        run();
      }, delayMs);
    },
    cancel,
    get pending() {
      return waiting;
    },
  };
}
