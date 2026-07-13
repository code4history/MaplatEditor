import Store from 'electron-store';
import { AssetDraftStore } from '../../src/services/assetDraftStore';
import { resolveRuntimeStoragePaths } from './runtimeStoragePaths';
import { app } from 'electron';
import path from 'node:path';

const runtimeStoragePaths = resolveRuntimeStoragePaths(
  process.env.MAPLAT_E2E_ROOT,
  path.join(app.getPath('documents'), app.getName()),
);
const store = new Store<Record<string, unknown>>(
  runtimeStoragePaths.assetDraftStoreCwd ? { cwd: runtimeStoragePaths.assetDraftStoreCwd } : {},
);

export default new AssetDraftStore(store);
