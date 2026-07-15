export interface ResettableSingleFlightOptions<Key, Value> {
  initialize: (key: Key) => Promise<Value>;
  // publish中にresetが割り込むと、破棄済みresourceをcallerへ返し得るため同期処理に限定する。
  publish?: (value: Value, key: Key) => void;
  dispose: (value: Value, published: boolean) => void | Promise<void>;
}

interface Initialization<Key, Value> {
  key: Key;
  generation: number;
  promise: Promise<Value>;
}

class InitializationSupersededError extends Error {
  constructor() {
    super('Initialization was superseded by reset');
  }
}

/**
 * key付きresourceの初期化をsingle-flight化し、resetと同じgeneration境界で直列化する。
 * initializeはresourceを外部公開せず生成だけを行い、publishはgeneration確認後に一度だけ呼ぶ。
 */
export class ResettableSingleFlight<Key, Value> {
  private readonly options: ResettableSingleFlightOptions<Key, Value>;
  private generation = 0;
  private current: { key: Key; value: Value } | null = null;
  private initialization: Initialization<Key, Value> | null = null;
  private resetPromise: Promise<void> | null = null;
  // 異なるkeyのgetが重なった場合は、最後に要求されたkeyを全callerの再試行先とする。
  // 各callerが元のkeyを再要求すると、旧/new初期化を相互にresetするlive-lockになる。
  private desired: { key: Key } | null = null;

  constructor(options: ResettableSingleFlightOptions<Key, Value>) {
    this.options = options;
  }

  async get(key: Key): Promise<Value> {
    this.desired = { key };
    for (;;) {
      if (this.resetPromise) {
        await this.resetPromise;
        continue;
      }
      const target = this.desired ? this.desired.key : key;
      if (this.current) {
        if (Object.is(this.current.key, target)) return this.current.value;
        await this.reset();
        continue;
      }
      if (this.initialization) {
        if (!Object.is(this.initialization.key, target)) {
          await this.reset();
          continue;
        }
        try {
          return await this.initialization.promise;
        } catch (error) {
          if (error instanceof InitializationSupersededError) continue;
          throw error;
        }
      }

      const initialization = {
        key: target,
        generation: this.generation,
        promise: null as unknown as Promise<Value>,
      };
      // initialization slotはawaitより前に取得する。同期した次のget()は必ずこのPromiseを待つ。
      this.initialization = initialization;
      initialization.promise = this.initializeAndPublish(initialization);
      try {
        return await initialization.promise;
      } catch (error) {
        if (error instanceof InitializationSupersededError) continue;
        throw error;
      }
    }
  }

  async reset(): Promise<void> {
    if (this.resetPromise) return this.resetPromise;

    this.generation += 1;
    const pending = this.initialization?.promise ?? null;
    const resetPromise = (async () => {
      if (pending) {
        try {
          await pending;
        } catch {
          // 初期化の成功/失敗にかかわらず、以下のcleanupを完遂する。
        }
      }
      const current = this.current;
      this.current = null;
      if (current) await this.options.dispose(current.value, true);
    })();
    this.resetPromise = resetPromise;
    try {
      await resetPromise;
    } finally {
      if (this.resetPromise === resetPromise) this.resetPromise = null;
    }
  }

  private async initializeAndPublish(initialization: Initialization<Key, Value>): Promise<Value> {
    let value: Value | undefined;
    try {
      value = await this.options.initialize(initialization.key);
      if (
        initialization.generation !== this.generation
        || !this.desired
        || !Object.is(initialization.key, this.desired.key)
      ) {
        await this.options.dispose(value, false);
        value = undefined;
        throw new InitializationSupersededError();
      }

      this.current = { key: initialization.key, value };
      try {
        this.options.publish?.(value, initialization.key);
      } catch (error) {
        this.current = null;
        // publish callbackは外部参照やtimerを部分的に設定済みの可能性がある。
        // published cleanupを通し、閉じたresourceへの参照を残さない。
        await this.options.dispose(value, true);
        value = undefined;
        throw error;
      }
      return value;
    } finally {
      if (this.initialization === initialization) this.initialization = null;
    }
  }
}

export function createResettableSingleFlight<Key, Value>(
  options: ResettableSingleFlightOptions<Key, Value>,
): ResettableSingleFlight<Key, Value> {
  return new ResettableSingleFlight(options);
}
