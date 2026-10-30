// `<script>` の中へ埋める JSON。値の中の `<` を逃がして `</script>` や `<!--` で要素を閉じられないようにする。
// `<` は JSON でも JavaScript でも同じ文字なので、受け取る値は変わらない。
export function jsonForScript(value: unknown, space?: number): string {
  return JSON.stringify(value, null, space).replace(/</g, '\\u003c');
}
