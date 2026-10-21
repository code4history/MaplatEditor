/**
 * pickedPreviewSource.ts — 画像ファイル指定直後の一次表示のための **electron 非依存**の判定ロジック。
 *
 * なぜ切り出すか:
 *   新しい IPC（`imageassets:readPickedSource`）は renderer が指定した画像の**バイト列**を返す。
 *   renderer が任意の絶対パスを渡して main に読ませる形にすると、既存に無い能力
 *   （任意ファイル読み出し）を renderer に与えることになる（設計書 §8）。∴ **token 方式**にする:
 *   main が選択ダイアログで利用者が選んだパスだけをこの store に覚え、
 *   renderer は token でしか要求できない（パス文字列は IPC の引数に取らない）。
 *
 *   `assets-images.ts` は electron（dialog / BrowserWindow）に依存するため smoke から直接読めない。
 *   `providerKeyResolution.ts` と同じく、判定を純関数・純クラスとしてここへ置き、
 *   遅延（TTL）と上限（追い出し）は時計を注入して単体で検証できるようにする。
 *
 * 上限 20 MB は `IMAGE_ASSET_MAX_BYTES`（ImageAssetService）と同じ値。
 * **保存できる上限と表示できる上限を一致**させ、「保存できるのに見えない」「見えたのに保存できない」を作らない。
 */

/** token の有効期間（30 分。1 セッションの編集作業を跨ぐには十分で、放置された分は捨てる） */
export const PICK_TOKEN_TTL_MS = 30 * 60 * 1000;
/** 同時に覚えるパスの上限（超えたら最も古いものを追い出す） */
export const PICK_TOKEN_MAX = 8;
/** 一次表示できるバイト数の上限（= IMAGE_ASSET_MAX_BYTES） */
export const PREVIEW_MAX_BYTES = 20 * 1024 * 1024;
/**
 * 一次表示できる拡張子。**経路ごとに分ける**（nov26-editor-splash-svg #462）。
 *
 * - アセット（`AssetEdit`）: 既存ピッカ（`imageassets:pickImageFile` の filters）と同じ集合のまま。
 *   SVG は入れない ∴ SVG 経由のスクリプト実行面を持ち込まない
 * - スプラッシュ: SVG を指定できる（人間の指示）。表示は `image/svg+xml` の data: URL を
 *   `<img src>` に入れるだけで、`<img>` では SVG の script も外部参照も動かない
 *
 * 既定（引数省略）はアセット経路。スプラッシュの一次表示は今のところ
 * `app://` の実体（`mimeFor` が `.svg` → `image/svg+xml` を返す）を `<img>` で出す経路であり、
 * こちらは token 経路に寄せるときの定義として置く。
 */
export const ASSET_PREVIEW_ALLOWED_EXTS = ["png", "jpg", "jpeg", "gif"] as const;
export const SPLASH_PREVIEW_ALLOWED_EXTS = ["png", "jpg", "jpeg", "gif", "svg"] as const;
/** 既存名（= アセット経路）の別名 */
export const PREVIEW_ALLOWED_EXTS = ASSET_PREVIEW_ALLOWED_EXTS;

export type PreviewRejectCode = "unsupported" | "too-large";
export type PickedTokenErrorCode = "unknown-token" | "expired";

export type PreviewRequestCheck = { ok: true } | { ok: false; code: PreviewRejectCode };

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

const normalizeExt = (ext: unknown): string =>
  typeof ext === "string" ? ext.replace(/^\./, "").trim().toLowerCase() : "";

/** 拡張子 → MIME。allowlist 外は null（描画側で理由文へ倒す） */
export function mimeForPreviewExt(
  ext: unknown,
  allowed: readonly string[] = ASSET_PREVIEW_ALLOWED_EXTS,
): string | null {
  const normalized = normalizeExt(ext);
  if (!allowed.includes(normalized)) return null;
  switch (normalized) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "svg":
      return "image/svg+xml";
    default:
      return null;
  }
}

/**
 * 読み出し可否の判定（拡張子 allowlist → バイト数上限の順）。
 * `byteSize` は stat で得た実サイズ。**デコードは main でしない**（main の freeze 面を増やさない）。
 * `allowed` を省略した場合はアセット経路の allowlist（SVG を含まない）。
 */
export function validatePreviewRequest(input: {
  ext: unknown;
  byteSize: unknown;
  allowed?: readonly string[];
}): PreviewRequestCheck {
  const allowed = input.allowed ?? ASSET_PREVIEW_ALLOWED_EXTS;
  if (mimeForPreviewExt(input.ext, allowed) === null) return { ok: false, code: "unsupported" };
  const byteSize = typeof input.byteSize === "number" && Number.isFinite(input.byteSize) ? input.byteSize : -1;
  if (byteSize < 0) return { ok: false, code: "unsupported" };
  if (byteSize > PREVIEW_MAX_BYTES) return { ok: false, code: "too-large" };
  return { ok: true };
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
        // 期限切れは表からも落とす（以後は unknown-token ではなく expired を返したいので残す）
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
