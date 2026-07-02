import type { SelectedRegisteredMapRef, RegisteredMapStatus } from "../services/registeredMapCatalog";
import type { SelectedPoiSourceRef } from "../services/registeredPoiSourceCatalog";

export interface AppMetadata {
  appId?: string;
  title?: string;
  description?: string;
  lang?: string;
}

export interface BaseMapCatalogItem {
  mapID: string;
  scope: "builtin" | "user";
  data: any;
}

export interface SelectedBaseMapRef {
  kind: "registered-base-map";
  mapID: string;
  scope: "builtin" | "user";
  role: "base" | "overlay";
  title?: string;
  opacity?: number;
  visible?: boolean;
  data?: any;
}

export interface MinimalAppDraft {
  metadata?: AppMetadata;
  selectedMap?: SelectedRegisteredMapRef;
  cachedTitle?: string;
  cachedStatus?: RegisteredMapStatus;
  selectedBaseMaps?: SelectedBaseMapRef[];
  selectedPoiSources?: SelectedPoiSourceRef[];
}

async function saveDraft(draft: MinimalAppDraft): Promise<void> {
  // Vue の reactive proxy は Electron IPC で正しくシリアライズされないため、
  // プレーンオブジェクトに変換してから送信する
  const plain = JSON.parse(JSON.stringify(draft));
  await (window as any).appdraft.save(plain);
}

async function loadDraft(): Promise<MinimalAppDraft | null> {
  try {
    const draft = await (window as any).appdraft.load();
    if (draft && !draft.selectedPoiSources) {
      draft.selectedPoiSources = [];
    }
    if (draft && !draft.selectedBaseMaps) {
      draft.selectedBaseMaps = [];
    }
    if (draft && !draft.metadata) {
      draft.metadata = {};
    }
    return draft;
  } catch (e) {
    console.warn("[useAppDraft] Failed to load draft, starting fresh:", e);
    return null;
  }
}

async function clearDraft(): Promise<void> {
  await (window as any).appdraft.save(null);
}

export function useAppDraft() {
  return { saveDraft, loadDraft, clearDraft };
}
