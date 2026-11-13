import type { Router } from "vue-router";
import { consumeScreenReturn, markScreenReturn } from "./screenNavigation";

// 編集画面から一覧へ戻る（m12-t31）。
// 直前履歴が listPath で始まるならそのフルパスへ push（?q=/bbox= 等のクエリ保持 → backCache 復元が発火）。
// それ以外（直接編集画面を開いた等）は一覧の素のパスへ push フォールバック。
// 【禁止】ここでは「履歴を1つ戻る」系の操作（Vue Router・window.history いずれの API でも）を
// 使ってはならない: preview iframe 内の Maplat viewer (@maplat/ui 同梱の page.js hashbang
// ルータ) が joint session history にエントリを積み、そうした操作は top のルートに届かず
// iframe 側のエントリだけを移動させてしまう（iframe 破棄後も残存エントリで無反応になる）。
// 一覧への遷移は必ずこの router.push 呼び出し一本に統一すること。
export async function navigateBackToList(router: Router, listPath: string): Promise<void> {
  const back = router.options.history.state.back;
  // 戻るボタンでの帰還であることを一覧側に渡す（戻るときだけ位置と条件を復元する）
  markScreenReturn();
  try {
    const failure = await router.push(typeof back === "string" && back.startsWith(listPath) ? back : listPath);
    // 到達しなかった（別の遷移に取り消された等）ときは、戻りの札を次の画面へ持ち越さない
    if (failure) consumeScreenReturn();
  } catch {
    consumeScreenReturn();
  }
}
