// app document の pois 復元 heal (Phase 8 Task 2, バグ①根治)。
// 旧 AppEdit は poiSources (JSON 文字列) を normalize のたびに JSON.stringify し直していたため、
// 保存⇄読込の往復ごとにエスケープが一段深くなる多重 stringify 破損が data_json に残っている。
// ここでは value.pois (配列) を優先し、文字列は bounded ループ (最大5回) で
// 「parse 結果が文字列なら再 parse」して配列に復元する。どうしても配列にならなければ
// 空配列 + console.warn (data_json 自体は書き換えないため破壊はしない — 次回保存で治る)。
// 保存形は pois 配列のみ (poiSources 文字列は二度と書かない)。

const MAX_REPARSE_DEPTH = 5;

// 「配列 or 多重 stringify された配列文字列」を配列へ復元する。復元不能は null
export function healPoisValue(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return null;
  if (value.trim() === "") return []; // 空文字列は「未設定」扱い (旧 defaultApp の "[]" 同等)
  let current: unknown = value;
  for (let depth = 0; depth < MAX_REPARSE_DEPTH && typeof current === "string"; depth++) {
    try {
      current = JSON.parse(current);
    } catch {
      return null;
    }
    if (Array.isArray(current)) return current;
  }
  return null;
}

// app document から pois 配列を復元する。pois (新形) 優先、poiSources (旧文字列形) は fallback。
// どちらも復元不能なら [] + console.warn (存在しない場合は warn なしで [])
export function healAppDocumentPois(value: { pois?: unknown; poiSources?: unknown }): unknown[] {
  const fromPois = healPoisValue(value.pois);
  if (fromPois) return fromPois;
  const fromLegacy = healPoisValue(value.poiSources);
  if (fromLegacy) return fromLegacy;
  if (value.pois != null || value.poiSources != null) {
    console.warn(
      "[AppEdit] Failed to restore the pois array from the stored document; starting empty (stored data_json is left untouched)",
    );
  }
  return [];
}
