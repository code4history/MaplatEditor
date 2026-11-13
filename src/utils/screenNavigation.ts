// 画面遷移の「戻る」の意図を、遷移先の画面が初期化で読み取れるように一回だけ渡す札。
//
// 一覧のスクロール位置や検索条件の復元は「戻るボタンで戻ったとき」にだけ行う。
// それ以外の画面移動（hash 書き換え・タブ・カードの遷移）では新しい画面を先頭から
// 表示するため、遷移の意図をここで明示的に渡す。渡されなければ先頭表示になる。
let returnMarked = false;

export function markScreenReturn(): void {
  returnMarked = true;
}

export function consumeScreenReturn(): boolean {
  const marked = returnMarked;
  returnMarked = false;
  return marked;
}
