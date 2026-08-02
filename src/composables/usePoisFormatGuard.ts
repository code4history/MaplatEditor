// pois の判定とその帰結（表示配列・read-only・書き込み可否）を AppEdit / MapEdit で共有する
// （M4-T1）。受け入れ（生値温存）は acceptDocumentPois が担い、ここは「今の文書がどう扱われる
// べきか」を反応的に示す第2層である。
//
// なぜ computed か: 両画面とも履歴 undo/redo は受け入れ関所を通らない
// （AppEdit.vue の performUndo/performRedo, MapEdit.vue の restoreHistoryState）。
// 判定を ref への命令的代入で持つと、この経路で表示・read-only が実態とずれる。
// computed なら文書 ref の差し替えに自動追随するため、関所を通らない経路でも常に正しい。
import { computed, type ComputedRef } from "vue";
import { readAppDocumentPois } from "../utils/appPoisFormat";

export interface PoisFormatGuard {
  /** PoiReferenceEditor へ渡す表示用配列（未対応形式なら空配列） */
  pois: ComputedRef<unknown[]>;
  /** 未対応形式か（read-only と警告表示の条件） */
  unsupported: ComputedRef<boolean>;
  /** 書き込みを受け付けてよいか（未対応形式なら false） */
  acceptsWrite: () => boolean;
}

export function usePoisFormatGuard(
  getDocument: () => { pois?: unknown } | null | undefined,
): PoisFormatGuard {
  const read = computed(() => readAppDocumentPois(getDocument() ?? {}));
  return {
    pois: computed(() => read.value.pois),
    unsupported: computed(() => read.value.unsupported),
    acceptsWrite: () => !read.value.unsupported,
  };
}
