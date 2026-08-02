// app document の pois 形式判定（M12-T30、sp-0006 準拠）。
// 撤去済みの旧 heal ユーティリティ（bounded reparse ループによる多重 stringify 破損の復元）は、
// 旧 Editor が d234ce8 (2026-07-02) で発明した JSON 文字列の内部表現へのフォールバック復元も
// 持っていたが、いずれも normalize のたびに JSON.stringify し直していた実装ミスの後始末であり、
// viewer 正本 (MaplatCore/src/normalize_pois.ts) が実際に受容する過去の正規形式の翻訳ではなかった。
// 書き込み側は既に修正済み（AppEdit.vue の保存経路は pois 配列をそのまま永続化する）ため、
// 読み込み側での復元は不要かつ sp-0006 に抵触する。
//
// ここでは「復元」ではなく「形式判定」のみを行う（文字列の再パースは一切行わない）。
// editor 正準形は pois が配列であることのみ。それ以外（文字列・object）は unsupported として
// 扱い、生値を温存 (黙って消えない原則, m3-t6 §5.8 H-5(d)) した上で read-only 表示に倒す。
// 温存を含む「受け入れ」は下の acceptDocumentPois が担い、AppEdit / MapEdit の両画面が
// この1本を通る (M4-T1)。
//
// レイヤ名キー object 形 ({main: layer, id1: layer}) は normalizeLayers (MaplatCore) の
// 出力＝ビューア内部形式であり、設定ファイル形式ではない (実データ0件・m4 マイルストーン設計 §1.2
// で確認)。恒久的に unsupported として扱う。M12-T30 当時のコメントは「正規取り込み化は別タスク
// (m12-t28) の責務」としていたが、m4 の再定義でその前提は失われた。
//
// 旧 Editor 発明の内部表現は人間が導入したフィールドではなく viewer 正本にも一切登場しないため、
// M12-T30 v1.2（sp-0007・恒久指示）により「存在しないものとして扱う」。本関数はそのフィールドを
// 一切参照しない（パラメータからも削除済み）。
export function readAppDocumentPois(value: { pois?: unknown }): {
  pois: unknown[];
  unsupported: boolean;
} {
  if (Array.isArray(value.pois)) {
    return { pois: value.pois, unsupported: false };
  }
  if (value.pois == null) {
    return { pois: [], unsupported: false };
  }
  return { pois: [], unsupported: true };
}

/**
 * pois 受け入れの唯一の関所（M4-T1）。外部（DB / ファイル / 複製元）から来た文書を
 * 編集状態へ取り込むとき、AppEdit / MapEdit の両画面ともこの関数を通す。
 *
 * - 配列（editor 正準形）      → そのまま target へ（**同一参照で素通しする**）
 * - 未設定（null / undefined） → target に pois キーを作らない（元に無いキーを生やさない）
 * - それ以外（未対応形式）      → **生値をそのまま温存する**（黙って消えない原則）
 *
 * target と incoming が同一オブジェクトでも安全（冪等）。将来 target 側に正規化が
 * 入っても、温存はこの関数が引き受けるため壊れない — 「たまたま生代入だから残っている」
 * ではなく、この1本を通ることが温存の保証である。
 */
export function acceptDocumentPois<T extends { pois?: unknown }>(
  target: T,
  incoming: { pois?: unknown },
): T {
  const read = readAppDocumentPois(incoming);
  if (incoming.pois == null) {
    delete (target as { pois?: unknown }).pois;
  } else if (read.unsupported) {
    (target as { pois?: unknown }).pois = incoming.pois;
  } else {
    (target as { pois?: unknown }).pois = read.pois;
  }
  return target;
}
