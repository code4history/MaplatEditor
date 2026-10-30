import { ipc } from './registry';
import StorageAdapter from '../adapters/ElectronStorageAdapter';

export const registerAssetHandlers = () => {
    ipc.handle('asset:checkSlug', async (_event, payload: { slug: string; excludeUid?: string }) => {
        try {
            return await StorageAdapter.isSlugAvailable(payload.slug, payload.excludeUid);
        } catch (e) {
            console.error('Failed to handle asset:checkSlug', e);
            return false;
        }
    });
};
