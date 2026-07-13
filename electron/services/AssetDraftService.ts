import Store from 'electron-store';
import { AssetDraftStore } from '../../src/services/assetDraftStore';

const store = new Store<Record<string, unknown>>();

export default new AssetDraftStore(store);
