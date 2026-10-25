// ベースマップ管理のサムネイル置換における「書き込み先」の決定（規則 K）。
//
// 置換の実体（プレビュー・IPC 呼び出し・指し先の rebase）は
// `src/composables/useThumbnailReplace.ts` が単一実装として持つ。本モジュールは
// **ベースマップ固有の「どこへ書くか」だけ**を純関数として切り出す。
//
// 切り出す理由: 複製元のアイコンを壊す不具合（issue #192）は
// 「書き込み先の決定」にあり、composable や main の書き込み経路は正しい。
// 決定を Vue コンポーネント内に閉じると、実際の書き込み経路（composable + IPC +
// AppAssetService / SqliteDataService）を smoke から同じ関数で叩けず、
// テスト側で決定を書き写すことになる（実装を証明しないテストになる）。

/** `tmbs/<key>.<ext>` の分解結果。null = 新たに `tmbs/` 配下へ作る（規則 K2） */
export interface ThumbnailKeyParts {
  fileKey: string;
  ext: string;
}

/** 置換の書き込み先。`copy512From` は 52px 単独置換のときに 512px を引き継ぐ元（任意） */
export interface BaseMapThumbnailTarget extends ThumbnailKeyParts {
  /**
   * 52px だけを置換するとき、512px の実体をこの 52px のパスから複製して
   * 書き込み先の 512px を用意する（元ファイルは読むだけで書き換えない）。
   * `thumbnail` が他者のファイルを指していたときだけ設定する。
   */
  copy512From?: string;
}

// 既存の規則 K1 の判定と同じ形。キーに `/` を含み得るため、この正規表現だけで
// パスの封じ込めを保証しない（書き込み側の sanitize が最終防壁）。
export const THUMBNAIL_KEY_PATTERN = /^tmbs\/(.+)\.([A-Za-z0-9]+)$/;

// copy512From には main の fs へ渡す相対パスを載せるため、入れ子パスを許さない。
const FLAT_TMBS_PATTERN = /^tmbs\/[^/]+\.[A-Za-z0-9]+$/;

/** `thumbnail` が `tmbs/<key>.<ext>` なら分解する。それ以外（同梱画像・URL・空）は null */
export function parseThumbnailKey(thumbnail: string | null | undefined): ThumbnailKeyParts | null {
  const match = THUMBNAIL_KEY_PATTERN.exec(thumbnail ?? "");
  return match ? { fileKey: match[1], ext: match[2] } : null;
}

/** `thumbnail` がこの文書自身の uid 名（`tmbs/<ownKey>.<ext>`）を指しているか */
export function isOwnThumbnail(thumbnail: string | null | undefined, ownKey: string): boolean {
  const parts = parseThumbnailKey(thumbnail);
  return parts !== null && parts.fileKey === ownKey;
}

export interface WriteTargetInput {
  /** 現在の `document.thumbnail` */
  thumbnail: string | null | undefined;
  /** この文書の uid（`BaseMapEdit.vue` の `iconFileKey()`） */
  ownKey: string;
  /** 規則 K0 のガードに使う slug */
  slug: string;
}

/**
 * 置換の書き込み先を決める（規則 K）。
 *
 *   K1（自分の uid 名）: `thumbnail` が `tmbs/<ownKey>.<ext>` を指しているなら、
 *     従来どおりそのキー・拡張子へ書く。ファイルは自分だけのもの。
 *   K1'（他者の名前・複製直後）: `thumbnail` が `tmbs/` 配下でも自分の uid 名でなければ、
 *     書き込み先を自分の uid 名へ切り替える。`thumbnail` は置換後に onPointerMoved で
 *     このキーへ付け替える。**複製元のファイルは一切書き換えない。**
 *   K2（同梱画像・URL・空）: 従来どおり自分の uid 名へ png で作る（slug 未入力なら K0 で null）。
 */
export function resolveBaseMapThumbnailWriteTarget(input: WriteTargetInput): BaseMapThumbnailTarget | null {
  const parts = parseThumbnailKey(input.thumbnail);
  // 従来の K1（規則 K）。自分の uid 名を指しているときは今までどおり thumbnail から採る。
  if (parts && parts.fileKey === input.ownKey) return parts;
  // 規則 K0: slug 未入力なら書かない（従来の K2 と同じガード）
  if (!parts && !input.slug) return null;
  const target: BaseMapThumbnailTarget = {
    // K1'（複製直後・旧 slug 名）も K2（同梱画像・URL・空）も、書き込み先は自分の uid 名。
    // 拡張子は K1' では複製元の thumbnail から引き継ぐ（merc 継承の .jpg などを保つ）。
    fileKey: input.ownKey,
    ext: parts?.ext ?? "png",
  };
  if (parts) {
    // 52px 単独置換でも、自分の uid 名の 512px が実体を持つように元の 512px を引き継ぐ。
    // 元ファイルは読むだけで書き換えない（main 側が存在しないときだけ複製する）。
    // 入れ子パスは main の fs へ渡さない（パスの封じ込めは書き込み側と二重に守る）。
    if (FLAT_TMBS_PATTERN.test(input.thumbnail ?? "")) target.copy512From = input.thumbnail ?? undefined;
  }
  return target;
}

export interface ForceDerive52Input {
  thumbnail: string | null | undefined;
  ownKey: string;
  exists52: boolean;
}

/**
 * 512px 置換のときに 52px の派生を強制するか（§6.5）。
 *
 * 従来の述語は「K1 かつ 52px の実体あり」のときだけ強制を外していた。しかし
 * `thumbnail` が他者のファイルを指している間は、52px の実体があっても**自分のものではない**。
 * その状態で derive OFF の 512px 単独置換を許すと、owner の 52px を参照したまま
 * 自分の 512px だけができる（指し先を自分の uid 名へ移すと 52px が欠ける）。
 * ∴ 強制を外すのは「自分の uid 名を指し、かつ実体がある」ときだけにする。
 */
export function shouldForceDerive52(input: ForceDerive52Input): boolean {
  const parts = parseThumbnailKey(input.thumbnail);
  return !(parts !== null && parts.fileKey === input.ownKey && input.exists52);
}
