export type EditorSaveState = 'dirty' | 'saving' | 'saved' | 'draft-restored';

export const EDITOR_SAVE_STATE_META = {
  dirty: {
    key: 'editor_ui.save_state.dirty',
    className: 'text-warning',
  },
  saving: {
    key: 'editor_ui.save_state.saving',
    className: 'text-muted',
  },
  saved: {
    key: 'editor_ui.save_state.saved',
    className: 'text-success',
  },
  'draft-restored': {
    key: 'editor_ui.save_state.draft_restored',
    className: 'text-info',
  },
} as const satisfies Record<
  EditorSaveState,
  { key: string; className: string }
>;

export type DiagnosticSeverity = 'info' | 'success' | 'warning' | 'danger';
export type DiagnosticScope = 'field' | 'section' | 'operation';

export interface DiagnosticItem {
  key: string;            // v-for 用の安定キー
  severity: DiagnosticSeverity;
  message: string;        // 表示文字列（i18n 解決済み。生エラーメッセージ可）
}

export const DIAGNOSTIC_SEVERITY_ICON: Record<DiagnosticSeverity, string> = {
  info: 'bi-info-circle',
  success: 'bi-check-circle',
  warning: 'bi-exclamation-triangle',
  danger: 'bi-exclamation-octagon',
};
