import { join, resolve } from 'node:path';

export type RuntimeStoragePaths = {
  isolated: boolean;
  saveFolder: string;
  settingsStoreCwd: string | undefined;
  assetDraftStoreCwd: string | undefined;
};

export function resolveRuntimeStoragePaths(
  e2eRoot: string | undefined,
  defaultSaveFolder: string,
): RuntimeStoragePaths {
  if (!e2eRoot) {
    return {
      isolated: false,
      saveFolder: defaultSaveFolder,
      settingsStoreCwd: undefined,
      assetDraftStoreCwd: undefined,
    };
  }

  const root = resolve(e2eRoot);
  return {
    isolated: true,
    saveFolder: join(root, 'save-folder'),
    settingsStoreCwd: join(root, 'electron-store', 'settings'),
    assetDraftStoreCwd: join(root, 'electron-store', 'asset-drafts'),
  };
}
