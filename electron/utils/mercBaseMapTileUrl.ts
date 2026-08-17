// m22-t1: merc ベースマップの実行時タイル URL（url_）の導出。
//
// なぜ必要か（設計書 §2）:
//   merc ベースマップは data_json に url: '' で保存される（MapEdit.vue の merc 登録が
//   常に空文字を書く）。タイルの実体は {saveFolder}/merc/{baseMapUid}/{z}/{x}/{y}.png にある
//   （ADR-0016）。url から実体へ至る解決は書き出し側・プレビュー側にしか無く、
//   エディタ内で背景を描く経路（MapEdit / PoiEditMap の mapSourceFactory）には無い。
//   空の url は MaplatCore/src/source_ex.ts が tiles/{mapID}/{z}/{x}/{y}.jpg へ自動補完するため、
//   ディレクトリも拡張子も違う宛先を要求して 404 になり、無表示のまま静かに終わる。
//
// なぜ deriveRuntimeTileUrl（runtimeTileUrl.ts）を再利用しないか（設計書 §2.1 C）:
//   同関数は tiles/<uid>/0/0 を開いて 0.(jpg|jpeg|png) を探すが、merc の minZoom は
//   maxZoom - ceil(log2(minSide/256)) で実スキャン地図では 12〜16 になり、ズーム 0 のタイルは
//   生成されない ∴ undefined を返し、undefined は「url 空」に落ちて上述の誤補完へ黙って戻る。
//
// なぜ I/O が要らないか（設計書 §2.1 A・B）:
//   merc のタイルは常に .png である（WmtsGeneratorService の maxZoomTileLoop /
//   upperZoomTileLoop の両方が無条件に ${y}.png を書き、merc/{uid}/tilejson.json も
//   tiles: ['{z}/{x}/{y}.png'] を宣言する）∴ 拡張子を探索する必要がない。
//   minZoom / maxZoom は data に既にある ∴ tilejson.json も読まない。
//   一覧取得のたびに行数ぶんの I/O が増えることがない。
//
// electron を import しない（smoke から node --experimental-strip-types で直接 import できる
// ことが前提。既存前例: electron/utils/releaseChannel.ts を
// scripts/m19-t4a-settings-menu-about-smoke.mjs が直接 import している）。
import path from 'node:path';
import fileUrl from 'file-url';

/**
 * merc ベースマップの実行時専用タイル URL（url_）を組み立てる。
 *
 * 名前空間の注意（設計書 §3.5）: 保存フォルダ上の実体は merc/{baseMapUid}/ であり
 * （ADR-0016）、書き出し／プレビューが使う merc/{現在 slug}/ ではない。本関数は
 * ファイルシステムを直に引くため **uid 側が正しい**。書き出し側の慣習（slug）を写すと、
 * tiles/{slug}/… を merc/{slug}/… に替えただけの同じ誤りを別の場所に作ることになる。
 *
 * 失敗時に空文字を返さない（上位設計の受け入れ条件）。空文字を url_ として立てると
 * mapSourceFactory の誤補完へ黙って戻るため、undefined を返し呼び出し側はキーごと省く。
 *
 * @param data        ベースマップの data（data_json 相当）。kind のみ参照する
 * @param baseMapUid  ベースマップの uid（ADR-0007 の正準キー）
 * @param saveFolder  保存フォルダの絶対パス（SettingsService の 'saveFolder'）
 */
export function deriveMercBaseMapTileUrl(
  data: { kind?: string } | null | undefined,
  baseMapUid: string | undefined,
  saveFolder: string | undefined,
): string | undefined {
  // 条件は kind === 'merc'（設計書 §4.6）。「url が空」を条件にすると、
  // 利用者が URL を空にしただけの tms 種別にも作用してしまう。
  if (data?.kind !== 'merc') return undefined;
  if (!baseMapUid || !saveFolder) return undefined;
  // file-url は file:///... 形式を返し、空白や非 ASCII を percent-encoding する
  // （保存フォルダに空白・非 ASCII を含む環境。deriveRuntimeTileUrl が同じ理由で同じ
  // ライブラリを使っている）。テンプレート部は後置のため無加工で残る。
  return `${fileUrl(path.join(saveFolder, 'merc', baseMapUid))}/{z}/{x}/{y}.png`;
}
