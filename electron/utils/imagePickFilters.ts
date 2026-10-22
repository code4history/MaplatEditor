// 画像を選ぶダイアログの拡張子フィルタ。
//
// nov26-editor-splash-svg (#462): スプラッシュだけ **SVG も選べる**ようにする（人間の指示）。
//   なぜ分けるか: 他の経路（地図サムネイル・ベースマップのアイコン）は取り込みで
//   Jimp にデコードさせ、縮小・再符号化する。Jimp は SVG を読めないので、そこへ SVG を出すのは
//   「選ばせてから必ず失敗する形式をダイアログに並べる」ことになる（`assets-images.ts` の
//   `imageassets:pickImageFile` と同じ判断）。∴ 共通の集合は変えず、経路ごとに分ける。
//
// NOV26-IM-PWA-ICON-SOURCE-0481: PWA アイコンの元画像も **SVG を選べる**ようにする（人間の指示）。
//   「PWA アイコン用の画像」は 1 枚の元画像で、スプラッシュと同じく複製＋Chromium での描画に使う。
//   ここでも共通の IMAGE_FILTERS は変えない（地図サムネイル等は従来どおり Jimp）。
//
// electron に依存しない（node の smoke から直接読む。dialog には `filters:` としてそのまま渡せる）。
export type ImageFilter = { name: string; extensions: string[] };

/** 画像を取り込んで再符号化する経路のフィルタ（従来の集合。変えない） */
export const IMAGE_FILTERS: ImageFilter[] = [
  { name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] },
];

/** スプラッシュのフィルタ（複製するだけなので SVG も受け付ける） */
export const SPLASH_IMAGE_FILTERS: ImageFilter[] = [
  { name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] },
];

/**
 * PWA アイコンの元画像のフィルタ（NOV26-IM-PWA-ICON-SOURCE-0481）。
 * スプラッシュと同じく、拡張子の選択肢そのものに SVG を並べる（人間は拡張子を忘れがち）。
 * SVG は `svgSource` の検査を通して複製し、退避用の 512x512 PNG を Chromium で描く
 * （`AppAssetService.uploadPwaIcon`）。
 */
export const PWA_ICON_IMAGE_FILTERS: ImageFilter[] = [
  { name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] },
];
