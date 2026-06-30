import Store from 'electron-store';

interface MinimalAppDraft {
  selectedMap: {
    kind: "registered-map";
    runtimeMapId: string;
    catalogKey: string;
  };
  cachedTitle?: string;
  cachedStatus?: string;
}

interface AppDraftStore {
  appDraft: MinimalAppDraft | null;
}

class AppDraftService {
  private store: Store<AppDraftStore>;

  constructor() {
    this.store = new Store<AppDraftStore>({ defaults: { appDraft: null } });
  }

  save(draft: MinimalAppDraft | null): void {
    this.store.set('appDraft', draft);
  }

  load(): MinimalAppDraft | null {
    return this.store.get('appDraft') ?? null;
  }
}

export default new AppDraftService();
