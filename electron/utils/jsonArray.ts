// 「配列 または 配列をJSON化した文字列」を配列へ正規化する共通ヘルパ (Phase 7 M5)。
// AppPreviewService (プレビュー生成) と AppExportService (エクスポート出力) の
// document.pois / document.poiSources 読み出しを同一の正規化規則へ統一するために抽出した。
// 非配列の truthy 値 (文字列JSON等) も配列化を試み、失敗/非配列なら空配列を返す。
export function normalizeJsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}
