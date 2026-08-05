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
            class="nav-link"
            :class="{ active: activeTab === 'basemap' }"
            href="#"
            data-testid="settings-basemap-tab"
            @click.prevent="activeTab = 'basemap'"
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
                  :placeholder="t('settings.jpeg_decode_auto')"
                  v-model="state.jpegDecodeMaxMemoryMB"
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
                  :placeholder="t('settings.jpeg_decode_auto')"
                  v-model="state.jpegDecodeMaxResolutionMP"
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

        <!-- Base Map Settings Tab (m6-t6: API キーの3段構成) -->
        <div
          class="tab-pane fade"
          :class="{ 'show active': activeTab === 'basemap' }"
          id="basemap"
          role="tabpanel"
        >
          <form class="form-horizontal">
            <h5>{{ t("settings.editor_api_key_heading") }}</h5>
            <p class="form-text">{{ t("settings.editor_api_key_notice") }}</p>

            <div class="row mb-2 align-items-center">
              <label for="editorGoogleApiKey" class="col-sm-3 col-form-label text-end">{{
                t("settings.editor_google_api_key")
              }}</label>
              <div class="col-sm-9">
                <input
                  type="text"
                  class="form-control"
                  id="editorGoogleApiKey"
                  data-testid="settings-editor-google-api-key"
                  v-model="state.editorGoogleApiKey"
                />
              </div>
            </div>
            <div class="row mb-3 align-items-center">
              <div class="col-sm-9 offset-sm-3">
                <div
                  v-if="sameKeyWarning.google"
                  class="text-warning small"
                  data-testid="settings-same-key-warning-google"
                >
                  {{ t("settings.same_key_warning", { provider: t("basemap.kind.label_google") }) }}
                </div>
              </div>
            </div>

            <div class="row mb-2 align-items-center">
              <label for="editorMapboxToken" class="col-sm-3 col-form-label text-end">{{
                t("settings.editor_mapbox_token")
              }}</label>
              <div class="col-sm-9">
                <input
                  type="text"
                  class="form-control"
                  id="editorMapboxToken"
                  data-testid="settings-editor-mapbox-token"
                  v-model="state.editorMapboxToken"
                />
              </div>
            </div>
            <div class="row mb-3 align-items-center">
              <div class="col-sm-9 offset-sm-3">
                <div
                  v-if="sameKeyWarning.mapbox"
                  class="text-warning small"
                  data-testid="settings-same-key-warning-mapbox"
                >
                  {{ t("settings.same_key_warning", { provider: t("basemap.kind.label_mapbox") }) }}
                </div>
              </div>
            </div>

            <h5 class="mt-4">{{ t("settings.default_publish_api_key_heading") }}</h5>
            <p class="form-text">{{ t("settings.default_publish_api_key_notice") }}</p>

            <div class="row mb-3 align-items-center">
              <label for="defaultPublishGoogleApiKey" class="col-sm-3 col-form-label text-end">{{
                t("settings.default_publish_google_api_key")
              }}</label>
              <div class="col-sm-9">
                <input
                  type="text"
                  class="form-control"
                  id="defaultPublishGoogleApiKey"
                  data-testid="settings-default-publish-google-api-key"
                  v-model="state.defaultPublishGoogleApiKey"
                />
              </div>
            </div>

            <div class="row mb-3 align-items-center">
              <label for="defaultPublishMapboxToken" class="col-sm-3 col-form-label text-end">{{
                t("settings.default_publish_mapbox_token")
              }}</label>
              <div class="col-sm-9">
                <input
                  type="text"
                  class="form-control"
                  id="defaultPublishMapboxToken"
                  data-testid="settings-default-publish-mapbox-token"
                  v-model="state.defaultPublishMapboxToken"
                />
              </div>
            </div>

            <!-- Buttons（basic タブと同じ共有 state を保存/破棄する） -->
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
                  <i class="bi bi-save me-1"></i>{{ t("common.save") }}
                </button>
              </div>
            </div>
          </form>
        </div>

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

// m6-t6: ベースマップタブの4キー（エディタ用×2 + 既定公開用×2）。onMounted/saveSettings で
// ループ処理するための一覧（R9 の既存パターンと同型）
const BASEMAP_KEY_FIELDS = [
  "editorGoogleApiKey",
  "editorMapboxToken",
  "defaultPublishGoogleApiKey",
  "defaultPublishMapboxToken",
] as const;

// State for form values
// M5-T8: JPEG デコードのキャップは既定が「自動」。UI では**空文字**が自動を表す
// （`v-model.number` は空欄で '' を返すため、number 型では自動を表現できない。
//  ∴ 文字列で持ち、保存時に null へ写像する）
const state = reactive<{
  lang: string;
  saveFolder: string;
  jpegDecodeMaxMemoryMB: string;
  jpegDecodeMaxResolutionMP: string;
  editorGoogleApiKey: string;
  editorMapboxToken: string;
  defaultPublishGoogleApiKey: string;
  defaultPublishMapboxToken: string;
}>({
  lang: "ja",
  saveFolder: "",
  jpegDecodeMaxMemoryMB: "",
  jpegDecodeMaxResolutionMP: "",
  editorGoogleApiKey: "",
  editorMapboxToken: "",
  defaultPublishGoogleApiKey: "",
  defaultPublishMapboxToken: "",
});

// Original values for dirty checking
const original = reactive<{
  lang: string;
  saveFolder: string;
  jpegDecodeMaxMemoryMB: string;
  jpegDecodeMaxResolutionMP: string;
  editorGoogleApiKey: string;
  editorMapboxToken: string;
  defaultPublishGoogleApiKey: string;
  defaultPublishMapboxToken: string;
}>({
  lang: "ja",
  saveFolder: "",
  jpegDecodeMaxMemoryMB: "",
  jpegDecodeMaxResolutionMP: "",
  editorGoogleApiKey: "",
  editorMapboxToken: "",
  defaultPublishGoogleApiKey: "",
  defaultPublishMapboxToken: "",
});

// m6-t6 (§3.3): エディタ用キーと既定公開用キーが非空かつ同一値の場合の警告
// （マイルストーン §2.2「エディタ用キーを公開用キーとして流用するトグルは作らない。
// 同一値の場合は警告を出す」）
const sameKeyWarning = computed(() => ({
  google:
    state.editorGoogleApiKey !== "" &&
    state.editorGoogleApiKey === state.defaultPublishGoogleApiKey,
  mapbox:
    state.editorMapboxToken !== "" &&
    state.editorMapboxToken === state.defaultPublishMapboxToken,
}));

/** 保存値（number | null）を UI の文字列表現へ。null / 未設定 = 自動 = 空文字 */
const capToField = (value: unknown): string =>
  typeof value === "number" && Number.isFinite(value) ? String(value) : "";

const isDirty = computed(() => {
  return (
    state.lang !== original.lang ||
    state.saveFolder !== original.saveFolder ||
    state.jpegDecodeMaxMemoryMB !== original.jpegDecodeMaxMemoryMB ||
    state.jpegDecodeMaxResolutionMP !== original.jpegDecodeMaxResolutionMP ||
    BASEMAP_KEY_FIELDS.some((key) => state[key] !== original[key])
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
    // M5-T6/M5-T8: 値の正規化は main 側（SettingsService）に閉じているので、ここでは受け取るだけ。
    // null（自動）は空欄として表示する
    for (const key of ["jpegDecodeMaxMemoryMB", "jpegDecodeMaxResolutionMP"] as const) {
      const value = await window.settings.get(key);
      state[key] = capToField(value);
      original[key] = state[key];
    }
    // m6-t6: ベースマップタブの4キー（未設定時は window.settings.get が undefined を返す）
    for (const key of BASEMAP_KEY_FIELDS) {
      const value = await window.settings.get(key);
      state[key] = typeof value === "string" ? value : "";
      original[key] = state[key];
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
    for (const key of BASEMAP_KEY_FIELDS) {
      state[key] = original[key];
    }
    if (i18next.language !== state.lang) {
        await i18next.changeLanguage(state.lang);
    }
};

const saveSettings = async () => {
    await window.settings.set("lang", state.lang);
    await window.settings.set("saveFolder", state.saveFolder);
    // M5-T8: 空欄は「自動」= null として送る（main 側の normalizeJpegDecodeCap が受ける）
    await window.settings.set("jpegDecodeMaxMemoryMB", state.jpegDecodeMaxMemoryMB === "" ? null : state.jpegDecodeMaxMemoryMB);
    await window.settings.set("jpegDecodeMaxResolutionMP", state.jpegDecodeMaxResolutionMP === "" ? null : state.jpegDecodeMaxResolutionMP);
    for (const key of BASEMAP_KEY_FIELDS) {
      await window.settings.set(key, state[key]);
    }

    // Update original to match new saved state.
    // M5-T6/M5-T8: 正規化後の値を読み直す（下限で丸められた場合・**機械安全枠の上限で
    // 切り下げられた場合**に画面と保存値がずれないように）
    original.lang = state.lang;
    original.saveFolder = state.saveFolder;
    for (const key of ["jpegDecodeMaxMemoryMB", "jpegDecodeMaxResolutionMP"] as const) {
      const saved = await window.settings.get(key);
      state[key] = capToField(saved);
      original[key] = state[key];
    }
    // m6-t6: ベースマップキーは正規化を挟まないので読み直し不要。dirty 判定を閉じるだけでよい
    for (const key of BASEMAP_KEY_FIELDS) {
      original[key] = state[key];
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
