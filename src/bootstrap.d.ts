/* Bootstrap 5 は npm パッケージに型定義を同梱しない（型は別途 @types/bootstrap）。
   本プロジェクトが利用する JS コンポーネント（Tooltip / Popover）の最小限の ambient 宣言。
   ContextHelp.vue が `import { Tooltip, Popover } from "bootstrap"` を strict/noImplicitAny で
   通すためのローカル shim。 */
declare module 'bootstrap' {
  interface TooltipOrPopoverOptions {
    title?: string;
    content?: string;
    placement?: 'top' | 'bottom' | 'left' | 'right' | 'auto';
    trigger?: string;
    html?: boolean;
    container?: string | Element | false;
  }

  export class Tooltip {
    constructor(element: Element, options?: TooltipOrPopoverOptions);
    show(): void;
    hide(): void;
    toggle(): void;
    dispose(): void;
  }

  export class Popover {
    constructor(element: Element, options?: TooltipOrPopoverOptions);
    show(): void;
    hide(): void;
    toggle(): void;
    dispose(): void;
  }
}
