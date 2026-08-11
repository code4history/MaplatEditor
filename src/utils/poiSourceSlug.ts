// POI ソースの slug 自動提案（M11-T10b: PoiSourceList から共有 util へ抽出）。
// import 時の fileName から slug 候補を作る。空になった場合は fallback (既定 'poi-source')。
// M3-T6 (§6.3): 先頭に NFKD 正規化 + 拡張子除去 (最後の 1 つのみ) を追加し、Asset 側局所実装との
// 非対称 (foo.zip → foo-zip) を解消した。AssetEdit からは前処理つき
// suggestSlug(name.normalize("NFKD").replace(/[^A-Za-z0-9._\s-]+/g, "-"), "") で呼び、
// 記号ラン → ハイフン置換の局所挙動を保存する (方針 (i)。同値性は smoke:m3-t6 Part A4 で表駆動検証)。
export function suggestSlug(candidate: string, fallback = "poi-source"): string {
  return (
    candidate
      .normalize("NFKD")
      .replace(/\.[^.]+$/, "")
      .replace(/[\s.]+/g, "-")
      .replace(/[^A-Za-z0-9_-]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 100)
      .toLowerCase() || fallback
  );
}
