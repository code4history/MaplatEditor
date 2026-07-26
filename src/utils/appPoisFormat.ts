// app document の pois 形式判定（M12-T30、sp-0006 準拠）。
// 旧 src/utils/poiSourcesHeal.ts は「多重 stringify 破損の bounded reparse 復元」+
// 「poiSources (JSON 文字列の旧 Editor 内部表現) へのフォールバック復元」を持っていたが、
// いずれも 2026-07-02 (d234ce8) の実装ミス（normalize のたびに JSON.stringify し直していた）の
// 後始末であり、viewer 正本 (MaplatCore/src/normalize_pois.ts) が実際に受容する過去の正規形式の
// 翻訳ではなかった。書き込み側は既に修正済み（AppEdit.vue の保存経路は pois 配列をそのまま
// 永続化し、poiSources 文字列を二度と書かない）ため、読み込み側での復元は不要かつ sp-0006 に抵触する。
//
// ここでは「復元」ではなく「形式判定」のみを行う（文字列の再パースは一切行わない）。
// editor 正準形は pois が配列であることのみ。それ以外（文字列・object・poiSources 残存）は
// unsupported として呼び出し側へ通知し、呼び出し側は生値を温存 (黙って消えない原則, m3-t6 §5.8
// H-5(d)) した上で read-only 表示に倒す。レイヤ名キー object 形 ({main: layer, id1: layer}) の
// 正規取り込み化は別タスク (m12-t28) の責務であり、本関数では引き続き unsupported として扱う。
export function readAppDocumentPois(value: { pois?: unknown; poiSources?: unknown }): {
  pois: unknown[];
  unsupported: boolean;
} {
  if (Array.isArray(value.pois)) {
    return { pois: value.pois, unsupported: false };
  }
  if (value.pois == null && value.poiSources == null) {
    return { pois: [], unsupported: false };
  }
  return { pois: [], unsupported: true };
}
