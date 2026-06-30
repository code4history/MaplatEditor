import type { SelectedRegisteredMapRef, RegisteredMapStatus } from "../services/registeredMapCatalog";

interface MinimalAppDraft {
  selectedMap: SelectedRegisteredMapRef;
  cachedTitle?: string;
  cachedStatus?: RegisteredMapStatus;
}

async function saveDraft(
  ref: SelectedRegisteredMapRef,
  title?: string,
  status?: RegisteredMapStatus,
): Promise<void> {
  const draft: MinimalAppDraft = {
    selectedMap: ref,
    ...(title !== undefined && { cachedTitle: title }),
    ...(status !== undefined && { cachedStatus: status }),
  };
  await (window as any).appdraft.save(draft);
}

async function loadDraft(): Promise<MinimalAppDraft | null> {
  try {
    return await (window as any).appdraft.load();
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
