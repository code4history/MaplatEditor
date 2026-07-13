import { ipcMain } from 'electron';
import AssetDraftService from '../services/AssetDraftService';
import { validateAssetDraftEnvelope } from '../../src/services/assetDraftStore';
import type { AssetDraftEnvelope, AssetDraftKind } from '../../src/types/assetDraft';

export function registerAssetDraftHandlers(): void {
  ipcMain.handle('asset-drafts:put', async (_event, draft: AssetDraftEnvelope) => {
    await AssetDraftService.put(draft);
  });
  ipcMain.handle('asset-drafts:get', async (_event, kind: AssetDraftKind, assetUid: string) =>
    AssetDraftService.get(kind, assetUid));
  ipcMain.handle('asset-drafts:remove', async (_event, kind: AssetDraftKind, assetUid: string) => {
    await AssetDraftService.remove(kind, assetUid);
  });
  ipcMain.handle('asset-drafts:list', async (_event, kind?: AssetDraftKind) =>
    AssetDraftService.list(kind));

  ipcMain.on('asset-drafts:flush-sync', (event, draft: AssetDraftEnvelope) => {
    try {
      validateAssetDraftEnvelope(draft);
      void AssetDraftService.put(draft);
      event.returnValue = { ok: true };
    } catch (error) {
      event.returnValue = { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}
