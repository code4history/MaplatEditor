<template>
  <nav class="navbar navbar-expand-md navbar-dark bg-dark fixed-top p-0">
    <div class="container-fluid h-100">
      <div class="navbar-brand d-flex align-items-center h-100 px-3">
        Maplat Editor
      </div>
      
      <div class="collapse navbar-collapse h-100" id="navbarCollapse">
        <ul class="navbar-nav me-auto mb-0 h-100">
          <li class="nav-item h-100">
            <a
              href="#"
              class="nav-link h-100 d-flex align-items-center px-4"
              :class="{ active: isMapSection }"
              @click.prevent="navigate('MapList')"
            >
              {{ t("navbar.edit_map") }}
            </a>
          </li>
          <li class="nav-item h-100">
            <a
              href="#"
              class="nav-link h-100 d-flex align-items-center px-4"
              :class="{ active: isPoiSection }"
              @click.prevent="navigate('PoiSourceList')"
            >
              {{ t("navbar.edit_poi") }}
            </a>
          </li>
          <li class="nav-item h-100">
            <a
              href="#"
              class="nav-link h-100 d-flex align-items-center px-4"
              :class="{ active: currentRoute === 'BaseMapList' }"
              @click.prevent="navigate('BaseMapList')"
            >
              {{ t("navbar.add_basemap") }}
            </a>
          </li>
          <li class="nav-item h-100">
            <a
              href="#"
              class="nav-link h-100 d-flex align-items-center px-4"
              :class="{ active: isAppSection }"
              @click.prevent="navigate('AppList')"
            >
              {{ t("navbar.edit_app") }}
            </a>
          </li>
          <li class="nav-item h-100">
            <a
              href="#"
              class="nav-link h-100 d-flex align-items-center px-4"
              :class="{ active: isAssetSection }"
              @click.prevent="navigate('AssetList')"
            >
              {{ t("navbar.assets") }}
            </a>
          </li>
          <li class="nav-item h-100">
            <a
              href="#"
              class="nav-link h-100 d-flex align-items-center px-4"
              :class="{ active: currentRoute === 'Settings' }"
              @click.prevent="navigate('Settings')"
            >
              <!-- UIが読めない言語になっても設定へ辿り着けるよう、言語非依存のギアアイコンを併記 -->
              <i class="bi bi-gear me-1"></i>{{ t("navbar.settings") }}
            </a>
          </li>
        </ul>
      </div>
    </div>
  </nav>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useTranslation } from "i18next-vue";

const { t } = useTranslation();
const route = useRoute();
const router = useRouter();
const currentRoute = computed(() => route.name);

const isMapSection = computed(() => {
    return currentRoute.value === 'MapList' || currentRoute.value === 'MapEdit';
});

const isPoiSection = computed(() => {
    return currentRoute.value === 'PoiSourceList' || currentRoute.value === 'PoiEdit';
});

const isAppSection = computed(() => {
    return currentRoute.value === 'AppList' || currentRoute.value === 'AppEdit';
});

const isAssetSection = computed(() => {
    return currentRoute.value === 'AssetList';
});

const navigate = (targetName: string) => {
    // Sticky Logic:
    // If we are in MapEdit, clicking "Edit Map" (targetName='MapList') does nothing.
    if (targetName === 'MapList' && currentRoute.value === 'MapEdit') {
        return;
    }
    // If already on the target, do nothing
    if (currentRoute.value === targetName) {
        return;
    }
    
    // Map 'MapList' target to root path for router
    if (targetName === 'MapList') router.push('/');
    else if (targetName === 'AppList') router.push('/applist');
    else if (targetName === 'PoiSourceList') router.push('/poisources');
    else if (targetName === 'BaseMapList') router.push('/basemaps');
    else if (targetName === 'AssetList') router.push('/assets');
    else if (targetName === 'Settings') router.push('/settings');
};
</script>

<style scoped>
.navbar {
    height: var(--editor-ui-header-height);
    min-height: var(--editor-ui-header-height);
    background-color: var(--editor-ui-header-bg) !important; /* BS3 navbar-inverse bg */
    border-color: var(--editor-ui-header-bg-active);
    padding: 0;
}

.container-fluid {
    height: 100%;
    padding-left: 15px;
    padding-right: 15px;
}

.navbar-brand {
    color: var(--editor-ui-header-fg) !important; /* BS3 brand color */
    font-size: 18px;
    height: var(--editor-ui-header-height);
    padding: 15px 15px;
    line-height: 20px;
    margin-right: 0;
    display: flex;
    align-items: center;
}

.navbar-brand:hover {
    color: var(--editor-ui-header-fg-active) !important;
}

.navbar-collapse {
    height: 100%;
}

.navbar-nav {
    flex-direction: row;
    height: 100%;
    margin-bottom: 0;
}

.nav-item {
    height: 100%;
    display: flex;
    align-items: center;
}

/* BS3 navbar-inverse link styles */
.nav-link {
    color: var(--editor-ui-header-fg) !important;
    padding-top: 15px;
    padding-bottom: 15px;
    line-height: 20px;
    height: 100%;
    display: flex;
    align-items: center;
    border-radius: 0; /* Square */
    margin: 0;
    transition: color 0.2s, background-color 0.2s;
    font-size: 14px;
}

.nav-link:hover {
    color: var(--editor-ui-header-fg-active) !important;
    background-color: transparent; /* BS3 doesn't change bg on hover, only color */
}

/* BS3 navbar-inverse active styling */
.nav-link.active {
    color: var(--editor-ui-header-fg-active) !important;
    background-color: var(--editor-ui-header-bg-active) !important; /* Darker black background */
    box-shadow: none;
    border: none;
    margin-top: 0;
    z-index: auto;
}
</style>
