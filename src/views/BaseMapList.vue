<template>
  <div class="container-fluid p-3">
    <!-- Controls Row -->
    <div class="row mb-3 gx-2 align-items-center">
      <div class="col-auto">
        <button class="btn btn-light border shadow-sm px-4" @click="openAddModal">
          {{ t("basemap.add") }}
        </button>
      </div>
      <div class="col">
        <span class="text-muted" style="font-size: 13px;">{{ t("basemap.description") }}</span>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="text-muted text-center py-3">
      {{ t("basemap.loading") }}
    </div>

    <!-- Error -->
    <div v-else-if="error" class="alert alert-danger">
      {{ error }}
    </div>

    <template v-else>
      <!-- User-defined base maps -->
      <h6 class="fw-bold mb-2">{{ t("basemap.user_section") }}</h6>
      <div v-if="userBaseMaps.length === 0" class="text-muted py-3">
        {{ t("basemap.no_user_basemaps") }}
      </div>
      <div v-else class="table-responsive mb-4">
        <table class="table table-hover table-sm align-middle bg-white shadow-sm">
          <thead class="table-light">
            <tr>
              <th style="width: 160px;">{{ t("basemap.id") }}</th>
              <th style="width: 220px;">{{ t("basemap.map_title") }}</th>
              <th>{{ t("basemap.url") }}</th>
              <th style="width: 180px;">{{ t("basemap.attribution") }}</th>
              <th style="width: 90px;">{{ t("basemap.max_zoom") }}</th>
              <th style="width: 140px;">{{ t("basemap.actions") }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in userBaseMaps" :key="item.mapID">
              <td class="text-break">{{ item.mapID }}</td>
              <td class="text-break">{{ item.data.title }}</td>
              <td class="text-break"><small>{{ item.data.url }}</small></td>
              <td class="text-break"><small>{{ item.data.attr || '-' }}</small></td>
              <td>{{ item.data.maxZoom ?? '-' }}</td>
              <td>
                <button class="btn btn-sm btn-outline-secondary me-1" @click="openEditModal(item)">
                  {{ t("basemap.edit") }}
                </button>
                <button class="btn btn-sm btn-outline-danger" @click="deleteBaseMap(item)">
                  {{ t("basemap.delete") }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Builtin base maps (read-only) -->
      <details class="mb-3">
        <summary class="fw-bold mb-2" style="cursor: pointer;">
          {{ t("basemap.builtin_section") }} ({{ builtinBaseMaps.length }})
        </summary>
        <div class="table-responsive mt-2">
          <table class="table table-sm align-middle bg-white shadow-sm">
            <thead class="table-light">
              <tr>
                <th style="width: 160px;">{{ t("basemap.id") }}</th>
                <th style="width: 220px;">{{ t("basemap.map_title") }}</th>
                <th>{{ t("basemap.url") }}</th>
                <th style="width: 90px;">{{ t("basemap.max_zoom") }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in builtinBaseMaps" :key="item.mapID">
                <td class="text-break text-muted">{{ item.mapID }}</td>
                <td class="text-break text-muted">{{ item.data.title }}</td>
                <td class="text-break text-muted"><small>{{ item.data.url || '-' }}</small></td>
                <td class="text-muted">{{ item.data.maxZoom ?? '-' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </details>
    </template>

    <!-- Add/Edit Modal -->
    <div v-if="showModal" class="modal show d-block" tabindex="-1">
      <div class="modal-dialog modal-lg">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">
              {{ editing ? t("basemap.modal.edit_title") : t("basemap.modal.add_title") }}
            </h5>
            <button type="button" class="btn-close" @click="closeModal"></button>
          </div>
          <div class="modal-body">
            <div v-if="formError" class="alert alert-danger py-2">{{ formError }}</div>
            <label class="form-label">{{ t("basemap.modal.id_label") }}</label>
            <input
              type="text"
              class="form-control"
              v-model="form.mapID"
              :disabled="editing"
              :placeholder="t('basemap.modal.id_placeholder')"
            />
            <label class="form-label mt-2">{{ t("basemap.modal.title_label") }}</label>
            <input
              type="text"
              class="form-control"
              v-model="form.title"
              :placeholder="t('basemap.modal.title_placeholder')"
            />
            <label class="form-label mt-2">{{ t("basemap.modal.url_label") }}</label>
            <input
              type="text"
              class="form-control"
              v-model="form.url"
              :placeholder="t('basemap.modal.url_placeholder')"
            />
            <label class="form-label mt-2">{{ t("basemap.modal.attr_label") }}</label>
            <input
              type="text"
              class="form-control"
              v-model="form.attr"
              :placeholder="t('basemap.modal.attr_placeholder')"
            />
            <label class="form-label mt-2">{{ t("basemap.modal.max_zoom_label") }}</label>
            <input
              type="number"
              class="form-control"
              v-model="form.maxZoom"
              min="1"
              max="25"
            />
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" @click="closeModal">
              {{ t("basemap.modal.cancel") }}
            </button>
            <button type="button" class="btn btn-primary" @click="saveBaseMap" :disabled="saving">
              {{ t("basemap.modal.save") }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useTranslation } from "i18next-vue";

interface BaseMapCatalogItem {
  mapID: string;
  scope: "builtin" | "user";
  data: any;
}

const { t } = useTranslation();

const items = ref<BaseMapCatalogItem[]>([]);
const loading = ref(false);
const error = ref("");

const userBaseMaps = computed(() => items.value.filter((item) => item.scope === "user"));
const builtinBaseMaps = computed(() => items.value.filter((item) => item.scope === "builtin"));

// Modal state
const showModal = ref(false);
const editing = ref(false);
const saving = ref(false);
const formError = ref("");
const form = ref({
  mapID: "",
  title: "",
  url: "",
  attr: "",
  maxZoom: "" as string | number,
});

const loadBaseMaps = async () => {
  loading.value = true;
  error.value = "";
  try {
    items.value = await window.baseMaps.list();
  } catch (e) {
    console.error("Failed to load base maps", e);
    error.value = t("basemap.errors.load_failed");
  } finally {
    loading.value = false;
  }
};

onMounted(() => {
  loadBaseMaps();
});

const openAddModal = () => {
  editing.value = false;
  form.value = { mapID: "", title: "", url: "", attr: "", maxZoom: "" };
  formError.value = "";
  showModal.value = true;
};

const openEditModal = (item: BaseMapCatalogItem) => {
  editing.value = true;
  form.value = {
    mapID: item.mapID,
    title: item.data.title || "",
    url: item.data.url || "",
    attr: item.data.attr || "",
    maxZoom: item.data.maxZoom ?? "",
  };
  formError.value = "";
  showModal.value = true;
};

const closeModal = () => {
  showModal.value = false;
};

const validateForm = (): string | null => {
  const mapID = form.value.mapID.trim();
  const title = form.value.title.trim();
  const url = form.value.url.trim();
  if (!mapID) return t("basemap.errors.id_required");
  if (!/^[a-zA-Z0-9_-]+$/.test(mapID)) return t("basemap.errors.id_invalid");
  if (!editing.value && items.value.some((item) => item.mapID === mapID)) {
    return t("basemap.errors.id_duplicate");
  }
  if (!title) return t("basemap.errors.title_required");
  if (!url) return t("basemap.errors.url_required");
  if (!(url.includes("{z}") && url.includes("{x}") && (url.includes("{y}") || url.includes("{-y}")))) {
    return t("basemap.errors.url_invalid");
  }
  if (form.value.maxZoom !== "" && form.value.maxZoom !== null) {
    const zoom = Number(form.value.maxZoom);
    if (!Number.isInteger(zoom) || zoom < 1 || zoom > 25) {
      return t("basemap.errors.max_zoom_invalid");
    }
  }
  return null;
};

const saveBaseMap = async () => {
  const validationError = validateForm();
  if (validationError) {
    formError.value = validationError;
    return;
  }
  const tms: any = {
    mapID: form.value.mapID.trim(),
    title: form.value.title.trim(),
    url: form.value.url.trim(),
  };
  const attr = form.value.attr.trim();
  if (attr) tms.attr = attr;
  if (form.value.maxZoom !== "" && form.value.maxZoom !== null) {
    tms.maxZoom = Number(form.value.maxZoom);
  }
  saving.value = true;
  try {
    await window.baseMaps.saveUser(tms);
    showModal.value = false;
    await loadBaseMaps();
  } catch (e) {
    console.error("Failed to save base map", e);
    formError.value = t("basemap.errors.save_failed");
  } finally {
    saving.value = false;
  }
};

const deleteBaseMap = async (item: BaseMapCatalogItem) => {
  const name = item.data.title || item.mapID;
  if (!confirm(t("basemap.delete_confirm", { name }))) return;
  try {
    await window.baseMaps.deleteUser(item.mapID);
    await loadBaseMaps();
  } catch (e) {
    console.error("Failed to delete base map", e);
    error.value = t("basemap.errors.delete_failed");
  }
};
</script>

<style scoped>
.table {
    font-size: 13px;
}
</style>
