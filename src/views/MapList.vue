<template>
  <!-- Inner container for padding -->
  <div class="container-fluid p-3" @click="hideContextMenu">
    <!-- Controls Row -->
    <div class="row mb-3 gx-2 align-items-center"> <!-- Reduced bottom margin -->
      <div class="col-auto">
        <button class="btn btn-light border shadow-sm px-4" @click="createNewMap">
          {{ t("maplist.new_create") || "New Creation" }}
        </button>
      </div>
      <div class="col">
        <input
          type="text"
          class="form-control shadow-sm"
          :placeholder="
            t('maplist.search_placeholder') || 'Please enter search conditions'
          "
          v-model="searchQuery"
          @input="handleSearch"
        />
      </div>
      <div class="col-auto">
        <div class="btn-group shadow-sm" role="group">
          <!-- Force enable for debug if needed, but logic seems sound if count returned -->
          <button class="btn btn-light border" :disabled="currentPage <= 1" @click="prevPage">&lt;</button>
          <button class="btn btn-light border" :disabled="!hasNext" @click="nextPage">&gt;</button>
        </div>
      </div>
    </div>

    <!-- Map Grid -->
    <div class="d-flex flex-wrap justify-content-start align-items-start gap-4" style="padding-left: 5px;">
      <div v-for="map in maplist" :key="map.mapID" class="map-card-wrapper">
        <div class="map-card-inner">
          <router-link
            :to="`/mapedit?mapid=${map.mapID}`"
            class="text-decoration-none text-dark d-block"
          >
            <!-- Image container: 190x190 -->
            <div
              class="position-relative bg-white"
              style="width: 190px; height: 190px; margin: 0 auto; overflow: hidden;"
            >
              <!-- Image Style: Centered with preserved aspect ratio -->
              <img
                v-if="map.image"
                :src="map.image"
                style="position: absolute; top: 0; bottom: 0; left: 0; right: 0; margin: auto;"
                :style="{ width: (map.width || 190) + 'px', height: (map.height || 190) + 'px' }"
                :alt="map.title"
                @contextmenu.prevent="openContextMenu($event, map)"
              />
              <img
                v-else
                :src="noImage"
                class="position-absolute top-50 start-50 translate-middle"
                style="max-width: 100%; max-height: 100%; width: auto; height: auto;"
                :alt="map.title"
                @contextmenu.prevent="openContextMenu($event, map)"
              />
            </div>
            <!-- Title container -->
            <div class="mt-2 text-center" style="width: 190px; min-height: 3em;">
              <p class="mb-0 text-break" style="font-size: 14px; line-height: 1.4;">{{ map.title }}</p>
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
      <li class="dropdown-header">{{ t('maplist.delete_menu') }}</li>
      <li>
        <a class="dropdown-item" href="#" @click.prevent="deleteMap">
          {{ t('maplist.delete_item', { name: contextMenu.name }) }}
        </a>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from "vue";
import { useRouter } from "vue-router";
import { useTranslation } from "i18next-vue";
import noImage from "../assets/img/no_image.png";

const { t } = useTranslation();
const router = useRouter();

interface MapItem {
  mapID: string;
  title: string;
  image: string | null;
  width?: number;
  height?: number;
}

const maplist = ref<MapItem[]>([]);
const searchQuery = ref("");

const currentPage = ref(1);
const hasNext = ref(true);

// Context menu state
const contextMenu = ref({
  visible: false,
  x: 0,
  y: 0,
  mapID: "",
  name: ""
});

const loadMaps = async (page: number = 1) => {
  try {
    const result = await (window as any).maplist.request(searchQuery.value, page);
    maplist.value = result.docs;
    // pageUpdate: 最終ページ全削除時にバックエンドが調整したページ番号
    currentPage.value = result.pageUpdate ?? page;
    hasNext.value = result.next;
  } catch (e) {
    console.error("Failed to fetch map list", e);
  }
};

onMounted(() => {
  loadMaps(1);
  //@ts-ignore
  window.maplist.on('maplist:refresh', () => {
    loadMaps(1);
  });
});

const handleSearch = () => {
  loadMaps(1);
};

const createNewMap = () => {
  router.push('/mapedit');
};

const prevPage = () => {
  if (currentPage.value > 1) {
    loadMaps(currentPage.value - 1);
  }
};

const nextPage = () => {
  if (hasNext.value) {
    loadMaps(currentPage.value + 1);
  }
};

// --- Context menu ---
const openContextMenu = (event: MouseEvent, map: MapItem) => {
  contextMenu.value = {
    visible: true,
    x: event.clientX,
    y: event.clientY,
    mapID: map.mapID,
    name: map.title
  };
};

const hideContextMenu = () => {
  contextMenu.value.visible = false;
};

const deleteMap = async () => {
  const { mapID, name } = contextMenu.value;
  hideContextMenu();
  if (!confirm(t('maplist.delete_confirm', { name }))) return;
  try {
    const result = await (window as any).maplist.delete(mapID, searchQuery.value, currentPage.value);
    maplist.value = result.docs;
    currentPage.value = result.pageUpdate ?? currentPage.value;
    hasNext.value = result.next;
  } catch (e) {
    console.error("Failed to delete map", e);
    alert(t('maplist.delete_error'));
  }
};

// Hide context menu on Escape key
const onKeyDown = (e: KeyboardEvent) => {
  if (e.key === 'Escape') hideContextMenu();
};
onMounted(() => window.addEventListener('keydown', onKeyDown));
onBeforeUnmount(() => window.removeEventListener('keydown', onKeyDown));
</script>

<style scoped>
.map-card-wrapper {
    width: 200px; /* Increased from 190px to accommodate border/padding */
    background: transparent;
    flex-shrink: 0; /* Prevent checking on narrow screens */
}
.map-card-inner {
    /* Legacy style: slightly raised/bubble effect */
    background: #fff;
    box-shadow: 0 2px 5px rgba(0,0,0,0.2); /* Stronger shadow */
    border: 1px solid rgba(0,0,0,0.1);
    border-radius: 4px;
    padding: 4px; /* Slightly more padding for the frame look */
    transition: box-shadow 0.2s;
    width: 100%; /* Fill wrapper */
}
.map-card-inner:hover {
    box-shadow: 0 4px 8px rgba(0,0,0,0.3);
}
.ctx-menu {
    position: fixed;
    z-index: 9999;
    min-width: 160px;
}
</style>
