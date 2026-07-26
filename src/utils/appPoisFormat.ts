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
// 呼び出し側へ通知し、呼び出し側は生値を温存 (黙って消えない原則, m3-t6 §5.8 H-5(d)) した上で
// read-only 表示に倒す。レイヤ名キー object 形 ({main: layer, id1: layer}) の正規取り込み化は
// 別タスク (m12-t28) の責務であり、本関数では引き続き unsupported として扱う。
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
