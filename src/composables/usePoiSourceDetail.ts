import { ref, type Ref } from "vue";
import type {
  PoiSourceDocument,
  PoiFeatureCollection,
} from "../services/registeredPoiSourceCatalog";

export function usePoiSourceDetail() {
  const document: Ref<PoiSourceDocument | null> = ref(null);
  const geojson: Ref<PoiFeatureCollection> = ref({ type: "FeatureCollection", features: [] });
  const loading: Ref<boolean> = ref(false);
  const error: Ref<string | null> = ref(null);
  const saveError: Ref<string | null> = ref(null);
  const isDirty: Ref<boolean> = ref(false);

  async function loadDetail(sourceId: string): Promise<void> {
    loading.value = true;
    error.value = null;
    saveError.value = null;
    try {
      const doc = await (window as any).poiSources.get(sourceId);
      document.value = doc;
      if (doc.geojson) {
        geojson.value = doc.geojson;
      } else {
        geojson.value = { type: "FeatureCollection", features: [] };
      }
      isDirty.value = false;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    } finally {
      loading.value = false;
    }
  }

  async function save(sourceId: string): Promise<boolean> {
    saveError.value = null;
    try {
      await (window as any).poiSources.saveLocal(sourceId, geojson.value);
      isDirty.value = false;
      return true;
    } catch (e: any) {
      saveError.value = e?.message ?? "An error occurred while saving";
      return false;
    }
  }

  async function deleteSource(sourceId: string): Promise<boolean> {
    try {
      await (window as any).poiSources.delete(sourceId);
      return true;
    } catch (e) {
      console.error("Failed to delete POI source", e);
      return false;
    }
  }

  async function validateRemote(sourceId: string): Promise<void> {
    try {
      const validation = await (window as any).poiSources.validateRemote({ kind: "source", sourceId });
      if (document.value) {
        document.value.summary.validation = validation;
        document.value.summary.status = validation.status;
      }
    } catch (e) {
      console.error("Failed to validate remote POI source", e);
    }
  }

  function markDirty(): void {
    isDirty.value = true;
  }

  return {
    document,
    geojson,
    loading,
    error,
    saveError,
    isDirty,
    loadDetail,
    save,
    deleteSource,
    validateRemote,
    markDirty,
  };
}
