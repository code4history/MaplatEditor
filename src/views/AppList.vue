<template>
  <div id="applist" class="container main app-editor" role="main">
    <div class="d-flex align-items-center justify-content-between gap-3 mb-3">
      <h2 class="mb-0">{{ t("applist.title") }}</h2>
      <div class="d-flex align-items-center gap-2">
        <span v-if="saveState === 'saved'" class="text-success small">{{ t("applist.saved") }}</span>
        <span v-else-if="saveState === 'saving'" class="text-muted small">{{ t("applist.saving") }}</span>
        <span v-else-if="saveState === 'error'" class="text-danger small">{{ t("applist.save_failed") }}</span>
        <button class="btn btn-sm btn-primary" type="button" :disabled="saveState === 'saving'" @click="saveAppDraft">
          {{ t("applist.save") }}
        </button>
      </div>
    </div>

    <ul class="nav nav-tabs mb-3">
      <li class="nav-item">
        <button
          class="nav-link"
          type="button"
          :class="{ active: activeTab === 'metadata' }"
          @click="activeTab = 'metadata'"
        >
          {{ t("applist.tabs.metadata") }}
        </button>
      </li>
      <li class="nav-item">
        <button
          class="nav-link"
          type="button"
          :class="{ active: activeTab === 'maps' }"
          @click="activeTab = 'maps'"
        >
          {{ t("applist.tabs.maps") }}
        </button>
      </li>
      <li class="nav-item">
        <button
          class="nav-link"
          type="button"
          :class="{ active: activeTab === 'preview' }"
          @click="activeTab = 'preview'"
        >
          {{ t("applist.tabs.preview") }}
        </button>
      </li>
    </ul>

    <section v-if="activeTab === 'metadata'" class="app-editor-section">
      <div class="row g-3">
        <div class="col-md-6">
          <label class="form-label" for="app-id">{{ t("applist.metadata.app_id") }}</label>
          <input id="app-id" v-model="metadata.appId" type="text" class="form-control" />
        </div>
        <div class="col-md-6">
          <label class="form-label" for="app-title">{{ t("applist.metadata.title") }}</label>
          <input id="app-title" v-model="metadata.title" type="text" class="form-control" />
        </div>
        <div class="col-md-6">
          <label class="form-label" for="app-lang">{{ t("applist.metadata.lang") }}</label>
          <select id="app-lang" v-model="metadata.lang" class="form-select">
            <option value="">{{ t("applist.metadata.lang_auto") }}</option>
            <option value="ja">日本語</option>
            <option value="en">English</option>
          </select>
        </div>
        <div class="col-12">
          <label class="form-label" for="app-description">{{ t("applist.metadata.description") }}</label>
          <textarea id="app-description" v-model="metadata.description" class="form-control" rows="5" />
        </div>
      </div>
    </section>

    <section v-else-if="activeTab === 'maps'" class="app-editor-section">
      <div class="mb-4">
        <div class="d-flex align-items-center justify-content-between gap-2 mb-2">
          <h5 class="mb-0">{{ t("applist.maplat_map") }}</h5>
          <button
            v-if="host.state.value"
            class="btn btn-sm btn-outline-secondary"
            type="button"
            @click="onDeselect"
          >
            {{ t("applist.deselect") }}
          </button>
        </div>
        <DesktopRegisteredMapSelector
          :catalog="catalog"
          :initial-catalog-key="initialCatalogKey"
          @select="onSelect"
          @deselect="onDeselect"
        />

        <div v-if="host.state.value" class="selected-summary mt-3">
          <h6>{{ t("applist.selected_map") }}</h6>
          <p class="mb-1"><strong>{{ t("applist.selected_title") }}</strong> {{ host.state.value.title }}</p>
          <p class="mb-1"><strong>{{ t("applist.selected_status") }}</strong> {{ host.state.value.status }}</p>
          <p class="mb-0"><strong>{{ t("applist.selected_map_id") }}</strong> {{ host.state.value.ref.runtimeMapId }}</p>
        </div>
      </div>

      <div class="mb-2">
        <h5 class="mb-2">{{ t("applist.base_maps") }}</h5>
        <div v-if="baseMapLoading" class="text-muted py-3">{{ t("applist.loading") }}</div>
        <div v-else-if="baseMapError" class="alert alert-danger">{{ baseMapError }}</div>
        <div v-else-if="baseMapCatalog.length === 0" class="text-muted py-3">{{ t("applist.no_base_maps") }}</div>
        <div v-else class="table-responsive">
          <table class="table table-sm align-middle app-editor-table">
            <thead>
              <tr>
                <th scope="col">{{ t("applist.use") }}</th>
                <th scope="col">{{ t("applist.base_map_title") }}</th>
                <th scope="col">{{ t("applist.base_map_scope") }}</th>
                <th scope="col">{{ t("applist.base_map_role") }}</th>
                <th scope="col">{{ t("applist.opacity") }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in baseMapCatalog" :key="baseMapKey(item)">
                <td>
                  <input
                    class="form-check-input"
                    type="checkbox"
                    :checked="isBaseMapSelected(item)"
                    @change="toggleBaseMap(item, $event)"
                  />
                </td>
                <td>
                  <div class="fw-medium">{{ baseMapTitle(item) }}</div>
                  <small class="text-muted">{{ item.mapID }}</small>
                </td>
                <td>{{ t(`applist.base_map_scopes.${item.scope}`) }}</td>
                <td>
                  <select
                    class="form-select form-select-sm role-select"
                    :disabled="!isBaseMapSelected(item)"
                    :value="selectedBaseMap(item)?.role ?? defaultBaseMapRole(item)"
                    @change="updateBaseMapRole(item, $event)"
                  >
                    <option value="base">{{ t("applist.roles.base") }}</option>
                    <option value="overlay">{{ t("applist.roles.overlay") }}</option>
                  </select>
                </td>
                <td>
                  <input
                    class="form-control form-control-sm opacity-input"
                    type="number"
                    min="0"
                    max="1"
                    step="0.05"
                    :disabled="!isBaseMapSelected(item)"
                    :value="selectedBaseMap(item)?.opacity ?? 1"
                    @change="updateBaseMapOpacity(item, $event)"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <section v-else class="app-editor-section">
      <div class="preview-grid">
        <div>
          <h5>{{ previewTitle }}</h5>
          <p class="text-muted mb-1">{{ metadata.appId || t("applist.preview.no_app_id") }}</p>
          <p class="mb-0">{{ metadata.description || t("applist.preview.no_description") }}</p>
        </div>
        <div>
          <h6>{{ t("applist.maplat_map") }}</h6>
          <p v-if="host.state.value" class="mb-0">{{ host.state.value.title }} ({{ host.state.value.ref.runtimeMapId }})</p>
          <p v-else class="text-muted mb-0">{{ t("applist.preview.no_maplat_map") }}</p>
        </div>
        <div>
          <h6>{{ t("applist.preview.base_layers") }}</h6>
          <ul v-if="baseLayers.length > 0" class="mb-0 ps-3">
            <li v-for="item in baseLayers" :key="item.mapID">{{ item.title ?? item.mapID }}</li>
          </ul>
          <p v-else class="text-muted mb-0">{{ t("applist.preview.no_base_layers") }}</p>
        </div>
        <div>
          <h6>{{ t("applist.preview.overlays") }}</h6>
          <ul v-if="overlayLayers.length > 0" class="mb-0 ps-3">
            <li v-for="item in overlayLayers" :key="item.mapID">
              {{ item.title ?? item.mapID }} / {{ t("applist.opacity") }} {{ item.opacity ?? 1 }}
            </li>
          </ul>
          <p v-else class="text-muted mb-0">{{ t("applist.preview.no_overlays") }}</p>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useTranslation } from "i18next-vue";
import { createDesktopRegisteredMapCatalog } from "../services/registeredMapCatalog";
import { useAppSourceHost } from "../composables/useAppSourceHost";
import {
  useAppDraft,
  type AppMetadata,
  type BaseMapCatalogItem,
  type MinimalAppDraft,
  type SelectedBaseMapRef,
} from "../composables/useAppDraft";
import type { SelectedRegisteredMapHostState } from "../composables/useRegisteredMapSelector";
import DesktopRegisteredMapSelector from "../components/DesktopRegisteredMapSelector.vue";

const { t } = useTranslation();
const catalog = createDesktopRegisteredMapCatalog();
const host = useAppSourceHost();
const { saveDraft, loadDraft } = useAppDraft();

const activeTab = ref<"metadata" | "maps" | "preview">("metadata");
const initialCatalogKey = ref<string | undefined>(undefined);
const currentDraft = ref<MinimalAppDraft>({});
const metadata = ref<AppMetadata>({});
const baseMapCatalog = ref<BaseMapCatalogItem[]>([]);
const selectedBaseMaps = ref<SelectedBaseMapRef[]>([]);
const baseMapLoading = ref(false);
const baseMapError = ref<string | null>(null);
const saveState = ref<"idle" | "saving" | "saved" | "error">("idle");

const baseLayers = computed(() => selectedBaseMaps.value.filter((item) => item.role === "base"));
const overlayLayers = computed(() => selectedBaseMaps.value.filter((item) => item.role === "overlay"));
const previewTitle = computed(() => metadata.value.title || t("applist.preview.untitled"));

onMounted(async () => {
  const draft = await loadDraft();
  if (draft) {
    currentDraft.value = draft;
    metadata.value = { ...(draft.metadata ?? {}) };
    selectedBaseMaps.value = [...(draft.selectedBaseMaps ?? [])];
    if (draft.selectedMap) {
      host.selectMap({
        ref: draft.selectedMap,
        title: draft.cachedTitle ?? "",
        status: draft.cachedStatus ?? "unknown",
      });
      initialCatalogKey.value = draft.selectedMap.catalogKey;
    }
  }
  await loadBaseMaps();
});

async function loadBaseMaps() {
  baseMapLoading.value = true;
  baseMapError.value = null;
  try {
    baseMapCatalog.value = await window.baseMaps.list();
  } catch (e) {
    baseMapError.value = e instanceof Error ? e.message : String(e);
  } finally {
    baseMapLoading.value = false;
  }
}

function buildDraft(): MinimalAppDraft {
  return {
    ...currentDraft.value,
    metadata: { ...metadata.value },
    selectedBaseMaps: selectedBaseMaps.value.map((item) => ({ ...item })),
  };
}

async function persistDraft() {
  saveState.value = "saving";
  try {
    currentDraft.value = buildDraft();
    await saveDraft(currentDraft.value);
    saveState.value = "saved";
  } catch (e) {
    console.error("[AppList] Failed to save app draft:", e);
    saveState.value = "error";
  }
}

function saveAppDraft() {
  void persistDraft();
}

function onSelect(state: SelectedRegisteredMapHostState) {
  host.selectMap(state);
  currentDraft.value = {
    ...currentDraft.value,
    selectedMap: state.ref,
    cachedTitle: state.title,
    cachedStatus: state.status,
  };
  void persistDraft();
}

function onDeselect() {
  host.clearMap();
  currentDraft.value = {
    ...currentDraft.value,
    selectedMap: undefined,
    cachedTitle: undefined,
    cachedStatus: undefined,
  };
  void persistDraft();
}

function baseMapKey(item: BaseMapCatalogItem): string {
  return `${item.scope}:${item.mapID}`;
}

function baseMapTitle(item: BaseMapCatalogItem): string {
  return String(item.data?.title ?? item.data?.label ?? item.mapID);
}

function defaultBaseMapRole(item: BaseMapCatalogItem): "base" | "overlay" {
  return item.data?.overlay ? "overlay" : "base";
}

function selectedBaseMap(item: BaseMapCatalogItem): SelectedBaseMapRef | undefined {
  return selectedBaseMaps.value.find((selected) => selected.mapID === item.mapID && selected.scope === item.scope);
}

function isBaseMapSelected(item: BaseMapCatalogItem): boolean {
  return Boolean(selectedBaseMap(item));
}

function toggleBaseMap(item: BaseMapCatalogItem, event: Event) {
  const checked = (event.target as HTMLInputElement).checked;
  if (checked && !isBaseMapSelected(item)) {
    selectedBaseMaps.value = [
      ...selectedBaseMaps.value,
      {
        kind: "registered-base-map",
        mapID: item.mapID,
        scope: item.scope,
        role: defaultBaseMapRole(item),
        title: baseMapTitle(item),
        opacity: 1,
        visible: true,
        data: item.data,
      },
    ];
  } else if (!checked) {
    selectedBaseMaps.value = selectedBaseMaps.value.filter(
      (selected) => !(selected.mapID === item.mapID && selected.scope === item.scope),
    );
  }
  void persistDraft();
}

function updateBaseMapRole(item: BaseMapCatalogItem, event: Event) {
  const role = (event.target as HTMLSelectElement).value === "overlay" ? "overlay" : "base";
  selectedBaseMaps.value = selectedBaseMaps.value.map((selected) =>
    selected.mapID === item.mapID && selected.scope === item.scope ? { ...selected, role } : selected,
  );
  void persistDraft();
}

function updateBaseMapOpacity(item: BaseMapCatalogItem, event: Event) {
  const raw = Number((event.target as HTMLInputElement).value);
  const opacity = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 1;
  selectedBaseMaps.value = selectedBaseMaps.value.map((selected) =>
    selected.mapID === item.mapID && selected.scope === item.scope ? { ...selected, opacity } : selected,
  );
  void persistDraft();
}
</script>

<style scoped>
.app-editor-section {
  padding: 12px 0 24px;
}

.selected-summary {
  border: 1px solid var(--bs-border-color);
  border-radius: 6px;
  padding: 12px;
}

.app-editor-table th,
.app-editor-table td {
  white-space: nowrap;
}

.role-select {
  min-width: 9rem;
}

.opacity-input {
  width: 6rem;
}

.preview-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 16px;
}
</style>
