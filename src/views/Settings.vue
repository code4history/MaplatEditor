<template>
  <div class="h-100 d-flex flex-column">
    <Header />
    <div class="container-fluid main flex-grow-1 mt-4 px-4">
      <!-- Tabs -->
      <ul class="nav nav-tabs nav-justified mb-3" role="tablist">
        <li class="nav-item">
          <a
            class="nav-link"
            :class="{ active: activeTab === 'basic' }"
            href="#"
            @click.prevent="activeTab = 'basic'"
            >{{ t("settings.basic_settings") }}</a
          >
        </li>
        <li class="nav-item">
          <a
            class="nav-link disabled"
            :class="{ active: activeTab === 'basemap' }"
            href="#"
            @click.prevent=""
            >{{ t("settings.base_map") }}</a
          >
        </li>
        <li class="nav-item">
          <a
            class="nav-link disabled"
            :class="{ active: activeTab === 'original' }"
            href="#"
            @click.prevent=""
            >{{ t("settings.original_map") }}</a
          >
        </li>
      </ul>

      <div class="tab-content">
        <!-- Basic Settings Tab -->
        <div
          class="tab-pane fade"
          :class="{ 'show active': activeTab === 'basic' }"
          id="basic"
          role="tabpanel"
        >
          <form class="form-horizontal">
            <!-- Language Switcher -->
            <div class="row mb-3 align-items-center">
              <label for="langSwitcher" class="col-sm-3 col-form-label text-end">{{
                t("settings.switch_lang")
              }}</label>
              <div class="col-sm-9">
                <select
                  class="form-select"
                  id="langSwitcher"
                  v-model="state.lang"
                >
                  <option value="ja">日本語</option>
                  <option value="en">English</option>
                </select>
              </div>
            </div>

            <!-- Data Folder -->
            <div class="row mb-3 align-items-center">
              <label for="saveFolder" class="col-sm-3 col-form-label text-end">{{
                t("settings.data_folder")
              }}</label>
              <div class="col-sm-9">
                <div class="input-group">
                  <input
                    type="text"
                    class="form-control"
                    id="saveFolder"
                    :placeholder="t('settings.specify_data_folder')"
                    v-model="state.saveFolder"
                    @click="showFolderDialog"
                    readonly
                  />
                </div>
              </div>
            </div>

            <!-- Buttons -->
            <div class="row">
              <div class="col-sm-9 offset-sm-3 d-flex justify-content-end gap-2">
                <button
                  type="button"
                  class="btn btn-light border"
                  :disabled="!isDirty"
                  @click="resetSettings"
                >
                  {{ t("common.reset") }}
                </button>
                <button
                  type="button"
                  class="btn btn-primary"
                  :disabled="!isDirty"
                  @click="saveSettings"
                >
                  {{ t("common.save_with_english") }}
                </button>
              </div>
            </div>
          </form>
        </div>

        <!-- Base Map Settings Tab (Empty/Disabled) -->
        <div
          class="tab-pane fade"
          :class="{ 'show active': activeTab === 'basemap' }"
          id="basemap"
          role="tabpanel"
        ></div>

        <!-- Original Map Settings Tab (Empty/Disabled) -->
        <div
          class="tab-pane fade"
          :class="{ 'show active': activeTab === 'original' }"
          id="original"
          role="tabpanel"
        ></div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, onMounted, ref, computed } from "vue";
import { useTranslation } from "i18next-vue";
import Header from "../components/Header.vue";

const { t, i18next } = useTranslation();
const activeTab = ref("basic");

// State for form values
const state = reactive({
  lang: "ja",
  saveFolder: "",
});

// Original values for dirty checking
const original = reactive({
  lang: "ja",
  saveFolder: "",
});

const isDirty = computed(() => {
  return state.lang !== original.lang || state.saveFolder !== original.saveFolder;
});

onMounted(async () => {
  try {
    const lang = await window.settings.get("lang");
    if (lang) {
      state.lang = lang;
      original.lang = lang;
      if (i18next.language !== lang) {
        await i18next.changeLanguage(lang);
      }
    }
    const saveFolder = await window.settings.get("saveFolder");
    if (saveFolder) {
      state.saveFolder = saveFolder;
      original.saveFolder = saveFolder;
    }
  } catch (e) {
    console.error("Failed to load settings:", e);
  }
});

const showFolderDialog = async () => {
  const path = await window.settings.showSaveFolderDialog();
  if (path) {
    state.saveFolder = path; // Only update state, not original, so it becomes dirty
  }
};

const resetSettings = async () => {
    state.lang = original.lang;
    state.saveFolder = original.saveFolder;
    if (i18next.language !== state.lang) {
        await i18next.changeLanguage(state.lang);
    }
};

const saveSettings = async () => {
    await window.settings.set("lang", state.lang);
    await window.settings.set("saveFolder", state.saveFolder);
    
    // Update original to match new saved state
    original.lang = state.lang;
    original.saveFolder = state.saveFolder;

    if (i18next.language !== state.lang) {
        await i18next.changeLanguage(state.lang);
    }
};
</script>

<style scoped>
/* Removed max-width restriction to allow full expansion */
.container-fluid.main {
    width: 100%;
}
</style>
