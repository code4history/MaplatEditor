import Store from 'electron-store';

interface MinimalAppDraft {
  metadata?: {
    appId?: string;
    title?: string;
    description?: string;
    lang?: string;
  };
  selectedMap?: {
    kind: "registered-map";
    runtimeMapId: string;
    catalogKey: string;
  };
  cachedTitle?: string;
  cachedStatus?: string;
  selectedBaseMaps?: Array<{
    kind: "registered-base-map";
    mapID: string;
    scope: "builtin" | "user";
    role: "base" | "overlay";
    title?: string;
    opacity?: number;
    visible?: boolean;
    data?: any;
  }>;
  selectedPoiSources?: Array<{
    kind: "registered-poi-source";
    sourceId: string;
    catalogKey: string;
    mode: string;
    cachedTitle?: string;
  }>;
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
