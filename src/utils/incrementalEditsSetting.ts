/**
 * 設定 incrementalEdits（三角網の差分更新。MaplatTin#100）の正規化。読み書きの両方が通る。
 *
 * 既定は切。electron-store の実体は利用者が編集できる JSON なので、明示の true（と文字列の 'true'）だけを「入れる」にし、
 * それ以外（未設定を含む）は切にする。updateCheckEnabled（既定は入）とは、既定の向きが逆。
 */
export function normalizeIncrementalEdits(value: unknown): boolean {
  return value === true || value === 'true';
}
