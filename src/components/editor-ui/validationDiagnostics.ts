// M11-T10: validation error code → field 診断(danger)の共通変換。
// master-detail エディタ(BaseMapEdit/AssetEdit)が code→i18nキー表と対象codeの
// 絞り込みで field 診断を組み立てる処理を一元化する(全項目を即時表示、dirtyゲートなし)。
import type { DiagnosticItem } from "./editorUiTypes";

export function validationFieldDiagnostics(
  errors: readonly string[],
  messageKeys: Record<string, string>,
  t: (key: string) => string,
  codes: readonly string[],
): DiagnosticItem[] {
  return errors
    .filter((code) => codes.includes(code))
    .map((code) => ({ key: code, severity: "danger" as const, message: t(messageKeys[code]) }));
}
