<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useTranslation } from "i18next-vue";
import noImage from "../assets/img/no_image.png";
import { UndoStack } from "../services/editorUndoStack";

type LangCode = "ja" | "en" | "de" | "fr" | "es" | "ko" | "zh" | "zh-TW";
type SourceKind = "maplat" | "base-map";
type SourceRole = "maplat" | "base" | "overlay";

interface AppSource {
  sourceType: SourceKind;
  mapID: string;
  title: string;
  label: Record<string, string>;
  role: SourceRole;
  startFrom?: boolean;
  opacity?: number;
  thumbnail?: string;
  data: any;
}

interface HttpSettings {
  previewPort: number;
  pwaManifest: boolean;
  overlay: boolean;
  enableHideMarker: boolean;
  enableBorder: boolean;
  enableCache: boolean;
  stateUrl: boolean;
  enableShare: boolean;
  iconSource: string;
  mapboxToken: string;
  googleApiKey: string;
}

interface AppRuntimeSettings {
  splash: string;
  fakeGps: boolean;
  fakeCenter: string;
  fakeRadius: number;
  homeLng: number;
  homeLat: number;
  defaultZoom: number;
}

interface ManifestSettings {
  name: string;
  shortName: string;
  backgroundColor: string;
  themeColor: string;
  display: string;
  startUrl: string;
  scope: string;
  iconsJson: string;
}

interface AppDocument {
  appID: string;
  originalAppID?: string;
  appName: Record<string, string>;
  title: Record<string, string>;
  description: Record<string, string>;
  lang: LangCode;
  sources: AppSource[];
  httpSettings: HttpSettings;
  appSettings: AppRuntimeSettings;
  manifestSettings: ManifestSettings;
  poiSources: string;
  startFrom?: string;
  status?: string;
  extraInfo?: string;
}

interface MapListItem {
  mapID: string;
  title: string;
  image: string | null;
  previewDisabled?: boolean;
  previewDisabledReason?: string;
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
  httpSettings: {
    previewPort: 41781,
    pwaManifest: true,
    overlay: true,
    enableHideMarker: true,
    enableBorder: true,
    enableCache: true,
    stateUrl: true,
    enableShare: true,
    iconSource: "",
    mapboxToken: "",
    googleApiKey: "",
  },
  appSettings: {
    splash: "",
    fakeGps: false,
    fakeCenter: "",
    fakeRadius: 10,
    homeLng: 139.767,
    homeLat: 35.681,
    defaultZoom: 17,
  },
  manifestSettings: {
    name: "",
    shortName: "",
    backgroundColor: "#f6f0d3",
    themeColor: "#f6f0d3",
    display: "standalone",
    startUrl: "./",
    scope: "./",
    iconsJson: "[]",
  },
  poiSources: "[]",
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
const previewUrl = ref("");
const historyStack = ref<UndoStack<AppDocument> | null>(null);
const historyApplying = ref(false);

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
  normalized.httpSettings = normalizeHttpSettings(value.httpSettings || value.http || value);
  normalized.appSettings = normalizeAppSettings(value.appSettings || value);
  normalized.manifestSettings = normalizeManifestSettings(value.manifestSettings || value.manifest || {});
  normalized.poiSources = JSON.stringify(value.poiSources || value.pois || [], null, 2);
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
  const data = value.data || value;
  const title = value.title || value.label || data?.title || data?.label || value.mapID;
  return {
    sourceType,
    mapID: value.mapID,
    title: typeof title === "string" ? title : localizedWithLang(title, "ja") || value.mapID,
    label: normalizeLangObject(value.label || data?.label || title),
    role,
    startFrom: Boolean(value.startFrom),
    opacity: value.opacity ?? 1,
    thumbnail: value.thumbnail || data?.thumbnail,
    data,
  };
}

function normalizeHttpSettings(value: any): HttpSettings {
  const defaults = defaultApp().httpSettings;
  return {
    ...defaults,
    previewPort: Number(value.previewPort || defaults.previewPort),
    pwaManifest: value.pwaManifest ?? defaults.pwaManifest,
    overlay: value.overlay ?? defaults.overlay,
    enableHideMarker: value.enableHideMarker ?? defaults.enableHideMarker,
    enableBorder: value.enableBorder ?? defaults.enableBorder,
    enableCache: value.enableCache ?? defaults.enableCache,
    stateUrl: value.stateUrl ?? defaults.stateUrl,
    enableShare: value.enableShare ?? defaults.enableShare,
    iconSource: value.iconSource || "",
    mapboxToken: value.mapboxToken || "",
    googleApiKey: value.googleApiKey || "",
  };
}

function normalizeAppSettings(value: any): AppRuntimeSettings {
  const defaults = defaultApp().appSettings;
  const home = value.home_position || value.homePosition;
  return {
    splash: value.splash || defaults.splash,
    fakeGps: value.fakeGps ?? value.fake_gps ?? defaults.fakeGps,
    fakeCenter: value.fakeCenter || value.fake_center || defaults.fakeCenter,
    fakeRadius: Number(value.fakeRadius ?? value.fake_radius ?? defaults.fakeRadius),
    homeLng: Number(value.homeLng ?? home?.[0] ?? defaults.homeLng),
    homeLat: Number(value.homeLat ?? home?.[1] ?? defaults.homeLat),
    defaultZoom: Number(value.defaultZoom ?? value.default_zoom ?? defaults.defaultZoom),
  };
}

function normalizeManifestSettings(value: any): ManifestSettings {
  const defaults = defaultApp().manifestSettings;
  return {
    ...defaults,
    name: value.name || "",
    shortName: value.shortName || value.short_name || "",
    backgroundColor: value.backgroundColor || value.background_color || defaults.backgroundColor,
    themeColor: value.themeColor || value.theme_color || defaults.themeColor,
    display: value.display || defaults.display,
    startUrl: value.startUrl || value.start_url || defaults.startUrl,
    scope: value.scope || defaults.scope,
    iconsJson: typeof value.iconsJson === "string" ? value.iconsJson : JSON.stringify(value.icons || [], null, 2),
  };
}

function localized(value: any): string {
  if (typeof value === "string") return value;
  return value?.[currentLang.value] || value?.[appData.value.lang] || value?.ja || value?.en || "";
}

function localizedWithLang(value: any, lang: string): string {
  if (typeof value === "string") return value;
  return value?.[lang] || value?.ja || value?.en || "";
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
  try {
    (document.manifestSettings as any).icons = JSON.parse(document.manifestSettings.iconsJson || "[]");
    (document as any).pois = JSON.parse(document.poiSources || "[]");
  } catch {
    saveError.value = t("appedit.invalid_json");
    return;
  }
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
  if (item.previewDisabled) {
    previewError.value = t(item.previewDisabledReason || "appedit.preview.unavailable");
    return;
  }
  if (appData.value.sources.some((source) => source.mapID === item.mapID && source.sourceType === "maplat")) return;
  let mapObject: any;
  try {
    mapObject = await window.mapedit.previewSource(item.mapID);
  } catch (e) {
    previewError.value = translatePreviewError(e);
    return;
  }
  appData.value.sources.push({
    sourceType: "maplat",
    mapID: item.mapID,
    title: item.title,
    label: { ...normalizeLangObject(item.title) },
    role: "maplat",
    startFrom: appData.value.sources.length === 0,
    thumbnail: item.image || "Maplat.png",
    data: { ...mapObject, mapID: item.mapID, maptype: "maplat" },
  });
  ensureSingleStartFrom();
  recordHistory();
}

function addBaseMapSource(item: BaseMapItem) {
  if (appData.value.sources.some((source) => source.mapID === item.mapID && source.sourceType === "base-map")) return;
  const role: SourceRole = item.data?.maptype === "overlay" || item.data?.overlay ? "overlay" : "base";
  const title = baseMapTitle(item);
  const thumbnail = item.data?.thumbnail || (role === "overlay" ? "overlay.png" : "basemap.png");
  appData.value.sources.push({
    sourceType: "base-map",
    mapID: item.mapID,
    title,
    label: { ...normalizeLangObject(title) },
    role,
    opacity: 1,
    thumbnail,
    data: {
      ...item.data,
      mapID: item.mapID,
      maptype: role === "overlay" ? "overlay" : (item.data?.maptype || "base"),
      label: item.data?.label || title,
      title: item.data?.title || title,
      thumbnail,
    },
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

function updateSourceData(source: AppSource, value: string) {
  try {
    source.data = JSON.parse(value);
    recordHistory();
  } catch {
    previewError.value = t("appedit.invalid_json");
  }
}

function baseMapTitle(item: BaseMapItem): string {
  return String(item.data?.title ?? item.data?.label ?? item.mapID);
}

function translatePreviewError(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  return message.startsWith("appedit.") ? t(message) : message;
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
    const result = await window.appedit.preparePreview(createPreviewDocument());
    previewUrl.value = result.url;
  } catch (e) {
    console.error("[AppEdit] Preview failed:", e);
    previewError.value = translatePreviewError(e);
    destroyPreview();
  }
}

function destroyPreview() {
  previewUrl.value = "";
}

function createPreviewDocument(): AppDocument {
  const document = cloneDocument(appData.value);
  document.manifestSettings.iconsJson = normalizeJsonText(document.manifestSettings.iconsJson, []);
  (document.manifestSettings as any).icons = JSON.parse(document.manifestSettings.iconsJson);
  (document as any).pois = JSON.parse(document.poiSources || "[]");
  document.sources = document.sources.map((source) => {
    const data = { ...source.data };
    data.mapID = source.mapID;
    data.label = source.label;
    data.title = data.title || source.title;
    data.thumbnail = data.thumbnail || source.thumbnail;
    if (source.sourceType === "base-map") {
      data.maptype = source.role === "overlay" ? "overlay" : (data.maptype || "base");
    }
    return { ...source, data };
  });
  return document;
}

function normalizeJsonText(value: string, fallback: any) {
  try {
    JSON.parse(value);
    return value;
  } catch {
    return JSON.stringify(fallback, null, 2);
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
          <section class="settings-section mt-3">
            <h5>{{ t("appedit.http_settings") }}</h5>
            <div class="row g-2">
              <div class="col-md-2">
                <label class="form-label small fw-bold">{{ t("appedit.preview_port") }}</label>
                <input v-model.number="appData.httpSettings.previewPort" type="number" min="1" max="65535" class="form-control form-control-sm" @change="recordHistory">
              </div>
              <div class="col-md-10">
                <label class="form-label small fw-bold">{{ t("appedit.http_toggles") }}</label>
                <div class="toggle-grid">
                  <label class="form-check"><input v-model="appData.httpSettings.pwaManifest" type="checkbox" class="form-check-input" @change="recordHistory"> {{ t("appedit.pwa_manifest") }}</label>
                  <label class="form-check"><input v-model="appData.httpSettings.overlay" type="checkbox" class="form-check-input" @change="recordHistory"> {{ t("appedit.overlay_ui") }}</label>
                  <label class="form-check"><input v-model="appData.httpSettings.enableHideMarker" type="checkbox" class="form-check-input" @change="recordHistory"> {{ t("appedit.hide_marker_ui") }}</label>
                  <label class="form-check"><input v-model="appData.httpSettings.enableBorder" type="checkbox" class="form-check-input" @change="recordHistory"> {{ t("appedit.border_ui") }}</label>
                  <label class="form-check"><input v-model="appData.httpSettings.enableCache" type="checkbox" class="form-check-input" @change="recordHistory"> {{ t("appedit.cache_ui") }}</label>
                  <label class="form-check"><input v-model="appData.httpSettings.stateUrl" type="checkbox" class="form-check-input" @change="recordHistory"> {{ t("appedit.state_url") }}</label>
                  <label class="form-check"><input v-model="appData.httpSettings.enableShare" type="checkbox" class="form-check-input" @change="recordHistory"> {{ t("appedit.share_ui") }}</label>
                </div>
              </div>
              <div class="col-md-4">
                <label class="form-label small fw-bold">{{ t("appedit.icon_source") }}</label>
                <input v-model="appData.httpSettings.iconSource" type="text" class="form-control form-control-sm" :placeholder="t('appedit.icon_source_placeholder')" @input="recordHistory">
              </div>
              <div class="col-md-4">
                <label class="form-label small fw-bold">{{ t("appedit.mapbox_token") }}</label>
                <input v-model="appData.httpSettings.mapboxToken" type="text" class="form-control form-control-sm" @input="recordHistory">
              </div>
              <div class="col-md-4">
                <label class="form-label small fw-bold">{{ t("appedit.google_api_key") }}</label>
                <input v-model="appData.httpSettings.googleApiKey" type="text" class="form-control form-control-sm" @input="recordHistory">
              </div>
            </div>
          </section>

          <section class="settings-section mt-3">
            <h5>{{ t("appedit.app_settings") }}</h5>
            <div class="row g-2">
              <div class="col-md-4">
                <label class="form-label small fw-bold">{{ t("appedit.splash") }}</label>
                <input v-model="appData.appSettings.splash" type="text" class="form-control form-control-sm" @input="recordHistory">
              </div>
              <div class="col-md-2">
                <label class="form-label small fw-bold">{{ t("appedit.home_lng") }}</label>
                <input v-model.number="appData.appSettings.homeLng" type="number" step="0.000001" class="form-control form-control-sm" @change="recordHistory">
              </div>
              <div class="col-md-2">
                <label class="form-label small fw-bold">{{ t("appedit.home_lat") }}</label>
                <input v-model.number="appData.appSettings.homeLat" type="number" step="0.000001" class="form-control form-control-sm" @change="recordHistory">
              </div>
              <div class="col-md-2">
                <label class="form-label small fw-bold">{{ t("appedit.default_zoom") }}</label>
                <input v-model.number="appData.appSettings.defaultZoom" type="number" min="0" max="28" class="form-control form-control-sm" @change="recordHistory">
              </div>
              <div class="col-md-2 d-flex align-items-end">
                <label class="form-check mb-1"><input v-model="appData.appSettings.fakeGps" type="checkbox" class="form-check-input" @change="recordHistory"> {{ t("appedit.fake_gps") }}</label>
              </div>
              <div class="col-md-4">
                <label class="form-label small fw-bold">{{ t("appedit.fake_center") }}</label>
                <input v-model="appData.appSettings.fakeCenter" type="text" class="form-control form-control-sm" @input="recordHistory">
              </div>
              <div class="col-md-2">
                <label class="form-label small fw-bold">{{ t("appedit.fake_radius") }}</label>
                <input v-model.number="appData.appSettings.fakeRadius" type="number" min="0" class="form-control form-control-sm" @change="recordHistory">
              </div>
              <div class="col-md-6">
                <label class="form-label small fw-bold">{{ t("appedit.poi_sources_json") }}</label>
                <textarea v-model="appData.poiSources" class="form-control form-control-sm font-monospace" rows="3" @input="recordHistory" />
              </div>
            </div>
          </section>

          <section v-if="appData.httpSettings.pwaManifest" class="settings-section mt-3">
            <h5>{{ t("appedit.manifest_settings") }}</h5>
            <div class="row g-2">
              <div class="col-md-4">
                <label class="form-label small fw-bold">{{ t("appedit.manifest_name") }}</label>
                <input v-model="appData.manifestSettings.name" type="text" class="form-control form-control-sm" @input="recordHistory">
              </div>
              <div class="col-md-3">
                <label class="form-label small fw-bold">{{ t("appedit.manifest_short_name") }}</label>
                <input v-model="appData.manifestSettings.shortName" type="text" class="form-control form-control-sm" @input="recordHistory">
              </div>
              <div class="col-md-2">
                <label class="form-label small fw-bold">{{ t("appedit.manifest_background_color") }}</label>
                <input v-model="appData.manifestSettings.backgroundColor" type="color" class="form-control form-control-sm form-control-color" @input="recordHistory">
              </div>
              <div class="col-md-2">
                <label class="form-label small fw-bold">{{ t("appedit.manifest_theme_color") }}</label>
                <input v-model="appData.manifestSettings.themeColor" type="color" class="form-control form-control-sm form-control-color" @input="recordHistory">
              </div>
              <div class="col-md-3">
                <label class="form-label small fw-bold">{{ t("appedit.manifest_display") }}</label>
                <select v-model="appData.manifestSettings.display" class="form-select form-select-sm" @change="recordHistory">
                  <option value="standalone">standalone</option>
                  <option value="fullscreen">fullscreen</option>
                  <option value="minimal-ui">minimal-ui</option>
                  <option value="browser">browser</option>
                </select>
              </div>
              <div class="col-md-4">
                <label class="form-label small fw-bold">{{ t("appedit.manifest_start_url") }}</label>
                <input v-model="appData.manifestSettings.startUrl" type="text" class="form-control form-control-sm" @input="recordHistory">
              </div>
              <div class="col-md-4">
                <label class="form-label small fw-bold">{{ t("appedit.manifest_scope") }}</label>
                <input v-model="appData.manifestSettings.scope" type="text" class="form-control form-control-sm" @input="recordHistory">
              </div>
              <div class="col-12">
                <label class="form-label small fw-bold">{{ t("appedit.manifest_icons") }}</label>
                <textarea v-model="appData.manifestSettings.iconsJson" class="form-control form-control-sm font-monospace" rows="4" @input="recordHistory" />
              </div>
            </div>
          </section>
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
              <button
                v-for="item in mapItems"
                :key="item.mapID"
                type="button"
                class="source-row"
                :class="{ 'source-row-disabled': item.previewDisabled }"
                :disabled="item.previewDisabled"
                :title="item.previewDisabled ? t(item.previewDisabledReason || 'appedit.preview.unavailable') : item.title"
                @click="addMapSource(item)"
              >
                <img :src="item.image || noImage" :alt="item.title">
                <span>
                  {{ item.title }}
                  <small v-if="item.previewDisabled" class="d-block text-danger">{{ t(item.previewDisabledReason || "appedit.preview.unavailable") }}</small>
                </span>
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
                <div class="col-md-5">
                  <label class="form-label small mb-0">{{ t("appedit.source_label") }}</label>
                  <input v-model="source.label[currentLang]" type="text" class="form-control form-control-sm" @input="recordHistory">
                </div>
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
              <details class="mt-2">
                <summary class="small text-primary">{{ t("appedit.source_advanced") }}</summary>
                <textarea
                  :value="JSON.stringify(source.data, null, 2)"
                  class="form-control form-control-sm font-monospace mt-1"
                  rows="5"
                  @change="updateSourceData(source, ($event.target as HTMLTextAreaElement).value)"
                />
              </details>
            </div>
          </div>
        </div>
      </div>

      <div v-show="activeTab === 'preview'" class="h-100 position-relative">
        <iframe v-if="previewUrl" class="preview-map" :src="previewUrl" />
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
.source-row-disabled {
  opacity: 0.58;
  cursor: not-allowed;
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
.settings-section {
  border: 1px solid var(--bs-border-color);
  border-radius: 4px;
  padding: 12px;
}
.settings-section h5 {
  font-size: 1rem;
  margin-bottom: 10px;
}
.toggle-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 4px 12px;
}
.preview-map {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: 0;
}
.preview-error {
  position: absolute;
  top: 12px;
  left: 12px;
  right: 12px;
  z-index: 5;
}
</style>
