<template>
  <div class="container-fluid p-3" @click="hideContextMenu">
    <!-- Controls Row -->
    <div class="row mb-3 gx-2 align-items-center">
      <div class="col-auto">
        <button class="btn btn-light border shadow-sm px-4" @click="showCreateLocalModal = true">
          {{ t("poisource.create_local") }}
        </button>
      </div>
      <div class="col-auto">
        <button class="btn btn-light border shadow-sm px-4" @click="showRegisterRemoteModal = true">
          {{ t("poisource.register_remote") }}
        </button>
      </div>
      <div class="col">
        <input
          type="text"
          class="form-control shadow-sm"
          :placeholder="t('poisource.search_placeholder')"
          v-model="searchQuery"
          @input="handleSearch"
        />
      </div>
      <div class="col-auto">
        <div class="btn-group shadow-sm" role="group">
          <button class="btn btn-light border" :disabled="currentPage <= 1" @click="prevPage">&lt;</button>
          <button class="btn btn-light border" :disabled="!hasNext" @click="nextPage">&gt;</button>
        </div>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="text-muted text-center py-3">
      {{ t("poisource.loading") }}
    </div>

    <!-- Error -->
    <div v-else-if="error" class="alert alert-danger">
      {{ error }}
    </div>

    <!-- Empty -->
    <div v-else-if="items.length === 0" class="text-muted text-center py-3">
      {{ t("poisource.no_sources_found") }}
    </div>

    <!-- Source Grid -->
    <div v-else class="d-flex flex-wrap justify-content-start align-items-start gap-4" style="padding-left: 5px;">
      <div v-for="source in items" :key="source.sourceId" class="source-card-wrapper">
        <div class="source-card-inner">
          <router-link
            :to="`/poisources/${source.sourceId}`"
            class="text-decoration-none text-dark d-block"
            @contextmenu.prevent="openContextMenu($event, source)"
          >
            <div class="card-body py-2 px-3">
              <div class="d-flex align-items-center gap-2 mb-1">
                <span class="badge" :class="source.mode === 'local' ? 'bg-primary' : 'bg-info'">
                  {{ source.mode === 'local' ? t("poisource.local") : t("poisource.remote") }}
                </span>
                <span
                  class="badge"
                  :class="{
                    'bg-success': source.status === 'ready',
                    'bg-warning': source.status === 'invalid',
                    'bg-danger': source.status === 'unreachable',
                    'bg-secondary': source.status === 'unknown'
                  }"
                >
                  {{ t(`poisource.status.${source.status}`) }}
                </span>
              </div>
              <p class="mb-1 fw-medium" style="font-size: 14px;">{{ source.title }}</p>
              <small class="text-muted">
                {{ source.featureCount !== null ? `${source.featureCount} ${t("poisource.features")}` : '-' }}
              </small>
            </div>
          </router-link>
        </div>
      </div>
    </div>

    <!-- Context menu -->
    <ul
      v-if="contextMenu.visible"
      class="dropdown-menu show ctx-menu"
      :style="{ top: contextMenu.y + 'px', left: contextMenu.x + 'px' }"
      @click.stop
    >
      <li class="dropdown-header">{{ t('poisource.detail.delete') }}</li>
      <li>
        <a class="dropdown-item" href="#" @click.prevent="deleteSource">
          {{ t('poisource.feature_table.delete') }}
        </a>
      </li>
    </ul>

    <!-- Create Local Modal -->
    <div v-if="showCreateLocalModal" class="modal show d-block" tabindex="-1">
      <div class="modal-dialog">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">{{ t("poisource.create_local_modal.title") }}</h5>
            <button type="button" class="btn-close" @click="showCreateLocalModal = false"></button>
          </div>
          <div class="modal-body">
            <label class="form-label">{{ t("poisource.create_local_modal.name_label") }}</label>
            <input
              type="text"
              class="form-control"
              v-model="newLocalTitle"
              :placeholder="t('poisource.create_local_modal.name_placeholder')"
            />
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" @click="showCreateLocalModal = false">
              {{ t("poisource.create_local_modal.cancel") }}
            </button>
            <button type="button" class="btn btn-primary" @click="createLocal" :disabled="!newLocalTitle.trim()">
              {{ t("poisource.create_local_modal.create") }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Register Remote Modal -->
    <div v-if="showRegisterRemoteModal" class="modal show d-block" tabindex="-1">
      <div class="modal-dialog">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">{{ t("poisource.register_remote_modal.title") }}</h5>
            <button type="button" class="btn-close" @click="showRegisterRemoteModal = false"></button>
          </div>
          <div class="modal-body">
            <label class="form-label">{{ t("poisource.register_remote_modal.name_label") }}</label>
            <input
              type="text"
              class="form-control"
              v-model="newRemoteTitle"
              :placeholder="t('poisource.register_remote_modal.name_placeholder')"
            />
            <label class="form-label mt-2">{{ t("poisource.register_remote_modal.url_label") }}</label>
            <input
              type="url"
              class="form-control"
              v-model="newRemoteUrl"
              :placeholder="t('poisource.register_remote_modal.url_placeholder')"
            />
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" @click="showRegisterRemoteModal = false">
              {{ t("poisource.register_remote_modal.cancel") }}
            </button>
            <button type="button" class="btn btn-primary" @click="registerRemote" :disabled="!newRemoteTitle.trim() || !newRemoteUrl.trim()">
              {{ t("poisource.register_remote_modal.register") }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useTranslation } from "i18next-vue";
import { usePoiSourceList } from "../composables/usePoiSourceList";

const { t } = useTranslation();

const {
  items,
  loading,
  error,
  searchQuery,
  currentPage,
  hasNext,
  loadSources,
  search,
  nextPage,
  prevPage,
} = usePoiSourceList();

// Context menu
const contextMenu = ref({
  visible: false,
  x: 0,
  y: 0,
  sourceId: "",
  mode: "" as "local" | "remote",
});

// Modals
const showCreateLocalModal = ref(false);
const newLocalTitle = ref("");
const showRegisterRemoteModal = ref(false);
const newRemoteTitle = ref("");
const newRemoteUrl = ref("");

onMounted(() => {
  loadSources();
});

const handleSearch = () => {
  search(searchQuery.value);
};

const openContextMenu = (event: MouseEvent, source: { sourceId: string; mode: "local" | "remote" }) => {
  if (source.mode !== "local") return;
  contextMenu.value = {
    visible: true,
    x: event.clientX,
    y: event.clientY,
    sourceId: source.sourceId,
    mode: source.mode,
  };
};

const hideContextMenu = () => {
  contextMenu.value.visible = false;
};

const deleteSource = async () => {
  const { sourceId } = contextMenu.value;
  hideContextMenu();
  if (!confirm(t("poisource.feature_table.confirm_delete"))) return;
  try {
    await window.poiSources.delete(sourceId);
    await loadSources();
  } catch (e) {
    console.error("Failed to delete POI source", e);
  }
};

// v2 backend は slug 必須 (グローバル一意)。本画面は Phase 3 で全面再構築されるため、
// 暫定でタイトルから機械的に slug を生成する (文字種 [A-Za-z0-9_-]+、空なら乱数フォールバック)
const suggestSlug = (title: string): string => {
  const base = title
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  const random = Math.random().toString(36).slice(2, 8);
  return base ? `${base}-${random}` : `poi-${random}`;
};

const createLocal = async () => {
  const title = newLocalTitle.value.trim();
  if (!title) return;
  try {
    const result = await window.poiSources.createLocal({ slug: suggestSlug(title), title });
    if ("error" in result || result.result !== "Success") {
      console.error("Failed to create local POI source", result);
      return;
    }
    showCreateLocalModal.value = false;
    newLocalTitle.value = "";
    await loadSources();
  } catch (e) {
    console.error("Failed to create local POI source", e);
  }
};

const registerRemote = async () => {
  const title = newRemoteTitle.value.trim();
  const url = newRemoteUrl.value.trim();
  if (!title || !url) return;
  try {
    const result = await window.poiSources.registerRemote({ slug: suggestSlug(title), title, url });
    if ("error" in result || result.result !== "Success") {
      console.error("Failed to register remote POI source", result);
      return;
    }
    showRegisterRemoteModal.value = false;
    newRemoteTitle.value = "";
    newRemoteUrl.value = "";
    await loadSources();
  } catch (e) {
    console.error("Failed to register remote POI source", e);
  }
};
</script>

<style scoped>
.source-card-wrapper {
    width: 240px;
    background: transparent;
    flex-shrink: 0;
}
.source-card-inner {
    background: #fff;
    box-shadow: 0 2px 5px rgba(0,0,0,0.2);
    border: 1px solid rgba(0,0,0,0.1);
    border-radius: 4px;
    padding: 4px;
    transition: box-shadow 0.2s;
    width: 100%;
}
.source-card-inner:hover {
    box-shadow: 0 4px 8px rgba(0,0,0,0.3);
}
.ctx-menu {
    position: fixed;
    z-index: 9999;
    min-width: 160px;
}
</style>
