// POI ソースの slug 自動提案（M11-T10b: PoiSourceList から共有 util へ抽出。挙動不変）。
// import 時の fileName から slug 候補を作る。空になった場合は 'poi-source' にフォールバック。
export function suggestSlug(candidate: string): string {
  return (
    candidate
      .replace(/[\s.]+/g, "-")
      .replace(/[^A-Za-z0-9_-]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 100)
      .toLowerCase() || "poi-source"
  );
}
