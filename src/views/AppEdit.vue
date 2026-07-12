<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useTranslation } from "i18next-vue";
import noImage from "../assets/img/no_image.png";
import osmThumb from "../assets/img/osm.png";
import gsiThumb from "../assets/img/gsi.png";
import gsiOrthoThumb from "../assets/img/gsi_ortho.png";
import { UndoStack } from "../services/editorUndoStack";
import AppSourceEditor from "../components/AppSourceEditor.vue";
import PoiReferenceEditor from "../components/PoiReferenceEditor.vue";
import { healAppDocumentPois } from "../utils/poiSourcesHeal";
import HomePositionEditorModal from "../components/HomePositionEditorModal.vue";
import EnvelopeEditorModal from "../components/EnvelopeEditorModal.vue";
import { fetchAllRegisteredMaps } from "../services/desktopMapList";
import {
  envelopeToBbox,
  isViewerBuiltin,
  normalizeAppSource,
  type AppSource as SharedAppSource,
} from "../utils/appSourceModel";
import { useRevisionedAssetSave } from "../composables/useRevisionedAssetSave";
import type { AppSaveResult } from "../electron";

import { LANGS_MAP, LANG_CODES, resolveEditorLanguage, type LangCode } from "../utils/editorLanguages";

interface AppSource extends SharedAppSource {
  thumbnail?: string;
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
  mapboxToken: string;
  googleApiKey: string;
}

interface AppRuntimeSettings {
  splash: string;
  homeLng: number | null;
  homeLat: number | null;
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
  iconSource: string;
}

interface AppDocument {
  appID: string; // slug編集欄の値 (ADR-0007: 正本キーはappUid)
  appName: Record<string, string>;
  title: Record<string, string>;
  description: Record<string, string>;
  keywords: string;
  siteUrl: string;
  lang: LangCode;
  sources: AppSource[];
  httpSettings: HttpSettings;
  appSettings: AppRuntimeSettings;
  manifestSettings: ManifestSettings;
  // POI データ (43 §2.4): {poiUid, cachedTitle?, icon?, selectedIcon?} 参照要素と
  // 生要素 (URL 文字列 / FC 埋め込み) の混在配列。旧 poiSources (JSON 文字列) 形は
  // 読込時に healAppDocumentPois が配列へ復元し、保存形は pois 配列のみ (Phase 8)
  pois: unknown[];
  startFrom?: string;
  status?: string;
  extraInfo?: string;
  // アプリ提供範囲(参考情報)。Editor内でのみ使用し、Viewer出力には含めない
  coverageLngLats?: [number, number][] | null;
}

interface MapListItem {
  uid: string; // Asset UID: sources参照の正本キー (ADR-0007)
  mapID: string; // slug (表示用)
  title: string;
  image: string | null;
  previewDisabled?: boolean;
  previewDisabledReason?: string;
}

interface BaseMapItem {
  mapID: string;
  scope: "builtin" | "user";
  data: any;
  thumbnailUrl?: string | null;
}

const builtinThumbnails: Record<string, string> = {
  osm: osmThumb,
  gsi: gsiThumb,
  gsi_ortho: gsiOrthoThumb,
};

const { t, i18next } = useTranslation();
const route = useRoute();
const router = useRouter();

// 対応言語(ビューア対応言語と同一)は共有定義から導出。langコード → common.* i18nキー名
const langsMap: Record<LangCode, string> = LANGS_MAP;

const emptyLangRecord = (): Record<string, string> =>
  Object.fromEntries(LANG_CODES.map((code) => [code, ""]));

const defaultApp = (): AppDocument => ({
  appID: "",
  appName: emptyLangRecord(),
  title: emptyLangRecord(),
  description: emptyLangRecord(),
  keywords: "",
  siteUrl: "",
  // 新規アプリのデフォルト言語は編集者のエディタUI言語(設定言語)に合わせる
  lang: resolveEditorLanguage(i18next.language),
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
    mapboxToken: "",
    googleApiKey: "",
  },
  appSettings: {
    splash: "",
    homeLng: null,
    homeLat: null,
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
    iconSource: "",
  },
  pois: [],
  status: "New",
  extraInfo: "",
  coverageLngLats: null,
});

const appData = ref<AppDocument>(defaultApp());
const originalAppData = ref<AppDocument>(defaultApp());
const activeTab = ref<"metadata" | "sources" | "pois" | "preview">("metadata");
const sourceListMode = ref<"maps" | "baseMaps">("maps");
const currentLang = ref<LangCode>("ja");
// 保存フロー (revision 楽観ロック) は useRevisionedAssetSave に共通化 (ADR-0007, Phase 4 Task 3)。
// 以下の3値の正本は handle の ref に一本化する:
//   uid(=appUid): 不変の正本キー。undefined = 未保存の新規アプリ
//   revision: 楽観ロック用。保存時に expectedRevision として送り、保存結果で更新する
//   confirmedSlug: 現在DBに永続化されているslug。appID欄がこの値に戻ったら再チェック不要
// saveApp が組み立てた送信内容を send クロージャへ渡す一時変数
let pendingSave: { document: AppDocument } | null = null;
const saveHandle = useRevisionedAssetSave<AppSaveResult>({
  send: async ({ uid, expectedRevision }) => {
    const { document } = pendingSave!;
    const result = await window.appedit.save({
      document: JSON.parse(JSON.stringify(document)),
      uid,
      slug: document.appID.trim(),
      expectedRevision,
    });
    if (!result) {
      // IPC が結果を返さなかった: 旧実装の最終elseと同じ処理(表示のみ、console.error/dialog無し)
      saveError.value = t("appedit.error_saving");
      return null;
    }
    return result;
  },
  applySuccess: async (result) => {
    // uid/revision/confirmedSlug は composable が保存結果から反映済み。以下は画面固有処理
    appData.value = normalizeAppDocument({ ...pendingSave!.document, appID: result.slug });
    onlyOne.value = true;
    appIDError.value = "";
    await hydrateSourceThumbnails();
    resetHistoryBase();
    // 新規作成でuidが確定した場合、リロード時に正しいアプリを再オープンできるよう
    // URLのクエリを追随させる (履歴は汚さない)
    if (route.query.uid !== result.uid) {
      router.replace({ query: { ...route.query, uid: result.uid } });
    }
    await (window as any).dialog.showMessageBox({ type: "info", buttons: ["OK"], message: t("appedit.success_save") });
  },
  reloadFromStore: () => reloadFromStore(),
  isDirty: () => isDirty.value,
  onFailure: async (result) => {
    if (result.result === "Exist") {
      // 保存レースでslugを先取りされた: 一意性チェックボタンを再度有効化する
      onlyOne.value = false;
      appIDError.value = "appedit.duplicate_appid";
      saveError.value = t("appedit.duplicate_appid");
    } else {
      saveError.value = t("appedit.error_saving");
    }
  },
  // ダイアログ表示時点の言語で t() されるよう getter で渡す (旧実装と同じタイミングで翻訳)
  messages: {
    get conflict() { return t("common.revision_conflict"); },
    get discard() { return t("appedit.confirm_no_save"); },
    get reload() { return t("common.reload"); },
    get overwrite() { return t("common.overwrite"); },
  },
});
const { uid: appUid, confirmedSlug, performSave, saving } = saveHandle;
// onlyOne: slugの一意性確認済みか (ADR-0007: appID欄は既存アプリでも編集可のslug欄)
const onlyOne = ref(false);
const appIDError = ref("appedit.check_uniqueness");
const saveError = ref<string | null>(null);
const mapItems = ref<MapListItem[]>([]);
const mapSearchQuery = ref("");
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
const filteredMapItems = computed(() => {
  const query = mapSearchQuery.value.trim().toLowerCase();
  if (!query) return mapItems.value;
  return mapItems.value.filter((item) =>
    item.mapID.toLowerCase().includes(query) || item.title.toLowerCase().includes(query),
  );
});

onMounted(async () => {
  // アプリ編集はuid正準で開く (ADR-0007): /appedit?uid=<uid>。uid未指定は新規作成
  const uid = typeof route.query.uid === "string" ? route.query.uid : "";
  if (uid) {
    const loaded = await window.appedit.request(uid);
    if (loaded) {
      appData.value = normalizeAppDocument(loaded);
      saveHandle.adoptLoaded({ uid: loaded.uid ?? uid, slug: appData.value.appID, revision: loaded.revision });
      onlyOne.value = true;
      appIDError.value = "";
    }
  }
  currentLang.value = appData.value.lang;
  await Promise.all([hydrateSourceThumbnails(), hydrateAssetPreviews()]);
  resetHistoryBase();
  await Promise.all([loadMaps(), loadBaseMaps()]);
});

const splashPreviewUrl = ref<string | null>(null);
const iconPreviewUrl = ref<string | null>(null);
const assetUploadError = ref<string | null>(null);

// splash/PWAアイコンのプレビュー画像URLを解決する
async function hydrateAssetPreviews() {
  splashPreviewUrl.value = appData.value.appSettings.splash
    ? await window.appAssets.fileUrl(`img/${appData.value.appSettings.splash}`)
    : null;
  iconPreviewUrl.value = appData.value.manifestSettings.iconSource
    ? await window.appAssets.fileUrl(appData.value.manifestSettings.iconSource)
    : null;
}

async function uploadSplash() {
  assetUploadError.value = null;
  const result = await window.appAssets.uploadSplash();
  if (result.err === "Canceled") return;
  if (result.err) {
    assetUploadError.value = t("appedit.error_invalid_image");
    return;
  }
  appData.value.appSettings.splash = result.splash || "";
  splashPreviewUrl.value = result.fileUrl || null;
  recordHistory();
}

async function uploadPwaIcon() {
  assetUploadError.value = null;
  if (!appData.value.appID.trim()) {
    assetUploadError.value = t("appedit.no_appid");
    return;
  }
  const result = await window.appAssets.uploadPwaIcon(appData.value.appID.trim());
  if (result.err === "Canceled") return;
  if (result.err === "NotSquare") {
    assetUploadError.value = t("appedit.error_not_square");
    return;
  }
  if (result.err === "TooSmall") {
    assetUploadError.value = t("appedit.error_too_small");
    return;
  }
  if (result.err) {
    assetUploadError.value = t("appedit.error_invalid_image");
    return;
  }
  appData.value.manifestSettings.iconSource = result.path || "";
  iconPreviewUrl.value = result.fileUrl || null;
  recordHistory();
}

const homePosition = computed<[number, number] | null>(() => {
  const { homeLng, homeLat } = appData.value.appSettings;
  return homeLng !== null && homeLat !== null ? [homeLng, homeLat] : null;
});
const homeModalVisible = ref(false);
const homeModalFallback = ref<[number, number] | undefined>(undefined);
const appCoverageModalVisible = ref(false);

// アプリ提供範囲(参考)の設定。Viewer出力には含めない
function applyAppCoverage(value: [number, number][] | null) {
  appData.value.coverageLngLats = value;
  recordHistory();
}

function bboxLabel(lngLats?: [number, number][] | null): string {
  const bbox = envelopeToBbox(lngLats ?? null);
  if (!bbox) return "-";
  return `W${bbox[0]} S${bbox[1]} E${bbox[2]} N${bbox[3]}`;
}

async function openHomePositionModal() {
  // 未設定時のみ、登録済みMaplat地図の代表点(homePosition)を初期表示の目安にする
  homeModalFallback.value = homePosition.value ? undefined : await resolveMaplatFallbackCenter();
  homeModalVisible.value = true;
}

// 代表点はあくまで目安なので、取得失敗は無視してベストエフォートで返す
async function resolveMaplatFallbackCenter(): Promise<[number, number] | undefined> {
  const maplatSources = appData.value.sources
    .filter((source) => source.sourceType === "maplat")
    .sort((a, b) => Number(b.startFrom || false) - Number(a.startFrom || false));
  for (const source of maplatSources) {
    try {
      const mapDoc = await window.mapedit.request(source.mapUid);
      const home = mapDoc?.homePosition;
      if (Array.isArray(home) && Number.isFinite(home[0]) && Number.isFinite(home[1])) {
        return [home[0], home[1]];
      }
    } catch {
      // noop
    }
  }
  return undefined;
}

function applyHomePosition(value: [number, number] | null) {
  appData.value.appSettings.homeLng = value ? value[0] : null;
  appData.value.appSettings.homeLat = value ? value[1] : null;
  recordHistory();
}

// 保存済みアプリのソースにUI表示用サムネイルURLを補完する。
// maplatのサムネイル実体はuidパス tmbs/{uid}.jpg (ADR-0007)
async function hydrateSourceThumbnails() {
  for (const source of appData.value.sources) {
    if (source.thumbnail || source.sourceType === "builtin") continue;
    const rel = source.sourceType === "maplat"
      ? `tmbs/${source.mapUid}.jpg`
      : String((source.data as any)?.thumbnail || `tmbs/${source.mapUid}_menu.jpg`);
    const url = await window.appAssets.fileUrl(rel);
    if (url) source.thumbnail = url;
  }
}

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
  // appID欄はslug編集欄 (ADR-0007)
  normalized.appID = value.appID || value.slug || value._id || "";
  normalized.lang = value.lang || "ja";
  normalized.appName = normalizeLangObject(value.appName || value.title, normalized.lang);
  normalized.title = normalizeLangObject(value.title || value.appName, normalized.lang);
  normalized.description = normalizeLangObject(value.description, normalized.lang);
  normalized.keywords = typeof value.keywords === "string" ? value.keywords : "";
  normalized.siteUrl = typeof value.siteUrl === "string" ? value.siteUrl : "";
  normalized.sources = Array.isArray(value.sources)
    ? value.sources.map((source: any) => normalizeSource(source, normalized.lang))
    : [];
  normalized.httpSettings = normalizeHttpSettings(value.httpSettings || value.http || value);
  normalized.appSettings = normalizeAppSettings(value.appSettings || value);
  normalized.manifestSettings = normalizeManifestSettings(value.manifestSettings || value.manifest || {});
  // 旧配置(httpSettings.iconSource)からの移行
  if (!normalized.manifestSettings.iconSource && typeof value.httpSettings?.iconSource === "string") {
    normalized.manifestSettings.iconSource = value.httpSettings.iconSource;
  }
  // pois (配列) 優先。旧 poiSources (JSON 文字列) と多重 stringify 破損は heal で配列に復元する
  // (旧実装がここで JSON.stringify し直していたのが破損の根本原因 — 二度と文字列形にしない)
  normalized.pois = healAppDocumentPois(value);
  normalized.startFrom = value.startFrom || value.start_from;
  normalized.extraInfo = typeof value.extraInfo === "string" ? value.extraInfo : "";
  normalized.coverageLngLats = Array.isArray(value.coverageLngLats) ? value.coverageLngLats : null;
  normalized.status = "Update";
  return normalized;
}

// 対応全言語のキーを持つレコードへ正規化する。プレーン文字列は
// デフォルト言語の値として受容する(ADR-0005の交換形)
function normalizeLangObject(value: any, defaultLang?: string): Record<string, string> {
  const record = emptyLangRecord();
  if (typeof value === "string") {
    if (value) record[defaultLang || appData.value.lang || "ja"] = value;
    return record;
  }
  for (const code of LANG_CODES) {
    record[code] = value?.[code] || "";
  }
  return record;
}

function normalizeSource(value: any, defaultLang?: string): AppSource {
  const source = normalizeAppSource(value) as AppSource;
  if (!source.title) {
    const fallbackID = source.mapSlug || source.mapUid;
    const title = source.label || (source.data as any)?.title || fallbackID;
    source.title = typeof title === "string" ? title : localizedWithLang(title, "ja") || fallbackID;
  }
  if (source.sourceType !== "builtin") {
    source.label = { ...normalizeLangObject(source.label || source.title, defaultLang) };
  }
  source.thumbnail = typeof value === "object" && value !== null ? value.thumbnail : undefined;
  return source;
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
    mapboxToken: value.mapboxToken || "",
    googleApiKey: value.googleApiKey || "",
  };
}

function normalizeAppSettings(value: any): AppRuntimeSettings {
  const defaults = defaultApp().appSettings;
  const home = value.home_position || value.homePosition;
  return {
    splash: value.splash || defaults.splash,
    homeLng: finiteOrNull(value.homeLng ?? home?.[0]),
    homeLat: finiteOrNull(value.homeLat ?? home?.[1]),
    defaultZoom: Number(value.defaultZoom ?? value.default_zoom ?? defaults.defaultZoom),
  };
}

// v-model.numberの空入力("")や不正値はnull(未設定)として扱う
function finiteOrNull(value: any): number | null {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
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
    iconSource: typeof value.iconSource === "string" ? value.iconSource : "",
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

async function goBack() {
  // 地図編集と同様、未保存の変更があれば確認ダイアログを出す
  if (isDirty.value) {
    const response = await (window as any).dialog.showMessageBox({
      type: "info",
      buttons: ["OK", "Cancel"],
      cancelId: 1,
      message: t("appedit.confirm_no_save"),
    });
    if (response.response !== 0) return;
  }
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

/**
 * slug(appID欄) 一意性チェック
 * ADR-0007: 既存アプリでは excludeUid=自分 を渡し、自分の現slugは「空き」と判定される
 */
async function checkOnlyOne() {
  const appID = appData.value.appID.trim();
  if (!appID) {
    appIDError.value = "appedit.no_appid";
    return;
  }
  const available = await window.assets.checkSlug({
    slug: appID,
    excludeUid: appUid.value ?? undefined,
  });
  appIDError.value = available ? "" : "appedit.duplicate_appid";
  if (!appIDError.value) onlyOne.value = true;
}

// slug(appID欄)の編集を検知して一意性再チェックを要求する (ADR-0007)。
// 永続化済みslug(confirmedSlug)に戻った場合は自分自身のslugなので確認済み扱いに復帰する
function onAppIDInput() {
  if (confirmedSlug.value && appData.value.appID === confirmedSlug.value) {
    onlyOne.value = true;
    appIDError.value = "";
  } else {
    onlyOne.value = false;
    appIDError.value = "appedit.check_uniqueness";
  }
}

/**
 * 保存 (ADR-0007: uid正準 + revision楽観ロック)
 * 既存アプリは uid 宛の upsert、新規は uid なしの create。
 * conflict(読み直す/上書き)・成功反映・Exist等の共通処理は
 * useRevisionedAssetSave (saveHandle) が担う
 */
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
  // pois は配列のまま永続化する (旧 poiSources 文字列形は normalize で pois 配列に
  // 統一済みのため、送信 document に poiSources キーは載らない — Phase 8 バグ①根治)
  const document = cloneDocument(appData.value);
  // sources参照はuid (maplat)なので startFrom もuidで永続化する
  document.startFrom = appData.value.sources.find((source) => source.startFrom)?.mapUid || appData.value.startFrom;
  document.status = "Update";
  // 表示専用のサムネイルURL(file://)は保存しない
  document.sources.forEach((source) => {
    delete (source as any).thumbnail;
  });
  // conflict/成功反映/Exist等の共通処理は useRevisionedAssetSave (saveHandle) が担う
  pendingSave = { document };
  await performSave();
}

/**
 * revision-conflict 後の「読み直す」: 最新の保存済み状態をuidで再取得して編集状態を置き換える
 */
async function reloadFromStore() {
  if (!appUid.value) return;
  try {
    const loaded = await window.appedit.request(appUid.value);
    if (!loaded) return;
    appData.value = normalizeAppDocument(loaded);
    saveHandle.adoptLoaded({ uid: loaded.uid ?? appUid.value, slug: appData.value.appID, revision: loaded.revision });
    onlyOne.value = true;
    appIDError.value = "";
    currentLang.value = appData.value.lang;
    await Promise.all([hydrateSourceThumbnails(), hydrateAssetPreviews()]);
    resetHistoryBase();
  } catch (e) {
    console.error("[reloadFromStore] Failed to reload app data:", e);
  }
}

const exporting = ref(false);

async function exportApp() {
  if (exporting.value) return;
  exporting.value = true;
  try {
    const document = cloneDocument(appData.value);
    document.startFrom = appData.value.sources.find((source) => source.startFrom)?.mapUid || appData.value.startFrom;
    const result = await window.appedit.export(document);
    if (result.result === "Canceled") return;
    if (result.result === "Error") {
      await (window as any).dialog.showMessageBox({
        type: "error",
        buttons: ["OK"],
        message: t("appedit.export_failed"),
        detail: result.message || "",
      });
      return;
    }
    const warnings = (result.warnings || []).map((key) => t(key)).join("\n");
    await (window as any).dialog.showMessageBox({
      type: warnings ? "warning" : "info",
      buttons: ["OK"],
      message: t("appedit.export_success", { outDir: result.outDir }),
      detail: warnings,
    });
  } finally {
    exporting.value = false;
  }
}

// 全件を一度に取得し、検索はクライアント側で絞り込む(ベース地図リストと同様)
async function loadMaps() {
  mapItems.value = await fetchAllRegisteredMaps();
}

async function loadBaseMaps() {
  baseMapItems.value = await window.baseMaps.list();
}

async function addMapSource(item: MapListItem) {
  if (item.previewDisabled) {
    previewError.value = t(item.previewDisabledReason || "appedit.preview.unavailable");
    return;
  }
  // sources参照はuid正準 (ADR-0007)。表示用にslug(mapSlug)/titleを併せて保持する
  if (appData.value.sources.some((source) => source.mapUid === item.uid && source.sourceType === "maplat")) return;
  appData.value.sources.push({
    sourceType: "maplat",
    mapUid: item.uid,
    mapSlug: item.mapID,
    title: item.title,
    label: { ...normalizeLangObject(item.title) },
    role: "maplat",
    startFrom: appData.value.sources.length === 0,
    thumbnail: item.image || undefined,
  });
  ensureSingleStartFrom();
  recordHistory();
}

function addBaseMapSource(item: BaseMapItem) {
  // builtin/tmsソースは登録地図ではないためuid解決の対象外。ビルトインID/TMS地図IDを
  // そのまま埋め込み値として保持する(app保存時の追加コピーであり、他エンティティへの参照ではない)
  if (appData.value.sources.some((source) => source.mapUid === item.mapID && source.sourceType !== "maplat")) return;
  const title = baseMapTitle(item);
  if (isViewerBuiltin(item.mapID)) {
    appData.value.sources.push({
      sourceType: "builtin",
      mapUid: item.mapID,
      title,
      role: "base",
    });
  } else {
    // マスタのアイコン/提供範囲等は「選択時のデフォルト」としてディープコピーで継承する。
    // 以後の編集はコピーにのみ反映し、マスタ側は変更しない(Inherited Source Defaults)
    const source = normalizeAppSource({
      mapID: item.mapID,
      maptype: item.data?.maptype,
      data: JSON.parse(JSON.stringify(item.data || {})),
    }) as AppSource;
    source.title = title;
    source.label = { ...normalizeLangObject(title) };
    source.thumbnail = item.thumbnailUrl || undefined;
    if (source.data && !source.data.thumbnail && item.thumbnailUrl) {
      // マスタにthumbnail未設定の旧ユーザーベースマップ: Viewer規約のtmbs/{mapID}_menu.jpgを補完
      source.data.thumbnail = `tmbs/${item.mapID}_menu.jpg`;
    }
    appData.value.sources.push(source);
  }
  ensureSingleStartFrom();
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
  appData.value.startFrom = source.mapUid;
  recordHistory();
}

function ensureSingleStartFrom() {
  const selected = appData.value.sources.find((source) => source.startFrom);
  if (!selected && appData.value.sources[0]) appData.value.sources[0].startFrom = true;
  appData.value.startFrom = appData.value.sources.find((source) => source.startFrom)?.mapUid;
}

function sourceTitle(source: AppSource): string {
  return source.title || source.data?.title || sourceIdLabel(source);
}

// 選択済みソースのID表示: maplatはuidではなく表示用slugを出す (ADR-0007)
function sourceIdLabel(source: AppSource): string {
  return source.sourceType === "maplat" ? source.mapSlug || source.mapUid : source.mapUid;
}

function baseMapTitle(item: BaseMapItem): string {
  return String(item.data?.title ?? item.data?.label ?? item.mapID);
}

function baseMapThumbnail(item: BaseMapItem): string {
  return builtinThumbnails[item.mapID] || item.thumbnailUrl || noImage;
}

function sourceThumbnail(source: AppSource): string {
  if (source.sourceType === "builtin") return builtinThumbnails[source.mapUid] || noImage;
  return source.thumbnail || noImage;
}

function translatePreviewError(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  return message.startsWith("appedit.") ? t(message) : message;
}

// プレビュー表示言語(空=アプリ既定)。切替時はセッションを作り直す
const previewLang = ref<"" | LangCode>("");

async function changePreviewLang(lang: string) {
  previewLang.value = lang as "" | LangCode;
  await renderPreview();
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
    // main 解決層からの警告 (missing/duplicate POI 参照等) を export と同じ形式で表示する
    const warnings = (result.warnings || []).map((key) => t(key)).join("\n");
    if (warnings) {
      await (window as any).dialog.showMessageBox({
        type: "warning",
        buttons: ["OK"],
        message: t("appedit.preview_warnings"),
        detail: warnings,
      });
    }
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
  if (previewLang.value) document.lang = previewLang.value;
  // sourcesはAppSource形のままmainプロセスへ渡し、composeViewerSourceで正規化する
  return document;
}

// --- POIデータタブ配線 (Phase 8 Task 2, 43 §2.4) ---
// 真実の器は appData.pois 配列 1 つ。順番変更/上書き/解除/追加は PoiReferenceEditor が
// 配列ごと差し替えの update:pois で返すので、ここでは反映 + 履歴記録だけを行う
function onPoisChange(next: unknown[]) {
  appData.value.pois = next;
  recordHistory();
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
        <div class="col-2 d-flex gap-1">
          <button type="button" class="btn btn-primary w-50" :disabled="!!saveError || !isDirty || saving" @click="saveApp">{{ t("common.save") }}</button>
          <button type="button" class="btn btn-success w-50" :disabled="isDirty || !onlyOne || exporting" @click="exportApp">{{ t("appedit.export_button") }}</button>
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
          <a class="nav-link" :class="{ active: activeTab === 'pois' }" href="#" @click.prevent="activeTab = 'pois'">
            {{ t("poiref.tab_label") }}
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
            <!-- App ID フィールド: slug編集欄 (ADR-0007: 既存アプリでも編集可、変更時は一意性再チェック) -->
            <div class="col-md-3" :class="appIDError && appIDError !== 'appedit.check_uniqueness' ? 'has-error' : ''">
              <label class="form-label fw-bold small mb-0">{{ t("appedit.appid") }}</label>
              <input
                v-model="appData.appID"
                type="text"
                class="form-control form-control-sm"
                :class="appIDError && appIDError !== 'appedit.check_uniqueness' ? 'is-invalid' : ''"
                :placeholder="t('appedit.input_appid')"
                @input="onAppIDInput(); recordHistory()"
              />
              <div v-if="appIDError" class="form-text small text-danger mb-0" style="font-size: 0.75rem;">
                {{ t(appIDError) }}
              </div>
              <div v-else class="form-text small mb-0" style="font-size: 0.75rem;">{{ t("appedit.unique_appid") }}</div>
            </div>
            <div class="col-md-2 d-flex align-items-start pt-4">
              <!-- 一意性チェックボタン: 確認済み(onlyOne)の間は無効化 (ADR-0007) -->
              <button class="btn btn-secondary btn-sm w-100 mt-1" :disabled="onlyOne" @click="checkOnlyOne">
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
          <div class="row g-1 mb-2">
            <div class="col-md-7">
              <label class="form-label fw-bold small mb-0">{{ t("appedit.keywords") }}</label>
              <input v-model="appData.keywords" type="text" class="form-control form-control-sm" @input="recordHistory">
            </div>
            <div class="col-md-5">
              <label class="form-label fw-bold small mb-0">{{ t("appedit.site_url") }}</label>
              <input v-model="appData.siteUrl" type="url" class="form-control form-control-sm" placeholder="https://example.com/myapp/" @input="recordHistory">
              <div class="form-text small mb-0" style="font-size: 0.75rem;">{{ t("appedit.site_url_note") }}</div>
            </div>
          </div>
          <div class="row g-1">
            <div class="col-12">
              <label class="form-label fw-bold small mb-0">{{ t("appedit.extra_info") }}</label>
              <textarea v-model="appData.extraInfo" class="form-control form-control-sm font-monospace" rows="8" @input="recordHistory" />
            </div>
          </div>
          <div class="row g-1 mb-2">
            <div class="col-12">
              <label class="form-label fw-bold small mb-0">{{ t("appedit.app_coverage") }}</label>
              <div class="d-flex align-items-center gap-2 flex-wrap">
                <span class="small font-monospace">{{ bboxLabel(appData.coverageLngLats) }}</span>
                <button type="button" class="btn btn-sm btn-outline-primary" @click="appCoverageModalVisible = true">
                  {{ t("appedit.envelope_pick") }}
                </button>
                <button v-if="appData.coverageLngLats" type="button" class="btn btn-sm btn-outline-danger" @click="applyAppCoverage(null)">
                  {{ t("appedit.envelope_clear") }}
                </button>
              </div>
              <div class="form-text small mb-0" style="font-size: 0.75rem;">{{ t("appedit.app_coverage_note") }}</div>
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
                <div class="d-flex align-items-center gap-2">
                  <input v-model="appData.appSettings.splash" type="text" class="form-control form-control-sm" readonly>
                  <button type="button" class="btn btn-sm btn-outline-secondary text-nowrap" @click="uploadSplash">{{ t("appedit.upload") }}</button>
                </div>
                <img v-if="splashPreviewUrl" :src="splashPreviewUrl" class="asset-preview mt-1" alt="splash">
              </div>
              <div class="col-md-2">
                <label class="form-label small fw-bold">{{ t("appedit.home_lng") }}</label>
                <input :value="appData.appSettings.homeLng ?? ''" type="number" step="0.000001" class="form-control form-control-sm" @change="appData.appSettings.homeLng = finiteOrNull(($event.target as HTMLInputElement).value); recordHistory()">
              </div>
              <div class="col-md-2">
                <label class="form-label small fw-bold">{{ t("appedit.home_lat") }}</label>
                <input :value="appData.appSettings.homeLat ?? ''" type="number" step="0.000001" class="form-control form-control-sm" @change="appData.appSettings.homeLat = finiteOrNull(($event.target as HTMLInputElement).value); recordHistory()">
              </div>
              <div class="col-md-2 d-flex align-items-end">
                <button type="button" class="btn btn-sm btn-outline-secondary text-nowrap mb-1" @click="openHomePositionModal">{{ t("appedit.home_pick") }}</button>
              </div>
              <div class="col-md-2">
                <label class="form-label small fw-bold">{{ t("appedit.default_zoom") }}</label>
                <input v-model.number="appData.appSettings.defaultZoom" type="number" min="0" max="28" class="form-control form-control-sm" @change="recordHistory">
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
              <div class="col-md-6">
                <label class="form-label small fw-bold">{{ t("appedit.manifest_icon_source") }}</label>
                <div class="d-flex align-items-center gap-2">
                  <input v-model="appData.manifestSettings.iconSource" type="text" class="form-control form-control-sm" readonly>
                  <button type="button" class="btn btn-sm btn-outline-secondary text-nowrap" @click="uploadPwaIcon">{{ t("appedit.upload") }}</button>
                </div>
                <div class="form-text small mb-0" style="font-size: 0.75rem;">{{ t("appedit.manifest_icon_note") }}</div>
                <div v-if="assetUploadError" class="text-danger small">{{ assetUploadError }}</div>
                <img v-if="iconPreviewUrl" :src="iconPreviewUrl" class="asset-preview mt-1" alt="icon">
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
                v-for="item in filteredMapItems"
                :key="item.mapID"
                type="button"
                class="source-row"
                :class="{ 'source-row-disabled': item.previewDisabled }"
                :disabled="item.previewDisabled"
                :title="item.previewDisabled ? t(item.previewDisabledReason || 'appedit.preview.unavailable') : item.title"
                @click="addMapSource(item)"
              >
                <img :src="item.image || noImage" :alt="item.title" loading="lazy" decoding="async">
                <span>
                  {{ item.title }}
                  <small v-if="item.previewDisabled" class="d-block text-danger">{{ t(item.previewDisabledReason || "appedit.preview.unavailable") }}</small>
                </span>
              </button>
            </div>
          </div>

          <div v-else>
            <div class="source-list">
              <button v-for="item in filteredBaseMapItems" :key="`${item.scope}:${item.mapID}`" type="button" class="source-row" @click="addBaseMapSource(item)">
                <img :src="baseMapThumbnail(item)" :alt="baseMapTitle(item)" loading="lazy" decoding="async">
                <span>{{ baseMapTitle(item) }}</span>
              </button>
            </div>
          </div>
        </div>

        <div class="selected-pane ps-3">
          <h5>{{ t("appedit.selected_sources") }}</h5>
          <div v-if="appData.sources.length === 0" class="text-muted py-3">{{ t("appedit.no_selected_sources") }}</div>
          <div v-else class="selected-list">
            <div v-for="(source, index) in appData.sources" :key="`${source.sourceType}:${source.mapUid}`" class="selected-source border rounded p-2 mb-2">
              <div class="d-flex align-items-center justify-content-between gap-2">
                <div class="d-flex align-items-center gap-2">
                  <img :src="sourceThumbnail(source)" :alt="sourceTitle(source)" class="selected-source-thumb">
                  <div>
                    <div class="fw-bold">{{ sourceTitle(source) }}</div>
                    <small class="text-muted">{{ sourceIdLabel(source) }} / {{ t(`appedit.roles.${source.role}`) }}</small>
                  </div>
                </div>
                <div class="btn-group btn-group-sm">
                  <button class="btn btn-outline-secondary" :disabled="index === 0" @click="moveSource(index, -1)">↑</button>
                  <button class="btn btn-outline-secondary" :disabled="index === appData.sources.length - 1" @click="moveSource(index, 1)">↓</button>
                  <button class="btn btn-outline-danger" @click="removeSource(index)">×</button>
                </div>
              </div>
              <div class="row g-2 mt-2 align-items-center">
                <div v-if="source.sourceType !== 'builtin' && source.label" class="col-md-5">
                  <label class="form-label small mb-0">{{ t("appedit.source_label") }}</label>
                  <input v-model="source.label[currentLang]" type="text" class="form-control form-control-sm" @input="recordHistory">
                </div>
                <div class="col-auto">
                  <div class="form-check">
                    <input :id="`start-${index}`" class="form-check-input" type="radio" name="startFrom" :checked="source.startFrom" @change="setStartFrom(source)">
                    <label class="form-check-label" :for="`start-${index}`">{{ t("appedit.start_from") }}</label>
                  </div>
                </div>
                <div v-if="source.sourceType === 'tms'" class="col-auto">
                  <select v-model="source.role" class="form-select form-select-sm" @change="recordHistory">
                    <option value="base">{{ t("appedit.roles.base") }}</option>
                    <option value="overlay">{{ t("appedit.roles.overlay") }}</option>
                  </select>
                </div>
              </div>
              <AppSourceEditor
                :source="source"
                :current-lang="currentLang"
                :fallback-center="homePosition ?? undefined"
                :app-coverage-lng-lats="appData.coverageLngLats ?? null"
                @change="recordHistory"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- Tab: POIデータ (Phase 8 Task 2)。器は appData.pois 配列、履歴は onPoisChange の
           recordHistory 明示 (AppEdit の既存方式) -->
      <div v-show="activeTab === 'pois'" class="h-100 overflow-hidden p-3">
        <PoiReferenceEditor :pois="appData.pois" @update:pois="onPoisChange" />
      </div>

      <div v-show="activeTab === 'preview'" class="h-100 position-relative">
        <iframe v-if="previewUrl" class="preview-map" :src="previewUrl" />
        <div class="preview-lang bg-white border rounded shadow-sm px-2 py-1 d-flex align-items-center gap-1">
          <label class="small fw-bold mb-0" for="previewLang">{{ t("appedit.preview_lang") }}</label>
          <select
            id="previewLang"
            class="form-select form-select-sm w-auto"
            :value="previewLang"
            @change="changePreviewLang(($event.target as HTMLSelectElement).value)"
          >
            <option value="">{{ t("appedit.preview_lang_default") }}</option>
            <option v-for="(v, k) in langsMap" :key="k" :value="k">{{ t("common." + v) }}</option>
          </select>
        </div>
        <div v-if="previewError" class="alert alert-warning preview-error">{{ previewError }}</div>
      </div>
    </div>

    <HomePositionEditorModal
      v-if="homeModalVisible"
      :model-value="homePosition"
      :fallback-center="homeModalFallback"
      @update:model-value="applyHomePosition"
      @close="homeModalVisible = false"
    />

    <EnvelopeEditorModal
      v-if="appCoverageModalVisible"
      :model-value="appData.coverageLngLats ?? null"
      :fallback-center="homePosition ?? undefined"
      title-key="appedit.app_coverage_modal_title"
      help-key="appedit.app_coverage_modal_help"
      @update:model-value="applyAppCoverage"
      @close="appCoverageModalVisible = false"
    />
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
.source-row img {
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
.selected-source-thumb {
  width: 40px;
  height: 40px;
  object-fit: contain;
  background: #f8f9fa;
  border: 1px solid var(--bs-border-color);
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
.asset-preview {
  max-width: 120px;
  max-height: 120px;
  border: 1px solid var(--bs-border-color);
  background: #f8f9fa;
  object-fit: contain;
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
.preview-lang {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 6;
}
</style>
