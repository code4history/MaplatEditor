// app document の pois 復元 heal (Phase 8 Task 2, バグ①根治)。
// 旧 AppEdit は poiSources (JSON 文字列) を normalize のたびに JSON.stringify し直していたため、
// 保存⇄読込の往復ごとにエスケープが一段深くなる多重 stringify 破損が data_json に残っている。
// ここでは value.pois (配列) を優先し、文字列は bounded ループで
// 「parse 結果が文字列なら再 parse」して配列に復元する。どうしても配列にならなければ
// 復元失敗 (failed: true) を呼び出し側へ伝える (data_json 自体は書き換えないため破壊はしない —
// 次回保存で治るが、失敗時は画面上で警告する。Phase 8 品質レビュー MAJOR-2)。
// 保存形は pois 配列のみ (poiSources 文字列は二度と書かない)。

// 各 reparse step は JSON.parse で「一段外側の stringify エスケープを剥がす」だけなので、
// 文字列長は毎回厳密に減少する (エスケープが増えるほど元の文字列は長くなる一方であり、
// 復元方向はその逆操作のため)。よって深さに関わらずいずれ配列化するか parse 失敗で止まり、
// 無限ループにはなり得ない。MAX_REPARSE_DEPTH は再帰爆発を防ぐためではなく、
// 万一想定外の壊れたデータに当たった場合の安全弁 (異常終了を早める) として設けてある
const MAX_REPARSE_DEPTH = 100;

// 「配列 or 多重 stringify された配列文字列」を配列へ復元する。復元不能は null。
// 空文字列も復元失敗 (null) として扱う (MINOR-4: 空文字列を「復元成功した空配列」と
// 区別できないと、多重 stringify 破損で偶然 "" になったケースを黙って正常扱いしてしまう。
// 呼び出し側 (healAppDocumentPois) で poiSources へのフォールバックに回す)
export function healPoisValue(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return null;
  if (value.trim() === "") return null;
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
// どちらも復元不能なら pois: [] + failed: true を返す (呼び出し側で UI 警告を出す)。
// pois/poiSources のいずれも元々未設定 (null/undefined) なら「復元失敗」ではないので failed: false
export function healAppDocumentPois(value: {
  pois?: unknown;
  poiSources?: unknown;
}): { pois: unknown[]; failed: boolean } {
  const fromPois = healPoisValue(value.pois);
  if (fromPois) return { pois: fromPois, failed: false };
  const fromLegacy = healPoisValue(value.poiSources);
  if (fromLegacy) return { pois: fromLegacy, failed: false };
  const hadData = value.pois != null || value.poiSources != null;
  if (hadData) {
    console.warn(
      "[AppEdit] Failed to restore the pois array from the stored document; starting empty (stored data_json is left untouched)",
    );
  }
  return { pois: [], failed: hadData };
}
