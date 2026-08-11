// テキスト欄内の Cmd/Ctrl+Z を復活させるための振り分け (ユーザー報告 2026-07-11)。
// Electron の Edit メニューは Undo/Redo を CmdOrCtrl+Z アクセラレータ + カスタム click
// (main-process-message 'menu:undo'/'menu:redo') で実装しているため、アクセラレータが
// Chromium のネイティブ編集 undo を横取りし、アプリ内の全テキスト欄で文字入力の
// Cmd+Z が一切効かなくなっていた。
// 対策: renderer 側で「フォーカスが編集可能フィールドにあるときはネイティブ undo/redo を
// 実行」し (App.vue のグローバルリスナー)、各ビューのセッション undo (MapEdit/PoiEdit の
// menu:undo ハンドラ) は編集フィールド内では発動しないよう分岐する。

/** フォーカス中の要素がテキスト編集可能か (keydown 系の isInputTarget と同基準) */
export function isEditableElement(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return true;
  return el instanceof HTMLElement && el.isContentEditable;
}

/**
 * menu:undo / menu:redo をネイティブのテキスト undo/redo として処理する。
 * 編集可能フィールドにフォーカスがある場合のみ実行し true を返す (それ以外は false)。
 * document.execCommand は非推奨だが Electron/Chromium のフォーカス中編集要素に対しては
 * 現在も機能し、これが renderer 側から fields の undo スタックへ届く唯一の手段。
 */
export function handleMenuTextUndoRedo(message: string): boolean {
  if (message !== "menu:undo" && message !== "menu:redo") return false;
  if (!isEditableElement(document.activeElement)) return false;
  document.execCommand(message === "menu:undo" ? "undo" : "redo");
  return true;
}
