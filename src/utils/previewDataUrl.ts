/**
 * previewDataUrl.ts — main が返した一次画像のバイト列を `<img src>` に渡せる URL にする（renderer 専用）。
 *
 * なぜ `data:` か:
 *   CSP（`electron/utils/appScheme.ts` の RENDERER_CSP）の `img-src` は `data:` を許可済みだが
 *   `blob:` を許可していない。`URL.createObjectURL` の URL は `<img>` で表示できないため、
 *   CSP を書き換えずに済む `data:` URL を使う（設計書 §3.5 / §4.2）。
 *
 * なぜ Blob + FileReader でなく直接 base64 か:
 *   変換は「バイト列 → data URL」の 1 手だけであり、Blob を挟むと (a) 20 MB のコピーが
 *   もう 1 回増え、(b) FileReader の無い環境（smoke の node）で検証できない。
 *   純関数にして smoke から直接呼べることを優先する。
 */

const CHUNK = 0x8000;

/** バイト列 → `data:<mime>;base64,<...>`。mime が空なら `application/octet-stream` にする。 */
export function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  const type = mime && mime.trim() ? mime.trim() : "application/octet-stream";
  // String.fromCharCode(...spread) は引数上限に当たるためチャンクで継ぐ
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
  }
  return `data:${type};base64,${btoa(binary)}`;
}
