import { join, resolve } from 'node:path';

export type RuntimeStoragePaths = {
  isolated: boolean;
  saveFolder: string;
  settingsStoreCwd: string | undefined;
  assetDraftStoreCwd: string | undefined;
  // M12-T20 (§5.1): 下書きタイルの永続 staging 領域のルート。
  // isolated (E2E): <MAPLAT_E2E_ROOT>/draft-tiles / 非 isolated: 呼び出し側が
  // app.getPath('userData')/draft-tiles を既定値として渡す
  draftTileRoot: string;
};

export function resolveRuntimeStoragePaths(
  e2eRoot: string | undefined,
  defaultSaveFolder: string,
  defaultDraftTileRoot: string,
): RuntimeStoragePaths {
  if (!e2eRoot) {
    return {
      isolated: false,
      saveFolder: defaultSaveFolder,
      settingsStoreCwd: undefined,
      assetDraftStoreCwd: undefined,
      draftTileRoot: defaultDraftTileRoot,
    };
  }

  const root = resolve(e2eRoot);
  return {
    isolated: true,
    saveFolder: join(root, 'save-folder'),
    settingsStoreCwd: join(root, 'electron-store', 'settings'),
    assetDraftStoreCwd: join(root, 'electron-store', 'asset-drafts'),
    draftTileRoot: join(root, 'draft-tiles'),
  };
}
