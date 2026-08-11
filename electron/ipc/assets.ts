import { ipcMain } from 'electron';
import StorageAdapter from '../adapters/ElectronStorageAdapter';

export const registerAssetHandlers = () => {
    ipcMain.handle('asset:checkSlug', async (_event, payload: { slug: string; excludeUid?: string }) => {
        try {
            return await StorageAdapter.isSlugAvailable(payload.slug, payload.excludeUid);
        } catch (e) {
            console.error('Failed to handle asset:checkSlug', e);
            return false;
        }
    });
};
