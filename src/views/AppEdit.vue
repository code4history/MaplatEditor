<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useTranslation } from "i18next-vue";
import isEqual from "lodash-es/isEqual";
import noImage from "../assets/img/no_image.png";
import osmThumb from "../assets/img/osm.png";
import gsiThumb from "../assets/img/gsi.png";
import gsiOrthoThumb from "../assets/img/gsi_ortho.png";
import { UndoStack } from "../services/editorUndoStack";
import AppSourceEditor from "../components/AppSourceEditor.vue";
import PoiReferenceEditor from "../components/PoiReferenceEditor.vue";
import DraftConflictDialog from "../components/editor-ui/DraftConflictDialog.vue";
import EditorActionHeader from "../components/editor-ui/EditorActionHeader.vue";
import EditorBusyOverlay from "../components/editor-ui/EditorBusyOverlay.vue";
import LangValueChips from "../components/editor-ui/LangValueChips.vue";
import SlugField from "../components/editor-ui/SlugField.vue";
import DiagnosticFeedback from "../components/editor-ui/DiagnosticFeedback.vue";
import ContextHelp from "../components/editor-ui/ContextHelp.vue";
import EditorTabs from "../components/editor-ui/EditorTabs.vue";
import type { EditorSaveState } from "../components/editor-ui/editorUiTypes";
import { readAppDocumentPois } from "../utils/appPoisFormat";
import HomePositionEditorModal from "../components/HomePositionEditorModal.vue";
import EnvelopeEditorModal from "../components/EnvelopeEditorModal.vue";
import ResourceSelector from "../components/ResourceSelector.vue";
import ResourceSelectorList from "../components/ResourceSelectorList.vue";
import ResourceMasterRow from "../components/resource-list/ResourceMasterRow.vue";
import ResourceEmptyState from "../components/resource-list/ResourceEmptyState.vue";
import { createMapListAdapter, type MapListRow } from "./resource-adapters/mapListAdapter";
import { baseMapSearchAdapter } from "./resource-adapters/baseMapSearchAdapter";
import type { BaseMapCatalogItem } from "../utils/baseMapEditorDocument";
import type { ResourceListItemViewModel } from "../components/resource-list/resourceListTypes";
import { useSelectorSpatialContext } from "../composables/useSelectorSpatialContext";
import type { SelectorSpatialContextView, Wgs84Bbox } from "../components/resource-list/resourceListTypes";
import {
  createAppSourceFromBaseMap,
  envelopeToBbox,
  normalizeAppSource,
  resolveBaseMapSelectorText,
  type AppSource as SharedAppSource,
} from "../utils/appSourceModel";
import { useRevisionedAssetSave } from "../composables/useRevisionedAssetSave";
import { useAssetDraftLifecycle } from "../composables/useAssetDraftLifecycle";
import { useInitialDraftPersist } from "../composables/useInitialDraftPersist";
import { useAppCoverageAutoCalc } from "../composables/useAppCoverageAutoCalc";
import {
  computeBboxAndCentroid,
  estimateZoomForBbox,
  expandBboxByRatio,
  bboxToEnvelope,
} from "../utils/geoEstimate";
import type { SlugFieldState } from "../composables/useSlugAvailability";
import { runEditorExportDecision } from "../composables/useEditorExportDecision";
import { isEditableElement } from "../utils/nativeTextUndo";
import { isTranslationMode } from "../utils/editorLanguageMode";
import type { AppSaveResult } from "../electron";

import {
  LANGS_MAP,
  LANG_CODES,
  SUPPORTED_LANGUAGES,
  resolveEditorLanguage,
  type LangCode,
} from "../utils/editorLanguages";

interface AppSource extends SharedAppSource {
  thumbnail?: string;
}

interface HttpSettings {
  previewPort: number;
  pwaManifest: boolean;
  overlay: boolean;
  enableHideMarker: boolean;
  enableMarkerList: boolean;
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
  name: Record<string, string>;
  shortName: Record<string, string>;
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
  keywords: Record<string, string>;
  siteUrl: string;
  lang: LangCode;
  sources: AppSource[];
  httpSettings: HttpSettings;
  appSettings: AppRuntimeSettings;
  manifestSettings: ManifestSettings;
  // POI データ (43 §2.4): {poiUid, cachedTitle?, icon?, selectedIcon?} 参照要素と
  // 生要素 (URL 文字列 / FC 埋め込み) の混在配列。editor 正準形は配列のみ (M12-T30)。
  // readAppDocumentPois が形式判定 (復元は行わない) を行い、保存形は pois 配列のみ。
  // M3-T6 §5.8: 未対応形式時は生値 (非配列) を温存するため unknown へ広げる (黙って消えない原則)。
  // 表示は Array.isArray ガード + read-only (map 側と同文法)
  pois: unknown;
  // M3-T6 §5.8 / M12-T30: 未対応形式時のみ旧 poiSources 生値を温存する (配列採用時は書かない — 従来どおり)
  poiSources?: unknown;
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
  keywords: emptyLangRecord(),
  siteUrl: "",
  // 新規アプリのデフォルト言語は編集者のエディタUI言語(設定言語)に合わせる
  lang: resolveEditorLanguage(i18next.language),
  sources: [],
  httpSettings: {
    previewPort: 41781,
    pwaManifest: true,
    overlay: true,
    enableHideMarker: true,
    // マーカー一覧 UI (viewer の enableMarkerList、GUI 検証 D3)。viewer 既定 (無効) に合わせて
    // false 既定 — 既存アプリ (キーなし保存形) の preview/export 出力を変えないため
    enableMarkerList: false,
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
    name: emptyLangRecord(),
    shortName: emptyLangRecord(),
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
const appCoverageAuto = useAppCoverageAutoCalc({ appDoc: appData as any });
const appSpatialSource = computed<Wgs84Bbox | null>(() => envelopeToBbox(appData.value.coverageLngLats ?? appCoverageAuto.autoCoverage.value) as Wgs84Bbox | null);
const appSourceSpatialContext = useSelectorSpatialContext(appSpatialSource);
const appPoiSpatialContext = useSelectorSpatialContext(appSpatialSource);
const appSourceSpatialView = computed<SelectorSpatialContextView>(() => ({ bbox: appSourceSpatialContext.bbox.value, enabled: appSourceSpatialContext.enabled.value, labelKey: "resource_selector.context_app_coverage" }));
const appPoiSpatialView = computed<SelectorSpatialContextView>(() => ({ bbox: appPoiSpatialContext.bbox.value, enabled: appPoiSpatialContext.enabled.value, labelKey: "resource_selector.context_app_coverage" }));
const mapSourceAdapter = createMapListAdapter({ hasDraft: () => false, selectedUid: () => null });
const activeTab = ref<"metadata" | "sources" | "pois" | "preview">("metadata");
const sourceListMode = ref<"maps" | "baseMaps">("maps");
const currentLang = ref<LangCode>("ja");
const selectEditorLanguage = (language: LangCode) => {
  currentLang.value = language;
};
// 保存フロー (revision 楽観ロック) は useRevisionedAssetSave に共通化 (ADR-0007, Phase 4 Task 3)。
// 以下の3値の正本は handle の ref に一本化する:
//   uid(=appUid): 不変の正本キー。undefined = 未保存の新規アプリ
//   revision: 楽観ロック用。保存時に expectedRevision として送り、保存結果で更新する
//   confirmedSlug: 現在DBに永続化されているslug。appID欄がこの値に戻ったら再チェック不要
// saveApp が組み立てた送信内容を send クロージャへ渡す一時変数
let pendingSave: { document: AppDocument } | null = null;
let appSaveSucceeded = false;
const saveHandle = useRevisionedAssetSave<AppSaveResult>({
  send: async ({ uid, expectedRevision }) => {
    const { document } = pendingSave!;
    // M11-T7/AC6: 新規は事前採番 uid + create 明示合図(§7.2b)で create 経路へ dispatch する
    // (予約帰属 asset_uid と行 uid を一致させ promote を成立させる)
    const result = await window.appedit.save({
      document: JSON.parse(JSON.stringify(document)),
      uid: uid ?? (newAppUid || undefined),
      slug: document.appID.trim(),
      expectedRevision,
      ...(uid == null && newAppUid ? { create: true } : {}),
    });
    if (!result) {
      // IPC が結果を返さなかった: 旧実装の最終elseと同じ処理(表示のみ、console.error/dialog無し)
      saveOperationError.value = t("appedit.error_saving");
      return null;
    }
    return result;
  },
  applySuccess: async (result) => {
    appSaveSucceeded = true;
    // uid/revision/confirmedSlug は composable が保存結果から反映済み。以下は画面固有処理
    appData.value = normalizeAppDocument({ ...pendingSave!.document, appID: result.slug });
    await hydrateSourceThumbnails();
    markHistorySaved();
    await draftLifecycle.markSaved();
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
      // 保存レースで slug を先取りされた: 重複を operation 診断へ(field 表示は SlugField が担う)
      saveOperationError.value = t("appedit.duplicate_appid");
    } else {
      saveOperationError.value = t("appedit.error_saving");
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
const { uid: appUid, revision, confirmedSlug, performSave, saving } = saveHandle;
// M11-T7: appID 欄は共通 SlugField(可用性・予約 lifecycle 内蔵)。旧 onlyOne/appIDError の
// 手動一意性確認機構は撤去し、保存時 confirmForSave(予約再確認)へ機構置換した。
const slugField = ref<InstanceType<typeof SlugField> | null>(null);
const slugFieldState = ref<SlugFieldState>("idle");
// 新規アプリの事前採番 uid (AC6): draft キーと保存 create uid を兼ねる。既存 draftUid が
// route にあれば引き継ぐ(hot exit 復元で予約 claim も同じ帰属になる)
const newAppUid = (typeof route.query.uid === "string" && route.query.uid)
  ? ""
  : (typeof route.query.draftUid === "string" ? route.query.draftUid : crypto.randomUUID());
const saveOperationError = ref<string | null>(null);
// 保存前バリデーション(MapEdit の saveError computed と同型、全エディタ統一 2026-07-16):
// スラッグ未入力の間は保存ボタンを常時 disabled にする(形式・一意性は SlugField/バックエンドが担保)
// M11-T10 (人間検証R4): アプリ名も必須。空のまま保存できると一覧のタイトルが slug 代用になる
const appTitleMissing = computed(() => {
  const hasValue = (record: Record<string, string> | undefined) =>
    Object.values(record ?? {}).some((value) => value && value.trim());
  return !hasValue(appData.value.title) && !hasValue(appData.value.appName);
});
const saveValidationError = computed<string | null>(() => {
  if (appTitleMissing.value) return t("appedit.no_app_name");
  const id = appData.value.appID;
  if (!id || !id.trim()) return t("appedit.no_appid");
  return null;
});
// pois がエディタ正準形式 (配列) でないかどうか (M12-T30: 復元ではなく形式判定)。
// true のまま保存しても data_json の生値は温存されるが (黙って消えない原則)、
// このタブでの編集は無効化され preview/export には反映されないため、POIデータタブに警告を出す
const poisUnsupported = ref(false);
const mapSearchQuery = ref("");
const baseMapSearchQuery = ref("");
const previewError = ref<string | null>(null);
const previewUrl = ref("");
const historyStack = ref<UndoStack<AppDocument> | null>(null);
const historyApplying = ref(false);

// タイトル空のフォールバックは EditorActionHeader 共通(editor_ui.untitled)。slug(appID) 代用はしない(M11-T10)
const displayTitle = computed(() => localized(appData.value.title) || localized(appData.value.appName));
const translationMode = computed(() =>
  isTranslationMode(currentLang.value, appData.value.lang),
);
const isDirty = computed(() => historyStack.value?.isDirty() ?? false);
const canUndo = computed(() => historyStack.value?.canUndo() ?? false);
const canRedo = computed(() => historyStack.value?.canRedo() ?? false);
const draftLifecycle = useAssetDraftLifecycle<AppDocument>({
  kind: "app",
  serialize: () => cloneDocument(appData.value),
  shouldPersist: () => isDirty.value,
  apply: (payload) => {
    appData.value = normalizeAppDocument(payload);
    currentLang.value = appData.value.lang;
  },
  onRestored: async () => {
    resetHistoryBase();
    historyStack.value?.markDirty();
    await Promise.all([hydrateSourceThumbnails(), hydrateAssetPreviews()]);
  },
});

// AC6: 新規 asset の slug 予約成功時に初期 draft を即時保存し、予約のGC保護を確立する。
useInitialDraftPersist({
  slugState: slugFieldState,
  isNewAsset: () => !appUid.value,
  flushDraft: () => draftLifecycle.flush(),
});

const exporting = ref(false);
const saveState = computed<EditorSaveState>(() => {
  if (saving.value) return "saving";
  if (draftLifecycle.draftRestored.value) return "draft-restored";
  return isDirty.value ? "dirty" : "saved";
});
const setDocumentLanguage = (language: LangCode) => {
  if (appData.value.lang === language) return;
  appData.value.lang = language;
  recordHistory();
};
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
function setLangValue(record: Record<string, string>, value: string): void {
  if (value.trim()) record[currentLang.value] = value;
  else delete record[currentLang.value];
}
function createAppLangComputed(key: "keywords") {
  return computed({
    get: () => appData.value[key][currentLang.value] || "",
    set: (value: string) => setLangValue(appData.value[key], value),
  });
}
function createManifestLangComputed(key: "name" | "shortName") {
  return computed({
    get: () => appData.value.manifestSettings[key][currentLang.value] || "",
    set: (value: string) => setLangValue(appData.value.manifestSettings[key], value),
  });
}
const keywordsText = createAppLangComputed("keywords");
const manifestNameText = createManifestLangComputed("name");
const manifestShortNameText = createManifestLangComputed("shortName");

onMounted(async () => {
  // アプリ編集はuid正準で開く (ADR-0007): /appedit?uid=<uid>。uid未指定は新規作成
  const uid = typeof route.query.uid === "string" ? route.query.uid : "";
  if (uid) {
    const loaded = await window.appedit.request(uid);
    if (loaded) {
      appData.value = normalizeAppDocument(loaded);
      saveHandle.adoptLoaded({ uid: loaded.uid ?? uid, slug: appData.value.appID, revision: loaded.revision });
      appCoverageAuto.refresh();
    }
  } else {
    // M11-T10: duplicateFrom がある場合は元アプリから内容を複製（設計v3.1 案A: エディタ側ロード）。
    // 複製浄化: normalizeAppDocument は uid/revision を写さない。slug(appID) は予約値で上書き
    const dupFrom = typeof route.query.duplicateFrom === "string" ? route.query.duplicateFrom : "";
    if (dupFrom) {
      try {
        const source = await window.appedit.request(dupFrom);
        if (source) {
          const normalized = normalizeAppDocument(source);
          if (typeof route.query.slug === "string" && route.query.slug) normalized.appID = route.query.slug;
          appData.value = normalized;
          appCoverageAuto.refresh();
        }
      } catch (e) {
        console.error("Failed to duplicate app", e);
      }
    }
  }
  currentLang.value = appData.value.lang;
  await Promise.all([hydrateSourceThumbnails(), hydrateAssetPreviews()]);
  resetHistoryBase();
  // M11-T10: 複製内容はどこにも永続化されていないため dirty 扱いにする
  // (即保存可能・放棄時は hot-exit で下書き化され、slug 予約が draft に紐付いて可視化される)
  if (!uid && typeof route.query.duplicateFrom === "string" && route.query.duplicateFrom) {
    historyStack.value?.markDirty();
  }
  // M11-T7: 新規の draft キー = 事前採番 uid(newAppUid)。予約帰属・create uid と一致させる
  const draftUid = uid || newAppUid;
  if (!uid && route.query.draftUid !== draftUid) {
    await router.replace({ query: { ...route.query, draftUid } });
  }
  await draftLifecycle.open(draftUid, revision.value ?? null);
  window.addEventListener("keydown", onEditorKeydown);
  removeMainProcessListener = window.appEvents.onMainProcessMessage(onMainProcessMessage);
});

watch(
  appData,
  () => nextTick(() => draftLifecycle.schedule(isDirty.value)),
  { deep: true, flush: "post" },
);

const splashPreviewUrl = ref<string | null>(null);
const iconPreviewUrl = ref<string | null>(null);
const assetUploadError = ref<string | null>(null);

if (typeof window !== 'undefined' && (window as any).isE2E) {
  (window as any).testDebug = {
    appData,
    applyAppCoverage,
    appCoverageAuto,
    estimateHomeFromSources,
  };
}

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

// 選択済み source 群の合成 coverage から home position / defaultZoom を推定する
function estimateHomeFromSources() {
  const coverage = appData.value.coverageLngLats ?? appCoverageAuto.autoCoverage.value;
  const bbox = envelopeToBbox(coverage);
  if (!bbox) return;
  const expanded = expandBboxByRatio(bbox, 0.05);
  const result = computeBboxAndCentroid(bboxToEnvelope(expanded));
  if (!result) return;
  appData.value.appSettings.homeLng = result.centroid[0];
  appData.value.appSettings.homeLat = result.centroid[1];
  appData.value.appSettings.defaultZoom = estimateZoomForBbox(result.bbox);
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
  window.removeEventListener("keydown", onEditorKeydown);
  removeMainProcessListener?.();
  removeMainProcessListener = undefined;
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
  normalized.keywords = normalizeLangObject(value.keywords, normalized.lang);
  normalized.siteUrl = typeof value.siteUrl === "string" ? value.siteUrl : "";
  normalized.sources = Array.isArray(value.sources)
    ? value.sources.map((source: any) => normalizeSource(source, normalized.lang))
    : [];
  normalized.httpSettings = normalizeHttpSettings(value.httpSettings || value.http || value);
  normalized.appSettings = normalizeAppSettings(value.appSettings || value);
  normalized.manifestSettings = normalizeManifestSettings(
    value.manifestSettings || value.manifest || {},
    normalized.lang,
  );
  // 旧配置(httpSettings.iconSource)からの移行
  if (!normalized.manifestSettings.iconSource && typeof value.httpSettings?.iconSource === "string") {
    normalized.manifestSettings.iconSource = value.httpSettings.iconSource;
  }
  // pois (配列) のみが editor 正準形式 (M12-T30: 復元は行わず形式判定のみ)。
  // M3-T6 §5.8 (H-5(d)): 未対応形式の場合は pois: [] を document へ書き込まず、
  // 元の生値を温存する (保存しても data_json から消えない — 黙って消えない原則)。
  // 表示は Array.isArray ガード + タブ read-only が受け止める。温存生値は preview/export では
  // readAppDocumentPois により従来どおり空扱い (回帰ではない — 警告文言にも明記)。
  const poisRead = readAppDocumentPois(value);
  if (poisRead.unsupported) {
    if (value.pois != null) normalized.pois = value.pois;
    if (value.poiSources != null) normalized.poiSources = value.poiSources;
  } else {
    normalized.pois = poisRead.pois;
  }
  poisUnsupported.value = poisRead.unsupported;
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
  const source = normalizeAppSource(value, defaultLang) as AppSource;
  if (!source.title) {
    const fallbackID = source.mapSlug || source.mapUid;
    const title = source.label || (source.data as any)?.title || fallbackID;
    source.title = typeof title === "string"
      ? title
      : localizedWithLang(title, defaultLang || "ja") || fallbackID;
  }
  if (source.sourceType !== "builtin") {
    source.label = {
      ...normalizeLangObject(value.label || value.data?.label || source.label || source.title, defaultLang),
    };
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
    enableMarkerList: value.enableMarkerList ?? defaults.enableMarkerList,
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

function normalizeManifestSettings(value: any, defaultLang: string): ManifestSettings {
  const defaults = defaultApp().manifestSettings;
  return {
    ...defaults,
    name: normalizeLangObject(value.name, defaultLang),
    shortName: normalizeLangObject(value.shortName || value.short_name, defaultLang),
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
  await draftLifecycle.flush();
  // 直前の履歴がアプリ一覧なら router.back()（?q= 等のクエリ保持 → backCache 復元が発火）。
  // それ以外（直接編集画面を開いた等）は一覧へ push フォールバック。
  const back = router.options.history.state.back as string | null;
  if (typeof back === 'string' && back.startsWith('/applist')) {
    router.back();
    return;
  }
  await router.push("/applist");
}

function resetHistoryBase() {
  const snapshot = cloneDocument(appData.value);
  originalAppData.value = cloneDocument(snapshot);
  historyStack.value = new UndoStack(snapshot);
}

function recordHistory() {
  if (historyApplying.value) return;
  // F4 同型(MapEdit): 文書の変更で保存時 operation 診断を解消する
  // (旧実装は slug 入力時のみ解消され、他フィールド編集では保存ボタンが disabled のまま固まった)
  if (saveOperationError.value) saveOperationError.value = null;
  const next = cloneDocument(appData.value);
  if (!historyStack.value || isEqual(historyStack.value.current(), next)) return;
  historyStack.value.push(next);
}

function markHistorySaved() {
  recordHistory();
  historyStack.value?.save();
  originalAppData.value = cloneDocument(appData.value);
}

function performUndo() {
  if (!historyStack.value?.canUndo()) return;
  historyApplying.value = true;
  historyStack.value.undo();
  appData.value = cloneDocument(historyStack.value.current());
  historyApplying.value = false;
}

function performRedo() {
  if (!historyStack.value?.canRedo()) return;
  historyApplying.value = true;
  historyStack.value.redo();
  appData.value = cloneDocument(historyStack.value.current());
  historyApplying.value = false;
}

function onEditorKeydown(event: KeyboardEvent) {
  if (!(event.metaKey || event.ctrlKey)) return;
  const key = event.key.toLowerCase();
  if (key === "s") {
    event.preventDefault();
    if (!saving.value && !exporting.value && isDirty.value && !saveOperationError.value && !saveValidationError.value) void saveApp();
    return;
  }
  if (isEditableElement(event.target as Element | null)) return;
  if (saving.value || exporting.value) return;
  if (key === "z" && event.shiftKey) {
    event.preventDefault();
    performRedo();
  } else if (key === "z") {
    event.preventDefault();
    performUndo();
  } else if (key === "y") {
    event.preventDefault();
    performRedo();
  }
}

let removeMainProcessListener: (() => void) | undefined;
function onMainProcessMessage(message: string) {
  if (isEditableElement(document.activeElement)) return;
  if (saving.value || exporting.value) return;
  if (message === "menu:undo") performUndo();
  else if (message === "menu:redo") performRedo();
}

// slug(appID欄) の live 入力 (M11-T7)。可用性確認・予約 lifecycle は SlugField 内蔵
// (excludeUid=自 uid で自分の現 slug は「空き」判定 = ADR-0007 継承)。
// 旧実装の @input 毎 recordHistory と同じ履歴文法を保つ。
function onAppIDLiveInput(value: string): void {
  saveOperationError.value = null;
  appData.value.appID = value;
  recordHistory();
}

/**
 * 保存 (ADR-0007: uid正準 + revision楽観ロック)
 * 既存アプリは uid 宛の upsert、新規は uid なしの create。
 * conflict(読み直す/上書き)・成功反映・Exist等の共通処理は
 * useRevisionedAssetSave (saveHandle) が担う
 */
async function saveApp(): Promise<boolean> {
  appSaveSucceeded = false;
  saveOperationError.value = null;
  if (!appData.value.appID.trim()) {
    saveOperationError.value = t("appedit.no_appid");
    return false;
  }
  // M11-T7: 保存直前の予約再確認(§7.1 confirmForSave)。他者予約なら保存中断(D7)。
  // registry 重複は backend の unique 制約(Exist)が最終防衛
  const slugOk = await slugField.value?.confirmForSave() ?? true;
  if (!slugOk) {
    saveOperationError.value = t("appedit.duplicate_appid");
    return false;
  }
  // pois は配列のまま永続化する (正準形式 (配列) の場合は normalize で pois 配列に
  // 統一済みのため、送信 document に poiSources キーは載らない — M12-T30)
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
  return appSaveSucceeded;
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
    currentLang.value = appData.value.lang;
    resetHistoryBase();
    await Promise.all([hydrateSourceThumbnails(), hydrateAssetPreviews()]);
  } catch (e) {
    console.error("[reloadFromStore] Failed to reload app data:", e);
  }
}

async function discardRestoredDraft() {
  if (!draftLifecycle.draftRestored.value) return;
  // 新規(未保存)アプリの下書き: 破棄=完全削除でセーブポイントが存在しないため、
  // 削除後は編集対象が無くなり一覧へ戻る(このとき hot-exit flush を通すと
  // 下書きが再保存されるため goBack ではなく直接遷移する)
  if (!appUid.value) {
    const name = localized(appData.value.appName) || appData.value.appID || t("editor_ui.draft_badge");
    const result = await (window as any).dialog.showMessageBox({
      type: "warning",
      buttons: [t("editor_ui.delete_draft"), t("common.cancel")],
      defaultId: 1,
      cancelId: 1,
      message: t("editor_ui.delete_draft_confirm", { name }),
    });
    if (result.response !== 0) return;
    await draftLifecycle.discard();
    await router.push("/applist");
    return;
  }
  const result = await (window as any).dialog.showMessageBox({
    type: "warning",
    buttons: [t("editor_ui.discard_draft"), t("common.cancel")],
    defaultId: 1,
    cancelId: 1,
    message: t("editor_ui.discard_draft_confirm"),
  });
  if (result.response !== 0) return;
  await draftLifecycle.discard();
  await reloadFromStore();
}

async function chooseAppExport(hasSaved: boolean) {
  const buttons = hasSaved
    ? [
        t("editor_ui.export_save_and_run"),
        t("editor_ui.export_saved_only"),
        t("common.cancel"),
      ]
    : [t("editor_ui.export_save_and_run"), t("common.cancel")];
  const result = await (window as any).dialog.showMessageBox({
    type: "info",
    buttons,
    cancelId: buttons.length - 1,
    message: t("editor_ui.export_dirty_prompt"),
  });
  if (result.response === 0) return "save" as const;
  if (hasSaved && result.response === 1) return "saved" as const;
  return "cancel" as const;
}

async function exportSavedApp(): Promise<boolean> {
  if (!appUid.value) return false;
  try {
    const document = cloneDocument(await window.appedit.request(appUid.value));
    const result = await window.appedit.export(document);
    if (result.result === "Canceled") return false;
    if (result.result === "Error") {
      await (window as any).dialog.showMessageBox({
        type: "error",
        buttons: ["OK"],
        message: t("appedit.export_failed"),
        detail: result.message || "",
      });
      return false;
    }
    const warnings = (result.warnings || []).map((key) => t(key)).join("\n");
    await (window as any).dialog.showMessageBox({
      type: warnings ? "warning" : "info",
      buttons: ["OK"],
      message: t("appedit.export_success", { outDir: result.outDir }),
      detail: warnings,
    });
    return true;
  } catch (error) {
    await (window as any).dialog.showMessageBox({
      type: "error",
      buttons: ["OK"],
      message: t("appedit.export_failed"),
      detail: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

async function exportApp() {
  if (exporting.value || saving.value) return;
  exporting.value = true;
  try {
    await runEditorExportDecision({
      dirty: isDirty.value,
      hasSaved: !!appUid.value,
      choose: chooseAppExport,
      save: saveApp,
      exportSaved: exportSavedApp,
    });
  } finally {
    exporting.value = false;
  }
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
  // builtinを含め、マスタの全言語resource/提供範囲等はApp文書へ独立コピーする。
  // Viewer出力時だけbuiltinは従来どおり文字列IDへ畳み込む。
  const source = createAppSourceFromBaseMap(
    { mapID: item.mapID, ...(item.data || {}) },
    appData.value.lang,
  ) as AppSource;
  source.thumbnail = item.thumbnailUrl || undefined;
  if (source.sourceType === "tms" && source.data && !source.data.thumbnail && item.thumbnailUrl) {
    // マスタにthumbnail未設定の旧ユーザーベースマップ: Viewer規約のtmbs/{mapID}_menu.jpgを補完
    source.data.thumbnail = `tmbs/${item.mapID}_menu.jpg`;
  }
  appData.value.sources.push(source);
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

// M12-T10 v2.0: selector 左ペインの行を ResourceMasterRow へ統一。
// added 判定（HM6: 追加済み=青=selected=true）・disabledReason（HM4: previewDisabled 理由表示）・
// スラッグ重複除去（HM10: metadata から mapID を除外、slug 行が表示するため）を反映。
function isMapSourceAdded(uid: string): boolean {
  return appData.value.sources.some((source) => source.mapUid === uid && source.sourceType === "maplat");
}
function isBaseMapSourceAdded(mapID: string): boolean {
  return appData.value.sources.some((source) => source.mapUid === mapID && source.sourceType !== "maplat");
}
function asResourceListRowFromMap(item: MapListRow): ResourceListItemViewModel {
  const added = isMapSourceAdded(item.uid);
  const previewDisabled = !!item.previewDisabled;
  return {
    uid: item.uid,
    slug: item.mapID,
    title: item.title || item.mapID,
    thumbnailUrl: item.image ?? null,
    metadata: [],
    badges: [],
    // HM6: 追加済み=selected=true（青）。disabled より selected を優先
    selected: added,
    hasDraft: false,
    actions: [],
    // HM4: previewDisabled 理由を常時表示（added でない場合のみ）
    disabledReason: !added && previewDisabled ? t(item.previewDisabledReason || "appedit.preview.unavailable") : undefined,
  };
}

function asResourceListRowFromBaseMap(item: BaseMapCatalogItem): ResourceListItemViewModel {
  // resolveBaseMapSelectorText で label → title → mapID の順に解決（AppEdit.vue:1035-1040 と同形式）
  const title = resolveBaseMapSelectorText(
    { mapID: item.mapID, defaultLang: appData.value.lang, ...(item.data || {}) },
    appData.value.lang,
  );
  const added = isBaseMapSourceAdded(item.mapID);
  return {
    uid: item.uid,
    slug: String(item.mapID),
    title,
    thumbnailUrl: item.thumbnailUrl ?? null,
    // HM10: スラッグ重複除去。slug 行が mapID を表示するため scope のみ残す（存在する場合）
    metadata: item.scope ? [item.scope] : [],
    badges: [],
    // HM6: 追加済み=selected=true（青）
    selected: added,
    hasDraft: false,
    actions: [],
  };
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
    <DraftConflictDialog
      :visible="!!draftLifecycle.conflictDraft.value"
      @discard="draftLifecycle.resolveConflict('discard')"
      @apply="draftLifecycle.resolveConflict('apply')"
    />
    <EditorBusyOverlay
      :visible="saving || exporting"
      :label="saving ? t('editor_ui.save_state.saving') : t('editor_ui.busy_exporting')"
    />
    <EditorActionHeader
      :title="displayTitle"
      :save-state="saveState"
      :active-lang="currentLang"
      :language-options="SUPPORTED_LANGUAGES"
      :can-undo="canUndo"
      :can-redo="canRedo"
      :save-disabled="!!saveValidationError || !!saveOperationError || !isDirty"
      :saving="saving"
      :actions-disabled="exporting"
      :discard-draft-visible="saveState === 'draft-restored'"
      @back="goBack"
      @update:active-lang="currentLang = $event"
      @undo="performUndo"
      @redo="performRedo"
      @save="saveApp"
      @discard-draft="discardRestoredDraft"
    >
      <template #actions="{ disabled }">
        <button
          type="button"
          class="btn btn-sm btn-outline-primary"
          data-editor-action="export"
          :disabled="disabled || exporting"
          @click="exportApp"
        >
          {{ t("editor_ui.export_button") }}
        </button>
      </template>
    </EditorActionHeader>

    <!-- M11-T7/AC8 同型(MapEdit): 保存 operation エラーはアクションヘッダ直下に常時可視で表示する。
         旧配置(メタデータフォーム最下部)ではスクロールしないと見えず、保存失敗が伝わらなかった -->
    <DiagnosticFeedback
      v-if="saveOperationError"
      scope="operation"
      dismissible
      :items="[{ key: 'save-error', severity: 'danger', message: saveOperationError }]"
      @dismiss="saveOperationError = null"
    />

    <!-- M11-T7/AC9: EditorTabs primitive + §9 語彙(メタデータ編集/地図選択/POI選択/プレビュー) -->
    <div class="px-4 mt-2">
      <EditorTabs
        :model-value="activeTab"
        :tabs="[
          { key: 'metadata', labelKey: 'editor_ui.tabs.metadata' },
          { key: 'sources', labelKey: 'editor_ui.tabs.maps', testid: 'app-sources-tab' },
          { key: 'pois', labelKey: 'editor_ui.tabs.pois' },
          { key: 'preview', labelKey: 'editor_ui.tabs.preview' },
        ]"
        @update:model-value="activeTab = $event as typeof activeTab"
      />
    </div>

    <div class="flex-grow-1 position-relative overflow-hidden bg-white border-top">
      <div v-show="activeTab === 'metadata'" class="h-100 overflow-auto p-3">
        <form class="container-fluid" @submit.prevent>
          <!-- Row 1 (M11-T7/AC7・§18b決定2): 先頭は タイトル → スラッグ (ID) → デフォルト言語 -->
          <div class="row g-1 mb-2">
            <div class="col-md-4">
              <div class="form-label fw-bold small mb-0 d-flex align-items-center gap-1">{{ t("appedit.app_name") }} <LangValueChips :model-value="appData.title" :active-lang="currentLang" :default-lang="appData.lang" :language-options="SUPPORTED_LANGUAGES" @select-language="selectEditorLanguage" /></div>
              <input data-testid="app-title" v-model="titleText" type="text" class="form-control form-control-sm" :class="appTitleMissing ? 'is-invalid' : ''" @input="recordHistory">
              <DiagnosticFeedback v-if="appTitleMissing" scope="field" :items="[{ key: 'title-required', severity: 'danger', message: t('appedit.no_app_name') }]" />
            </div>
            <!-- App ID フィールド (M11-T7/AC1): 共通 SlugField(可用性診断+予約 lifecycle 内蔵)。
                 手動一意性確認ボタンは撤去(debounce 自動確認 + 保存時 confirmForSave へ機構置換) -->
            <div class="col-md-5">
              <SlugField
                ref="slugField"
                :model-value="appData.appID"
                asset-kind="app"
                :asset-uid="appUid || newAppUid"
                :draft-uid="appUid || newAppUid"
                :original-slug="confirmedSlug"
                :required="true"
                :disabled="translationMode"
                input-testid="app-id"
                @update:model-value="onAppIDLiveInput"
                @state-change="slugFieldState = $event"
              />
            </div>
            <div class="col-md-3">
              <label class="form-label fw-bold small mb-0" for="appDocumentLanguage">
                {{ t("editor_ui.default_lang_label") }}
              </label>
              <select
                id="appDocumentLanguage"
                class="form-select form-select-sm"
                data-editor-document-language
                :value="appData.lang"
                :disabled="translationMode"
                @change="setDocumentLanguage(($event.target as HTMLSelectElement).value as LangCode)"
              >
                <option
                  v-for="language in SUPPORTED_LANGUAGES"
                  :key="language.code"
                  :value="language.code"
                >
                  {{ language.nativeName }}
                </option>
              </select>
            </div>
          </div>
          <div class="row g-1 mb-2">
            <div class="col-12">
              <div class="form-label fw-bold small mb-0 d-flex align-items-center gap-1">{{ t("appedit.description") }} <LangValueChips :model-value="appData.description" :active-lang="currentLang" :default-lang="appData.lang" :language-options="SUPPORTED_LANGUAGES" @select-language="selectEditorLanguage" /></div>
              <textarea v-model="descriptionText" class="form-control form-control-sm" rows="5" @input="recordHistory" />
            </div>
          </div>
          <div class="row g-1 mb-2">
            <div class="col-md-7">
              <div class="form-label fw-bold small mb-0 d-flex align-items-center gap-1">{{ t("appedit.keywords") }} <LangValueChips :model-value="appData.keywords" :active-lang="currentLang" :default-lang="appData.lang" :language-options="SUPPORTED_LANGUAGES" @select-language="selectEditorLanguage" /></div>
              <input data-testid="app-keywords" v-model="keywordsText" type="text" class="form-control form-control-sm" @input="recordHistory">
            </div>
            <div class="col-md-5">
              <label class="form-label fw-bold small mb-0 d-flex align-items-center gap-1">{{ t("appedit.site_url") }} <ContextHelp :text="t('appedit.site_url_note')" :ariaLabel="t('appedit.site_url_note')" /></label>
              <input v-model="appData.siteUrl" type="url" class="form-control form-control-sm" placeholder="https://example.com/myapp/" :disabled="translationMode" @input="recordHistory">
            </div>
          </div>
          <div class="row g-1">
            <div class="col-12">
              <label class="form-label fw-bold small mb-0">{{ t("appedit.extra_info") }}</label>
              <textarea v-model="appData.extraInfo" class="form-control form-control-sm font-monospace" rows="8" :disabled="translationMode" @input="recordHistory" />
            </div>
          </div>
          <div class="row g-1 mb-2">
            <div class="col-12">
              <label class="form-label fw-bold small mb-0 d-flex align-items-center gap-1">{{ t("appedit.app_coverage") }} <ContextHelp :text="t('appedit.app_coverage_note')" :ariaLabel="t('appedit.app_coverage_note')" /></label>
              <div class="d-flex align-items-center gap-2 flex-wrap">
                <span class="small font-monospace">{{ bboxLabel(appData.coverageLngLats ?? appCoverageAuto.autoCoverage.value) }}</span>
                <button
                  type="button"
                  class="btn btn-sm btn-outline-primary"
                  data-testid="app-coverage-pick-button"
                  :disabled="translationMode"
                  @click="appCoverageModalVisible = true"
                >
                  {{ t("appedit.envelope_pick") }}
                </button>
                <button
                  v-if="appData.coverageLngLats"
                  type="button"
                  class="btn btn-sm btn-outline-danger"
                  :disabled="translationMode"
                  @click="applyAppCoverage(null)"
                >
                  {{ t("appedit.envelope_clear") }}
                </button>
              </div>
            </div>
          </div>
          <section class="settings-section mt-3">
            <h5>{{ t("appedit.http_settings") }}</h5>
            <div class="row g-2">
              <div class="col-md-2">
                <label class="form-label small fw-bold">{{ t("appedit.preview_port") }}</label>
                <input v-model.number="appData.httpSettings.previewPort" type="number" min="1" max="65535" class="form-control form-control-sm" :disabled="translationMode" @change="recordHistory">
              </div>
              <div class="col-md-10">
                <label class="form-label small fw-bold">{{ t("appedit.http_toggles") }}</label>
                <div class="toggle-grid">
                  <label class="form-check"><input v-model="appData.httpSettings.pwaManifest" type="checkbox" class="form-check-input" :disabled="translationMode" @change="recordHistory"> {{ t("appedit.pwa_manifest") }}</label>
                  <label class="form-check"><input v-model="appData.httpSettings.overlay" type="checkbox" class="form-check-input" :disabled="translationMode" @change="recordHistory"> {{ t("appedit.overlay_ui") }}</label>
                  <label class="form-check"><input v-model="appData.httpSettings.enableHideMarker" type="checkbox" class="form-check-input" :disabled="translationMode" @change="recordHistory"> {{ t("appedit.hide_marker_ui") }}</label>
                  <label class="form-check"><input v-model="appData.httpSettings.enableMarkerList" type="checkbox" class="form-check-input" :disabled="translationMode" @change="recordHistory"> {{ t("appedit.marker_list_ui") }}</label>
                  <label class="form-check"><input v-model="appData.httpSettings.enableBorder" type="checkbox" class="form-check-input" :disabled="translationMode" @change="recordHistory"> {{ t("appedit.border_ui") }}</label>
                  <label class="form-check"><input v-model="appData.httpSettings.enableCache" type="checkbox" class="form-check-input" :disabled="translationMode" @change="recordHistory"> {{ t("appedit.cache_ui") }}</label>
                  <label class="form-check"><input v-model="appData.httpSettings.stateUrl" type="checkbox" class="form-check-input" :disabled="translationMode" @change="recordHistory"> {{ t("appedit.state_url") }}</label>
                  <label class="form-check"><input v-model="appData.httpSettings.enableShare" type="checkbox" class="form-check-input" :disabled="translationMode" @change="recordHistory"> {{ t("appedit.share_ui") }}</label>
                </div>
              </div>
              <div class="col-md-4">
                <label class="form-label small fw-bold">{{ t("appedit.mapbox_token") }}</label>
                <input v-model="appData.httpSettings.mapboxToken" type="text" class="form-control form-control-sm" :disabled="translationMode" @input="recordHistory">
              </div>
              <div class="col-md-4">
                <label class="form-label small fw-bold">{{ t("appedit.google_api_key") }}</label>
                <input v-model="appData.httpSettings.googleApiKey" type="text" class="form-control form-control-sm" :disabled="translationMode" @input="recordHistory">
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
                  <button type="button" class="btn btn-sm btn-outline-secondary text-nowrap" :disabled="translationMode" @click="uploadSplash">{{ t("appedit.upload") }}</button>
                </div>
                <img v-if="splashPreviewUrl" :src="splashPreviewUrl" class="asset-preview mt-1" alt="splash">
              </div>
              <div class="col-md-2">
                <label class="form-label small fw-bold">{{ t("appedit.home_lng") }}</label>
                <input :value="appData.appSettings.homeLng ?? ''" type="number" step="0.000001" class="form-control form-control-sm" :disabled="translationMode" @change="appData.appSettings.homeLng = finiteOrNull(($event.target as HTMLInputElement).value); recordHistory()">
              </div>
              <div class="col-md-2">
                <label class="form-label small fw-bold">{{ t("appedit.home_lat") }}</label>
                <input :value="appData.appSettings.homeLat ?? ''" type="number" step="0.000001" class="form-control form-control-sm" :disabled="translationMode" @change="appData.appSettings.homeLat = finiteOrNull(($event.target as HTMLInputElement).value); recordHistory()">
              </div>
              <div class="col-md-2 d-flex align-items-end">
                <button type="button" class="btn btn-sm btn-outline-info text-nowrap mb-1" data-testid="app-edit-estimate-home" :disabled="translationMode || !(appData.coverageLngLats ?? appCoverageAuto.autoCoverage.value)" @click="estimateHomeFromSources">
                  {{ t("common.estimate") }}
                </button>
                <button type="button" class="btn btn-sm btn-outline-secondary text-nowrap mb-1 ms-1" :disabled="translationMode" @click="openHomePositionModal">{{ t("appedit.home_pick") }}</button>
              </div>
              <div class="col-md-2">
                <label class="form-label small fw-bold">{{ t("appedit.default_zoom") }}</label>
                <input v-model.number="appData.appSettings.defaultZoom" type="number" min="0" max="28" class="form-control form-control-sm" :disabled="translationMode" @change="recordHistory">
              </div>
            </div>
          </section>

          <section v-if="appData.httpSettings.pwaManifest" class="settings-section mt-3">
            <h5>{{ t("appedit.manifest_settings") }}</h5>
            <div class="row g-2">
              <div class="col-md-4">
                <div class="form-label small fw-bold d-flex align-items-center gap-1">{{ t("appedit.manifest_name") }} <LangValueChips :model-value="appData.manifestSettings.name" :active-lang="currentLang" :default-lang="appData.lang" :language-options="SUPPORTED_LANGUAGES" @select-language="selectEditorLanguage" /></div>
                <input data-testid="app-manifest-name" v-model="manifestNameText" type="text" class="form-control form-control-sm" @input="recordHistory">
              </div>
              <div class="col-md-3">
                <div class="form-label small fw-bold d-flex align-items-center gap-1">{{ t("appedit.manifest_short_name") }} <LangValueChips :model-value="appData.manifestSettings.shortName" :active-lang="currentLang" :default-lang="appData.lang" :language-options="SUPPORTED_LANGUAGES" @select-language="selectEditorLanguage" /></div>
                <input data-testid="app-manifest-short-name" v-model="manifestShortNameText" type="text" class="form-control form-control-sm" @input="recordHistory">
              </div>
              <div class="col-md-2">
                <label class="form-label small fw-bold">{{ t("appedit.manifest_background_color") }}</label>
                <input v-model="appData.manifestSettings.backgroundColor" type="color" class="form-control form-control-sm form-control-color" :disabled="translationMode" @input="recordHistory">
              </div>
              <div class="col-md-2">
                <label class="form-label small fw-bold">{{ t("appedit.manifest_theme_color") }}</label>
                <input v-model="appData.manifestSettings.themeColor" type="color" class="form-control form-control-sm form-control-color" :disabled="translationMode" @input="recordHistory">
              </div>
              <div class="col-md-3">
                <label class="form-label small fw-bold">{{ t("appedit.manifest_display") }}</label>
                <select v-model="appData.manifestSettings.display" class="form-select form-select-sm" :disabled="translationMode" @change="recordHistory">
                  <option value="standalone">standalone</option>
                  <option value="fullscreen">fullscreen</option>
                  <option value="minimal-ui">minimal-ui</option>
                  <option value="browser">browser</option>
                </select>
              </div>
              <div class="col-md-4">
                <label class="form-label small fw-bold">{{ t("appedit.manifest_start_url") }}</label>
                <input v-model="appData.manifestSettings.startUrl" type="text" class="form-control form-control-sm" :disabled="translationMode" @input="recordHistory">
              </div>
              <div class="col-md-4">
                <label class="form-label small fw-bold">{{ t("appedit.manifest_scope") }}</label>
                <input v-model="appData.manifestSettings.scope" type="text" class="form-control form-control-sm" :disabled="translationMode" @input="recordHistory">
              </div>
              <div class="col-md-6">
                <label class="form-label small fw-bold d-flex align-items-center gap-1">{{ t("appedit.manifest_icon_source") }} <ContextHelp :text="t('appedit.manifest_icon_note')" :ariaLabel="t('appedit.manifest_icon_note')" /></label>
                <div class="d-flex align-items-center gap-2">
                  <input v-model="appData.manifestSettings.iconSource" type="text" class="form-control form-control-sm" :class="{ 'is-invalid': !!assetUploadError }" readonly>
                  <button type="button" class="btn btn-sm btn-outline-secondary text-nowrap" :disabled="translationMode" @click="uploadPwaIcon">{{ t("appedit.upload") }}</button>
                </div>
                <!-- M12-T11 (R3/C32): inline text-danger から DF field へ -->
                <DiagnosticFeedback v-if="assetUploadError" scope="field" :items="[{ key: 'pwa-icon', severity: 'danger', message: assetUploadError }]" />
                <img v-if="iconPreviewUrl" :src="iconPreviewUrl" class="asset-preview mt-1" alt="icon">
              </div>
            </div>
          </section>
        </form>
      </div>

      <ResourceSelector v-show="activeTab === 'sources'" class="p-3">
        <template #list>
          <div class="source-pane-toolbar pb-2">
            <div class="btn-group w-100 mb-2" role="group">
              <button class="btn btn-sm" :class="sourceListMode === 'maps' ? 'btn-primary' : 'btn-outline-primary'" @click="sourceListMode = 'maps'">
                {{ t("appedit.map_list") }}
              </button>
              <button data-testid="app-basemap-mode" class="btn btn-sm" :class="sourceListMode === 'baseMaps' ? 'btn-primary' : 'btn-outline-primary'" @click="sourceListMode = 'baseMaps'">
                {{ t("appedit.base_map_list") }}
              </button>
            </div>

          </div>
          <ResourceSelectorList
            :key="sourceListMode"
            :query="sourceListMode === 'maps' ? mapSearchQuery : baseMapSearchQuery"
            :adapter="sourceListMode === 'maps' ? mapSourceAdapter : baseMapSearchAdapter"
            :placeholder="sourceListMode === 'maps' ? t('appedit.search_maps_placeholder') : t('appedit.search_base_maps')"
            :input-testid="sourceListMode === 'baseMaps' ? 'app-basemap-search' : undefined"
            :spatial-context="appSourceSpatialView"
            @update:query="sourceListMode === 'maps' ? (mapSearchQuery = $event) : (baseMapSearchQuery = $event)"
            @toggle-spatial-context="appSourceSpatialContext.toggle"
          >
            <template #item="{ item }">
              <ResourceMasterRow
                v-if="sourceListMode === 'maps'"
                :item="asResourceListRowFromMap(item)"
                kind="map"
                variant="selector"
                :disabled="!isMapSourceAdded(item.uid) && !!item.previewDisabled"
                :data-testid="`app-map-row-${item.mapID}`"
                @select="addMapSource(item)"
              />
              <ResourceMasterRow
                v-else
                :item="asResourceListRowFromBaseMap(item)"
                kind="base-map"
                variant="selector"
                :disabled="false"
                :data-testid="`app-basemap-row-${item.mapID}`"
                @select="addBaseMapSource(item)"
              />
            </template>
          </ResourceSelectorList>
        </template>

        <template #selected>
          <h5>{{ t("appedit.selected_sources") }}</h5>
          <ResourceEmptyState
            v-if="appData.sources.length === 0"
            icon-class="bi bi-map"
            :message="t('appedit.no_selected_sources')"
          />
          <div v-else class="selected-list">
            <div v-for="(source, index) in appData.sources" :key="`${source.sourceType}:${source.mapUid}`" class="selected-source border rounded p-2 mb-2" :data-testid="`app-selected-source-${source.mapUid}`">
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
                  <div class="form-label small mb-0 d-flex align-items-center gap-1">{{ t("appedit.source_label") }} <LangValueChips :model-value="source.label" :active-lang="currentLang" :default-lang="appData.lang" :language-options="SUPPORTED_LANGUAGES" @select-language="selectEditorLanguage" /></div>
                  <input v-model="source.label[currentLang]" type="text" class="form-control form-control-sm" @input="recordHistory">
                </div>
                <div class="col-auto">
                  <div class="form-check">
                    <input :id="`start-${index}`" class="form-check-input" type="radio" name="startFrom" :checked="source.startFrom" :disabled="translationMode" @change="setStartFrom(source)">
                    <label class="form-check-label" :for="`start-${index}`">{{ t("appedit.start_from") }}</label>
                  </div>
                </div>
                <div v-if="source.sourceType === 'tms'" class="col-auto">
                  <select v-model="source.role" class="form-select form-select-sm" :disabled="translationMode" @change="recordHistory">
                    <option value="base">{{ t("appedit.roles.base") }}</option>
                    <option value="overlay">{{ t("appedit.roles.overlay") }}</option>
                  </select>
                </div>
              </div>
              <AppSourceEditor
                :source="source"
                :current-lang="currentLang"
                :default-lang="appData.lang"
                :language-options="SUPPORTED_LANGUAGES"
                :translation-mode="translationMode"
                :fallback-center="homePosition ?? undefined"
                :app-coverage-lng-lats="appData.coverageLngLats ?? null"
                @select-language="selectEditorLanguage"
                @change="recordHistory"
              />
            </div>
          </div>
        </template>
      </ResourceSelector>

      <!-- Tab: POIデータ (Phase 8 Task 2)。器は appData.pois 配列、履歴は onPoisChange の
           recordHistory 明示 (AppEdit の既存方式) -->
      <!-- NOTE: v-show を d-flex と同じ div に置くと Bootstrap の display:flex!important に負けて
           v-show が効かず、後続タブ(プレビュー)を覆い隠す (MapEdit settings と同じ罠、2026-07-12)。
           v-show 専用ラッパーを挟む -->
      <div v-show="activeTab === 'pois'" class="h-100" data-testid="app-pois-tab-pane">
      <div class="h-100 overflow-hidden p-3 d-flex flex-column">
        <DiagnosticFeedback v-if="poisUnsupported" :items="[{ key: 'h', severity: 'warning', message: t('appedit.poi_format_unsupported') }]" scope="section" class="flex-shrink-0" />
        <!-- M3-T6 §5.8 / M12-T30: 未対応形式中は表示ガード (Array.isArray — MapEdit と同文法) + read-only で
             生値温存を空配列表示の編集が上書きする経路を塞ぐ。§5.4: hostSlug/hostTitle は変換 slug/title 基底 -->
        <PoiReferenceEditor class="flex-grow-1" heading-key="poiref.selected_list_app" :pois="Array.isArray(appData.pois) ? appData.pois : []" :read-only="poisUnsupported" :host-slug="appData.appID" :host-title="appData.appName" :active-lang="currentLang" :default-lang="appData.lang" :language-options="SUPPORTED_LANGUAGES" :spatial-context="appPoiSpatialView" @toggle-spatial-context="appPoiSpatialContext.toggle" @select-language="selectEditorLanguage" @update:pois="onPoisChange" />
      </div>
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
        <!-- M11-T7/AC8: section 診断(警告)へ移行(絶対配置の overlay 位置は .preview-error が担う) -->
        <DiagnosticFeedback
          v-if="previewError"
          class="preview-error"
          scope="section"
          :items="[{ key: 'preview-error', severity: 'warning', message: previewError }]"
        />
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
      :model-value="appData.coverageLngLats ?? appCoverageAuto.autoCoverage.value"
      :fallback-center="homePosition ?? undefined"
      title-key="appedit.app_coverage_modal_title"
      help-key="appedit.app_coverage_modal_help"
      @update:model-value="applyAppCoverage"
      @close="appCoverageModalVisible = false"
    />
  </div>
</template>

<style scoped>
/* 2カラムグリッドは ResourceSelector が提供 */
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
/* .source-row の基底スタイルは ResourceSelectorList の :slotted に集約 (m11-t8b) */
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
