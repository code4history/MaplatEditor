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
