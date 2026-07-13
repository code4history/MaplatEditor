<template>
  <section class="base-map-master-list d-flex flex-column h-100 bg-white">
    <div class="p-3 border-bottom">
      <button type="button" class="btn btn-primary btn-sm w-100 mb-2" @click="emit('create')">
        <i class="bi bi-plus-lg me-1" aria-hidden="true"></i>{{ t("basemap.add") }}
        <span v-if="newDrafts.length" class="badge bg-warning text-dark ms-1">{{ t("editor_ui.draft_badge") }}</span>
      </button>
    </div>

    <div ref="scrollElement" class="flex-grow-1 overflow-auto" @scroll.passive="emit('scroll', scrollElement)">
      <div v-if="loading" class="text-muted text-center py-4">{{ t("basemap.loading") }}</div>
      <div v-else-if="error" class="alert alert-danger m-3">{{ error }}</div>
      <template v-else>
        <div v-if="newDrafts.length" class="border-bottom">
          <h6 class="small text-uppercase text-muted px-3 pt-3 mb-1">{{ t("editor_ui.draft_badge") }}</h6>
          <button
            v-for="draft in newDrafts"
            :key="draft.assetUid"
            type="button"
            class="list-group-item list-group-item-action border-0 rounded-0 px-3 py-2 w-100 text-start"
            :class="{ active: selectedUid === draft.assetUid }"
            :aria-current="selectedUid === draft.assetUid ? 'true' : undefined"
            @click="emit('select-draft', draft.assetUid)"
          >
            <span class="fw-semibold">{{ t("basemap.master_detail.new_draft") }}</span>
            <span class="badge bg-warning text-dark ms-1">{{ t("editor_ui.draft_badge") }}</span>
          </button>
        </div>

        <h6 class="small text-uppercase text-muted px-3 pt-3 mb-1">{{ t("basemap.user_section") }}</h6>
        <div v-if="userItems.length === 0" class="text-muted small px-3 py-2">{{ t("basemap.no_user_basemaps") }}</div>
        <div
          v-for="item in userItems"
          :key="item.uid"
          role="button"
          tabindex="0"
          class="base-map-row list-group-item list-group-item-action border-0 border-bottom rounded-0 px-3 py-2 w-100 text-start"
          :class="{ active: selectedUid === item.uid }"
          :aria-current="selectedUid === item.uid ? 'true' : undefined"
          @click="emit('select', item.uid)"
          @keydown.enter.prevent="emit('select', item.uid)"
          @keydown.space.prevent="emit('select', item.uid)"
        >
          <img v-if="item.thumbnailUrl" :src="item.thumbnailUrl" class="base-map-row__icon" :alt="item.mapID">
          <span v-else class="base-map-row__icon base-map-row__placeholder"><i class="bi bi-map" aria-hidden="true"></i></span>
          <span class="min-w-0 flex-grow-1">
            <span class="d-block text-truncate fw-semibold">{{ titleOf(item) || item.mapID }}</span>
            <small class="d-block text-truncate" :class="selectedUid === item.uid ? 'text-white-50' : 'text-muted'">{{ item.mapID }}</small>
          </span>
          <span v-if="draftUids.has(item.uid)" class="badge bg-warning text-dark">{{ t("editor_ui.draft_badge") }}</span>
          <span class="form-check ms-1" @click.stop>
            <input
              class="form-check-input"
              type="checkbox"
              :title="t('basemap.always_visible')"
              :checked="item.alwaysVisible"
              :disabled="item.alwaysLocked"
              @change="emit('toggle-always', item, ($event.target as HTMLInputElement).checked)"
            >
          </span>
          <button type="button" class="btn btn-sm btn-link text-danger p-0" :title="t('basemap.delete')" @click.stop="emit('delete', item)">
            <i class="bi bi-trash" aria-hidden="true"></i>
          </button>
        </div>

        <details class="border-bottom" open>
          <summary class="small text-uppercase text-muted px-3 py-3">{{ t("basemap.builtin_section") }} ({{ builtinItems.length }})</summary>
          <div
            v-for="item in builtinItems"
            :key="item.uid"
            role="button"
            tabindex="0"
            class="base-map-row list-group-item list-group-item-action border-0 border-top rounded-0 px-3 py-2 w-100 text-start"
            :class="{ active: selectedUid === item.uid }"
            :aria-current="selectedUid === item.uid ? 'true' : undefined"
            @click="emit('select', item.uid)"
            @keydown.enter.prevent="emit('select', item.uid)"
            @keydown.space.prevent="emit('select', item.uid)"
          >
            <img v-if="item.thumbnailUrl" :src="item.thumbnailUrl" class="base-map-row__icon" :alt="item.mapID">
            <span v-else class="base-map-row__icon base-map-row__placeholder"><i class="bi bi-map" aria-hidden="true"></i></span>
            <span class="min-w-0 flex-grow-1">
              <span class="d-block text-truncate">{{ titleOf(item) || item.mapID }}</span>
              <small class="d-block text-truncate" :class="selectedUid === item.uid ? 'text-white-50' : 'text-muted'">{{ item.mapID }}</small>
            </span>
            <span class="form-check ms-1" @click.stop>
              <input
                class="form-check-input"
                type="checkbox"
                :title="t('basemap.always_visible')"
                :checked="item.alwaysVisible"
                :disabled="item.alwaysLocked"
                @change="emit('toggle-always', item, ($event.target as HTMLInputElement).checked)"
              >
            </span>
          </div>
        </details>
      </template>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useTranslation } from "i18next-vue";
import type { AssetDraftSummary } from "../../types/assetDraft";
import type { BaseMapCatalogItem } from "../../utils/baseMapEditorDocument";
import { localizeTitle } from "../../utils/langResource";

const props = defineProps<{
  items: BaseMapCatalogItem[];
  selectedUid: string | null;
  activeLang: string;
  draftUids: Set<string>;
  draftSummaries: AssetDraftSummary[];
  loading: boolean;
  error: string;
}>();

const emit = defineEmits<{
  "select": [uid: string];
  "select-draft": [uid: string];
  "create": [];
  "delete": [item: BaseMapCatalogItem];
  "toggle-always": [item: BaseMapCatalogItem, always: boolean];
  "scroll": [element: HTMLElement | null];
}>();

const { t } = useTranslation();
const scrollElement = ref<HTMLElement | null>(null);
const newDrafts = computed(() => props.draftSummaries.filter((draft) => draft.baseRevision === null));
const userItems = computed(() => props.items.filter((item) => item.scope === "user"));
const builtinItems = computed(() => props.items.filter((item) => item.scope === "builtin"));
const titleOf = (item: BaseMapCatalogItem) => localizeTitle(item.data.title as any, props.activeLang);

defineExpose({ scrollElement });
</script>

<style scoped>
.base-map-master-list { min-width: 18rem; }
.base-map-row { display: flex; align-items: center; gap: .65rem; }
.base-map-row__icon { width: 40px; height: 40px; flex: 0 0 40px; object-fit: contain; background: #f8f9fa; border: 1px solid var(--bs-border-color); }
.base-map-row__placeholder { display: grid; place-items: center; color: var(--bs-secondary-color); }
.min-w-0 { min-width: 0; }
</style>
