import { ref, type Ref } from "vue";
import type {
  PoiSourceDocument,
  PoiFeatureCollection,
} from "../services/registeredPoiSourceCatalog";

// Write Store backend (poisource:* v2, uid/slug契約) を旧 view model へ読み替える薄い shim。
// 画面群は Phase 3 で全面再構築されるため、コンパイル維持と最低限の動作のみを狙う。
// save は uid正準の { slug, title, fc, expectedRevision } 契約 + 結果 union (maps/apps と同形)
export function usePoiSourceDetail() {
  const document: Ref<PoiSourceDocument | null> = ref(null);
  const geojson: Ref<PoiFeatureCollection> = ref({ type: "FeatureCollection", features: [] });
  const loading: Ref<boolean> = ref(false);
  const error: Ref<string | null> = ref(null);
  const saveError: Ref<string | null> = ref(null);
  const isDirty: Ref<boolean> = ref(false);

  // 保存に必要な v2 メタデータ (slug/title 内部形/revision) を保持する
  const record = ref<{ slug: string; title: Record<string, string>; revision: number } | null>(null);

  function titleToText(title: Record<string, string>, fallback: string): string {
    if (title && typeof title === "object") {
      if (typeof title.ja === "string" && title.ja) return title.ja;
      const first = Object.values(title).find((t) => typeof t === "string" && t !== "");
      if (first) return first;
    }
    return fallback;
  }

  async function loadDetail(sourceId: string): Promise<void> {
    loading.value = true;
    error.value = null;
    saveError.value = null;
    try {
      const detail = await window.poiSources.get(sourceId);
      if (!detail) {
        throw new Error(`POI source not found: ${sourceId}`);
      }
      record.value = { slug: detail.slug, title: detail.title, revision: detail.revision };
      document.value = {
        summary: {
          catalogKey: `poi-source:${detail.uid}`,
          sourceId: detail.uid,
          title: titleToText(detail.title, detail.slug),
          mode: detail.mode,
          featureCount: detail.featureCount,
          url: detail.url ?? undefined,
          status: "ready",
          readOnly: detail.readOnly,
          updatedAt: detail.updatedAt,
          validation: { status: "ready" },
        },
      };
      geojson.value = (detail.fc ?? { type: "FeatureCollection", features: [] }) as PoiFeatureCollection;
      isDirty.value = false;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    } finally {
      loading.value = false;
    }
  }

  async function save(sourceId: string): Promise<boolean> {
    saveError.value = null;
    if (!record.value) {
      saveError.value = "Source is not loaded";
      return false;
    }
    try {
      const result = await window.poiSources.save(sourceId, {
        slug: record.value.slug,
        title: record.value.title,
        fc: geojson.value,
        expectedRevision: record.value.revision,
      });
      if ("error" in result) {
        saveError.value = `Revision conflict (current: ${result.current})`;
        return false;
      }
      if (result.result !== "Success") {
        saveError.value =
          result.result === "Invalid"
            ? result.issues.map((i) => `${i.code}${i.featureId ? ` (${i.featureId})` : ""}`).join(", ")
            : result.result;
        return false;
      }
      record.value.revision = result.revision;
      isDirty.value = false;
      return true;
    } catch (e: any) {
      saveError.value = e?.message ?? "An error occurred while saving";
      return false;
    }
  }

  async function deleteSource(sourceId: string): Promise<boolean> {
    try {
      await window.poiSources.delete(sourceId);
      return true;
    } catch (e) {
      console.error("Failed to delete POI source", e);
      return false;
    }
  }

  // 旧 validateRemote 相当: remote snapshot の明示再取得 (POI-118) + 再読込
  async function validateRemote(sourceId: string): Promise<void> {
    try {
      const result = await window.poiSources.refreshRemote(sourceId);
      if ("error" in result || result.result !== "Success") {
        console.error("Failed to refresh remote POI source", result);
        return;
      }
      await loadDetail(sourceId);
    } catch (e) {
      console.error("Failed to refresh remote POI source", e);
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
