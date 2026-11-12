/**
 * pickedPathStore.ts — 「利用者がファイル選択のダイアログで選んだパス」を token に置き換える表（**electron 非依存**）。
 *
 * renderer が任意の絶対パスを渡して main に読ませる形にすると、renderer が乗っ取られたときに
 * 任意のファイルを読めてしまう。∴ main がダイアログの返値だけをこの表に覚えて token を発行し、
 * renderer は token でしか読み出しを要求できないようにする（パス文字列は IPC の引数に取らない）。
 *
 * 使う経路（表は経路ごとに別のインスタンス。実装はこの 1 つ）:
 *   - 画像の一次表示: `imageassets:pickImageFile` → `imageassets:readPickedSource`
 *   - POI の取り込み: `poisource:pickImportFile` → `poisource:detectImportLanguage`・`poisource:importFile`
 * インスタンスを分けるのは、経路ごとに許す拡張子が違うため（画像の token で POI を読ませない、逆も同じ）。
 *
 * 規則（どの経路も同じ）:
 *   - token は期限内なら何度でも解決できる（1 回で消さない）
 *   - 発行から `PICK_TOKEN_TTL_MS`（30 分）で失効する
 *   - 同時に覚えるのは `PICK_TOKEN_MAX`（8 件）まで。超えたら最も古いものを追い出す
 * 時計は注入できるので、期限と追い出しを単体で検証できる。
 */

/** token の有効期間（30 分。1 セッションの編集作業を跨ぐには十分で、放置された分は捨てる） */
export const PICK_TOKEN_TTL_MS = 30 * 60 * 1000;
/** 同時に覚えるパスの上限（超えたら最も古いものを追い出す） */
export const PICK_TOKEN_MAX = 8;

export type PickedTokenErrorCode = "unknown-token" | "expired";

export type PickedTokenResolution =
  | { ok: true; filePath: string }
  | { ok: false; code: PickedTokenErrorCode };

export interface PickedPathStore {
  /** 利用者が選んだパスを覚え、token を発行する（同じパスでも毎回新しい token） */
  register(filePath: string): string;
  /** token → パス。未知・期限切れは解決しない */
  resolve(token: string): PickedTokenResolution;
  clear(): void;
  size(): number;
}

/**
 * token → パスの対応表。main のプロセス内にだけ存在し、ディスクにも IPC の応答にもパスを出さない
 * （`resolve` は main 内部でのみ使う）。
 */
export function createPickedPathStore(deps: {
  now?: () => number;
  ttlMs?: number;
  max?: number;
  newToken?: () => string;
} = {}): PickedPathStore {
  const now = deps.now ?? (() => Date.now());
  const ttlMs = deps.ttlMs ?? PICK_TOKEN_TTL_MS;
  const max = deps.max ?? PICK_TOKEN_MAX;
  const newToken = deps.newToken ?? (() => globalThis.crypto.randomUUID());
  // Map の挿入順 = 発行順。上限超過は先頭（最も古い）から落とす
  const entries = new Map<string, { filePath: string; issuedAt: number }>();

  const isExpired = (issuedAt: number): boolean => now() - issuedAt >= ttlMs;

  return {
    register(filePath: string): string {
      const token = newToken();
      entries.set(token, { filePath, issuedAt: now() });
      while (entries.size > max) {
        const oldest = entries.keys().next();
        if (oldest.done) break;
        entries.delete(oldest.value);
      }
      return token;
    },
    resolve(token: string): PickedTokenResolution {
      if (typeof token !== "string" || token.length === 0) return { ok: false, code: "unknown-token" };
      const entry = entries.get(token);
      if (!entry) return { ok: false, code: "unknown-token" };
      if (isExpired(entry.issuedAt)) {
        // 期限切れは表に残す（以後も unknown-token ではなく expired を返すため）
        return { ok: false, code: "expired" };
      }
      return { ok: true, filePath: entry.filePath };
    },
    clear(): void {
      entries.clear();
    },
    size(): number {
      return entries.size;
    },
  };
}
