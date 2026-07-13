export type EditorExportChoice = 'save' | 'saved' | 'cancel';
export type ExportDecisionResult = 'exported' | 'canceled' | 'save-failed';

export interface EditorExportDecisionOptions {
  dirty: boolean;
  hasSaved: boolean;
  choose: (hasSaved: boolean) => Promise<EditorExportChoice>;
  save: () => Promise<boolean>;
  exportSaved: () => Promise<boolean>;
}

export async function runEditorExportDecision(
  options: EditorExportDecisionOptions,
): Promise<ExportDecisionResult> {
  if (!options.dirty) {
    if (!options.hasSaved) return 'save-failed';
    return (await options.exportSaved()) ? 'exported' : 'canceled';
  }

  const choice = await options.choose(options.hasSaved);
  if (choice === 'cancel') return 'canceled';

  if (choice === 'saved') {
    if (!options.hasSaved) return 'canceled';
    return (await options.exportSaved()) ? 'exported' : 'canceled';
  }

  if (!(await options.save())) return 'save-failed';
  return (await options.exportSaved()) ? 'exported' : 'canceled';
}
