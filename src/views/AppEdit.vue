<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useTranslation } from "i18next-vue";
import { MaplatApp } from "@maplat/core";
import noImage from "../assets/img/no_image.png";
import { UndoStack } from "../services/editorUndoStack";

type LangCode = "ja" | "en" | "de" | "fr" | "es" | "ko" | "zh" | "zh-TW";
type SourceKind = "maplat" | "base-map";
type SourceRole = "maplat" | "base" | "overlay";

interface AppSource {
  sourceType: SourceKind;
  mapID: string;
  title: string;
  role: SourceRole;
  startFrom?: boolean;
  opacity?: number;
  data: any;
}

interface AppDocument {
  appID: string;
  originalAppID?: string;
  appName: Record<string, string>;
  title: Record<string, string>;
  description: Record<string, string>;
  lang: LangCode;
  sources: AppSource[];
  startFrom?: string;
  status?: string;
  extraInfo?: string;
}

interface MapListItem {
  mapID: string;
  title: string;
  image: string | null;
}

interface BaseMapItem {
  mapID: string;
  scope: "builtin" | "user";
  data: any;
}

const { t } = useTranslation();
const route = useRoute();
const router = useRouter();

const langsMap: Record<LangCode, string> = {
  ja: "japanese",
  en: "english",
  de: "germany",
  fr: "french",
  es: "spanish",
  ko: "korean",
  zh: "simplified",
  "zh-TW": "traditional",
};

const defaultApp = (): AppDocument => ({
  appID: "",
  appName: { ja: "", en: "", de: "", fr: "", es: "", ko: "", zh: "", "zh-TW": "" },
  title: { ja: "", en: "", de: "", fr: "", es: "", ko: "", zh: "", "zh-TW": "" },
  description: { ja: "", en: "", de: "", fr: "", es: "", ko: "", zh: "", "zh-TW": "" },
  lang: "ja",
  sources: [],
  status: "New",
  extraInfo: "",
});

const appData = ref<AppDocument>(defaultApp());
const originalAppData = ref<AppDocument>(defaultApp());
const activeTab = ref<"metadata" | "sources" | "preview">("metadata");
const sourceListMode = ref<"maps" | "baseMaps">("maps");
const currentLang = ref<LangCode>("ja");
const onlyOne = ref(false);
const appIDError = ref("appedit.check_uniqueness");
const saveError = ref<string | null>(null);
const mapItems = ref<MapListItem[]>([]);
const mapSearchQuery = ref("");
const mapCurrentPage = ref(1);
const mapHasNext = ref(true);
const baseMapItems = ref<BaseMapItem[]>([]);
const baseMapSearchQuery = ref("");
const previewError = ref<string | null>(null);
const historyStack = ref<UndoStack<AppDocument> | null>(null);
const historyApplying = ref(false);
let previewApp: MaplatApp | null = null;

const displayTitle = computed(() => localized(appData.value.title) || localized(appData.value.appName) || appData.value.appID);
const isDirty = computed(() => historyStack.value?.isDirty() ?? false);
const canUndo = computed(() => historyStack.value?.canUndo() ?? false);
const canRedo = computed(() => historyStack.value?.canRedo() ?? false);
const isDefaultLang = computed({
  get: () => appData.value.lang === currentLang.value,
  set: (checked: boolean) => {
    if (checked) {
      appData.value.lang = currentLang.value;
      recordHistory();
    }
  },
});
const titleText = computed({
  get: () => appData.value.title[currentLang.value] || "",
  set: (value: string) => {
    appData.value.title[currentLang.value] = value;
    appData.value.appName[currentLang.value] = value;
  },
});
const descriptionText = computed({
  get: () => appData.value.description[currentLang.value] || "",
  set: (value: string) => {
    appData.value.description[currentLang.value] = value;
  },
});
const filteredBaseMapItems = computed(() => {
  const query = baseMapSearchQuery.value.trim().toLowerCase();
  if (!query) return baseMapItems.value;
  return baseMapItems.value.filter((item) =>
    item.mapID.toLowerCase().includes(query) || baseMapTitle(item).toLowerCase().includes(query),
  );
});

onMounted(async () => {
  const appID = typeof route.query.appid === "string" ? route.query.appid : "";
  if (appID) {
    const loaded = await window.appedit.request(appID);
    if (loaded) {
      appData.value = normalizeAppDocument(loaded);
      appData.value.originalAppID = appID;
      onlyOne.value = true;
      appIDError.value = "";
    }
  }
  currentLang.value = appData.value.lang;
  resetHistoryBase();
  await Promise.all([loadMaps(1), loadBaseMaps()]);
});

onBeforeUnmount(() => {
  destroyPreview();
});

watch(activeTab, async (tab) => {
  if (tab === "preview") {
    await renderPreview();
  } else {
    destroyPreview();
  }
});

function cloneDocument(value: AppDocument): AppDocument {
  return JSON.parse(JSON.stringify(value));
}

function normalizeAppDocument(value: any): AppDocument {
  const normalized = defaultApp();
  normalized.appID = value.appID || value._id || "";
  normalized.originalAppID = value.originalAppID || normalized.appID;
  normalized.lang = value.lang || "ja";
  normalized.appName = normalizeLangObject(value.appName || value.title);
  normalized.title = normalizeLangObject(value.title || value.appName);
  normalized.description = normalizeLangObject(value.description);
  normalized.sources = Array.isArray(value.sources) ? value.sources.map(normalizeSource) : [];
  normalized.startFrom = value.startFrom || value.start_from;
  normalized.extraInfo = typeof value.extraInfo === "string" ? value.extraInfo : "";
  normalized.status = "Update";
  return normalized;
}

function normalizeLangObject(value: any): Record<string, string> {
  if (typeof value === "string") return { ja: value, en: value };
  return {
    ja: value?.ja || "",
    en: value?.en || "",
    de: value?.de || "",
    fr: value?.fr || "",
    es: value?.es || "",
    ko: value?.ko || "",
    zh: value?.zh || "",
    "zh-TW": value?.["zh-TW"] || "",
  };
}

function normalizeSource(value: any): AppSource {
  const sourceType: SourceKind = value.sourceType || (value.maptype === "maplat" || value.noload ? "maplat" : "base-map");
  const role: SourceRole = value.role || (sourceType === "maplat" ? "maplat" : value.maptype === "overlay" ? "overlay" : "base");
  return {
    sourceType,
    mapID: value.mapID,
    title: value.title || value.label || value.mapID,
    role,
    startFrom: Boolean(value.startFrom),
    opacity: value.opacity ?? 1,
    data: value.data || value,
  };
}

function localized(value: any): string {
  if (typeof value === "string") return value;
  return value?.[currentLang.value] || value?.[appData.value.lang] || value?.ja || value?.en || "";
}

function goBack() {
  router.push("/applist");
}

function resetHistoryBase() {
  const snapshot = cloneDocument(appData.value);
  originalAppData.value = cloneDocument(snapshot);
  historyStack.value = new UndoStack(snapshot);
}

function recordHistory() {
  if (historyApplying.value) return;
  historyStack.value?.push(cloneDocument(appData.value));
}

function performUndo() {
  if (!historyStack.value?.canUndo()) return;
  historyApplying.value = true;
  historyStack.value.undo();
  appData.value = cloneDocument(historyStack.value.current());
  currentLang.value = appData.value.lang;
  historyApplying.value = false;
}

function performRedo() {
  if (!historyStack.value?.canRedo()) return;
  historyApplying.value = true;
  historyStack.value.redo();
  appData.value = cloneDocument(historyStack.value.current());
  currentLang.value = appData.value.lang;
  historyApplying.value = false;
}

async function checkOnlyOne() {
  const appID = appData.value.appID.trim();
  if (!appID) {
    appIDError.value = "appedit.no_appid";
    return;
  }
  const available = await window.appedit.checkID(appID);
  appIDError.value = available || appID === appData.value.originalAppID ? "" : "appedit.duplicate_appid";
  if (!appIDError.value) onlyOne.value = true;
}

function changeAppID() {
  onlyOne.value = false;
  appIDError.value = "appedit.check_uniqueness";
}

async function saveApp() {
  saveError.value = null;
  if (!appData.value.appID.trim()) {
    saveError.value = t("appedit.no_appid");
    return;
  }
  if (!onlyOne.value || appIDError.value) {
    saveError.value = t("appedit.check_uniqueness");
    return;
  }
  const document = cloneDocument(appData.value);
  document.startFrom = appData.value.sources.find((source) => source.startFrom)?.mapID || appData.value.startFrom;
  document.status = "Update";
  const result = await window.appedit.save(document.appID, document);
  if (result === "Success") {
    appData.value = normalizeAppDocument(document);
    appData.value.originalAppID = document.appID;
    onlyOne.value = true;
    resetHistoryBase();
    await (window as any).dialog.showMessageBox({ type: "info", buttons: ["OK"], message: t("appedit.success_save") });
  } else if (result === "Exist") {
    saveError.value = t("appedit.duplicate_appid");
  } else {
    saveError.value = t("appedit.error_saving");
  }
}

async function loadMaps(page: number = 1) {
  const result = await window.maplist.request(mapSearchQuery.value, page);
  mapItems.value = result.docs;
  mapCurrentPage.value = result.pageUpdate ?? page;
  mapHasNext.value = result.next;
}

async function loadBaseMaps() {
  baseMapItems.value = await window.baseMaps.list();
}

async function addMapSource(item: MapListItem) {
  if (appData.value.sources.some((source) => source.mapID === item.mapID && source.sourceType === "maplat")) return;
  const mapObject = await window.mapedit.request(item.mapID);
  if (!mapObject.compiled) {
    previewError.value = t("appedit.preview.compiled_required");
  }
  appData.value.sources.push({
    sourceType: "maplat",
    mapID: item.mapID,
    title: item.title,
    role: "maplat",
    startFrom: appData.value.sources.length === 0,
    data: { ...mapObject, mapID: item.mapID, maptype: "maplat", noload: true },
  });
  ensureSingleStartFrom();
  recordHistory();
}

function addBaseMapSource(item: BaseMapItem) {
  if (appData.value.sources.some((source) => source.mapID === item.mapID && source.sourceType === "base-map")) return;
  const role: SourceRole = item.data?.maptype === "overlay" || item.data?.overlay ? "overlay" : "base";
  appData.value.sources.push({
    sourceType: "base-map",
    mapID: item.mapID,
    title: baseMapTitle(item),
    role,
    opacity: 1,
    data: { ...item.data, mapID: item.mapID, maptype: role === "overlay" ? "overlay" : (item.data?.maptype || "base") },
  });
  recordHistory();
}

function removeSource(index: number) {
  appData.value.sources.splice(index, 1);
  ensureSingleStartFrom();
  recordHistory();
}

function moveSource(index: number, delta: number) {
  const target = index + delta;
  if (target < 0 || target >= appData.value.sources.length) return;
  const [item] = appData.value.sources.splice(index, 1);
  appData.value.sources.splice(target, 0, item);
  recordHistory();
}

function setStartFrom(source: AppSource) {
  appData.value.sources.forEach((item) => {
    item.startFrom = item === source;
  });
  appData.value.startFrom = source.mapID;
  recordHistory();
}

function ensureSingleStartFrom() {
  const selected = appData.value.sources.find((source) => source.startFrom);
  if (!selected && appData.value.sources[0]) appData.value.sources[0].startFrom = true;
  appData.value.startFrom = appData.value.sources.find((source) => source.startFrom)?.mapID;
}

function sourceTitle(source: AppSource): string {
  return source.title || source.data?.title || source.mapID;
}

function baseMapTitle(item: BaseMapItem): string {
  return String(item.data?.title ?? item.data?.label ?? item.mapID);
}

function buildPreviewSetting() {
  const sources = appData.value.sources.map((source) => {
    const data = { ...source.data };
    data.mapID = source.mapID;
    if (source.sourceType === "maplat") {
      if (!data.compiled) {
        throw new Error(t("appedit.preview.compiled_required", { mapID: source.mapID }));
      }
      data.maptype = "maplat";
      data.noload = true;
      data.url = data.url || data.url_;
    }
    if (source.sourceType === "base-map") {
      data.maptype = source.role === "overlay" ? "overlay" : (data.maptype || "base");
    }
    return data;
  });
  return {
    appName: appData.value.appName,
    lang: appData.value.lang,
    title: appData.value.title,
    description: appData.value.description,
    homePosition: [139.767, 35.681],
    defaultZoom: 10,
    sources,
    startFrom: appData.value.startFrom || appData.value.sources.find((source) => source.startFrom)?.mapID,
  };
}

async function renderPreview() {
  destroyPreview();
  previewError.value = null;
  if (appData.value.sources.length === 0) {
    previewError.value = t("appedit.preview.no_sources");
    return;
  }
  await nextTick();
  try {
    previewApp = new MaplatApp({
      div: "appPreviewMap",
      setting: buildPreviewSetting(),
      restoreSession: false,
      enableCache: false,
    });
    await previewApp.waitReady;
  } catch (e) {
    console.error("[AppEdit] Preview failed:", e);
    previewError.value = e instanceof Error ? e.message : String(e);
    destroyPreview();
  }
}

function destroyPreview() {
  if (previewApp) {
    previewApp.remove();
    previewApp = null;
  }
}
</script>

<template>
  <div class="d-flex flex-column h-100 text-start">
    <div class="px-4 py-3 pb-0 d-flex align-items-center flex-shrink-0 bg-white">
      <div class="row w-100 align-items-center g-2">
        <div class="col-5 d-flex align-items-center gap-2">
          <h4>
            <a href="#" class="text-decoration-none" @click.prevent="goBack">&lt;&lt;</a>
            <span class="ms-2 text-dark">{{ displayTitle || appData.appID || t("appedit.new_app") }}</span>
          </h4>
        </div>
        <div class="col-1 text-end">
          <label class="fw-bold" for="appLang">{{ t("common.language") }}</label>
        </div>
        <div class="col-2">
          <select id="appLang" v-model="currentLang" class="form-select">
            <option v-for="(v, k) in langsMap" :key="k" :value="k">{{ t("common." + v) }}</option>
          </select>
        </div>
        <div class="col-2">
          <div class="form-check d-flex align-items-center gap-1">
            <input id="appLangDefault" v-model="isDefaultLang" class="form-check-input" type="checkbox" :disabled="isDefaultLang">
            <label class="form-check-label fw-bold" for="appLangDefault">{{ t("mapedit.set_default") }}</label>
          </div>
        </div>
        <div class="col-2 d-flex gap-1">
          <button type="button" class="btn btn-outline-secondary w-50" :disabled="!canUndo" @click="performUndo">{{ t("menu.undo") }}</button>
          <button type="button" class="btn btn-outline-secondary w-50" :disabled="!canRedo" @click="performRedo">{{ t("menu.redo") }}</button>
        </div>
        <div class="col-2 text-end">
          <button type="button" class="btn btn-primary w-100" :disabled="!!saveError || !isDirty" @click="saveApp">{{ t("common.save") }}</button>
        </div>
      </div>
    </div>

    <div class="px-4 mt-2">
      <ul class="nav nav-tabs nav-fill bg-white flex-shrink-0 border-bottom-0">
        <li class="nav-item">
          <a class="nav-link" :class="{ active: activeTab === 'metadata' }" href="#" @click.prevent="activeTab = 'metadata'">
            {{ t("appedit.edit_metadata") }}
          </a>
        </li>
        <li class="nav-item">
          <a class="nav-link" :class="{ active: activeTab === 'sources' }" href="#" @click.prevent="activeTab = 'sources'">
            {{ t("appedit.edit_sources") }}
          </a>
        </li>
        <li class="nav-item">
          <a class="nav-link" :class="{ active: activeTab === 'preview' }" href="#" @click.prevent="activeTab = 'preview'">
            {{ t("appedit.preview_tab") }}
          </a>
        </li>
      </ul>
    </div>

    <div class="flex-grow-1 position-relative overflow-hidden bg-white border-top">
      <div v-show="activeTab === 'metadata'" class="h-100 overflow-auto p-3">
        <form class="container-fluid" @submit.prevent>
          <div class="row g-1 mb-2">
            <div class="col-md-3" :class="appIDError && appIDError !== 'appedit.check_uniqueness' ? 'has-error' : ''">
              <label class="form-label fw-bold small mb-0">{{ t("appedit.appid") }}</label>
              <input
                v-model="appData.appID"
                type="text"
                class="form-control form-control-sm"
                :class="appIDError && appIDError !== 'appedit.check_uniqueness' ? 'is-invalid' : ''"
                :disabled="onlyOne"
                :placeholder="t('appedit.input_appid')"
                @input="appIDError = 'appedit.check_uniqueness'; recordHistory()"
              />
              <div v-if="appIDError" class="form-text small text-danger mb-0" style="font-size: 0.75rem;">
                {{ t(appIDError) }}
              </div>
              <div v-else class="form-text small mb-0" style="font-size: 0.75rem;">{{ t("appedit.unique_appid") }}</div>
            </div>
            <div class="col-md-2 d-flex align-items-start pt-4">
              <button v-if="onlyOne" class="btn btn-danger btn-sm w-100 mt-1" @click="changeAppID">
                {{ t("appedit.change_appid") }}
              </button>
              <button v-else class="btn btn-secondary btn-sm w-100 mt-1" @click="checkOnlyOne">
                {{ t("appedit.uniqueness_button") }}
              </button>
            </div>
            <div class="col-md-7">
              <label class="form-label fw-bold small mb-0">{{ t("appedit.app_name") }}</label>
              <input v-model="titleText" type="text" class="form-control form-control-sm" @input="recordHistory">
            </div>
          </div>
          <div class="row g-1 mb-2">
            <div class="col-12">
              <label class="form-label fw-bold small mb-0">{{ t("appedit.description") }}</label>
              <textarea v-model="descriptionText" class="form-control form-control-sm" rows="5" @input="recordHistory" />
            </div>
          </div>
          <div class="row g-1">
            <div class="col-12">
              <label class="form-label fw-bold small mb-0">{{ t("appedit.extra_info") }}</label>
              <textarea v-model="appData.extraInfo" class="form-control form-control-sm font-monospace" rows="8" @input="recordHistory" />
            </div>
          </div>
          <div v-if="saveError" class="alert alert-danger mt-3">{{ saveError }}</div>
        </form>
      </div>

      <div v-show="activeTab === 'sources'" class="h-100 p-3 source-editor">
        <div class="source-pane border-end pe-3">
          <div class="source-pane-toolbar pb-2">
            <div class="btn-group w-100 mb-2" role="group">
              <button class="btn btn-sm" :class="sourceListMode === 'maps' ? 'btn-primary' : 'btn-outline-primary'" @click="sourceListMode = 'maps'">
                {{ t("appedit.map_list") }}
              </button>
              <button class="btn btn-sm" :class="sourceListMode === 'baseMaps' ? 'btn-primary' : 'btn-outline-primary'" @click="sourceListMode = 'baseMaps'">
                {{ t("appedit.base_map_list") }}
              </button>
            </div>

            <input
              v-if="sourceListMode === 'maps'"
              v-model="mapSearchQuery"
              class="form-control form-control-sm"
              :placeholder="t('maplist.search_placeholder')"
              @input="loadMaps(1)"
            >
            <input
              v-else
              v-model="baseMapSearchQuery"
              class="form-control form-control-sm"
              :placeholder="t('appedit.search_base_maps')"
            >
          </div>

          <div v-if="sourceListMode === 'maps'">
            <div class="source-list">
              <button v-for="item in mapItems" :key="item.mapID" type="button" class="source-row" @click="addMapSource(item)">
                <img :src="item.image || noImage" :alt="item.title">
                <span>{{ item.title }}</span>
              </button>
            </div>
            <div class="d-flex justify-content-center gap-2 mt-2">
              <button class="btn btn-sm btn-outline-secondary" :disabled="mapCurrentPage <= 1" @click="loadMaps(mapCurrentPage - 1)">&lt;</button>
              <button class="btn btn-sm btn-outline-secondary" :disabled="!mapHasNext" @click="loadMaps(mapCurrentPage + 1)">&gt;</button>
            </div>
          </div>

          <div v-else>
            <div class="source-list">
              <button v-for="item in filteredBaseMapItems" :key="`${item.scope}:${item.mapID}`" type="button" class="source-row" @click="addBaseMapSource(item)">
                <span class="base-map-thumb">{{ item.scope === "builtin" ? "B" : "U" }}</span>
                <span>{{ baseMapTitle(item) }}</span>
              </button>
            </div>
          </div>
        </div>

        <div class="selected-pane ps-3">
          <h5>{{ t("appedit.selected_sources") }}</h5>
          <div v-if="appData.sources.length === 0" class="text-muted py-3">{{ t("appedit.no_selected_sources") }}</div>
          <div v-else class="selected-list">
            <div v-for="(source, index) in appData.sources" :key="`${source.sourceType}:${source.mapID}`" class="selected-source border rounded p-2 mb-2">
              <div class="d-flex align-items-center justify-content-between gap-2">
                <div>
                  <div class="fw-bold">{{ sourceTitle(source) }}</div>
                  <small class="text-muted">{{ source.mapID }} / {{ t(`appedit.roles.${source.role}`) }}</small>
                </div>
                <div class="btn-group btn-group-sm">
                  <button class="btn btn-outline-secondary" :disabled="index === 0" @click="moveSource(index, -1)">↑</button>
                  <button class="btn btn-outline-secondary" :disabled="index === appData.sources.length - 1" @click="moveSource(index, 1)">↓</button>
                  <button class="btn btn-outline-danger" @click="removeSource(index)">×</button>
                </div>
              </div>
              <div class="row g-2 mt-2 align-items-center">
                <div class="col-auto">
                  <div class="form-check">
                    <input :id="`start-${index}`" class="form-check-input" type="radio" name="startFrom" :checked="source.startFrom" @change="setStartFrom(source)">
                    <label class="form-check-label" :for="`start-${index}`">{{ t("appedit.start_from") }}</label>
                  </div>
                </div>
                <div v-if="source.sourceType === 'base-map'" class="col-auto">
                  <select v-model="source.role" class="form-select form-select-sm" @change="recordHistory">
                    <option value="base">{{ t("appedit.roles.base") }}</option>
                    <option value="overlay">{{ t("appedit.roles.overlay") }}</option>
                  </select>
                </div>
                <div v-if="source.role === 'overlay'" class="col-auto">
                  <input v-model.number="source.opacity" type="number" min="0" max="1" step="0.05" class="form-control form-control-sm opacity-input" @change="recordHistory">
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div v-show="activeTab === 'preview'" class="h-100 position-relative">
        <div id="appPreviewMap" class="preview-map"></div>
        <div v-if="previewError" class="alert alert-warning preview-error">{{ previewError }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.source-editor {
  display: grid;
  grid-template-columns: minmax(280px, 36%) 1fr;
  gap: 0;
  overflow: hidden;
}
.source-pane,
.selected-pane {
  min-height: 0;
  overflow: auto;
}
.source-pane {
  display: flex;
  flex-direction: column;
}
.source-pane-toolbar {
  position: sticky;
  top: 0;
  z-index: 2;
  background: #fff;
}
.source-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 0;
}
.source-row {
  display: grid;
  grid-template-columns: 48px 1fr;
  align-items: center;
  gap: 8px;
  width: 100%;
  border: 1px solid var(--bs-border-color);
  background: #fff;
  border-radius: 4px;
  padding: 6px;
  text-align: left;
}
.source-row img,
.base-map-thumb {
  width: 48px;
  height: 48px;
  object-fit: contain;
  background: #f8f9fa;
  border: 1px solid var(--bs-border-color);
}
.base-map-thumb {
  display: grid;
  place-items: center;
  font-weight: 700;
  color: #6c757d;
}
.opacity-input {
  width: 6rem;
}
.preview-map {
  position: absolute;
  inset: 0;
}
.preview-error {
  position: absolute;
  top: 12px;
  left: 12px;
  right: 12px;
  z-index: 5;
}
</style>
