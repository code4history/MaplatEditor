<template>
  <div class="h-100 d-flex flex-column">
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
                <!-- UI言語の選択肢は自言語表記(autonym): 現在のUI言語が読めなくても自分の言語を探せる -->
                <select
                  class="form-select"
                  id="langSwitcher"
                  v-model="state.lang"
                >
                  <option v-for="entry in SUPPORTED_LANGUAGES" :key="entry.code" :value="entry.code">
                    {{ entry.nativeName }}
                  </option>
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

            <!-- M5-T6: JPEG デコード上限（大きな地図画像が取り込めないときに引き上げる） -->
            <div class="row mb-3 align-items-center">
              <label for="jpegDecodeMaxMemoryMB" class="col-sm-3 col-form-label text-end">{{
                t("settings.jpeg_decode_max_memory")
              }}</label>
              <div class="col-sm-9">
                <input
                  type="number"
                  class="form-control"
                  id="jpegDecodeMaxMemoryMB"
                  min="512"
                  step="1"
                  v-model.number="state.jpegDecodeMaxMemoryMB"
                />
              </div>
            </div>

            <div class="row mb-3 align-items-center">
              <label for="jpegDecodeMaxResolutionMP" class="col-sm-3 col-form-label text-end">{{
                t("settings.jpeg_decode_max_resolution")
              }}</label>
              <div class="col-sm-9">
                <input
                  type="number"
                  class="form-control"
                  id="jpegDecodeMaxResolutionMP"
                  min="100"
                  step="1"
                  v-model.number="state.jpegDecodeMaxResolutionMP"
                />
                <div class="form-text">{{ t("settings.jpeg_decode_desc") }}</div>
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
                <!-- UIが読めない言語のままでも保存操作が判別できるよう、言語非依存のアイコンを併記 -->
                <button
                  type="button"
                  class="btn btn-primary"
                  :disabled="!isDirty"
                  @click="saveSettings"
                >
                  <i class="bi bi-save me-1"></i>{{ t("common.save") }}
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
import { SUPPORTED_LANGUAGES } from "../utils/editorLanguages";

const { t, i18next } = useTranslation();
const activeTab = ref("basic");

// State for form values
const state = reactive({
  lang: "ja",
  saveFolder: "",
  jpegDecodeMaxMemoryMB: 8192,
  jpegDecodeMaxResolutionMP: 800,
});

// Original values for dirty checking
const original = reactive({
  lang: "ja",
  saveFolder: "",
  jpegDecodeMaxMemoryMB: 8192,
  jpegDecodeMaxResolutionMP: 800,
});

const isDirty = computed(() => {
  return (
    state.lang !== original.lang ||
    state.saveFolder !== original.saveFolder ||
    state.jpegDecodeMaxMemoryMB !== original.jpegDecodeMaxMemoryMB ||
    state.jpegDecodeMaxResolutionMP !== original.jpegDecodeMaxResolutionMP
  );
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
    // M5-T6: 値の正規化は main 側（SettingsService）に閉じているので、ここでは受け取るだけ
    for (const key of ["jpegDecodeMaxMemoryMB", "jpegDecodeMaxResolutionMP"] as const) {
      const value = await window.settings.get(key);
      if (typeof value === "number") {
        state[key] = value;
        original[key] = value;
      }
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
    state.jpegDecodeMaxMemoryMB = original.jpegDecodeMaxMemoryMB;
    state.jpegDecodeMaxResolutionMP = original.jpegDecodeMaxResolutionMP;
    if (i18next.language !== state.lang) {
        await i18next.changeLanguage(state.lang);
    }
};

const saveSettings = async () => {
    await window.settings.set("lang", state.lang);
    await window.settings.set("saveFolder", state.saveFolder);
    await window.settings.set("jpegDecodeMaxMemoryMB", state.jpegDecodeMaxMemoryMB);
    await window.settings.set("jpegDecodeMaxResolutionMP", state.jpegDecodeMaxResolutionMP);

    // Update original to match new saved state.
    // M5-T6: 正規化後の値を読み直す（下限で丸められた場合に画面と保存値がずれないように）
    original.lang = state.lang;
    original.saveFolder = state.saveFolder;
    for (const key of ["jpegDecodeMaxMemoryMB", "jpegDecodeMaxResolutionMP"] as const) {
      const saved = await window.settings.get(key);
      if (typeof saved === "number") {
        state[key] = saved;
        original[key] = saved;
      }
    }

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
