// m19-t2: 512px サムネイルのパス派生を単一関数へ集約する（マイルストーン設計 v1.6 §4.3.2-3）。
//
// 【不変条件 INV-T】（タスク設計 §6.2.1）
//   `thumbnail`（ベースマップの文書属性 / 地図の uid 規約パス）は **常に 52px サムネイルの所在**である。
//   512px の所在は thumb512PathFor(thumbnail) からのみ導く。
//   512px パスを thumbnail 側へ書き戻すと (a) 二重適用で `_512_512` になり、
//   (b) 書き出しの uuid 一致（AppExportService の /^tmbs\/([0-9a-f-]{36})\.…$/）から外れて
//   viewer 向け出力に uid 名が漏れる（ADR-0007 の export 契約違反）。
//
// 本モジュールは副作用なし・Node 依存なしの純関数のみを持つ。
// main（electron/）と renderer（src/）の双方から同一実体を import するため、
// `path` を使わず文字列操作だけで実装している。

/**
 * 512px 側の符号化形式。null = 入力の拡張子を引き継ぐ（現行）。
 *
 * m19-t5（サムネイルの webp 化）は **この 1 定数を 'webp' へ変えるだけ**で全経路が webp 化する。
 * 52px 側との非対称（52px は現行形式のまま）はここで吸収される。
 */
export const THUMB_512_EXT: string | null = null;

const BASEMAP_ICONS_PREFIX = 'basemap_icons/';
const BASEMAP_ICONS_512_PREFIX = 'basemap_icons_512/';

/** 拡張子の決定。THUMB_512_EXT が非 null ならそちらで置き換える。 */
function withThumb512Ext(stem: string, sourceExt: string): string {
  return `${stem}.${THUMB_512_EXT ?? sourceExt}`;
}

/**
 * 52px サムネイルの相対パスから 512px の相対パスを導く**唯一の**関数。
 *
 *  - `tmbs/<name>.<ext>`          -> `tmbs/<name>_512.<ext>`          （接尾辞規則）
 *  - `basemap_icons/<name>.<ext>` -> `basemap_icons_512/<name>.<ext>` （ディレクトリ差替え規則）
 *  - それ以外                      -> `null`
 *
 * THUMB_512_EXT が非 null のときは、いずれの規則でも拡張子をその値へ置き換える。
 *
 * ディレクトリ差替え規則は「ビルトインカタログが持つ 512px の明示属性」と同値であることが
 * 機械的に証明済みである（smoke S1: ビルトイン全件で 派生 === 明示属性、不一致 0）。
 * ∴ **エディタは当該明示属性を読まない**。明示属性は書き出し・viewer 向けの
 * 出力契約としてカタログ側に据え置く（二重分岐を作らない）。
 *
 * 注意: ユーザー作成文書（kind = google / mapbox / maplibre）の既定 thumbnail も
 * `basemap_icons/*.png` を指すが、それらは当該明示属性を持てない（文書スキーマに無い）。
 * ディレクトリ差替え規則はこのケースも同じ式で解決するために要る。
 */
export function thumb512PathFor(thumbnailRelPath: string): string | null {
  if (typeof thumbnailRelPath !== 'string') return null;
  const rel = thumbnailRelPath.trim();
  if (!rel) return null;

  if (rel.startsWith(BASEMAP_ICONS_PREFIX)) {
    const match = /^basemap_icons\/(.+?)\.([A-Za-z0-9]+)$/.exec(rel);
    if (!match) return null;
    return withThumb512Ext(`${BASEMAP_ICONS_512_PREFIX}${match[1]}`, match[2]);
  }

  const match = /^(tmbs\/.+?)\.([A-Za-z0-9]+)$/.exec(rel);
  if (!match) return null;
  return withThumb512Ext(`${match[1]}_512`, match[2]);
}

/**
 * 52px サムネイルの相対パス。`ext` は呼び出し元が現況から与える。
 *  - 地図: `'jpg'`（uid 規約）
 *  - ベースマップ: `document.thumbnail` の実拡張子（`.png` 固定ではない。merc 継承は `.jpg` を作る）
 *
 * `fileKey` の正規化（sanitize）は呼び出し元の責務である（書き込み側の AppAssetService が行う）。
 */
export function thumb52PathFor(fileKey: string, ext: string): string {
  return `tmbs/${fileKey}.${ext}`;
}
