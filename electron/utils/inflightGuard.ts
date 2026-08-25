// t1: メインプロセスで致命例外（uncaughtException）が起きたとき、実行中の長時間 IPC を
// 必ず settle させるためのガード（設計書 §4.5）。
//
// 背景: adm-zip の非同期継続で投げられた例外は誰の try/catch にも捕まらず、IPC の Promise が
// 孤児化して renderer に `reply was never sent` が返っていた（設計書 §1.4-1.6）。根本原因は
// zipWriter.ts への置換で消えるが、「致命例外が起きたのに IPC が黙って固まる」構造そのものへの
// 防壁として本モジュールを置く。
//
// 設計判断（§4.5）: タイムアウトは使わない（2.14 GiB の搬出は正常でも数分かかる ∴ 安全な値が
// 存在しない）。代わりに「uncaughtException が起きた」という事実を settle のトリガにする。
type Rejector = (err: unknown) => void;
const inflight = new Set<Rejector>();

/** backendErrorForwarder の uncaughtException ハンドラ(:67)からのみ呼ばれる（unhandledRejection には結線しない — §4.5 の設計判断） */
export function failAllInflight(err: unknown): void {
  for (const reject of [...inflight]) {
    inflight.delete(reject);
    reject(err);
  }
}

/**
 * fn の実行中にメインプロセスの致命例外が起きたら、その例外で reject する。
 * fn 自身が settle すれば登録は解除される（誤検知しない）。
 *
 * 非キャンセル意味論（§4.5 の確定仕様）: tripwire が race に勝って Error 応答を返しても、
 * fn() は打ち切られず走り続ける。搬出が後に完走すれば、利用者の選択先へ正当な zip が
 * 後着し得る（一時領域には exportApp の finally により残らない）。
 */
export async function runGuarded<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let reject!: Rejector;
  const tripwire = new Promise<never>((_, rj) => {
    reject = (e) =>
      rj(e instanceof Error ? e : new Error(`${label}: main process fatal error: ${String(e)}`));
  });
  inflight.add(reject);
  // tripwire を race に使うだけなので、勝たなかった側の rejection を握り潰す
  tripwire.catch(() => undefined);
  try {
    return await Promise.race([fn(), tripwire]);
  } finally {
    inflight.delete(reject);
  }
}
