<template>
  <div class="container-fluid p-3" @click="hideContextMenu">
    <div class="row mb-3 gx-2 align-items-center">
      <div class="col-auto">
        <button class="btn btn-light border shadow-sm px-4" @click="createNewApp">
          {{ t("applist.new_create") }}
        </button>
      </div>
      <div class="col">
        <input
          v-model="searchQuery"
          type="text"
          class="form-control shadow-sm"
          :placeholder="t('applist.search_placeholder')"
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

    <div class="d-flex flex-wrap justify-content-start align-items-start gap-4" style="padding-left: 5px;">
      <div v-for="app in applist" :key="app.appID" class="app-card-wrapper">
        <div class="app-card-inner">
          <router-link :to="`/appedit?appid=${app.appID}`" class="text-decoration-none text-dark d-block">
            <div class="position-relative bg-white app-image">
              <img
                :src="app.image || noImage"
                :alt="app.title"
                class="position-absolute top-50 start-50 translate-middle"
                style="max-width: 100%; max-height: 100%; width: auto; height: auto;"
                @contextmenu.prevent="openContextMenu($event, app)"
              />
            </div>
            <div class="mt-2 text-center app-title">
              <p class="mb-0 text-break">{{ app.title }}</p>
            </div>
          </router-link>
        </div>
      </div>
    </div>

    <ul
      v-if="contextMenu.visible"
      class="dropdown-menu show ctx-menu"
      :style="{ top: contextMenu.y + 'px', left: contextMenu.x + 'px' }"
      @click.stop
    >
      <li class="dropdown-header">{{ t("applist.delete_menu") }}</li>
      <li>
        <a class="dropdown-item" href="#" @click.prevent="deleteApp">
          {{ t("applist.delete_item", { name: contextMenu.name }) }}
        </a>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { useTranslation } from "i18next-vue";
import noImage from "../assets/img/no_image.png";

const { t } = useTranslation();
const router = useRouter();

interface AppItem {
  appID: string;
  title: string;
  image: string | null;
}

const applist = ref<AppItem[]>([]);
const searchQuery = ref("");
const currentPage = ref(1);
const hasNext = ref(true);
const contextMenu = ref({ visible: false, x: 0, y: 0, appID: "", name: "" });

const loadApps = async (page: number = 1) => {
  try {
    const result = await window.applist.request(searchQuery.value, page);
    applist.value = result.docs;
    currentPage.value = result.pageUpdate ?? page;
    hasNext.value = result.next;
  } catch (e) {
    console.error("Failed to fetch app list", e);
  }
};

onMounted(() => {
  loadApps(1);
  const unsubscribe = window.applist.onRefresh(() => loadApps(1));
  onBeforeUnmount(() => unsubscribe());
});

const handleSearch = () => loadApps(1);
const createNewApp = () => router.push("/appedit");
const prevPage = () => currentPage.value > 1 && loadApps(currentPage.value - 1);
const nextPage = () => hasNext.value && loadApps(currentPage.value + 1);

const openContextMenu = (event: MouseEvent, app: AppItem) => {
  contextMenu.value = { visible: true, x: event.clientX, y: event.clientY, appID: app.appID, name: app.title };
};
const hideContextMenu = () => {
  contextMenu.value.visible = false;
};
const deleteApp = async () => {
  const { appID, name } = contextMenu.value;
  hideContextMenu();
  if (!confirm(t("applist.delete_confirm", { name }))) return;
  try {
    const result = await window.applist.delete(appID, searchQuery.value, currentPage.value);
    applist.value = result.docs;
    currentPage.value = result.pageUpdate ?? currentPage.value;
    hasNext.value = result.next;
  } catch (e) {
    console.error("Failed to delete app", e);
    alert(t("applist.delete_error"));
  }
};
</script>

<style scoped>
.app-card-wrapper {
  width: 200px;
  background: transparent;
  flex-shrink: 0;
}
.app-card-inner {
  background: #fff;
  box-shadow: 0 2px 5px rgba(0,0,0,0.2);
  border: 1px solid rgba(0,0,0,0.1);
  border-radius: 4px;
  padding: 4px;
  transition: box-shadow 0.2s;
  width: 100%;
}
.app-card-inner:hover {
  box-shadow: 0 4px 8px rgba(0,0,0,0.3);
}
.app-image {
  width: 190px;
  height: 190px;
  margin: 0 auto;
  overflow: hidden;
}
.app-title {
  width: 190px;
  min-height: 3em;
}
.app-title p {
  font-size: 14px;
  line-height: 1.4;
}
.ctx-menu {
  position: fixed;
  z-index: 2000;
  display: block;
}
</style>
