// ランタイム専用タイルURL（url_）の導出（m5-t3）。
//
// なぜ切り出したか（設計書 §2.1 / §3.1）:
//   同じ導出が MapEditService.normalizeRequestData と DataUploadService.extractZip の2箇所にあり、
//   互いに異なる挙動をしていた。DataUploadService 側は
//     - json.url を完全に無視する（利用者が指定した交換形のタイルURLを踏み倒す）
//     - file:// を手組みするため percent-encoding されない
//       (保存フォルダのパスに空白や非 ASCII を含む環境で MapEditService 側と別の URL になる)
//     - 置換の正規表現に末尾アンカーが無く、最初の一致を置換する
//   という3点で劣っていた。DataUploadService.ts:74 のコメントが自ら「原版の
//   normalizeRequestData 相当」と名乗っているとおり、これは意図された分岐ではなく
//   移植時に本体を呼ばずに書き写した結果である。∴ 本関数への統一は元の設計意図への回帰である。
//
// 何を含み、何を含まないか:
//   含む   = url_ の決定そのもの（json.url 優先 → 内部タイルからの組み立て）
//   含まない = whReady ガードと store2HistMap の呼び出し。これらは呼び出し側の関心事であり、
//              混ぜると extractZip の { mapData, tins } 契約を意図せず変えてしまう（設計書 §2.6）
import path from 'node:path';
import fs from 'fs-extra';
import fileUrl from 'file-url';

/**
 * ランタイム専用のタイルURL（url_）を決定する。
 *
 * 交換形の url が指定されていればそれを採用し（不変条件 I-1: url は利用者が指定する
 * タイルURLテンプレート）、無ければ内部タイル tiles/<uid>/0/0 の実体から組み立てる。
 * どちらも得られない場合は undefined を返す（呼び出し側は url_ を設定しない）。
 *
 * @param json        地図データ。url のみ参照する（store 形式・交換形 JSON いずれも可）
 * @param thumbFolder 内部タイルの 0/0 ディレクトリ絶対パス（tiles/<uid>/0/0）
 */
export async function deriveRuntimeTileUrl(
  json: { url?: string } | null | undefined,
  thumbFolder: string,
): Promise<string | undefined> {
  if (json?.url) return json.url;

  try {
    if (await fs.pathExists(thumbFolder)) {
      const thumbs = await fs.readdir(thumbFolder);
      const tileFile = thumbs.find((f) => /^0\.(jpg|jpeg|png)$/.test(f));
      if (tileFile) {
        // file-url は file:///... 形式を返し、空白や非 ASCII を percent-encoding する。
        // 末尾の /0/0/0.<ext> だけを /{z}/{x}/{y}.<ext> へ置換する（アンカー必須:
        // アンカーが無いとパス途中の /0/0/0. を誤置換し得る）
        const thumbURL = fileUrl(path.join(thumbFolder, tileFile));
        return thumbURL.replace(/\/0\/0\/0\.(jpg|jpeg|png)$/, '/{z}/{x}/{y}.$1');
      }
    }
  } catch (e) {
    // 旧 MapEditService と同じく握り潰して undefined 扱いにする（タイル未配置は正常系）
    console.error('[runtimeTileUrl] タイル検索エラー:', e);
  }
  return undefined;
}
