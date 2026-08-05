<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, computed, watch, nextTick } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { isEqual, cloneDeep } from 'lodash-es';
import ProgressModal from '../components/ProgressModal.vue';
import EnvelopeEditorModal from '../components/EnvelopeEditorModal.vue';
import PoiReferenceEditor from '../components/PoiReferenceEditor.vue';
import ResourceSelector from '../components/ResourceSelector.vue';
import ResourceSelectorList from '../components/ResourceSelectorList.vue';
import ResourceMasterRow from '../components/resource-list/ResourceMasterRow.vue';
import ResourceRangeFilterButton from '../components/resource-list/ResourceRangeFilterButton.vue';
import ResourceEmptyState from '../components/resource-list/ResourceEmptyState.vue';
import DraftConflictDialog from '../components/editor-ui/DraftConflictDialog.vue';
import EditorActionHeader from '../components/editor-ui/EditorActionHeader.vue';
import EditorBusyOverlay from '../components/editor-ui/EditorBusyOverlay.vue';
import LangValueChips from '../components/editor-ui/LangValueChips.vue';
import LicenseSelect from '../components/editor-ui/LicenseSelect.vue';
import SlugField from '../components/editor-ui/SlugField.vue';
import EditorTabs from '../components/editor-ui/EditorTabs.vue';
import DiagnosticFeedback from '../components/editor-ui/DiagnosticFeedback.vue';
import ContextHelp from '../components/editor-ui/ContextHelp.vue';
import noImage from '../assets/img/no_image.png';
import osmThumb from '../assets/img/osm.png';
import gsiThumb from '../assets/img/gsi.png';
import gsiOrthoThumb from '../assets/img/gsi_ortho.png';
import { envelopeToBbox, resolveBaseMapSelectorText } from '../utils/appSourceModel';
import { isNonReferenceObjectEntry } from '../utils/poiReferenceUi';
import { acceptDocumentPois, writeDocumentPois } from '../utils/appPoisFormat';
import { usePoisFormatGuard } from '../composables/usePoisFormatGuard';
import { computeBboxAndCentroid, estimateZoomForBbox, expandBboxByRatio } from '../utils/geoEstimate';
import { resolveBaseMapLayerMetadata } from '../utils/baseMapEditorDocument';
import { isEditableElement } from '../utils/nativeTextUndo';
import { isTranslationMode } from '../utils/editorLanguageMode';
import { MAP_LANG_ATTRS } from '../utils/langResource';
import {
    LANGS_MAP,
    SUPPORTED_LANGUAGES,
    resolveEditorLanguage,
    type LangCode,
} from '../utils/editorLanguages';
import { UndoStack } from '../services/editorUndoStack';
import { useHistorySuppression } from '../composables/useHistorySuppression';
import { editorComputeBackend } from '../services/editorComputeBackend';
import { useRevisionedAssetSave } from '../composables/useRevisionedAssetSave';
import { useAssetDraftLifecycle } from '../composables/useAssetDraftLifecycle';
import { useInitialDraftPersist } from '../composables/useInitialDraftPersist';
import type { SlugFieldState } from '../composables/useSlugAvailability';
import type { SelectorSpatialContextView, ResourceListItemViewModel } from '../components/resource-list/resourceListTypes';
import { createBaseMapVisibilityListAdapter } from '../views/resource-adapters/baseMapVisibilityListAdapter';
import type { BaseMapVisibilityItem } from '../../electron/services/SqliteDataService';
import { runEditorExportDecision } from '../composables/useEditorExportDecision';
import type { EditorSaveState } from '../components/editor-ui/editorUiTypes';
import type { MapSaveResult } from '../electron';
// @ts-ignore
import { useTranslation } from 'i18next-vue';
import { sha1 } from 'js-sha1';
// @ts-ignore
import Geocoder from '../libs/ol-geocoder/base';
// @ts-ignore
import ContextMenu from '../libs/ol-contextmenu/main';
// @ts-ignore
import { MaplatMap } from '@maplat/core/src/map_ex';
// @ts-ignore
import { mapSourceFactory } from '@maplat/core/src/source_ex';
import Tin from '@maplat/tin';
import { GeoJSON } from 'ol/format';
import { edgeSplit } from '../utils/edgeSplitMath';

import { defaults as interactionDefaults, DragRotateAndZoom, Modify, Snap, Pointer } from 'ol/interaction';
import { defaults as controlDefaults } from 'ol/control';
import { altKeyOnly } from 'ol/events/condition';
import 'ol/ol.css';
import { Tile, Group } from 'ol/layer';
import LayerSwitcher from 'ol-layerswitcher';
import 'ol-layerswitcher/dist/ol-layerswitcher.css';
import { Vector as VectorLayer } from 'ol/layer';
import { Vector as VectorSource } from 'ol/source';
import { Style, Stroke, Fill, Icon } from 'ol/style';
import { LineString } from 'ol/geom';
import { transform } from 'ol/proj';
import { useGcpAutoRange } from '../composables/useGcpAutoRange';
import { navigateBackToList } from '../utils/listBackNavigation';
// import { getCenter } from 'ol/extent';
// import { Projection } from 'ol/proj';
// import { XYZ } from 'ol/source';
import type { MapBrowserEvent } from 'ol';
import type Feature from 'ol/Feature';
import type { SimpleGeometry } from 'ol/geom';

const { t, i18next } = useTranslation();
const TIN_V2_OPTIONS = { useV2Algorithm: true };
const router = useRouter();
const route = useRoute();

// 旧実装 mapedit.js と同じ定数
const MERC_MAX = 20037508.342789244;
const MERC_CROSSMATRIX = [
    [0.0, 0.0],
    [0.0, 1.0],
    [1.0, 0.0],
    [0.0, -1.0],
    [-1.0, 0.0]
];

// 保存済みslug (基盤設定など旧slugキーのIPCが参照する)。表示中のslug編集値は mapData.mapID
const mapID = ref('');
// 保存フロー (revision 楽観ロック) は useRevisionedAssetSave に共通化 (ADR-0007, Phase 4 Task 2)。
// 以下の3値の正本は handle の ref に一本化する:
//   uid(=mapUid): 不変の正本キー。undefined = 未保存の新規地図
//   revision: 楽観ロック用。保存時に expectedRevision として送り、保存結果で更新する
//   confirmedSlug: 現在DBに永続化されているslug。mapID欄がこの値に戻ったら再チェック不要
// saveMap が組み立てた送信内容を send クロージャへ渡す一時変数。
// copy 保存では handle.uid(旧uid) ではなく saveMap が決めた sendUid=undefined /
// copyFromUid=旧uid を使う必要があるため、send は ctx.uid を参照しない
let pendingSave: {
    saveValue: any;
    tins: any[];
    sendUid: string | undefined;
    copyFromUid: string | undefined;
} | null = null;
const saveHandle = useRevisionedAssetSave<MapSaveResult>({
    send: async ({ expectedRevision }) => {
        const { saveValue, tins, sendUid, copyFromUid } = pendingSave!;
        // M11-T7/D5改: UID 維持改名は明示フィールド renameFromSlug で原本(slugキー)改名の
        // 残作業を引き継ぐ。起点は「最後に完全成功した保存の slug」(mapID ref = applySuccess
        // でのみ更新)であり、DBコミット後のファイル操作失敗→再試行でも失われない。
        const renameFromSlug =
            sendUid && mapID.value && mapID.value !== saveValue.mapID ? mapID.value : undefined;
        // JSON ラウンドトリップで Vue リアクティブプロキシ・非シリアライズ可能値を除去してから送信
        const result = await window.mapedit.save({
            mapObject: JSON.parse(JSON.stringify(saveValue)),
            tins: JSON.parse(JSON.stringify(tins)),
            // M11-T7/AC6: 新規は事前採番 uid + create 明示合図(§7.2b)で create 経路へ。
            // M11-T10: 複製(copyFromUid)も同じ create 経路に乗せる。一覧側の slug 予約は
            // asset_uid=newMapUid 帰属のため、uid を送らない旧 copy 経路(server採番)だと
            // 自分の予約に isSlugAvailable が弾かれて Exist になる(複製保存の自己衝突)。
            uid: sendUid ?? (newMapUid || undefined),
            slug: saveValue.mapID,
            expectedRevision,
            copyFromUid,
            renameFromSlug,
            ...(sendUid == null && newMapUid ? { create: true } : {}),
        });
        if (!result) {
            // IPC が結果を返さなかった: エラーを operation 診断へ(M11-T7/AC8)
            console.error('[saveMap] Save error:', result);
            saveOperationError.value = t('mapedit.error_saving');
            return null;
        }
        // 旧実装の result.slug ?? saveValue.mapID フォールバックを維持
        // (composable は Success の slug をそのまま confirmedSlug に採用するため)
        if ('result' in result && result.result === 'Success' && result.slug == null) {
            result.slug = saveValue.mapID;
        }
        return result;
    },
    applySuccess: async (result) => {
        mapSaveSucceeded = true;
        await (window as any).dialog.showMessageBox({
            type: 'info',
            buttons: ['OK'],
            message: t('mapedit.success_save')
        });
        // uid/revision/confirmedSlug は composable が保存結果から反映済み。以下は画面固有処理
        mapID.value = confirmedSlug.value!;
        if (!mapData.value.mapID) mapData.value.mapID = pendingSave!.saveValue.mapID;
        mapData.value.uid = result.uid;
        mapData.value.revision = result.revision;
        mapData.value.status = 'Update';
        // M12-T17: 新規原本アップロード直後の保存(tmpCheck)はバックエンドが恒久タイルURLを
        // result.url として返す。originalMapData の cloneDeep(次行)・markHistorySaved(165行)
        // より前に代入しないと、保存済みスナップショットに新しい url_ が反映されず
        // 保存直後から恒久的に dirty になる(設計レビューv1 Major2 / v2 §1 で実挙動と整合確認済み)
        if (result.url) mapData.value.url_ = result.url;
        originalMapData.value = cloneDeep(mapData.value);
        markHistorySaved();
        await draftLifecycle.markSaved();
        // M12-T29: 複製・新規作成で result.uid が事前採番 draftUid と異なるとき、
        // identity を保存済み行の (uid, revision) へ再構成しないと、その後の編集が
        // 旧 draftUid で persist され、正式データと同一 slug のドラフトが取り残される。
        // PoiEdit.vue の m11-t10b で確立した markSaved → rebase → flush パターンと同一。
        draftLifecycle.rebase(result.uid, result.revision);
        await draftLifecycle.flush();
        // 新規作成・複製で編集対象uidが変わった場合、リロード時に正しい地図を
        // 再オープンできるようURLのクエリを追随させる (履歴は汚さない)
        if (route.query.uid !== result.uid) {
            router.replace({ query: { ...route.query, uid: result.uid } });
        }
        // M12-T17: タイル参照が恒久URLへ切り替わったので、タイルソースのみを再生成して
        // 表示に反映する(loadMapTiles() 全体は使わない。exchangeTileSource() の理由は
        // 定義側コメント参照)。url_ 代入・cloneDeep・markHistorySaved 完了後なので dirty 判定は汚さない
        if (result.url) await exchangeTileSource();
    },
    reloadFromStore: () => reloadFromStore(),
    isDirty: () => isDirty.value,
    onFailure: async (result) => {
        if (result.result === 'Exist') {
            // 保存レースで slug を先取りされた(field 表示は SlugField が担う)。
            // M11-T7/AC8: operation 診断へ(旧 info ダイアログ撤去)
            saveOperationError.value = t('mapedit.error_duplicate_id');
        } else if ('errorKey' in result && result.errorKey) {
            // M13-T2 (§5.3/§7, レビュー v1 Minor 5): originals 未対応拡張子など、main 側が
            // 契約した errorKey を優先して専用メッセージを表示する(DB未到達の reject はこの分岐)
            console.error('[saveMap] Save error:', result);
            saveOperationError.value = t(result.errorKey);
        } else {
            // DBコミット後のファイル操作失敗 (Error{revision付き}, ADR-0007) は composable が
            // uid/revision/confirmedSlug を取り込み済み(偽のrevision-conflict防止)。ここでは通知のみ。
            // 原本改名の残作業は mapID ref(applySuccess でのみ更新)由来の renameFromSlug が
            // 再試行に引き継ぐ(M11-T7/D5改)
            console.error('[saveMap] Save error:', result);
            saveOperationError.value = t('mapedit.error_saving');
        }
    },
    // ダイアログ表示時点の言語で t() されるよう getter で渡す (旧実装と同じタイミングで翻訳)
    messages: {
        get conflict() { return t('common.revision_conflict'); },
        get discard() { return t('mapedit.confirm_no_save'); },
        get reload() { return t('common.reload'); },
        get overwrite() { return t('common.overwrite'); },
    },
});
// 既存の参照箇所を最小変更で handle 経由にするための別名
// (revision は保存フロー移行後 MapEdit 内に直接の読み書きが残らないため別名不要)
const { uid: mapUid, revision, confirmedSlug, adoptLoaded, performSave, saving } = saveHandle;
/**
 * 旧実装 defaultMap 相当: 新規作成時の初期値
 * map.js defaultMap に完全準拠
 */
const defaultMapData = () => ({
    title: '',
    label: '',
    attr: '',
    dataAttr: '',
    strictMode: 'strict',   // 旧実装デフォルトは 'strict'
    vertexMode: 'plain',
    gcps: [],
    edges: [],
    sub_maps: [],
    status: 'New',
    officialTitle: '',
    author: '',
    era: '',
    createdAt: '',
    license: 'All right reserved',
    dataLicense: 'CC BY-SA',
    licenseNote: '',
    dataLicenseNote: '',
    contributor: '',
    mapper: '',
    reference: '',
    description: '',
    url: '',
    width: undefined as number | undefined,
    height: undefined as number | undefined,
    url_: '',
    lang: 'ja',
    imageExtension: undefined as string | undefined,
    wmtsHash: undefined as string | undefined,
    wmtsFolder: '',
    homePosition: undefined as number[] | undefined,
    mercZoom: undefined as number | undefined,
    mapID: '',
});
const mapData = ref<any>({});
const originalMapData = ref<any>({}); // isDirty 比較用ディープクローン

// M4-T1: Map 側の文書受け入れ関所。外部 (DB / ファイル / 複製元) から来た文書はすべてここを通す。
// 現時点で Map は文書の正規化を行わないが、将来ここに正規化を挟んでも pois の温存は
// acceptDocumentPois が保証する (AppEdit の normalizeAppDocument と同一の関数)。
// 履歴復帰 (restoreHistoryState) は受け入れ済み文書の内部クローンなのでここを通さない
// — AppEdit の performUndo/performRedo が normalizeAppDocument を通らないのと対称であり、
// その経路の判定漏れは下の poisGuard (computed) が塞ぐ。
function setMapDocument(incoming: any): void {
    mapData.value = acceptDocumentPois(incoming, incoming);
    // M5-T7: main 側で導出済みの url_ と対になる url を記録する（設計 §5.3 の初期化）
    markRuntimeTileUrlDerived();
}

// pois がエディタ正準形式 (配列) でないかどうか。判定・表示・read-only・書き込み可否は
// AppEdit と共通の usePoisFormatGuard が唯一の実装 (M4-T1)
const poisGuard = usePoisFormatGuard(() => mapData.value);
const { unsupported: poisUnsupported, pois: poisForEditor } = poisGuard;
// M11-T7: mapID 欄は共通 SlugField(可用性・予約 lifecycle 内蔵)。旧 onlyOne の手動一意性
// 確認機構は撤去し、保存時 confirmForSave(予約再確認)へ機構置換した。
const slugField = ref<InstanceType<typeof SlugField> | null>(null);
const slugFieldState = ref<SlugFieldState>('idle');
// M11-T7/AC8: 保存 operation エラー(ID 重複/予約 conflict/保存失敗)。旧 error ダイアログから
// DiagnosticFeedback scope="operation" へ移行。編集(履歴 snapshot)で自動的に解消する(F4 同型)
const saveOperationError = ref<string | null>(null);
// 新規地図の事前採番 uid (AC6): draft キーと保存 create uid を兼ねる。既存 draftUid が
// route にあれば引き継ぐ(hot exit 復元で予約 claim も同じ帰属になる)
const newMapUid = (typeof route.query.uid === 'string' && route.query.uid && route.query.uid !== 'new')
    ? ''
    : (typeof route.query.draftUid === 'string' ? route.query.draftUid : crypto.randomUUID());
const copyFromUidSource = ref<string | undefined>(undefined); // M11-T10: 複製元UID
const mappingUIRow = ref('layer');
const currentEditingLayer = ref(0);
const editingID = ref('');
const createCoordinateComputed = (isX: boolean, isIllst: boolean) => computed({
    get: () => {
        if (!editingID.value) return '';
        const idInt = Number(editingID.value);
        let pt;
        if (newGcp.value && idInt === newGcp.value[2]) {
            pt = newGcp.value[isIllst ? 0 : 1];
        } else {
            const gcp = gcps.value[idInt - 1];
            if (gcp) pt = gcp[isIllst ? 0 : 1];
        }
        if (!pt) return '';
        
        if (isIllst) {
            return pt[isX ? 0 : 1];
        } else {
            const lonlat = transform(pt, 'EPSG:3857', 'EPSG:4326');
            return arrayRoundTo(lonlat, 6)[isX ? 0 : 1];
        }
    },
    set: (val: number | string) => {
        if (!editingID.value || val === '') return;
        const numVal = Number(val);
        const isNew = newGcp.value && Number(editingID.value) === newGcp.value[2];
        
        if (isNew) {
             if (!newGcp.value[isIllst ? 0 : 1]) newGcp.value[isIllst ? 0 : 1] = [0, 0];
        }
        
        const targetPoint = isNew ? newGcp.value[isIllst ? 0 : 1] : gcps.value[Number(editingID.value) - 1][isIllst ? 0 : 1];
        if (!targetPoint) return;
        
        if (isIllst) {
            targetPoint[isX ? 0 : 1] = numVal;
        } else {
            const lonlat = transform(targetPoint, 'EPSG:3857', 'EPSG:4326');
            lonlat[isX ? 0 : 1] = numVal;
            const merc = transform(lonlat, 'EPSG:4326', 'EPSG:3857');
            targetPoint[0] = merc[0];
            targetPoint[1] = merc[1];
        }
        
        // OpenLayers マーカー座標を更新（旧実装の Vue Event Bus 相当）
        const map = isIllst ? illstMap : mercMap;
        const source = map?.getSource('marker');
        if (source) {
            const feature = source.getFeatures().find((f: any) => f.get('gcpIndex') === (isNew ? 'new' : Number(editingID.value) - 1));
            if (feature) {
                const geom = feature.getGeometry();
                const coords = (isIllst && illstSource) ? illstSource.xy2SysCoord(targetPoint) : targetPoint;
                if (geom) geom.setCoordinates(coords);
            }
        }
    }
});

const editingX = createCoordinateComputed(true, true);
const editingY = createCoordinateComputed(false, true);
const editingLong = createCoordinateComputed(true, false);
const editingLat = createCoordinateComputed(false, false);
const sub_maps = ref<any[]>([]);
const importance = computed(() => {
    if (currentEditingLayer.value === 0) return 0;
    return sub_maps.value[currentEditingLayer.value - 1]?.importance ?? 0;
});
const priority = computed(() => {
    // 旧実装 map.js L.337 に準拠
    if (currentEditingLayer.value === 0) return 0;
    return sub_maps.value[currentEditingLayer.value - 1]?.priority ?? 0;
});
const baseMapList = ref<any[]>([]);
const currentBaseMapID = ref('osm');
const baseMapVisibilityList = ref<BaseMapVisibilityItem[]>([]);
const baseMapVisibilityLoading = ref(false);
const baseMapVisibilityError = ref('');
// ベースマップ表示選択の検索/絞り込み(文字列・GCP範囲・地域指定)
const baseMapSearchText = ref('');
const baseMapFilterRegion = ref<[number, number][] | null>(null);
const showBaseMapRegionModal = ref(false);

// M12-T10: builtin ベースマップアイコン（OSM/GSI/GSI_ORTHO）の同梱リソース。
// IPC が basemap_icons/ を resolveBaseMapListImage で解決済みだが、
// 同梱リソースは vite import で確実にロードできるためフォールバックとして併用（AppEdit.vue:136-140 と同形式）
const builtinThumbnails: Record<string, string> = {
    osm: osmThumb,
    gsi: gsiThumb,
    gsi_ortho: gsiOrthoThumb,
};

// M12-T10 v2.0: selector の spatial context。EnvelopeEditorModal で設定した baseMapFilterRegion を使う。
// 無ければ GCP auto range を fallback（現状の filteredBaseMapVisibilityList と同一方針）。
// adapter の bbox 絞り込みに使う。UI は ResourceRangeFilterButton へ一本化（spatial-toggle は #range-filter slot で排他）。
const baseMapSpatialContext = computed<SelectorSpatialContextView>(() => {
    const manual = envelopeToBbox(baseMapFilterRegion.value);
    if (manual) {
        return { bbox: manual, enabled: true, labelKey: 'resource_selector.context_map' };
    }
    const auto = gcpAutoRange.bbox.value;
    const expanded = auto ? expandBboxByRatio(auto, 0.05) : null;
    return {
        bbox: expanded,
        enabled: !!expanded,
        labelKey: 'resource_selector.context_map',
    };
});
// stable インスタンス（computed で再生成しない）。source() が reactive に最新を返すため、
// ResourceSelectorList の spatialContext / query watch で再 load される。
// HM1: 楽観更新で baseMapVisibilityList の item.enabled を in-place 更新するため、
// adapter の source() は常に最新の reactivity を返す（remount なし）。
const baseMapVisibilityListAdapter = createBaseMapVisibilityListAdapter({
    source: () => baseMapVisibilityList.value,
    hasDraft: () => false,
    activeLang: () => mapData.value.lang || 'ja',
});

// M12-T10 v2.0: 右ペイン（選択済み）= enabled なベースマップ一覧
const enabledBaseMaps = computed(() => baseMapVisibilityList.value.filter((item) => item.enabled));

// M12-T10 v2.0: 右ペインの thumbnail。IPC が resolveBaseMapListImage で thumbnailUrl を付与済み。
// builtin の同梱リソースは builtinThumbnails で確実に解決（AppEdit.vue:1042-1044 と同形式）
function baseMapThumbnail(item: BaseMapVisibilityItem): string {
    return builtinThumbnails[item.mapID] || item.thumbnailUrl || noImage;
}

// M12-T10 v2.0: 右ペインの title。resolveBaseMapSelectorText で表示用タイトルを解決（AppEdit.vue:1035-1040 と同形式）
function baseMapTitleForSelected(item: BaseMapVisibilityItem): string {
    return resolveBaseMapSelectorText(
        { mapID: item.mapID, ...(item.data || {}) },
        mapData.value.lang || 'ja',
    );
}

// M12-T15 (R5): サムネイル管理（512px/52px の置換アップロード + 512px→52px 流用）。
// プレビューは appAssets.fileUrl で tmbs/{uid}(.|_512).jpg を解決する（存在しなければ placeholder）
const thumbnail512Url = ref<string | null>(null);
const thumbnail52Url = ref<string | null>(null);
const derive52FromUpload = ref(true); // 「52px も作成する」チェックボックス（既定 ON）
const thumbnailError = ref('');
// M12-T15 (Fix-2): 置換後に同一 file:// URL でブラウザが画像をキャッシュするのを防ぐ cache buster。
// 置換のたびにインクリメントして URL を一意にし、プレビューを再読込させる
const thumbnailNonce = ref(0);
async function refreshThumbnails(): Promise<void> {
    if (!mapUid.value) { thumbnail512Url.value = null; thumbnail52Url.value = null; return; }
    const v = `?v=${thumbnailNonce.value}`;
    try {
        const url512 = await (window as any).appAssets.fileUrl(`tmbs/${mapUid.value}_512.jpg`);
        thumbnail512Url.value = url512 ? url512 + v : null;
    } catch { thumbnail512Url.value = null; }
    try {
        const url52 = await (window as any).appAssets.fileUrl(`tmbs/${mapUid.value}.jpg`);
        thumbnail52Url.value = url52 ? url52 + v : null;
    } catch { thumbnail52Url.value = null; }
}
async function replaceThumbnail(kind: '512' | '52'): Promise<void> {
    if (!mapUid.value) return;
    thumbnailError.value = '';
    try {
        const result = await (window as any).appAssets.replaceMapThumbnail(mapUid.value, kind, kind === '512' ? derive52FromUpload.value : false);
        if (result?.err && result.err !== 'Canceled') thumbnailError.value = result.err;
    } catch (e: any) {
        thumbnailError.value = e?.message || String(e);
    }
    // 置換後は nonce を上げてプレビューを強制再読込（同一 URL のブラウザキャッシュを回避）
    thumbnailNonce.value++;
    await refreshThumbnails();
}
watch(mapUid, () => { void refreshThumbnails(); }, { immediate: true });

// M12-T10 v2.0 HM1: 楽観更新。旧 setBaseMapVisible と同型（in-place で item.enabled を更新、scroll 保持）。
// :key remount・baseMapReloadNonce は廃止。エラー時のみ loadBaseMapVisibility() で再取得。
async function setBaseMapEnabled(item: BaseMapVisibilityItem, enabled: boolean): Promise<void> {
    if (item.locked || !baseMapVisibilityMapRef()) return;
    item.enabled = enabled;  // 楽観更新（reactivity で行が即時に added/disabled 切替。scroll 不変）
    try {
        await (window as any).mapedit.setBaseMapVisibilityForMapID(baseMapVisibilityMapRef(), item.uid, enabled);
        await refreshBaseMapLayers();
    } catch (e: any) {
        item.enabled = !enabled;  // ロールバック
        baseMapVisibilityError.value = e?.message || String(e);
        await loadBaseMapVisibility();  // エラー時のみ再取得で整合
    }
}

// M12-T10 v2.0: baseMapVisibilityList が IPC で読み込まれたら ResourceSelectorList を再 load させる。
// HM1: :key remount は廃止。代わりに ref から ResourceSelectorList.reload() を直接呼ぶ（scroll 保持）。
// ※ 楽観更新中（item.enabled 変更のみ）は配列参照が不変のため watch は発火せず、in-place で更新される。
//   初回 IPC 読込完了時のみ配列参照が差し替わり watch が発火。
const baseMapSelectorListRef = ref<{ reload: () => Promise<void> } | null>(null);
watch(() => baseMapVisibilityList.value, () => {
    // 初回ロード完了時に ResourceSelectorList.reload() を呼んで items を更新（scroll 保持）
    void baseMapSelectorListRef.value?.reload();
}, { deep: false });

// M12-T10 v2.0: ResourceMasterRow variant="selector" へ渡す ViewModel へ変換。
// adapter.toViewModel と同一ロジックだが、template 内で直接呼ぶため host 側にも用意。
function asResourceListRowFromVisibility(item: BaseMapVisibilityItem): ResourceListItemViewModel {
    return baseMapVisibilityListAdapter.toViewModel(item, mapData.value.lang || 'ja');
}

// M12-T10 v2.0 HM3: 範囲コントロールの状態。manual 設定時 'manual' / GCP auto 存在時 'auto' / それ以外 'none'
const baseMapRangeState = computed<"none" | "auto" | "manual">(() => {
    if (baseMapFilterRegion.value) return "manual";
    if (gcpAutoRange.bbox.value) return "auto";
    return "none";
});

// M12-T10 v2.0 HM8: POI 選択の範囲コントロール（ベースマップ選択と同一方針）
const poiFilterRegion = ref<[number, number][] | null>(null);
const showPoiRegionModal = ref(false);
const poiSpatialContext = computed<SelectorSpatialContextView>(() => {
    const manual = envelopeToBbox(poiFilterRegion.value);
    if (manual) {
        return { bbox: manual, enabled: true, labelKey: 'resource_selector.context_map' };
    }
    const auto = gcpAutoRange.bbox.value;
    const expanded = auto ? expandBboxByRatio(auto, 0.05) : null;
    return {
        bbox: expanded,
        enabled: !!expanded,
        labelKey: 'resource_selector.context_map',
    };
});
const poiRangeState = computed<"none" | "auto" | "manual">(() => {
    if (poiFilterRegion.value) return "manual";
    if (gcpAutoRange.bbox.value) return "auto";
    return "none";
});

const activeTab = ref('metadata');

const gcps = ref<any[]>([]);
const gcpAutoRange = useGcpAutoRange({ gcps });
const newGcp = ref<any>(undefined);
const homePosition = ref<any>(undefined);
const mercZoom = ref<number | undefined>(undefined);
const edges = ref<any[]>([]);
const newlyAddEdge = ref<number | undefined>(undefined);
/**
 * 旧実装 vueMap.tinObjects 相当
 * インデックス 0 = メインレイヤー, 1以降 = サブマップ
 * tinObject は currentEditingLayer に対応するスロットへのアクセサ
 */
const tinObjects = ref<any[]>([undefined]);

const tinObject = computed({
    get: () => tinObjects.value[currentEditingLayer.value],
    set: (val: any) => {
        // 配列が足りない場合は拡張
        while (tinObjects.value.length <= currentEditingLayer.value) {
            tinObjects.value.push(undefined);
        }
        tinObjects.value[currentEditingLayer.value] = val;
    }
});

const errorNumber = ref<number | null>(null);
// 座標変換テスト用レイヤーの VectorSource 参照（モジュールレベル）
let illstCheckSource: VectorSource | null = null;
let mercCheckSource: VectorSource | null = null;
// errorStatus: TIN の strict_status 文字列
// strict_status は Transform クラスの直接プロパティ（getCompiled() の中ではなく setCompiled() 後に設定される）
const errorStatus = computed(() => {
    const tin = tinObject.value;
    if (!tin || typeof tin !== 'object') return tin as string | undefined;
    return tin.strict_status as string | undefined;
});

// kinksCount: kinks のエラー点数（strict_error 時に使用）
const kinksCount = computed(() => {
    const tin = tinObject.value;
    if (!tin || typeof tin !== 'object') return 0;
    return tin.kinks?.bakw?.features?.length ?? 0;
});

// M12-T11 (R4/D1): GCP タブ footer のエラーステータス文言。「エラーなし」(strict) は null で非表示。
// 文言キーは旧 span 表示のものをそのまま DF section バナーへ移す
const gcpErrorStatusMessage = computed(() => {
    switch (errorStatus.value) {
        case 'tooLessGcps': return t('mapedit.map_error_too_short');
        case 'tooLinear': return t('mapedit.map_error_linear');
        case 'pointsOutside': return t('mapedit.map_error_outside');
        case 'edgeError': return t('mapedit.map_error_crossing');
        case 'strict_error': return t('mapedit.map_error_number', { num: kinksCount.value });
        case 'loose': return t('mapedit.map_loose_by_error');
        default: return null; // 'strict' (エラーなし)・未確定
    }
});

watch(sub_maps, (newVal) => {
    mapData.value.sub_maps = newVal;
}, { deep: true });

watch(currentEditingLayer, (newLayer) => {
    if (newLayer === 0) {
        gcps.value = mapData.value.gcps || [];
        edges.value = mapData.value.edges || [];
    } else {
        const subMap = sub_maps.value[newLayer - 1];
        if (subMap) {
            gcps.value = subMap.gcps || [];
            edges.value = subMap.edges || [];
        }
    }
    editingID.value = '';
    newGcp.value = undefined;
    nextTick(() => {
        gcpsToMarkers();
        updateTin(); // 新レイヤー用に TIN と bounds 描画を更新
    });
});

// const editingID_ = ref('');
const strictMode = ref('auto');
const vertexMode = ref<'plain' | 'birdeye'>('plain');

// const editableGCPID = computed({
//   get() {
//     if (newGcp.value) editingID_.value = '';
//     return newGcp.value ? newGcp.value[2] : editingID_.value;
//   },
//   set(newValue) {
//     if (newGcp.value) {
//       editingID_.value = '';
//     } else {
//       editingID_.value = newValue;
//     }
//   }
// });

const currentLang = ref<LangCode>('ja');
const selectEditorLanguage = (language: LangCode) => {
    currentLang.value = language;
};

type MapEditHistoryState = {
    // M11-T10: 複製元UID (undefined=複製ではない)。保存時のタイル/サムネイル複製と
    // draft 復元後の複製継続の両方が依存する
    copyFromUid?: string;
    mapData: any;
    sub_maps: any[];
    gcps: any[];
    edges: any[];
    homePosition: any;
    mercZoom: number | undefined;
    strictMode: string;
    vertexMode: 'plain' | 'birdeye';
    currentEditingLayer: number;
};

const historyStack = ref<UndoStack<MapEditHistoryState> | null>(null);
const historyReady = ref(false);

// m1-t6-hotfix-1: 履歴診断（E2E 専用）。製品実行時はコストを持ち込まない（設計 §6.5）
// 露出ゲートは testDebug（:987）と同じ window.isE2E に揃える。
// preload.ts:242 が MAPLAT_E2E_ROOT の有無で立てるため、製品実行時は常に false になる。
const historyDiagEnabled = Boolean(import.meta.env.DEV)
    || (typeof window !== 'undefined' && Boolean((window as any).isE2E));
const HISTORY_JOURNAL_LIMIT = 200;
type HistoryJournalEntry = Record<string, unknown>;
const historyJournalBuf: HistoryJournalEntry[] = [];
let historyPhase = 'init';
// changedFields 算出用の影スナップショット（監視9項目のみ）
let historyShadow: Record<string, unknown> | null = null;

const WATCHED_FIELDS = [
    'mapData', 'sub_maps', 'gcps', 'edges', 'homePosition',
    'mercZoom', 'strictMode', 'vertexMode', 'currentEditingLayer',
] as const;

const watchedSnapshotForDiag = (): Record<string, unknown> => ({
    mapData: cloneDeep(mapData.value),
    sub_maps: cloneDeep(sub_maps.value),
    gcps: cloneDeep(gcps.value),
    edges: cloneDeep(edges.value),
    homePosition: cloneDeep(homePosition.value),
    mercZoom: mercZoom.value,
    strictMode: strictMode.value,
    vertexMode: vertexMode.value,
    currentEditingLayer: currentEditingLayer.value,
});

/**
 * 履歴ジャーナルへ1件記録する（設計 §6.2）。
 * 記録主体は常に MapEdit 側であり、useHistorySuppression は onDiagnostic で
 * 事実を報告するだけで journal を直接書かない（INV-6）。
 */
const journal = (kind: string, originTags: string[] | null, extra: Record<string, unknown> = {}) => {
    if (!historyDiagEnabled) return;
    const now = watchedSnapshotForDiag();
    const changedFields = historyShadow
        ? WATCHED_FIELDS.filter((k) => !isEqual((historyShadow as any)[k], (now as any)[k]))
        : [...WATCHED_FIELDS];
    let mapDataDiffKeys: string[] = [];
    if (changedFields.includes('mapData')) {
        const before = (historyShadow?.mapData ?? {}) as Record<string, unknown>;
        const after = (now.mapData ?? {}) as Record<string, unknown>;
        const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
        mapDataDiffKeys = [...keys].filter((k) => !isEqual(before[k], after[k]));
    }
    historyShadow = now;
    const snap = historyStack.value?.snapshot();
    historyJournalBuf.push({
        kind,
        originTags,
        changedFields,
        mapDataDiffKeys,
        suppressed: historySuppression.suppressed.value,
        scopeTag: historySuppression.currentTag.value,
        scopeStack: (extra.scopeStack as string[] | undefined) ?? undefined,
        pointer: snap?.pointer ?? null,
        length: snap?.history.length ?? null,
        at: typeof performance !== 'undefined' ? performance.now() : 0,
        phase: historyPhase,
        ...extra,
    });
    if (historyJournalBuf.length > HISTORY_JOURNAL_LIMIT) historyJournalBuf.shift();
};

// route query からの初期無効タグ注入（設計 §5.2「初期無効タグの注入経路」）。
// setup 時点で解決するため W3/W4（onMounted 内で走る）にも間に合う。
// 製品実行時は診断が無効なので query に何が付いていても無視する。
const initialDisabledScopeTags = (() => {
    if (!historyDiagEnabled) return [];
    const raw = route.query.noHistorySuppress;
    const text = typeof raw === 'string' ? raw : Array.isArray(raw) ? String(raw[0] ?? '') : '';
    return text.split(',').map((s) => s.trim()).filter(Boolean);
})();

const historySuppression = useHistorySuppression({
    disabledTags: initialDisabledScopeTags,
    // C7: 有効スコープ push の直前に保留中の編集を確定させる（設計 §5.6.2a）。
    // ここで catch してはならない（composable が捕捉して onDiagnostic で返す契約）。
    onBeforeFirstScope: () => {
        const pending = historySuppression.cancelPendingSnapshot();
        if (!pending) return;
        recordHistorySnapshot(historySuppression.mergeOrigin(pending, ['(flush)']));
        journal('flush', pending);
    },
    // composable → MapEdit の唯一の報告経路（設計 §5.6.6）。journal を書くのはこちら側
    onDiagnostic: (e) => {
        if (e.type === 'schedule') {
            journal('schedule', e.origin, { scopeStack: e.scopeStack });
        } else if (e.type === 'discard-suppressed') {
            journal('skip-suppressed', historySuppression.mergeOrigin(e.origin, e.scopeStack), { scopeStack: e.scopeStack });
        } else if (e.type === 'flush-error') {
            journal('flush-error', historySuppression.mergeOrigin(null, e.scopeStack), {
                scopeStack: e.scopeStack,
                error: String((e.error as any)?.message ?? e.error),
            });
        }
    },
});
const { withoutHistory, withoutHistoryAsync, cancelPendingSnapshot, mergeOrigin, snapshotScope } = historySuppression;
const historyRestoring = historySuppression.suppressed;

const captureHistoryState = (): MapEditHistoryState => ({
    // M11-T10: 複製元UID。draft 経由(hot-exit→復元→保存)でもタイル/サムネイル複製を失わない
    copyFromUid: copyFromUidSource.value,
    mapData: cloneDeep(mapData.value),
    sub_maps: cloneDeep(sub_maps.value),
    gcps: cloneDeep(gcps.value),
    edges: cloneDeep(edges.value),
    homePosition: cloneDeep(homePosition.value),
    mercZoom: mercZoom.value,
    strictMode: strictMode.value,
    vertexMode: vertexMode.value,
    currentEditingLayer: currentEditingLayer.value,
});

const restoreHistoryState = async (state: MapEditHistoryState) => await withoutHistoryAsync('W1', async () => {
    // W1（設計 §5.3.1）: 復元。源が復元スナップショットで宛先が ref = 読み込み・再同期（S2）
    copyFromUidSource.value = state.copyFromUid;
    mapData.value = cloneDeep(state.mapData);
    sub_maps.value = cloneDeep(state.sub_maps);
    currentEditingLayer.value = Math.min(
        state.currentEditingLayer,
        state.sub_maps.length
    );
    gcps.value = cloneDeep(state.gcps);
    edges.value = cloneDeep(state.edges);
    homePosition.value = cloneDeep(state.homePosition);
    mercZoom.value = state.mercZoom;
    strictMode.value = state.strictMode || 'strict';
    vertexMode.value = state.vertexMode || 'plain';
    tinObjects.value = Array(1 + sub_maps.value.length).fill(undefined);
    editingID.value = '';
    newGcp.value = undefined;
    newlyAddEdge.value = undefined;
    await nextTick();
    // Draft restore runs before initMaps()/loadMapTiles() during mount. Rendering
    // here is only valid for Undo/Redo after the map runtime is ready; initial
    // draft rendering is performed by loadMapTiles() below.
    if (illstMap && mercMap && illstSource) {
        // M5-T7: 復元された url に対して url_ を作り直してからキーを比較する。
        // スナップショットが url 編集の途中（url は新しいが url_ は古い）で取られていた場合の
        // 補正であり、あわせて lastDerivedUrl を復元後の url へ更新する（設計 §5.3(b)）。
        // 交換の判断と実行は下に残す（exchange: false）。
        await refreshRuntimeTileUrl((mapData.value?.url ?? '') as string, { applyUrl: false, exchange: false });
        // m1-t6-hotfix-2: 復元した mapData が指すタイルと表示中のタイルが異なるなら
        // ソースを再構築する（設計 v1.1 §5.4）。gcpsToMarkers()/updateTin() は
        // illstSource の座標変換を使うため、必ずそれらより前に行う。
        // 本関数は W1 抑止スコープの内側なので、再構築に伴う書き戻しは履歴へ入らない。
        if (tileIdentityKey(mapData.value) !== illstSourceKey) {
            await exchangeTileSource();
        }
        gcpsToMarkers();
        updateTin();
    }
});

const initializeHistoryStack = () => {
    historyStack.value = new UndoStack<MapEditHistoryState>(captureHistoryState());
    historyReady.value = true;
};

const resetHistoryBase = () => {
    // C1（設計 §5.6.2）: 終端廃棄。履歴世代を作り直すため前世代の origin を持ち越さない
    cancelPendingSnapshot();
    initializeHistoryStack();
    if (historyStack.value) historyStack.value.save();
};

/**
 * 履歴スナップショットを記録する（設計 §5.6.3）。
 * origin は呼び出し側が確定させて渡す（取得と消費の責務分離 = INV-3）。
 * 本関数は composable のタイマー origin を一切参照しない。
 * すべての early return もジャーナルへ記録する（origin は take 済みで残留しえないため、
 * 記録しないと「どこへ消えたか」が追えなくなる）。
 */
const recordHistorySnapshot = (origin: string[]) => {
    if (!historyReady.value) { journal('skip-not-ready', origin); return; }
    if (historyRestoring.value) { journal('skip-suppressed', origin); return; }
    if (!historyStack.value) { journal('skip-no-stack', origin); return; }
    const nextState = captureHistoryState();
    if (isEqual(historyStack.value.current(), nextState)) { journal('skip-equal', origin); return; }
    historyStack.value.push(nextState);
    journal('push', origin);
};

/**
 * 非同期に着地した編集を、デバウンスを待たずにその場で確定させる（設計 §5.5・§5.6.2 の C3）。
 * スコープ内から呼んではならない（recordHistorySnapshot は suppressed を尊重するため）。
 */
const commitHistorySnapshot = () => {
    const pending = cancelPendingSnapshot();   // clear と take を同時に行う
    recordHistorySnapshot(mergeOrigin(pending, ['(direct)', ...snapshotScope()]));
    journal('commit', mergeOrigin(pending, ['(direct)']));
};

const markHistorySaved = () => {
    // C2（設計 §5.6.2）: 直接確定。保留 origin は破棄せず引き継ぐ
    const pending = cancelPendingSnapshot();
    recordHistorySnapshot(mergeOrigin(pending, ['(direct)', ...snapshotScope()]));
    if (historyStack.value) historyStack.value.save();
};

const draftLifecycle = useAssetDraftLifecycle<MapEditHistoryState>({
    kind: 'map',
    serialize: captureHistoryState,
    shouldPersist: () => isDirty.value,
    apply: restoreHistoryState,
    onRestored: () => {
        initializeHistoryStack();
        historyStack.value?.markDirty();
    },
});

// M12-T20 (§6.4): 復元時ガード。draft 復元完了後に mapedit:stagingStatus を照会し、
// タイル参照先（staging/tmp）が実在しなければ警告ダイアログを表示する。
// 文言は分岐: savedTilesExist かつ conflict 分岐適用 → draft_already_saved（保存確定直後
// クラッシュでは保存成功済みのため喪失警告は誤誘導）/ それ以外 → draft_tiles_lost（断定形を
// 避けた喪失告知 + 再アップロード誘導）。**mapData は書き換えない**（表示のみ。sp-0006:
// 読み込み側でのデータ改変はしない。下書き自体も破棄しない — GCP・メタデータは再アップロードで
// 完全復旧できる。m3-t6「黙って消えない」原則）
const warnIfDraftTilesLost = async (viaConflictApply: boolean) => {
    const url_ = mapData.value?.url_ as string | undefined;
    if (!url_) return;
    try {
        const status = await window.mapedit.stagingStatus(url_, mapUid.value || newMapUid || undefined);
        if (!status || status.alive) return;
        const key = viaConflictApply && status.savedTilesExist
            ? 'mapedit.draft_already_saved'
            : 'mapedit.draft_tiles_lost';
        await (window as any).dialog.showMessageBox({
            type: 'warning',
            buttons: ['OK'],
            message: t(key),
        });
    } catch (e) {
        console.warn('[MapEdit] stagingStatus check failed:', e);
    }
};

// M12-T20 (§6.4): conflict 分岐の適用は復元時ガードを viaConflictApply=true で通す
const applyConflictDraft = async () => {
    await draftLifecycle.resolveConflict('apply');
    void warnIfDraftTilesLost(true);
};

// AC6: 新規 asset の slug 予約成功時に初期 draft を即時保存し、予約のGC保護を確立する。
useInitialDraftPersist({
    slugState: slugFieldState,
    isNewAsset: () => !mapUid.value,
    flushDraft: () => draftLifecycle.flush(),
});

const scheduleHistorySnapshot = () => {
    // F4 同型: 文書の変更で保存時 operation 診断を解消する(M11-T7/AC8)
    // 抑止中は scheduleWithOrigin が C4（終端廃棄）として処理し fn を呼ばない
    if (!historyRestoring.value && saveOperationError.value) saveOperationError.value = null;
    // C4（抑止中の終端廃棄）と C5（非抑止時の再スケジュール = origin 合成）は
    // composable 側が担う（設計 §5.6.2）。発火時に take-and-clear 済みの origin が届く
    historySuppression.scheduleWithOrigin((origin) => recordHistorySnapshot(origin));
};

const canUndo = computed(() => historyStack.value?.canUndo() ?? false);
const canRedo = computed(() => historyStack.value?.canRedo() ?? false);

// const onOffAttr = ['license', 'dataLicense', 'reference', 'url'];
const langAttr = [...MAP_LANG_ATTRS];

const arrayRoundTo = (array: number[], decimal: number) => {
    const factor = Math.pow(10, decimal);
    return array.map((item) => Math.round(item * factor) / factor);
};

// カスタムドラッグインタラクション（旧MaplatEditorの動作を再現）
class Drag extends Pointer {
    coordinate_: number[] | null = null;
    cursor_: string = 'pointer';
    feature_: Feature | null = null;
    previousCursor_: string | undefined = undefined;
    layerFilter: string = 'marker';

    constructor() {
        super({
            handleDownEvent: Drag.prototype.handleDownEvent,
            handleDragEvent: Drag.prototype.handleDragEvent,
            handleMoveEvent: Drag.prototype.handleMoveEvent,
            handleUpEvent: Drag.prototype.handleUpEvent
        });
    }

    handleDownEvent(evt: MapBrowserEvent<any>) {
        if (evt.originalEvent.button === 2) return false;
        const map = evt.map;
        const this_ = this;
        let feature = map.forEachFeatureAtPixel(evt.pixel, (f) => f as Feature, {
            layerFilter(layer) {
                return layer.get('name') === this_.layerFilter;
            }
        });

        if (feature) {
            const geom = feature.getGeometry();
            if (geom && geom.getType() === 'LineString') {
                feature = undefined;
            } else if (feature.get('gcpIndex') === 'home') {
                feature = undefined;
            } else {
                this.coordinate_ = evt.coordinate;
                this.feature_ = feature;
                const gcpIndex = feature.get('gcpIndex');
                if (gcpIndex !== 'new') {
                    // リアクティブな状態更新を直接行う（旧実装の vueMap プロパティ経由ではなく）
                    editingID.value = String(Number(gcpIndex) + 1);
                }
            }
        }
        return !!feature;
    }

    handleDragEvent(evt: MapBrowserEvent<any>) {
        if (evt.originalEvent.button === 2 || !this.coordinate_ || !this.feature_) return;

        const deltaX = evt.coordinate[0] - this.coordinate_[0];
        const deltaY = evt.coordinate[1] - this.coordinate_[1];

        const geometry = this.feature_.getGeometry() as SimpleGeometry;
        if (geometry) {
             geometry.translate(deltaX, deltaY);
        }

        this.coordinate_[0] = evt.coordinate[0];
        this.coordinate_[1] = evt.coordinate[1];
    }

    handleMoveEvent(evt: MapBrowserEvent<any>) {
        if (evt.originalEvent.button === 2) return;
        
        // カーソルのポインタスタイル制御
        if (this.cursor_) {
            const map = evt.map;
            const this_ = this;
            const feature = map.forEachFeatureAtPixel(evt.pixel, (f) => f as Feature, {
                layerFilter(layer) {
                    return layer.get('name') === this_.layerFilter;
                }
            });

            const element = evt.map.getTargetElement();
            if (feature) {
                if (element.style.cursor !== this.cursor_) {
                    this.previousCursor_ = element.style.cursor;
                    element.style.cursor = this.cursor_;
                }
            } else if (this.previousCursor_ !== undefined) {
                element.style.cursor = this.previousCursor_;
                this.previousCursor_ = undefined;
            }
        }
    }

    handleUpEvent(evt: MapBrowserEvent<any>) {
        if (evt.originalEvent.button === 2 || !this.feature_) return false;
        const map = evt.map;
        const isIllst = map === illstMap;
        const feature = this.feature_;
        const geom = feature.getGeometry() as SimpleGeometry;
        
        if (!geom) return false;
        
        let xy = geom.getCoordinates();
        xy = isIllst && illstSource ? arrayRoundTo(illstSource.sysCoord2Xy(xy as number[]) as number[], 2) : arrayRoundTo(xy as number[], 6);

        const gcpIndex = feature.get('gcpIndex');
        if (gcpIndex !== 'new') {
            const index = Number(gcpIndex);
            if (gcps.value[index]) {
                const gcp = gcps.value[index];
                gcp[isIllst ? 0 : 1] = xy;
                gcps.value.splice(index, 1, gcp);
                gcpsToMarkers();
                syncLayerData();
            }
        } else {
            if (newGcp.value) {
                newGcp.value.splice(isIllst ? 0 : 1, 1, xy);
            }
        }
        
        this.coordinate_ = null as any;
        this.feature_ = null;
        return false;
    }
}

// 言語別フィールドの内部表現は常にオブジェクト {lang: text} (ADR-0005)。
// ロード/保存側(SqliteDataService)で正規化されるが、新規作成直後の初期値や
// 旧形式データに備えてプレーン文字列(=デフォルト言語の値)も防御的に受容する
const localedGet = (key: string) => {
    const lang = mapData.value.lang || 'ja';
    const locale = currentLang.value;
    const val = mapData.value[key];
    if (typeof val !== 'object' || val === null) {
        return lang === locale ? (val || '') : '';
    }
    return val[locale] != null ? val[locale] : '';
};

const localedSet = (key: string, value: string) => {
    const lang = mapData.value.lang || 'ja';
    const locale = currentLang.value;
    const current = mapData.value[key];
    if (value == null) value = '';

    // プレーン文字列だった場合もオブジェクト形へ正規化してから編集する
    const val: any =
        typeof current === 'object' && current !== null
            ? current
            : current ? { [lang]: current } : {};
    if (value === '') {
        delete val[locale];
    } else {
        val[locale] = value;
    }
    mapData.value[key] = val;
};

const createLangComputed = (key: string) => computed({
    get: () => localedGet(key),
    set: (val: string) => localedSet(key, val)
});

// ローカライズフィールドの computed プロパティ
const title = createLangComputed('title');
const label = createLangComputed('label');
const officialTitle = createLangComputed('officialTitle');
const author = createLangComputed('author');
const era = createLangComputed('era');
const createdAt = createLangComputed('createdAt');
const contributor = createLangComputed('contributor'); // テンプレートでは 'owner' として参照される
const mapper = createLangComputed('mapper');
const attr = createLangComputed('attr');
const dataAttr = createLangComputed('dataAttr');
const licenseNote = createLangComputed('licenseNote');
const dataLicenseNote = createLangComputed('dataLicenseNote');
const description = createLangComputed('description');

// テンプレート変数名とlangAttrキー名のマッピング
// テンプレート: title, officialTitle, author, createAt(=createdAt), era, owner(=contributor), mapper
// v-model="mapData.createAt" → langAttr の createdAt に対応
// v-model="mapData.owner"    → langAttr の contributor に対応

const translationMode = computed(
    () => isTranslationMode(currentLang.value, mapData.value.lang || 'ja'),
);

const setDocumentLanguage = (newLang: LangCode) => {
    const oldLang = (mapData.value.lang || 'ja') as LangCode;
    if (oldLang === newLang) return;
    // 旧プレーン文字列を旧既定言語の値として保全してから、文書既定言語だけを変更する。
    for (const attr of langAttr) {
        const value = mapData.value[attr];
        if (typeof value !== 'object' || value === null) {
            mapData.value[attr] = value ? { [oldLang]: value } : {};
        }
    }
    mapData.value.lang = newLang;
};
const isDirty = computed(() => {
    if (historyStack.value) return historyStack.value.isDirty();
    return !isEqual(mapData.value, originalMapData.value);
});
const exporting = ref(false);
const saveState = computed<EditorSaveState>(() => {
    if (saving.value) return 'saving';
    if (draftLifecycle.draftRestored.value) return 'draft-restored';
    return isDirty.value ? 'dirty' : 'saved';
});

if (typeof window !== 'undefined' && (window as any).isE2E) {
    (window as any).testDebug = {
        mapData,
        homePosition,
        mercZoom,
        gcps,
        // M12-T1: edge 分割 E2E の状態検証と右クリック座標計算用
        edges,
        illstMapInfo: () => ({ map: illstMap, source: illstSource }),
        mercMapInfo: () => ({ map: mercMap, source: illstSource }),
        // url_ を E2E 側で設定した後に illstSource を初期化するための再実行口
        loadMapTiles: async () => loadMapTiles(),
        // edge 分割のエラー経路（衝突・edge 未検出）は marker が hit を遮るため UI 右クリックでは
        // 到達不能。実関数を直接駆動して検証するための公開口（実経路そのものを呼ぶ）
        addMarkerOnEdge: (arg: any, map: any) => addMarkerOnEdge(arg, map),
        currentEditingLayer,
        baseMapFilterRegion,
        estimateHomeFromGcps,
        // m1-t6-hotfix-2: タイルソース診断（設計 v1.1 §5.4a）
        tileSourceDebug: () => ({ exchangeCount: illstSourceExchangeCount, key: illstSourceKey }),
        // --- m1-t6-hotfix-1: 履歴診断（設計 §6.1・§6.2） ---
        // UndoStack の pointer/history は private のため、公開 API snapshot() から導出する
        historyDebug: () => {
            const snap = historyStack.value?.snapshot();
            return snap
                ? {
                      pointer: snap.pointer,
                      length: snap.history.length,
                      basePointer: snap.basePointer,
                      canUndo: canUndo.value,
                      canRedo: canRedo.value,
                  }
                : null;
        },
        historyJournal: () => historyJournalBuf.map((e) => ({ ...e })),
        historyJournalClear: () => { historyJournalBuf.length = 0; },
        historyMark: (label: string) => { historyPhase = label; },
        // 注入結果の検証用（設計 §6.3。基点測定前にアサートする）
        historyScopeState: () => ({
            W1: historySuppression.isScopeEnabled('W1'),
            W2: historySuppression.isScopeEnabled('W2'),
            W3: historySuppression.isScopeEnabled('W3'),
            W4: historySuppression.isScopeEnabled('W4'),
            diagEnabled: historyDiagEnabled,
            diagnosticErrors: historySuppression.diagnosticErrorCount(),
        }),
        // mount 後の補助切り替え。基点測定の主経路ではない（W3/W4 には間に合わない）
        setHistoryScopeEnabled: (tag: string, enabled: boolean) =>
            historySuppression.setScopeEnabled(tag, enabled),
    };
}

watch(
    [mapData, sub_maps, gcps, edges, homePosition, mercZoom, strictMode, vertexMode, currentEditingLayer],
    scheduleHistorySnapshot,
    { deep: true }
);
watch(
    [mapData, sub_maps, gcps, edges, homePosition, mercZoom, strictMode, vertexMode, currentEditingLayer],
    () => nextTick(() => draftLifecycle.schedule(isDirty.value)),
    { deep: true, flush: 'post' }
);

// slug(mapID欄) の live 入力 (M11-T7)。可用性確認・予約 lifecycle は SlugField 内蔵
// (excludeUid=自 uid で自分の現 slug は「空き」判定 = ADR-0007 継承)。履歴・draft は
// mapData の deep watch が拾う(既存の文法どおり)。
function onMapIDLiveInput(value: string): void {
    mapData.value.mapID = value;
}

// --- POIデータタブ配線 (Phase 8 Task 2, 43 §2.4) ---
// 器は mapData.pois 配列 (無ければ undefined)。順番変更/上書き/解除/追加は
// PoiReferenceEditor が配列ごと差し替えの update:pois で返す。書き込みは mapData の
// deep-watch (scheduleHistorySnapshot) が履歴を拾うため明示 recordHistory は不要。
// undo/redo/reload による mapData 差し替えは :pois prop 経由で表示へそのまま反映される
const poiRefEditor = ref<InstanceType<typeof PoiReferenceEditor> | null>(null);
// M12-T10 v2.0 Min2: mapCanonicalBbox / refreshMapCanonicalBbox は dead code として削除
// （POI spatial は poiSpatialContext へ移行済み、consumer なし）

// M4-T1: 冒頭のガードは AppEdit と同一形。read-only は UI の入口を閉じるだけなので、
// 書き込みの唯一の出口であるここでも未対応形式を弾く (二重防御)。
// M4-T4: 保存形の決定は AppEdit と完全に同一なので、書き込み側の関所 writeDocumentPois
// へ寄せた (恒久指示: 同一扱い処理は共通実装へ徹底)。
function onPoisChange(next: unknown[]) {
    if (!poisGuard.acceptsWrite()) return;
    writeDocumentPois(mapData.value, next, mapData.value.pois);
}

// m1-t6-hotfix-1: 保留中の編集は「ポインタを動かす前」に確定させる。
// C7（onBeforeFirstScope）は W1 スコープ進入直前に flush するが、undo/redo 経路では
// その時点で既に historyStack.undo()/redo() がポインタを動かしているため、flush が
// 移動後の枝へ push して redo 枝を切り捨ててしまう（基点測定で実測）。
// ここで先に確定させれば、undo は「確定済みの直前状態」へ正しく戻る。
const commitPendingBeforeNavigate = () => {
    commitHistorySnapshot();
};

const performUndo = async () => {
    if (!historyStack.value) return;
    commitPendingBeforeNavigate();
    if (!historyStack.value.canUndo()) return;
    historyStack.value.undo();
    await restoreHistoryState(historyStack.value.current());
};

const performRedo = async () => {
    if (!historyStack.value) return;
    commitPendingBeforeNavigate();
    if (!historyStack.value.canRedo()) return;
    historyStack.value.redo();
    await restoreHistoryState(historyStack.value.current());
};

const onHistoryKeydown = (event: KeyboardEvent) => {
    if (poiRefEditor.value?.pickerOpen) return; // picker 表示中はグローバルキーを抑止 (Phase 8 品質レビュー MAJOR-1)
    if (!(event.metaKey || event.ctrlKey)) return;
    const key = event.key.toLowerCase();
    if (key === 's') {
        event.preventDefault();
        if (!saving.value && !exporting.value && isDirty.value && !saveError.value) void saveMap();
        return;
    }
    if (isEditableElement(event.target as Element | null)) return;
    if (saving.value || exporting.value) return;
    if (key === 'z' && event.shiftKey) {
        event.preventDefault();
        performRedo();
    } else if (key === 'z') {
        event.preventDefault();
        performUndo();
    } else if (key === 'y') {
        event.preventDefault();
        performRedo();
    }
};

let removeMainProcessListener: (() => void) | undefined;

const onMainProcessMessage = (message: string) => {
    if (poiRefEditor.value?.pickerOpen) return; // picker 表示中はグローバルキーを抑止 (Phase 8 品質レビュー MAJOR-1)
    // 編集可能フィールドにフォーカス中はネイティブのテキスト undo が対象
    // (App.vue のグローバルリスナーが実行済み。セッション undo は発動しない)
    if (isEditableElement(document.activeElement)) return;
    if (saving.value || exporting.value) return;
    if (message === 'menu:undo') {
        performUndo();
    } else if (message === 'menu:redo') {
        performRedo();
    }
};

/**
 * 旧実装 computed.displayTitle 相当（map.js L.123）
 * タイトル空のフォールバックは EditorActionHeader 共通(editor_ui.untitled)へ一元化(M11-T10)
 */
const displayTitle = computed(() => {
    const title = mapData.value.title;
    if (!title) return '';
    if (typeof title !== 'object') return title;
    const lang = mapData.value.lang || 'ja';
    return title[lang] || '';
});

/**
 * 旧実装 zenHankakuLength 相当（map.js L.54）
 * 全角=2、半角=1 で文字列長を算出（最大30 = 全角15文字）
 *
 * 旧実装は escape() を使用: ASCII/Latin(U+0000-U+00FF) → %XX (長さ1扱い)、
 * CJK等(U+0100以上) → %uXXXX (長さ2扱い)。
 * escape() は非推奨のため、コードポイントで直接判定する同等実装に置換。
 */
function zenHankakuLength(text: string): number {
    let len = 0;
    for (const char of text) {
        const cp = char.codePointAt(0)!;
        len += cp > 0xFF ? 2 : 1;
    }
    return len;
}

// 対応言語(ビューア対応言語と同一)は共有定義から導出。langコード → common.* i18nキー名
const langsMap: Record<string, string> = LANGS_MAP;

/**
 * 旧実装 computed.blockingGcpsError 相当（map.js L.289）
 * いずれかのレイヤーで tooLinear / pointsOutside の場合 true
 */
const blockingGcpsError = computed(() =>
    tinObjects.value.reduce((prev: boolean, tin: any) =>
        tin === 'tooLinear' || tin === 'pointsOutside' || prev, false)
);

/**
 * 旧実装 computed.error 相当（map.js L.268）
 * 保存ボタン無効化の判定に使う。null = エラーなし、object = エラーあり
 * 旧実装: error || !dirty → 保存ボタン disabled
 */
const saveError = computed(() => {
    const err: Record<string, string> = {};

    // --- mapID (一意性は SlugField + 保存時 confirmForSave が担う。ここは形式検証のみ) ---
    const id = mapData.value.mapID as string | undefined;
    if (id == null || id === '') {
        err['mapID'] = 'mapedit.error_set_mapid';
    } else if (!id.match(/^[\d\w_-]+$/)) {
        err['mapID'] = 'mapedit.error_mapid_character';
    }

    // --- title（表示用タイトル必須・長さ制限）---
    const rawTitle = mapData.value.title;
    const lang = mapData.value.lang || 'ja';
    if (rawTitle == null || rawTitle === '') {
        err['title'] = t('mapmodel.no_title');
    } else if (typeof rawTitle !== 'object') {
        if (zenHankakuLength(rawTitle) > 30) {
            err['title'] = t('mapmodel.over_title', { lang: t(`common.${langsMap[lang] || 'japanese'}`) });
        }
    } else {
        for (const key of Object.keys(langsMap)) {
            if (rawTitle[key] && zenHankakuLength(rawTitle[key]) > 30) {
                err['title'] = t('mapmodel.over_title', { lang: t(`common.${langsMap[key]}`) });
            }
        }
    }

    // --- attr（地図画像コピーライト必須）---
    const rawAttr = mapData.value.attr;
    const attrVal = typeof rawAttr === 'object' ? rawAttr?.[lang] : rawAttr;
    if (attrVal == null || attrVal === '') {
        err['attr'] = t('mapmodel.image_copyright');
    }

    // --- GCPブロッキングエラー（tooLinear / pointsOutside）---
    if (blockingGcpsError.value) {
        err['blockingGcpsError'] = 'blockingGcpsError';
    }

    return Object.keys(err).length > 0 ? err : null;
});

// 旧実装 map.js L.169-171
const gcpsEditReady = computed(() =>
    !!(mapData.value.width && mapData.value.height && mapData.value.url_)
);

// 旧実装 map.js L.165-168
const imageExtensionCalc = computed(() => {
    if (mapData.value.imageExtension) return mapData.value.imageExtension;
    if (mapData.value.width && mapData.value.height) return 'jpg';
    return undefined;
});

// mainLayerHash: 旧実装 map.js L.248-254 に準拠（crypto-browserify polyfill 経由で SHA1）
// M12-T22: 休眠パネル専用（削除禁止・M4-(2)へ転用予定）
const mainLayerHash = computed(() => {
    const tin = tinObjects.value[0];
    if (!tin || typeof tin === 'string') return undefined;
    try {
        return sha1(JSON.stringify(tin.getCompiled()));
    } catch {
        return undefined;
    }
});

// 旧実装 map.js L.211-213
// M12-T22: 休眠パネル専用（削除禁止・M4-(2)へ転用予定）
const wmtsDirty = computed(() => mapData.value.wmtsHash !== mainLayerHash.value);

// 旧実装 map.js L.172-175 (Tin.STATUS_STRICT = 'strict')
// M12-T22: 休眠パネル専用（削除禁止・M4-(2)へ転用予定）
const wmtsEditReady = computed(() => {
    const tin = tinObjects.value[0];
    return !!(mainLayerHash.value && wmtsDirty.value &&
              tin && typeof tin === 'object' && tin.strict_status === 'strict');
});

// 旧実装 map.js L.431-439: csvUploadUiValue 初期値
// M12-T22: 休眠パネル専用（削除禁止・M12-T23で再編予定）
const csvUploadUiValue = ref({
    pixXColumn: 1,
    pixYColumn: 2,
    lngColumn: 3,
    latColumn: 4,
    ignoreHeader: 0,
    reverseMapY: false,
    projText: 'EPSG:4326'
});

// 旧実装 map.js L.176-194
// M12-T22: 休眠パネル専用（削除禁止・M12-T23で再編予定）
const csvUpError = computed(() => {
    const uiValue = csvUploadUiValue.value;
    if (uiValue.pixXColumn === uiValue.pixYColumn || uiValue.pixXColumn === uiValue.lngColumn ||
        uiValue.pixXColumn === uiValue.latColumn || uiValue.pixYColumn === uiValue.lngColumn ||
        uiValue.pixYColumn === uiValue.latColumn || uiValue.lngColumn === uiValue.latColumn) {
        return 'column_dup';
    }
    if (!(typeof uiValue.pixXColumn === 'number' && typeof uiValue.pixYColumn === 'number' &&
          typeof uiValue.lngColumn === 'number' && typeof uiValue.latColumn === 'number')) {
        return 'column_null';
    }
    if (!(typeof uiValue.ignoreHeader === 'number')) {
        return 'ignore_header';
    }
    if (uiValue.projText === '') return 'proj_text';
    return false as const;
});

// M12-T11 (R3/C31): CSV インポート状態エラーは DF field へ。コード→文言の写像を一元化
// M12-T22: 休眠パネル専用（削除禁止・M12-T23で再編予定）
const csvUpErrorMessage = computed(() => {
    switch (csvUpError.value) {
        case 'column_dup': return t('dataio.csv_error_column_dup');
        case 'column_null': return t('dataio.csv_error_column_null');
        case 'ignore_header': return t('dataio.csv_error_ignore_header');
        case 'proj_text': return t('dataio.csv_error_proj_text');
        default: return null;
    }
});

// 旧実装 map.js L.198-207
// M12-T22: 休眠パネル専用（削除禁止・M12-T23で再編予定）
const csvProjPreset = computed({
    get: () => {
        const projText = csvUploadUiValue.value.projText;
        return projText === 'EPSG:4326' ? 'wgs84' : projText === 'EPSG:3857' ? 'mercator' : 'other';
    },
    set: (newValue: string) => {
        csvUploadUiValue.value.projText =
            newValue === 'wgs84' ? 'EPSG:4326' : newValue === 'mercator' ? 'EPSG:3857' : '';
    }
});

const normalizeImportance = (arr: any[]) => {
    const zeroIndex = arr.indexOf(0);
    arr.forEach((item, index) => {
        if (index === zeroIndex) return;
        item.importance = zeroIndex - index;
    });
};

const normalizePriority = (arr: any[]) => {
    arr.forEach((item, index) => {
        item.priority = arr.length - index;
    });
};

// --- Submap Computeds ---
const importanceSortedSubMaps = computed(() => {
    const array = [...sub_maps.value];
    array.push(0 as any); // 0 represents the main map
    return array.sort((a, b) => {
        const ac = a === 0 ? 0 : a.importance;
        const bc = b === 0 ? 0 : b.importance;
        return (ac < bc ? 1 : -1);
    });
});

const prioritySortedSubMaps = computed(() => {
    const array = [...sub_maps.value];
    return array.sort((a, b) => (a.priority < b.priority ? 1 : -1));
});

const canUpImportance = computed(() => {
    // 旧実装 map.js L.314-318 に準拠（メインレイヤーも含めて判定）
    const most = importanceSortedSubMaps.value[0];
    const mostImportance = most === 0 ? 0 : most.importance;
    return importance.value !== mostImportance;
});

const canDownImportance = computed(() => {
    // 旧実装 map.js L.319-323 に準拠
    const least = importanceSortedSubMaps.value[importanceSortedSubMaps.value.length - 1];
    const leastImportance = least === 0 ? 0 : least.importance;
    return importance.value !== leastImportance;
});

const canUpPriority = computed(() => {
    if (currentEditingLayer.value === 0) return false;
    const mostPriority = prioritySortedSubMaps.value[0]?.priority;
    const currentMap = sub_maps.value[currentEditingLayer.value - 1];
    return currentMap && currentMap.priority !== mostPriority;
});

const canDownPriority = computed(() => {
    if (currentEditingLayer.value === 0) return false;
    const leastPriority = prioritySortedSubMaps.value[prioritySortedSubMaps.value.length - 1]?.priority;
    const currentMap = sub_maps.value[currentEditingLayer.value - 1];
    return currentMap && currentMap.priority !== leastPriority;
});

let illstMap: any = null;
let illstSource: any = null;
let mercMap: any = null;
// let mercSource: any = null;

// json/bounds レイヤーの VectorSource 参照キャッシュ（MaplatMap.getSource() 経由では取得できない）
let illstJsonSource: VectorSource | null = null;
let illstBoundsSource: VectorSource | null = null;
let mercJsonSource: VectorSource | null = null;
let mercBoundsSource: VectorSource | null = null;

const labelFontStyle = "Normal 12px Arial";

const getTextWidth = ( _text: string | number, _fontStyle: string ) => {
  const canvas = document.createElement( "canvas" );
  const context = canvas.getContext( "2d" );
  if (!context) return 0;
  context.font = _fontStyle;
  const metrics = context.measureText( String(_text) );
  return metrics.width;
}

const edgesClear = () => {
    if (illstMap && illstMap.getSource('edges')) {
        illstMap.getSource('edges').clear();
    }
    if (mercMap && mercMap.getSource('edges')) {
        mercMap.getSource('edges').clear();
    }
};

const gcpsToMarkers = () => {
    edgesClear();

    // 既存マーカーをクリア
    const illstSourceMarker = illstMap?.getSource('marker') as VectorSource;
    const mercSourceMarker = mercMap?.getSource('marker') as VectorSource;

    if (illstSourceMarker) illstSourceMarker.clear();
    if (mercSourceMarker) mercSourceMarker.clear();

    const addMarkerToMap = (pt1: number[], pt2: number[], index: number | string, _isCurrentEditing: boolean) => {
        const _isEditing = typeof index === 'number' && currentEditingLayer.value !== 0 && currentEditingLayer.value !== (gcps.value[index] ? gcps.value[index][2] : 0);
        if (_isEditing) { /* console.log("Currently editing this layer"); */ }
        
        let iconSrc;
        if (index === 'home') {
             // ホームマーカー（赤い家のアイコン）
             const homeSVG = `<svg version="1.1" id="Layer_2" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" x="0px" y="0px" width="20px" height="20px" viewBox="0 0 20 20" enable-background="new 0 0 20 20" xml:space="preserve">
<polygon x="0" y="0" points="10,0 20,10 17,10 17,20 3,20 3,10 0,10 10,0" stroke="#FF0000" fill="#FF0000" stroke-width="2"></polygon></svg>`;
             iconSrc = `data:image/svg+xml,${encodeURIComponent(homeSVG)}`;
        } else {
             // 通常 GCP マーカー（ラベル付き吹き出し形状）
             const isEdgeStart = index === newlyAddEdge.value;
             const fillColor = isEdgeStart ? '#FF0000' : '#DEEFAE';
             const label = String(typeof index === 'number' ? index + 1 : (newGcp.value ? newGcp.value[2] : 'New'));
             const labelWidth = getTextWidth(label, labelFontStyle) + 10;
             const svg = `<svg version="1.1" id="Layer_1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
x="0px" y="0px" width="${labelWidth}px" height="20px"
viewBox="0 0 ${labelWidth} 20" enable-background="new 0 0 ${labelWidth} 20" xml:space="preserve">
<polygon x="0" y="0" points="0,0 ${labelWidth},0 ${labelWidth},16 ${(labelWidth / 2 + 4)},16
${(labelWidth / 2)},20 ${(labelWidth / 2 - 4)},16 0,16 0,0" stroke="#000000" fill="${fillColor}" stroke-width="2"></polygon>
<text x="5" y="13" fill="#000000" font-family="Arial" font-size="12" font-weight="normal">${label}</text></svg>`;
             iconSrc = `data:image/svg+xml,${encodeURIComponent(svg)}`;
        }

        const iconStyle = new Style({
            image: new Icon({
                src: iconSrc,
                anchor: [0.5, 1]
            })
        });

        if (illstSourceMarker && pt1 && illstMap && illstSource) {
            illstMap.setMarker(illstSource.xy2SysCoord(pt1), { gcpIndex: index }, iconStyle, 'marker');
        }

        if (mercSourceMarker && pt2 && mercMap) {
            mercMap.setMarker(pt2, { gcpIndex: index }, iconStyle, 'marker');
        }
    };

    // 既存の全 GCP をマーカーとして追加
    gcps.value.forEach((gcp, index) => {
        addMarkerToMap(gcp[0], gcp[1], index, currentEditingLayer.value === gcp[2]);
    });

    // 未確定 GCP（新規追加中）があれば追加
    if (newGcp.value) {
        addMarkerToMap(newGcp.value[0], newGcp.value[1], 'new', true);
    }
    
    // ホームポジションマーカーを追加
    // 旧実装 homeToMarkers() に準拠: mercMap は常に表示、illstMap は TIN が valid な場合のみ逆変換で表示
    if (homePosition.value) {
        const merc = transform(homePosition.value, 'EPSG:4326', 'EPSG:3857');
        let illstXy: number[] | undefined;
        if ((errorStatus.value === 'strict' || errorStatus.value === 'loose') &&
            tinObjects.value[0] && typeof tinObjects.value[0] !== 'string') {
            // merc→illst 逆変換（第2引数 true = backward transform）
            illstXy = tinObjects.value[0].transform(merc, true);
        }
        addMarkerToMap(illstXy as any, merc, 'home', false);
    }

    // エッジ（ドロネー境界線）を描画
    edges.value.forEach((edge, _i) => {
        const gcp1 = gcps.value[edge[2][0]];
        const gcp2 = gcps.value[edge[2][1]];
        if (!gcp1 || !gcp2) return;
        
        const illst1 = illstSource.xy2SysCoord(gcp1[0]);
        const illst2 = illstSource.xy2SysCoord(gcp2[0]);
        const style = new Style({
            stroke: new Stroke({
                color: 'red',
                width: 2
            })
        });

        const mercCoords = [gcp1[1]];
        edge[1].forEach((node: any) => mercCoords.push(node));
        mercCoords.push(gcp2[1]);
        const mercLine = {
            geometry: new LineString(mercCoords),
            startEnd: edge[2]
        };

        const illstCoords = [illst1];
        edge[0].forEach((node: any) => illstCoords.push(illstSource.xy2SysCoord(node)));
        illstCoords.push(illst2);
        const illstLine = {
            geometry: new LineString(illstCoords),
            startEnd: edge[2]
        };

        if (illstMap && illstMap.setFeature) illstMap.setFeature(illstLine, style, 'edges');
        if (mercMap && mercMap.setFeature) mercMap.setFeature(mercLine, style, 'edges');
    });
};

// 旧実装 map.js L.413-415: errorStatus が strict/loose かつ homePosition が未設定の場合のみ
const enableSetHomeIllst = computed(() =>
    (errorStatus.value === 'strict' || errorStatus.value === 'loose') && !homePosition.value
);

// 旧実装 map.js L.416-418: homePosition が未設定の場合のみ
const enableSetHomeMerc = computed(() => !homePosition.value);

// 旧実装 mapedit.js L.124-160: 地図座標5地点情報から地図サイズ情報（中心座標、ズーム、回転）を得る
function xys2Size(xys: number[][], size: number[]): [number[], number, number] {
    const center = xys[0];
    const nesw = xys.slice(1, 5);
    const neswDelta = nesw.map((val) => [val[0] - center[0], val[1] - center[1]]);
    const normal = [[0.0, 1.0], [1.0, 0.0], [0.0, -1.0], [-1.0, 0.0]];
    let abss = 0, cosx = 0, sinx = 0;
    for (let i = 0; i < 4; i++) {
        const delta = neswDelta[i];
        const norm = normal[i];
        const abs = Math.sqrt(Math.pow(delta[0], 2) + Math.pow(delta[1], 2));
        abss += abs;
        const outer = delta[0] * norm[1] - delta[1] * norm[0];
        const inner = Math.acos((delta[0] * norm[0] + delta[1] * norm[1]) / abs);
        const theta = outer > 0.0 ? -1.0 * inner : inner;
        cosx += Math.cos(theta);
        sinx += Math.sin(theta);
    }
    const scale = abss / 4.0;
    const omega = Math.atan2(sinx, cosx);
    const radius = Math.floor(Math.min(size[0], size[1]) / 4);
    const zoom = Math.log((radius * MERC_MAX) / 128 / scale) / Math.log(2);
    return [center, zoom, omega];
}

// 旧実装 mapedit.js L.355-364: 座標行列を theta ラジアン回転する
function rotateMatrix(xys: number[][], theta: number): number[][] {
    return xys.map(([x, y]) => [
        x * Math.cos(theta) - y * Math.sin(theta),
        x * Math.sin(theta) + y * Math.cos(theta)
    ]);
}

// 旧実装 mapedit.js L.162-165: zoom レベルに対応するメルカトル半径を返す
function getRadius(size: number[], zoom: number): number {
    const radius = Math.floor(Math.min(size[0], size[1]) / 4);
    return (radius * MERC_MAX) / 128 / Math.pow(2, zoom);
}

// 旧実装 mapedit.js L.167-177: メルカトル中心・zoom・回転から5地点座標配列を返す
// 戻り値: [center, N, E, S, W, [mapWidth, mapHeight]]
function size2Xys(center: number[], zoom: number, rotate: number): number[][] {
    const size = mercMap.getSize() as number[];
    const radius = getRadius(size, zoom);
    const crossDelta = rotateMatrix(MERC_CROSSMATRIX, rotate);
    const cross = crossDelta.map(([dx, dy]) => [
        dx * radius + center[0],
        dy * radius + center[1]
    ]);
    cross.push(size);
    return cross;
}

// 旧実装 mapedit.js L.366-392: ホームポジションの位置へ両地図のビューを移動する
const showHomePosition = () => {
    if (!homePosition.value || !mercMap) return;
    const mercView = mercMap.getView();
    const merc = transform(homePosition.value, 'EPSG:4326', 'EPSG:3857');
    mercView.setCenter(merc);
    mercView.setZoom(mercZoom.value ?? 14);

    if ((errorStatus.value === 'strict' || errorStatus.value === 'loose') &&
        tinObjects.value[0] && typeof tinObjects.value[0] !== 'string' && illstSource && illstMap) {
        // mercMap の5地点を illstMap 座標に逆変換して illstMap のビューを合わせる
        const mercSize = size2Xys(merc, mercZoom.value ?? 14, 0);
        const wh = mercSize[5];
        const mercPoints = mercSize.slice(0, 5);
        const illstSize = mercPoints.map((coord) => {
            const xy = tinObjects.value[0].transform(coord, true);
            return illstSource.xy2SysCoord(xy);
        });
        const centerZoom = xys2Size(illstSize, wh);
        const illstView = illstMap.getView();
        illstView.setCenter(centerZoom[0]);
        illstView.setZoom(centerZoom[1]);
        illstView.setRotation(0);
        mercView.setRotation(-centerZoom[2]);
    }
};

// 旧実装 mapedit.js L.349-353: ホームポジションを削除する
const removeHomePosition = () => {
    homePosition.value = undefined;
    mercZoom.value = undefined;
    mapData.value.homePosition = undefined;
    mapData.value.mercZoom = undefined;
    gcpsToMarkers();
};

// 旧実装 mapedit.js L.1423-1441: イラストマップの現在表示領域をホームポジションとして設定
const setHomeIllst = () => {
    if (!illstMap || !illstSource || !tinObjects.value[0] || typeof tinObjects.value[0] === 'string') return;
    const view = illstMap.getView();
    const illstCenter = view.getCenter();
    const illstZoom = view.getZoom();

    // illstSource.viewpoint2SysCoords([center, zoom, rotate]) → [5地点の座標配列, [width, height]]
    const [illstSize, wh] = illstSource.viewpoint2SysCoords([illstCenter, illstZoom, 0]);

    const mercSize = illstSize.map((coords: number[]) => {
        const xy = illstSource.sysCoord2Xy(coords);
        return tinObjects.value[0].transform(xy, false);
    });

    const sizeArray = xys2Size(mercSize, wh);
    const longlat = transform(sizeArray[0], 'EPSG:3857', 'EPSG:4326');
    homePosition.value = longlat;
    mapData.value.homePosition = cloneDeep(longlat);
    mercZoom.value = sizeArray[1];
    mapData.value.mercZoom = sizeArray[1];
    gcpsToMarkers();
};

const setHomeMerc = () => {
    const view = mercMap.getView();
    const longlat = transform(view.getCenter(), 'EPSG:3857', 'EPSG:4326');
    const zoom = view.getZoom();
    
    homePosition.value = longlat;
    mercZoom.value = zoom;
    
    // mapData に反映して isDirty を確実に発火させる
    mapData.value.homePosition = cloneDeep(longlat);
    mapData.value.mercZoom = zoom;
    
    gcpsToMarkers();
};

// GCP 重心と bbox fit zoom を homePosition / mercZoom に一発設定する推定アクション
function estimateHomeFromGcps() {
    if (!gcps.value || gcps.value.length === 0) return;
    const points: [number, number][] = [];
    for (const gcp of gcps.value) {
        const merc = gcp?.[1];
        if (Array.isArray(merc) && typeof merc[0] === 'number' && typeof merc[1] === 'number') {
            const [lng, lat] = transform([merc[0], merc[1]], 'EPSG:3857', 'EPSG:4326');
            points.push([lng, lat]);
        }
    }
    const result = computeBboxAndCentroid(points);
    if (!result) return;
    const { bbox, centroid } = result;
    const zoom = estimateZoomForBbox(bbox);
    homePosition.value = centroid;
    mercZoom.value = zoom;
    mapData.value.homePosition = cloneDeep(centroid);
    mapData.value.mercZoom = zoom;
    gcpsToMarkers();
}

const syncLayerData = () => {
    const layer = currentEditingLayer.value;
    if (layer === 0) {
        mapData.value.gcps = cloneDeep(gcps.value);
        mapData.value.edges = cloneDeep(edges.value);
    } else {
        const subMap = sub_maps.value[layer - 1];
        if (subMap) {
            subMap.gcps = cloneDeep(gcps.value);
            subMap.edges = cloneDeep(edges.value);
        }
    }
};


const addNewMarker = (arg: any, map: any) => {
  const number = gcps.value.length + 1;
  const coord = arg.coordinate;
  const isIllst = map === illstMap;

  if (isIllst) {
    const boundsFeature = illstBoundsSource?.getFeatures()[0];
    if (boundsFeature) {
        const geom = boundsFeature.getGeometry();
        if (geom && !geom.intersectsCoordinate(coord)) {
            return;
        }
    }
  }

  const xy = isIllst ? arrayRoundTo(illstSource.sysCoord2Xy(coord), 2) : arrayRoundTo(coord, 6);

  if (!newGcp.value) {
    const labelWidth = getTextWidth( number, labelFontStyle ) + 10;
    const iconSVG = `<svg version="1.1" id="Layer_1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
x="0px" y="0px" width="${labelWidth}px" height="20px" viewBox="0 0 ${labelWidth} 20"
enable-background="new 0 0 ${labelWidth} 20" xml:space="preserve">
<polygon x="0" y="0" points="0,0 ${labelWidth},0 ${labelWidth},16 ${(labelWidth / 2 + 4)},16
${(labelWidth / 2)},20 ${(labelWidth / 2 - 4)},16 0,16 0,0" stroke="#000000" fill="#FFCCCC" stroke-width="2"></polygon>
<text x="5" y="13" fill="#000000" font-family="Arial" font-size="12" font-weight="normal">${number}</text></svg>`;

    const iconStyle = new Style({
      "image": new Icon({
        "src": `data:image/svg+xml,${encodeURIComponent(iconSVG)}`,
        "anchor": [0.5, 1]
      })
    });

    map.setMarker(coord, { gcpIndex: 'new' }, iconStyle);

    if (isIllst) {
       newGcp.value = [xy, undefined, number];
    } else {
       newGcp.value = [undefined, xy, number];
    }
  } else if ((isIllst && !newGcp.value[0]) || (!isIllst && !newGcp.value[1])) {
    if (isIllst) { newGcp.value[0] = xy; } else { newGcp.value[1] = xy; }
    const newPoint = [newGcp.value[0], newGcp.value[1], currentEditingLayer.value];
    gcps.value.push(newPoint);
    
    // 再描画前に保留中のマーカーをクリア
    newGcp.value = undefined;
    editingID.value = String(gcps.value.length);
    gcpsToMarkers();
    syncLayerData();
  }
};

const removeMarker = (arg: any, map: any) => {
  const marker = arg.data.marker;
  const gcpIndex = marker.get('gcpIndex');
  if (gcpIndex === 'new') {
    newGcp.value = undefined;
    map.getSource('marker').removeFeature(marker);
  } else {
    // 接続エッジを削除し、インデックスを繰り下げる
    for (let i = edges.value.length - 1; i >= 0; i--) {
       const edge = edges.value[i];
       if (edge[2][0] === Number(gcpIndex) || edge[2][1] === Number(gcpIndex)) {
           edges.value.splice(i, 1);
       } else {
           if (edge[2][0] > Number(gcpIndex)) edge[2][0]--;
           if (edge[2][1] > Number(gcpIndex)) edge[2][1]--;
       }
    }
    gcps.value.splice(Number(gcpIndex), 1);
    
    gcpsToMarkers();
    syncLayerData();
  }
  editingID.value = '';
  newlyAddEdge.value = undefined;
};

const edgeStartMarker = (arg: any) => {
    const marker = arg.data.marker;
    const gcpIndex = marker.get('gcpIndex');
    if (gcpIndex !== 'new') {
        newlyAddEdge.value = Number(gcpIndex);
        gcpsToMarkers();
    }
};

const edgeEndMarker = (arg: any) => {
    const marker = arg.data.marker;
    const gcpIndex = Number(marker.get('gcpIndex'));
    if (newlyAddEdge.value !== undefined) {
        const edgeIndices = [newlyAddEdge.value, gcpIndex].sort((a, b) => a - b);
        newlyAddEdge.value = undefined;
        // 同じエッジが既に存在しないか確認
        const exists = edges.value.some(e => e[2][0] === edgeIndices[0] && e[2][1] === edgeIndices[1]);
        if (!exists) {
            edges.value.push([[], [], edgeIndices]);
            gcpsToMarkers();
            syncLayerData();
        } else {
            console.warn("Edge already exists");
        }
    }
};

const removeEdge = (arg: any) => {
    const startEnd = arg.data.startEnd;
    if (!startEnd) return;
    const idx = edges.value.findIndex(e => e[2][0] === startEnd[0] && e[2][1] === startEnd[1]);
    if (idx >= 0) {
        edges.value.splice(idx, 1);
        gcpsToMarkers();
        syncLayerData();
    }
};

// M12-T1: 対応線上への対応点作成（旧版 mapedit.js:405-489 addMarkerOnEdge の移植）。
// 計算部は src/utils/edgeSplitMath.ts の純粋関数へ分離し、ここでは座標丸め・
// エラー診断・gcps/edges mutation・再描画を担う。現行契約への適合差分:
// (a) gcps は3要素 [illst, mercator, layer]、(b) syncLayerData() で永続化、
// (c) エラー診断（EDGE_NOT_FOUND/ZERO_LENGTH/GCP_COLLISION/INVALID_COORDINATE_ARRAY）
const edgeOperationError = ref<string | null>(null);

const addMarkerOnEdge = (arg: any, map: any) => {
    edgeOperationError.value = null;
    const edgeGeom = arg.data.edge;
    const isIllst = map === illstMap;
    const coord = edgeGeom.getGeometry().getClosestPoint(arg.coordinate);
    // 座標丸めは旧版と同じ式（illst: 小数2桁 / mercator: 小数6桁）
    const xy = isIllst ? arrayRoundTo(illstSource.sysCoord2Xy(coord), 2) : arrayRoundTo(coord, 6);
    const startEnd = edgeGeom.get('startEnd');
    const edgeIndex = edges.value.findIndex(e => e[2][0] === startEnd[0] && e[2][1] === startEnd[1]);
    if (edgeIndex < 0) {
        console.warn('[m12-t1 edge-split] EDGE_NOT_FOUND', startEnd);
        edgeOperationError.value = t('mapedit.edge_error_not_found');
        return;
    }
    const edge = edges.value[edgeIndex];
    const gcp1 = gcps.value[startEnd[0]];
    const gcp2 = gcps.value[startEnd[1]];
    const result = edgeSplit({
        thisNodes: isIllst ? edge[0] : edge[1],
        thatNodes: isIllst ? edge[1] : edge[0],
        thisEnd1: gcp1[isIllst ? 0 : 1],
        thisEnd2: gcp2[isIllst ? 0 : 1],
        thatEnd1: gcp1[isIllst ? 1 : 0],
        thatEnd2: gcp2[isIllst ? 1 : 0],
        xy,
    });
    if (!result.ok) {
        if (result.code === 'EDGE_ZERO_LENGTH') {
            console.warn('[m12-t1 edge-split] EDGE_ZERO_LENGTH', startEnd);
            edgeOperationError.value = t('mapedit.edge_error_zero_length');
        } else {
            console.error('[m12-t1 edge-split] INVALID_COORDINATE_ARRAY', startEnd);
        }
        return;
    }
    const newGcpPoint: [number[], number[]] = [
        isIllst ? xy : result.thatXy,
        isIllst ? result.thatXy : xy,
    ];
    // 座標丸め衝突（Minor-2）: 丸め後の新 GCP が既存 GCP と同座標なら mutation なし
    const collision = gcps.value.some((gcp) =>
        Math.hypot(gcp[0][0] - newGcpPoint[0][0], gcp[0][1] - newGcpPoint[0][1]) < 1e-8 &&
        Math.hypot(gcp[1][0] - newGcpPoint[1][0], gcp[1][1] - newGcpPoint[1][1]) < 1e-8,
    );
    if (collision) {
        console.warn('[m12-t1 edge-split] GCP_COLLISION', newGcpPoint[0], newGcpPoint[1]);
        return;
    }
    gcps.value.push([newGcpPoint[0], newGcpPoint[1], currentEditingLayer.value]);
    const newGcpIndex = gcps.value.length - 1;
    editingID.value = String(newGcpIndex + 1);
    edges.value.splice(edgeIndex, 1, [
        isIllst ? result.thisPrevNodes : result.thatPrevNodes,
        isIllst ? result.thatPrevNodes : result.thisPrevNodes,
        [startEnd[0], newGcpIndex],
    ]);
    edges.value.push([
        isIllst ? result.thisLastNodes : result.thatLastNodes,
        isIllst ? result.thatLastNodes : result.thisLastNodes,
        [newGcpIndex, startEnd[1]],
    ]);
    gcpsToMarkers();
    syncLayerData();
};

const createContextMenu = (map: any) => {
  const contextmenu = new ContextMenu({
    width: 170,
    defaultItems: false,
    items: []
  });
  
  contextmenu.on('beforeopen', (evt: any) => {
    // 領域外でのコンテキストメニュー抑制 (オリジナルの動作)
    if (map === illstMap) {
        const boundsFeature = illstBoundsSource?.getFeatures()[0];
        if (boundsFeature) {
            const geom = boundsFeature.getGeometry();
            if (geom && !geom.intersectsCoordinate(evt.coordinate)) {
                return false; 
            }
        }
    }
  });

  contextmenu.on('open', (evt: any) => {
    // contextmenu インスタンスの map プロパティは厳密に型付けされないため、引数の map を直接使用する
    const feature = map.forEachFeatureAtPixel(evt.pixel, (ft: any) => ft as Feature, {
      layerFilter(layer: any) {
        return layer.get('name') === 'marker' || layer.get('name') === 'edges';
      },
      hitTolerance: 5
    });
    
    contextmenu.clear();
    
     if (feature) {
       if (feature.getGeometry()?.getType() === 'LineString') {
          // フィーチャーがエッジの場合
          const edgeStartEnd = feature.get('startEnd');
          contextmenu.push({
              text: t('mapedit.context_correspond_line_remove') || 'Remove Edge',
              data: { startEnd: edgeStartEnd },
              callback: (e: any) => removeEdge(e)
          });
          // M12-T1: 対応線上への対応点作成（旧版は removeEdge と両方 push していた）
          contextmenu.push({
              text: t('mapedit.context_marker_on_line'),
              data: { edge: feature },
              callback: (e: any) => addMarkerOnEdge(e, map)
          });
       } else {
        // フィーチャーがマーカーの場合
        const gcpIndex = feature.get('gcpIndex');
        if (gcpIndex === 'home') {
           contextmenu.push({ text: t('mapedit.context_home_remove'), callback: () => removeHomePosition() });
           contextmenu.push({ text: t('mapedit.context_home_show'),   callback: () => showHomePosition() });
        } else if (gcpIndex !== 'new') {
           editingID.value = String(Number(gcpIndex) + 1);
           
           if (newlyAddEdge.value === undefined) {
               contextmenu.push({ text: t('mapedit.context_correspond_line_start') || 'Add Edge', data: { marker: feature }, callback: (e: any) => edgeStartMarker(e) });
           } else if (newlyAddEdge.value !== Number(gcpIndex)) {
               contextmenu.push({ text: t('mapedit.context_correspond_line_end') || 'Set End Point', data: { marker: feature }, callback: (e: any) => edgeEndMarker(e) });
           } else {
               contextmenu.push({ text: t('mapedit.context_correspond_line_cancel') || 'Cancel Edge', callback: () => { newlyAddEdge.value = undefined; gcpsToMarkers(); } });
           }
           
           contextmenu.push({ text: t('mapedit.context_remove_marker'), data: { marker: feature }, callback: (e: any) => removeMarker(e, map) });
        }
      }
    } else if (newGcp.value !== undefined && newGcp.value[map === illstMap ? 0 : 1] !== undefined) {
      // 保留中のマーカー追加操作のキャンセルメニュー
      contextmenu.push({ text: t('mapedit.context_cancel_add_marker'), callback: () => removeMarker({data: {marker: map.getSource('marker').getFeatures().find((f:any)=>f.get('gcpIndex')==='new')}}, map) });
    } else {
      contextmenu.push({ text: t('mapedit.context_add_marker'), callback: (e: any) => addNewMarker(e, map) });
      if (newlyAddEdge.value !== undefined) {
          contextmenu.push({ text: t('mapedit.context_correspond_line_cancel') || 'Cancel Edge', callback: () => { newlyAddEdge.value = undefined; gcpsToMarkers(); } });
      }
    }
  });
  
  return contextmenu;
};

// M11-T10 (人間検証R6): request が添付する compiled 由来の tins を mapData から切り離して取り出す
const extractCompiledTins = (data: any): any[] | null => {
    const tins = Array.isArray(data?.compiledTins) ? data.compiledTins : null;
    if (data && 'compiledTins' in data) delete data.compiledTins;
    return tins;
};
// compiled を持つレイヤーへ Tin を種付けする(再計算は compiled が無いレイヤーだけで良い)。
// 文字列(tooLessGcps/compiledRequired)は未計算のまま残し、load 側の再計算に委ねる
const seedTinObjects = (tins: any[] | null): void => {
    if (!tins) return;
    tins.forEach((entry, i) => {
        if (i >= tinObjects.value.length || !entry || typeof entry === 'string') return;
        const tin = new Tin(TIN_V2_OPTIONS);
        tin.setCompiled(entry);
        tinObjects.value[i] = tin;
    });
};

onMounted(async () => {
    // 地図編集はuid正準で開く (ADR-0007): /mapedit?uid=<uid>。uid未指定は新規作成
    const uid = route.query.uid as string | undefined;
    const isNew = !uid || uid === 'new';
    let requestCompiledTins: any[] | null = null;

    if (isNew) {
        // 新規地図: defaultMap で初期化
        // M11-T10: duplicateFrom がある場合は元地図から内容を複製
        const dupFrom = route.query.duplicateFrom as string | undefined;
        if (dupFrom) {
          try {
            const source = await (window as any).mapedit.request(dupFrom);
            if (source) {
              // M11-T10 (R6): 複製元の compiled tins を種付け用に確保(再計算なしで即保存可能に)
              requestCompiledTins = extractCompiledTins(source);
              // 複製浄化: uid/revision 除去、予約slugで上書き
              delete source.uid;
              delete source.revision;
              if (route.query.slug) source.mapID = route.query.slug as string;
              if (!source.status) source.status = 'New';
              const fresh = source;
              fresh.lang = fresh.lang || resolveEditorLanguage(i18next.language);
              // W4（設計 §5.3.1）: mount 時の初期状態構築（S3）
              withoutHistory('W4', () => {
                setMapDocument(fresh);
                originalMapData.value = cloneDeep(mapData.value);
              });
              // copyFromUid を保持: 保存時に tiles/thumbnail 複製
              copyFromUidSource.value = dupFrom;
            } else {
              // fallback to default
              const fresh: any = defaultMapData();
              fresh.lang = resolveEditorLanguage(i18next.language);
              // W4（設計 §5.3.1）: mount 時の初期状態構築（S3）
              withoutHistory('W4', () => {
                setMapDocument(fresh);
                originalMapData.value = cloneDeep(mapData.value);
              });
            }
          } catch (e) {
            console.error("Failed to duplicate map", e);
            const fresh: any = defaultMapData();
            fresh.lang = resolveEditorLanguage(i18next.language);
            // W4（設計 §5.3.1）: mount 時の初期状態構築（S3）
            withoutHistory('W4', () => {
              setMapDocument(fresh);
              originalMapData.value = cloneDeep(mapData.value);
            });
          }
        } else {
          const fresh: any = defaultMapData();
          fresh.lang = resolveEditorLanguage(i18next.language);
          // W4（設計 §5.3.1）: mount 時の初期状態構築（S3）
          withoutHistory('W4', () => {
            setMapDocument(fresh);
            originalMapData.value = cloneDeep(mapData.value);
          });
          // M11-T10 (AC11): MapList のインポート導線から遷移した場合、
          // 新規初期化後に既存の importMap フロー(ファイル選択→展開)を自動起動する
          if (route.query.import === '1') {
            void nextTick(() => { void importMap(); });
          }
        }
    } else {
        // 既存地図: バックエンドからuidで読み込み
        try {
            const data = await (window as any).mapedit.request(uid);
            if (data) {
                // M11-T10 (R6): compiled tins を種付け用に確保(compiled 持ちは初回再計算を省く)
                requestCompiledTins = extractCompiledTins(data);
                // バックエンドが mapID(=slug)/uid/revision/status を設定してくれている
                if (!data.status) data.status = 'Update';
                adoptLoaded({ uid: data.uid ?? uid, slug: data.mapID, revision: data.revision });
                mapID.value = data.mapID;
                // W4（設計 §5.3.1）: 永続化済み内容の読み込み（S3）
                withoutHistory('W4', () => {
                    setMapDocument(data);
                    originalMapData.value = cloneDeep(mapData.value);
                });
            }
        } catch (e) {
            console.error("Failed to load map data:", e);
        }
    }

    // 編集言語の初期値は地図のデフォルト言語(未設定の旧データはja)
    currentLang.value = (mapData.value.lang || 'ja') as LangCode;

    // wmtsフォルダパスをバックエンドから取得
    // NOTE: mapData と originalMapData 両方に設定しないと isDirty が常に true になる
    try {
        const wmtsFolder = await (window as any).mapedit.getWmtsFolder();
        // W3（設計 §5.3.1）: 実行環境のパス注入。originalMapData も同時更新している
        // ことがコード上の signature S1（＝編集ではない）である
        withoutHistory('W3', () => {
            mapData.value.wmtsFolder = wmtsFolder;
            originalMapData.value.wmtsFolder = wmtsFolder;
        });
    } catch (_e) { /* 取得失敗時はデフォルト空文字のまま */ }

    // W4（設計 §5.3.1）: mount 時の初期状態構築。起点にユーザ操作が無い（S3）
    withoutHistory('W4', () => {
        sub_maps.value = cloneDeep(mapData.value.sub_maps || []);
        gcps.value = cloneDeep(mapData.value.gcps || []);
        edges.value = cloneDeep(mapData.value.edges || []);
        homePosition.value = mapData.value.homePosition;
        mercZoom.value = mapData.value.mercZoom;
        // 旧実装の defaultMap に合わせ、デフォルトは 'strict'（'auto' ではない）
        strictMode.value = mapData.value.strictMode || 'strict';
        vertexMode.value = mapData.value.vertexMode || 'plain';
    });
    // tinObjects: メインレイヤー + サブマップ分 の undefined で初期化（旧実装: vueMap.tinObjects = [...]）
    tinObjects.value = Array(1 + sub_maps.value.length).fill(undefined);
    // M11-T10 (R6): compiled を持つレイヤーは種付けし再計算を省く(未訪問レイヤーの素体化も防ぐ)
    seedTinObjects(requestCompiledTins);
    initializeHistoryStack();
    // M11-T10: 複製内容はどこにも永続化されていないため dirty 扱いにする
    // (即保存可能・放棄時は hot-exit で下書き化され、slug 予約が draft に紐付いて可視化される)
    if (copyFromUidSource.value) historyStack.value?.markDirty();
    // M11-T7: 新規の draft キー = 事前採番 uid(newMapUid)。予約帰属・create uid と一致させる
    const draftUid = uid && uid !== 'new' ? uid : newMapUid;
    if (isNew && route.query.draftUid !== draftUid) {
        await router.replace({ query: { ...route.query, draftUid } });
    }
    const restoreDecision = await draftLifecycle.open(draftUid, revision.value ?? null);
    // M12-T20 (§6.4): auto-apply で復元された場合の復元時ガード（conflict 分岐は
    // applyConflictDraft が担う）。表示のみのため mount 続行をブロックしない
    if (restoreDecision === 'auto-apply') void warnIfDraftTilesLost(false);
    window.addEventListener('keydown', onHistoryKeydown);
    removeMainProcessListener = window.appEvents.onMainProcessMessage(onMainProcessMessage);

    initMaps();
    if (mapData.value.url_) {
        setTimeout(() => loadMapTiles(), 100);
    }

    // GCP タブへの切り替えを監視: v-show でマップコンテナが非表示の間は
    // OpenLayers が高さ 0 の div にレンダリングするため、updateSize() で強制再描画する
    watch(activeTab, (newTab) => {
        if (newTab === 'gcps') {
            nextTick(() => {
                illstMap?.updateSize();
                mercMap?.updateSize();
            });
        } else if (newTab === 'settings') {
            loadBaseMapVisibility();
        }
        // M12-T10 v2.0 Min2: pois タブの refreshMapCanonicalBbox 呼出は dead code のため削除
    });
});

onBeforeUnmount(() => {
    // C6（設計 §5.6.2）: 終端廃棄
    cancelPendingSnapshot();
    window.removeEventListener('keydown', onHistoryKeydown);
    removeMainProcessListener?.();
    removeMainProcessListener = undefined;
    // Map/OpenLayers runtime is module-scoped. Clear it before a subsequent
    // MapEdit mount applies a draft, otherwise restoreHistoryState() can draw
    // through a detached source left by the previous screen.
    illstMap?.setTarget(undefined);
    mercMap?.setTarget(undefined);
    illstSource = null;
    illstMap = null;
    mercMap = null;
    illstCheckSource = null;
    mercCheckSource = null;
    editorComputeBackend.dispose();
});

let edgeRevisionBuffer: number[] = [];

const edgeModifyStart = (evt: any) => {
    edgeRevisionBuffer = [];
    evt.features.forEach((f: any) => {
        edgeRevisionBuffer.push(f.getRevision());
    });
};

const edgeModifyEnd = (evt: any) => {
    const isIllust = evt.target.getMap() === illstMap;
    let feature: any = null;
    evt.features.forEach((f: any, i: number) => {
        if (f.getRevision() !== edgeRevisionBuffer[i]) feature = f;
    });
    if (!feature) return;

    const startEnd = feature.get('startEnd');
    if (!startEnd) return;

    const edgeIndex = edges.value.findIndex(e => e[2][0] === startEnd[0] && e[2][1] === startEnd[1]);
    if (edgeIndex < 0) return;

    const edge = edges.value[edgeIndex];
    const rawCoords = feature.getGeometry().getCoordinates();
    const rawPoints = rawCoords.filter((_item: any, index: number, array: any[]) => !(index === 0 || index === array.length - 1));

    if (isIllust) {
        edge[0] = rawPoints.map((pt: number[]) => arrayRoundTo(illstSource.sysCoord2Xy(pt), 2));
    } else {
        edge[1] = rawPoints.map((pt: number[]) => arrayRoundTo(pt, 6));
    }
    
    edges.value.splice(edgeIndex, 1, edge);
    syncLayerData();
};

const edgeModifyCondition = (e: any) => {
    if (e.originalEvent.button === 2) return false;
    const map = e.map;
    const f = map.getFeaturesAtPixel(e.pixel, {
        layerFilter(layer: any) {
            const name = layer.get('name');
            return name === 'edges' || name === 'marker';
        }
    });
    if (f && f.length > 0 && f[0].getGeometry()?.getType() === 'LineString') {
        const coordinates = f[0].getGeometry().getCoordinates();
        const p0 = e.pixel;
        let p1 = map.getPixelFromCoordinate(coordinates[0]);
        let dx = p0[0] - p1[0];
        let dy = p0[1] - p1[1];
        if (Math.sqrt(dx * dx + dy * dy) <= 10) return false;
        
        p1 = map.getPixelFromCoordinate(coordinates.slice(-1)[0]);
        dx = p0[0] - p1[0];
        dy = p0[1] - p1[1];
        if (Math.sqrt(dx * dx + dy * dy) <= 10) return false;
        
        return true;
    }
    return false;
};

const tinStyle = (feature: any) => {
    const type = feature.getGeometry()?.getType();
    if (type === 'Polygon') {
        return new Style({
            stroke: new Stroke({ color: 'blue', width: 1 }),
            fill: new Fill({ color: 'rgba(0, 0, 255, 0.05)' })
        });
    } else if (type === 'LineString') {
        return new Style({
            stroke: new Stroke({ color: 'red', width: 2 })
        });
    }
    // Point: kinks（交差エラー点）を黄色ダイヤ型アイコンで表示
    // 旧実装 mapedit.js L.731-743 に準拠
    const iconSVG = `<svg version="1.1" id="Layer_1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
x="0px" y="0px" width="6px" height="6px" viewBox="0 0 6 6" enable-background="new 0 0 6 6" xml:space="preserve">
<polygon x="0" y="0" points="3,0 6,3 3,6 0,3 3,0" stroke="#FF0000" fill="#FFFF00" stroke-width="2"></polygon></svg>`;
    return new Style({
        image: new Icon({
            src: `data:image/svg+xml,${encodeURIComponent(iconSVG)}`,
            anchor: [0.5, 0.5]
        })
    });
};

const jsonClear = () => {
    illstJsonSource?.clear();
    mercJsonSource?.clear();
};

const boundsClear = () => {
    illstBoundsSource?.clear();
    mercBoundsSource?.clear();
};

const checkClear = () => {
    illstCheckSource?.clear();
    mercCheckSource?.clear();
};

const tinResultUpdate = () => {
    if (!illstMap || !mercMap || !illstSource) return;

    jsonClear();
    boundsClear();
    checkClear();
    errorNumber.value = null;

    const forProj = `ZOOM:${illstSource.maxZoom}`;
    const jsonReader = new GeoJSON();

    // illstMap に有効領域（bounds）を描画
    let bboxPoints: number[][];
    if (currentEditingLayer.value === 0) {
        bboxPoints = [
            [0, 0], [mapData.value.width, 0],
            [mapData.value.width, mapData.value.height],
            [0, mapData.value.height], [0, 0]
        ];
    } else {
        const subMap = sub_maps.value[currentEditingLayer.value - 1];
        const bd = subMap?.bounds || [];
        bboxPoints = bd.length > 0 ? [...bd, bd[0]] : [];
    }
    if (bboxPoints && bboxPoints.length > 1) {
        const bboxGeoJson = { type: 'Feature', geometry: { type: 'Polygon', coordinates: [bboxPoints] }, properties: {} };
        const bboxFeatures = jsonReader.readFeatures(bboxGeoJson, { dataProjection: forProj, featureProjection: 'EPSG:3857' });
        if (illstBoundsSource) illstBoundsSource.addFeatures(bboxFeatures);
    }

    const tin = tinObject.value;
    if (!tin || typeof tin === 'string') return;

    // 両地図にTINメッシュを描画
    // tins は Tin インスタンスの直接プロパティ（getCompiled() の中ではない）
    // 旧実装: tinObject.tins.forw / tinObject.tins.bakw
    try {
        const forTin = tin.tins?.forw;
        const bakTin = tin.tins?.bakw;
        if (forTin) {
            const forFeatures = jsonReader.readFeatures(forTin, { dataProjection: forProj, featureProjection: 'EPSG:3857' });
            forFeatures.forEach((f: any) => f.setStyle(tinStyle(f)));
            if (illstJsonSource) illstJsonSource.addFeatures(forFeatures);
        }
        if (bakTin) {
            const bakFeatures = jsonReader.readFeatures(bakTin, { dataProjection: 'EPSG:3857' });
            bakFeatures.forEach((f: any) => f.setStyle(tinStyle(f)));
            if (mercJsonSource) mercJsonSource.addFeatures(bakFeatures);
        }
        // A-2: kinks（交差エラー点）の表示 - strict_errorの場合のみ
        // 旧実装 mapedit.js L.706-709 に準拠
        if (tin.strict_status === 'strict_error' && tin.kinks?.bakw) {
            const kinkFeatures = jsonReader.readFeatures(tin.kinks.bakw, { dataProjection: 'EPSG:3857' });
            kinkFeatures.forEach((f: any) => f.setStyle(tinStyle(f)));
            if (mercJsonSource) mercJsonSource.addFeatures(kinkFeatures);
        }
    } catch (e) {
        console.error('[tinResultUpdate] Failed to render TIN:', e);
    }
};

// M11-T10: 進行中の TIN 計算を保存が待てるように件数を追跡する。
// 複製直後は dirty で即保存できるため、worker 計算完了前に tins を収集すると
// compiled が失われ store が gcps 素体へ劣化する(store2HistMap の compiledRequired 警告)。
let tinComputeActive = 0;
const tinComputeWaiters: Array<() => void> = [];
const waitForTinComputeIdle = (): Promise<void> =>
    tinComputeActive === 0 ? Promise.resolve() : new Promise((resolve) => { tinComputeWaiters.push(resolve); });

// opts.force: 保存前ゲート用。タイル読込(illstSource)前でも TIN 計算自体は gcps/bounds だけで可能
const updateTin = async (opts?: { force?: boolean }) => {
    if (!illstSource && !opts?.force) return;
    const gcpList = gcps.value;
    if (!gcpList || gcpList.length < 3) {
        tinObject.value = 'tooLessGcps';
        tinResultUpdate();
        return;
    }
    // bounds / wh を IPC に渡すための変換（オリジナルの backend/mapedit.js と同じ引数）
    const index = currentEditingLayer.value;
    const width = Number(mapData.value.width) || 0;
    const height = Number(mapData.value.height) || 0;
    const wh = index === 0 ? [width, height] : null;
    
    let subMapBounds = index !== 0 ? sub_maps.value[index - 1]?.bounds : null;
    // サブマップにboundsがない場合はメインマップのboundsまたはデフォルト矩形を使用
    if (index !== 0 && !subMapBounds) {
        subMapBounds = mapData.value.bounds || [[0, 0], [width, 0], [width, height], [0, height]];
    }

    const bounds = index !== 0 ? subMapBounds : wh; // index=0 は [width, height] を bounds 代わりに使用

    console.log(`[updateTin] index: ${index}, wh: ${JSON.stringify(wh)}, bounds: ${JSON.stringify(bounds)}`);

    if (!bounds && !wh) {
        console.error('[updateTin] Both wh and bounds are missing for index:', index);
        return;
    }
    tinComputeActive++;
    try {
        // Vue の Proxy は IPC の Structured Clone に対応しないため、JSON でプレーンオブジェクトに変換する
        const plainGcps = JSON.parse(JSON.stringify(gcpList.map((g: any[]) => [g[0], g[1]])));
        const plainEdges = JSON.parse(JSON.stringify(edges.value));
        const plainBounds = bounds ? JSON.parse(JSON.stringify(bounds)) : null;
        const [, compiled] = await editorComputeBackend.updateTin({
            gcps: plainGcps,
            edges: plainEdges,
            index,
            bounds: plainBounds,
            strict: strictMode.value,
            vertex: vertexMode.value
        });
        if (typeof compiled === 'string') {
            // エラー文字列が返ってきた場合
            tinObject.value = compiled;
        } else {
            // コンパイル済みデータをフロントで Tin に復元して tins プロパティを使えるようにする
            const tin = new Tin(TIN_V2_OPTIONS);
            tin.setCompiled(compiled);
            tinObject.value = tin;
        }
    } catch (err: any) {
        // unmount による worker dispose は画面遷移中の正常な取消。状態を汚さず終了する(人間検証R5)
        if (String(err?.message ?? err).includes('worker was disposed')) return;
        console.error('[updateTin] IPC error:', err);
        tinObject.value = 'unknownError';
    } finally {
        tinComputeActive--;
        if (tinComputeActive === 0) tinComputeWaiters.splice(0).forEach((resolve) => resolve());
    }
    tinResultUpdate();
    // M11-T11 HV-M1: Undo/Redo 等で TIN 再計算後に illst 側 home マーカーが再描画されるよう、
    // homePosition がある場合は gcpsToMarkers() をもう一度呼び出す。
    // illstSource 未ロード時(保存時force計算等)は edges 描画で落ちるためガードする。
    if (homePosition.value && illstSource) gcpsToMarkers();
};

const boundsModifyEnd = (evt: any) => {
    const feature = evt.features.getArray()[0];
    if (!feature || !illstSource) return;
    const geom = feature.getGeometry();
    if (!geom || geom.getType() !== 'Polygon') return;
    
    const coords = (geom as any).getCoordinates()[0]; // 外周リングを取得
    coords.pop(); // 末尾の重複点を除去して保存

    // 画像座標系に変換
    const imageCoords = coords.map((c: number[]) => {
        return arrayRoundTo(illstSource.sysCoord2Xy(c) as number[], 2);
    });

    const index = currentEditingLayer.value;
    if (index === 0) {
        mapData.value.bounds = imageCoords;
    } else {
        sub_maps.value[index - 1].bounds = imageCoords;
    }
    
    // 有効領域が変更されたのでTINを再計算
    updateTin();
};

// A-1: 座標変換テスト（クリックした地点を相手地図に対応点で表示）
// 旧実装 mapedit.js onClick (L.581-649) に準拠
const onMapClick = async (evt: MapBrowserEvent<PointerEvent>) => {
    if (evt.originalEvent.altKey) return;
    if (!illstMap || !mercMap || !illstSource) return;

    const isIllst = (evt.map ?? (evt as any).target) === illstMap;
    const distMap = isIllst ? mercMap : illstMap;
    const srcMarkerLoc = evt.coordinate;

    // 前回のテストピンをクリア
    illstCheckSource?.clear();
    mercCheckSource?.clear();

    const tin = tinObject.value;
    if (typeof tin === 'string' || !tin) {
        // TIN エラー状態（文字列が返された場合）
        const msg =
            tin === 'tooLessGcps' ? t('mapedit.testerror_too_short') :
            tin === 'tooLinear'   ? t('mapedit.testerror_too_linear') :
            tin === 'pointsOutside' ? t('mapedit.testerror_outside') :
            tin === 'edgeError'   ? t('mapedit.testerror_line') :
                                    t('mapedit.testerror_unknown');
        await (window as any).dialog.showMessageBox({ type: 'info', buttons: ['OK'], message: msg });
        return;
    }
    if (tin.strict_status === 'strict_error' && !isIllst) {
        await (window as any).dialog.showMessageBox({
            type: 'info', buttons: ['OK'],
            message: t('mapedit.testerror_valid_error')
        });
        return;
    }

    // srcXy: TIN 座標空間の入力点（illst 側: [illst_x, illst_y]、merc 側: [merc_x, merc_y]）
    const srcXy = isIllst
        ? illstSource.sysCoord2Xy(srcMarkerLoc)
        : srcMarkerLoc;

    // isIllst=true → 順変換（illst→merc）、false → 逆変換（merc→illst）
    const distXy = tin.transform(srcXy, !isIllst);

    if (!distXy) {
        await (window as any).dialog.showMessageBox({
            type: 'info', buttons: ['OK'],
            message: t('mapedit.testerror_outside_map')
        });
        return;
    }

    const distMarkerLoc = isIllst ? distXy : illstSource.xy2SysCoord(distXy);
    distMap.getView().setCenter(distMarkerLoc);

    const iconSVG = `<svg version="1.1" id="Layer_1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
x="0px" y="0px" width="10px" height="15px" viewBox="0 0 10 15" enable-background="new 0 0 10 15" xml:space="preserve">
<polygon x="0" y="0" points="5,1 9,5 5,14 1,5 5,1" stroke="#FF0000" fill="#FFFF00" stroke-width="2"></polygon></svg>`;
    const style = new Style({
        image: new Icon({
            src: `data:image/svg+xml,${encodeURIComponent(iconSVG)}`,
            anchor: [0.5, 1]
        })
    });

    const { Feature } = await import('ol');
    const { Point: OlPoint } = await import('ol/geom');
    const srcFeature = new Feature({ geometry: new OlPoint(srcMarkerLoc) });
    const distFeature = new Feature({ geometry: new OlPoint(distMarkerLoc) });
    srcFeature.setStyle(style);
    distFeature.setStyle(style);
    (isIllst ? illstCheckSource : mercCheckSource)?.addFeature(srcFeature);
    (isIllst ? mercCheckSource : illstCheckSource)?.addFeature(distFeature);
};

const initMaps = async () => {

    // 1. Initialize Illustrated Map (LEFT side)
    illstMap = new MaplatMap({
        div: 'illstMap',
        interactions: interactionDefaults().extend([
            new DragRotateAndZoom({
                condition: altKeyOnly
            }),
            new Drag()
        ]),
        controls: controlDefaults()
    });
    illstMap.addControl(createContextMenu(illstMap));

    // bounds 表示レイヤー（有効領域を赤ポリゴンで表示）
    const illstBoundsVSrc = new VectorSource({ wrapX: false });
    illstBoundsSource = illstBoundsVSrc;
    const illstBoundsLayer = new VectorLayer({
        source: illstBoundsVSrc,
        style: new Style({
            stroke: new Stroke({ color: 'red', width: 2 }),
            fill: new Fill({ color: 'rgba(0,0,0,0)' })
        })
    });
    illstBoundsLayer.set('name', 'bounds');
    // json レイヤー（TIN 三角形メッシュ）
    const illstJsonVSrc = new VectorSource({ wrapX: false });
    illstJsonSource = illstJsonVSrc;
    const illstJsonLayer = new VectorLayer({
        source: illstJsonVSrc
    });
    illstJsonLayer.set('name', 'json');
    // check レイヤー（座標変換テスト用ピン）
    const illstCheckVSrc = new VectorSource({ wrapX: false });
    illstCheckSource = illstCheckVSrc;
    const illstCheckLayer = new VectorLayer({ source: illstCheckVSrc });
    illstCheckLayer.set('name', 'check');
    const illstEdgesVSrc = new VectorSource({ wrapX: false });
    const illstEdgesLayer = new VectorLayer({
        source: illstEdgesVSrc
    });
    illstEdgesLayer.set('name', 'edges');
    const illstOverlay = illstMap.getLayer('overlay');
    if (illstOverlay && illstOverlay.getLayers) {
        illstOverlay.getLayers().push(illstBoundsLayer);
        illstOverlay.getLayers().push(illstJsonLayer);
        illstOverlay.getLayers().push(illstEdgesLayer);
    }
    // check レイヤーはトップレベルに追加（overlay グループではない）
    illstMap.getLayers().push(illstCheckLayer);
    // クリックイベント: 座標変換テスト
    illstMap.on('click', onMapClick);

    const illstEdgeModify = new Modify({
        source: illstEdgesVSrc as VectorSource,
        condition: edgeModifyCondition
    });
    illstEdgeModify.on('modifystart', edgeModifyStart);
    illstEdgeModify.on('modifyend', edgeModifyEnd);
    const illstEdgeSnap = new Snap({ source: illstEdgesVSrc as VectorSource });
    illstMap.addInteraction(illstEdgeModify);
    illstMap.addInteraction(illstEdgeSnap);

    const illstBoundsModify = new Modify({
        source: illstBoundsVSrc,
    });
    illstBoundsModify.on('modifyend', boundsModifyEnd);
    const illstBoundsSnap = new Snap({ source: illstBoundsVSrc });
    illstMap.addInteraction(illstBoundsModify);
    illstMap.addInteraction(illstBoundsSnap);

    // 2. Initialize Mercator Map (RIGHT side)
    mercMap = new MaplatMap({
        div: 'mercMap',
        interactions: interactionDefaults().extend([
            new DragRotateAndZoom({
                condition: altKeyOnly
            }),
            new Drag()
        ]),
        controls: controlDefaults().extend([
            new LayerSwitcher()
        ])
    });
    mercMap.addControl(createContextMenu(mercMap));

    // bounds 表示レイヤー（有効領域を赤ポリゴンで表示）
    const mercBoundsVSrc = new VectorSource({ wrapX: false });
    mercBoundsSource = mercBoundsVSrc;
    const mercBoundsLayer = new VectorLayer({
        source: mercBoundsVSrc,
        style: new Style({
            stroke: new Stroke({ color: 'red', width: 2 }),
            fill: new Fill({ color: 'rgba(0,0,0,0)' })
        })
    });
    mercBoundsLayer.set('name', 'bounds');
    // json レイヤー（TIN 三角形メッシュ）
    const mercJsonVSrc = new VectorSource({ wrapX: false });
    mercJsonSource = mercJsonVSrc;
    const mercJsonLayer = new VectorLayer({
        source: mercJsonVSrc
    });
    mercJsonLayer.set('name', 'json');
    // check レイヤー（座標変換テスト用ピン）
    const mercCheckVSrc = new VectorSource({ wrapX: false });
    mercCheckSource = mercCheckVSrc;
    const mercCheckLayer = new VectorLayer({ source: mercCheckVSrc });
    mercCheckLayer.set('name', 'check');
    const mercEdgesVSrc = new VectorSource({ wrapX: false });
    const mercEdgesLayer = new VectorLayer({
        source: mercEdgesVSrc
    });
    mercEdgesLayer.set('name', 'edges');
    const mercOverlay = mercMap.getLayer('overlay');
    if (mercOverlay && mercOverlay.getLayers) {
        mercOverlay.getLayers().push(mercBoundsLayer);
        mercOverlay.getLayers().push(mercJsonLayer);
        mercOverlay.getLayers().push(mercEdgesLayer);
    }
    // checkレイヤーはトップレベルに追加
    mercMap.getLayers().push(mercCheckLayer);
    // クリックイベント: 座標変換テスト
    mercMap.on('click', onMapClick);
    
    const mercEdgeModify = new Modify({
        source: mercEdgesVSrc as VectorSource,
        condition: edgeModifyCondition
    });
    mercEdgeModify.on('modifystart', edgeModifyStart);
    mercEdgeModify.on('modifyend', edgeModifyEnd);
    const mercEdgeSnap = new Snap({ source: mercEdgesVSrc as VectorSource });
    mercMap.addInteraction(mercEdgeModify);
    mercMap.addInteraction(mercEdgeSnap);

    // 旧実装 mapedit.js L.1283-1296 相当: 未移植のため一時コメントアウト
    // 地図の描画ごとにextentを送信し、表示範囲に重なる地図リストを取得する機能
    //
    // mercMap.on('postrender', () => {
    //     // 地図の描画ごとにextentを送信
    //     const extent = mercMap.getView().calculateExtent();
    //     (window as any).mapedit.checkExtentMap(extent);
    // });
    // // 表示範囲に重なる地図リストをVueに格納
    // (window as any).ipcRenderer.on('mapedit:extentMapList', (_event: any, mapIDs: string[]) => {
    //     // templateMaps に相当する ref を定義し、UIに反映する
    //     console.log('[checkExtentMap] overlapping mapIDs:', mapIDs);
    // });
    // // 1秒以内に新しいextentが来ていた場合のリトライ処理
    // (window as any).ipcRenderer.on('mapedit:checkExtentMapRetry', (_event: any, extent: number[]) => {
    //     (window as any).mapedit.checkExtentMap(extent);
    // });

    const geocoder = new Geocoder('nominatim', {
        provider: 'osm',
        lang: 'en-US',
        placeholder: t('mapedit.control_put_address'),
        limit: 5,
        keepOpen: false
    });
    
    // 住所検索時はジオコーダーのピンマーカーを非表示にする
    geocoder.on('addresschosen', () => {
        if (geocoder.getLayer && geocoder.getLayer()) {
            geocoder.getLayer().getSource().clear();
        }
    });
    
    mercMap.addControl(geocoder);
    
    // メルカトル地図のデフォルトビューを設定
    const mercView = mercMap.getView();
    mercView.setCenter([15545266.36, 4253560.83]); // 東京付近
    mercView.setZoom(5);

    // ベースマップの初期設定
    await setupBaseMaps();
};

// ... (imports)

// M12-T17 (設計レビューv2 Minor2): mapSourceFactory + exchangeSource のみを行う軽量ヘルパー。
// loadMapTiles() 全体はこの後 gcps/edges/homePosition 等を「レイヤー0のデータ」として
// mapData.value から無条件に再代入する(2566行以降、syncLayerData 参照)。保存成功時の
// タイル参照リフレッシュ(applySuccess)はレイヤー文脈を保ったまま呼ばれる初のケースであり、
// loadMapTiles() をそのまま使うとサブレイヤー編集中(currentEditingLayer > 0)の gcps.value を
// レイヤー0データで意図せず上書きしてしまう。タイルソースの差し替えだけが目的の呼び出しは
// 本ヘルパーを使う(gcps/edges/ビュー中心/updateTin 等には一切触れない)
// m1-t6-hotfix-2: タイルソースの同一性管理（設計 v1.1 §5.2・§5.3）
// 拡張子の解決を1関数へ集約する。旧実装は mapData.extension を読んでいたが、
// 当該キーはどこからも書かれず常に undefined だった（latent な死引数。設計 §3.3）。
const resolveImageExtension = (md: any): string => md?.imageExtension || 'jpg';

// タイル実体の同一性を決めるキー。mapID（スラッグ）と attr（帰属表示）は含めない。
// 拡張子成分は url_ がある通常経路では冗長だが、url_ 不在で tiles/{mapID}/… を
// 組み立てる経路では独立した同一性要素になるため残す（設計 §5.2 の注記）。
const tileIdentityKey = (md: any): string =>
    [md?.url_, md?.width, md?.height, resolveImageExtension(md)].join('|');

// 現在 illstSource が構築された時点のキー。exchangeTileSource() の成功時のみ更新する
// （呼び出し元は :189 保存成功 / loadMapTiles 冒頭 / restoreHistoryState の3経路。設計 §4.1）
let illstSourceKey: string | null = null;
// E2E 診断用の成功回数カウンタ（設計 §5.4a）
let illstSourceExchangeCount = 0;

const exchangeTileSource = async (): Promise<any> => {
    if (!illstMap) return null;
    const options = {
        mapID: mapID.value,
        url: mapData.value.url_,
        width: mapData.value.width,
        height: mapData.value.height,
        attr: mapData.value.attr,
        noload: true, // HistMap/HistMap_tin を直接生成するためのフラグ
        imageExtension: resolveImageExtension(mapData.value)
    };
    try {
        const source = await mapSourceFactory(options, {});
        illstSource = source;
        illstMap.exchangeSource(source);
        // 成功時のみ更新する。失敗時は key を据え置き、次回の復元で再試行させる（設計 §5.4）
        illstSourceKey = tileIdentityKey(mapData.value);
        illstSourceExchangeCount++;
        return source;
    } catch (e) {
        console.error('[exchangeTileSource] mapSourceFactory でタイル読み込み失敗:', e);
        return null;
    }
};

// M5-T7: url（交換形）→ url_（ランタイム専用）の再導出。
//
// なぜ main へ問い合わせるか（設計 §4）: url が空のとき url_ はタイル実体から組み立てる
// 必要があり、renderer に持ち込むと m5-t3 が1本化した deriveRuntimeTileUrl が3箇所目として
// 復活する。∴ 導出は main（mapedit:deriveRuntimeTileUrl）に閉じたまま呼ぶ。
//
// lastDerivedUrl は「url_ を最後に導出したときの url」であって「入力欄の直前値」ではない
// （設計 §5.3）。入力欄基準にすると履歴復元で失効し、同じ値を再入力したときに早期 return して
// url と url_ が食い違う ＝ 本タスクが直すはずの症状を新経路で再導入してしまう。
// ∴ 更新は本関数の中だけで行い、経路 (a)(b) のどちらを通っても必ず更新される形にする。
let lastDerivedUrl: string | null = null;

/** 地図文書を丸ごと受け入れた直後に呼ぶ（url と url_ が対になっている状態の記録） */
const markRuntimeTileUrlDerived = () => {
    lastDerivedUrl = (mapData.value?.url ?? '') as string;
};

/**
 * url に対応する url_ を main から取り直して mapData へ反映する。
 *
 * @param requested 反映したい url。確定経路では入力値、復元経路では復元後の mapData.url
 * @param applyUrl  true なら mapData.url も requested で上書きする（確定経路）
 * @param exchange  true なら同一性キーが変わったときにタイル源を交換する
 * @returns **反映したか**（url_ ないし url を書いたか）。交換の有無ではない
 */
const refreshRuntimeTileUrl = async (
    requested: string,
    { applyUrl, exchange }: { applyUrl: boolean; exchange: boolean },
): Promise<boolean> => {
    if (requested === lastDerivedUrl) return false;

    // mapUpload と同じ作法: mapData への書き込みは **await の後にまとめて**行う。
    // await より前に書くと、その時点で履歴スナップショットが着地して
    // 「url は新しいが url_ は古い」中間エントリができ、Undo が1回で編集前へ戻らない（実測）。
    const captured = mapData.value;
    const whReady = !!(captured?.width && captured?.height);

    let derived: string | undefined;
    if (whReady) {
        derived = await (window as any).mapedit.deriveRuntimeTileUrl(
            requested,
            mapUid.value || newMapUid,
        );
        // await を跨いで mapData が差し替わっていたら破棄する（後着の処理が正しい状態を作る）
        if (mapData.value !== captured) return false;
        lastDerivedUrl = requested;
    }

    if (applyUrl) mapData.value.url = requested;
    // 寸法未確定（＝タイルがまだ無い）なら url_ は触らない。
    // 入力値そのものは捨てずに保持する（利用者の編集を失わせない）
    if (!whReady) return applyUrl;

    mapData.value.url_ = derived;
    if (exchange && tileIdentityKey(mapData.value) !== illstSourceKey) {
        await exchangeTileSource();
    }
    return true;
};

/**
 * タイルURL欄の確定（blur / Enter）。
 *
 * 入力欄は `v-model` ではなく `:value` + `@change` にしてある。`v-model` の既定は
 * `input` イベントで**キー入力ごとに mapData.url を書く**ため、確定前に履歴エントリが
 * 1つ着地してしまう（そのエントリは url_ が追随する前の中間状態になる）。
 * mapUpload が1回の Undo で戻せるのは、mapData への書き込みが await の後に
 * まとめて起きるからであり、ここも同じ形に揃えた。
 */
const onTileUrlCommitted = async (event: Event) => {
    const next = (event.target as HTMLInputElement).value;
    if (await refreshRuntimeTileUrl(next, { applyUrl: true, exchange: true })) {
        // await を跨いで着地した編集なので明示確定する（mapUpload と同型）
        commitHistorySnapshot();
    }
};

const loadMapTiles = async () => {
    // 旧実装 reflectIllstMap に準拠: mapSourceFactory を使用
    // 非正方形タイル（HistMap）などの設定を適切に処理する
    const source = await exchangeTileSource();
    if (!source) return;

    try {
        console.log('[loadMapTiles] source ready, mapData.gcps:', mapData.value.gcps?.length);

        // illstMapのビュー中心を設定（旧実装 reflectIllstMap に完全準拠）
        // 旧実装は illstView.setCenter(initialCenter) のみ実行し、ビューのプロジェクションは変更しない
        const initialCenter = source.xy2SysCoord([mapData.value.width / 2, mapData.value.height / 2]);
        const illstView = illstMap.getView();
        illstView.setCenter(initialCenter);

        // 旧実装の mapDataCommon フロー（vueMap.setInitialMap(json) 相当）:
        // mapData から gcps/edges/homePosition を反映
        // W2（設計 §5.3.1）: 源が mapData・宛先が ref の再同期（S2）。編集ではない。
        // setTimeout(...,100) 起動 + タイル source 待ちで着地時刻が不定なため、
        // 抑止しないと undo と redo の間に割り込んで redo 枝を破棄しうる（本不具合の主火種）
        withoutHistory('W2', () => {
            if (mapData.value.gcps) gcps.value = mapData.value.gcps;
            if (mapData.value.edges) edges.value = mapData.value.edges;
            if (mapData.value.homePosition) homePosition.value = mapData.value.homePosition;
            if (mapData.value.mercZoom) mercZoom.value = mapData.value.mercZoom;
            if (mapData.value.strictMode) strictMode.value = mapData.value.strictMode;
            if (mapData.value.vertexMode) vertexMode.value = mapData.value.vertexMode;
        });

        // mercMapのビューをGCPのバウンディングボックスに合わせて設定（旧実装 reflectIllstMap に準拠）
        // gcp[1] は既に EPSG:3857 座標（mercMap のクリックで記録）
        const gcpList = gcps.value;
        if (gcpList && gcpList.length > 0) {
            let center: number[], zoom: number;
            if (gcpList.length === 1) {
                center = gcpList[0][1];
                zoom = 16;
            } else {
                const results = gcpList.reduce((prev: any, curr: any, index: number) => {
                    const merc = curr[1];
                    prev[0][0] += merc[0];
                    prev[0][1] += merc[1];
                    if (merc[0] > prev[1][0]) prev[1][0] = merc[0];
                    if (merc[1] > prev[1][1]) prev[1][1] = merc[1];
                    if (merc[0] < prev[2][0]) prev[2][0] = merc[0];
                    if (merc[1] < prev[2][1]) prev[2][1] = merc[1];
                    if (index === gcpList.length - 1) {
                        const c = [prev[0][0] / gcpList.length, prev[0][1] / gcpList.length];
                        const deltax = prev[1][0] - prev[2][0];
                        const z = Math.log(600 / 256 * MERC_MAX * 2 / deltax) / Math.log(2);
                        return [c, z];
                    }
                    return prev;
                }, [[0, 0], [-MERC_MAX, -MERC_MAX], [MERC_MAX, MERC_MAX]]);
                center = results[0];
                zoom = results[1];
            }
            mercMap.getView().setCenter(center);
            mercMap.getView().setZoom(zoom);
        } else if (homePosition.value) {
            // GCPがない場合はhomePosition（EPSG:3857）を使用
            mercMap.getView().setCenter(homePosition.value);
            if (mercZoom.value) mercMap.getView().setZoom(mercZoom.value);
        }

        // マーカーを描画しTINを計算・表示（旧実装の gcpsToMarkers() + tinResultUpdate() 相当）
        gcpsToMarkers();
        // M11-T10 (R6): compiled 種付け済みレイヤーは再計算せず描画のみ行う
        // (compiled は再計算を省くための保存形式。無い/素体文字列のときだけ計算する)
        if (!tinObject.value || typeof tinObject.value === 'string') updateTin();
        else tinResultUpdate();

    } catch (e) {
        console.error('[loadMapTiles] mapSourceFactory でタイル読み込み失敗:', e);
    }
};

// 旧実装 vueMap ウォッチャー相当: gcps/edges/strictMode/vertexMode 変更時に updateTin() を呼び出す
watch(gcps, () => { if (illstSource) updateTin(); }, { deep: true });
watch(edges, () => { if (illstSource) updateTin(); }, { deep: true });
watch(strictMode, (newVal) => { 
    mapData.value.strictMode = newVal;
    if (illstSource) updateTin(); 
});
watch(vertexMode, (newVal) => { 
    mapData.value.vertexMode = newVal;
    if (illstSource) updateTin(); 
});

// auto 状態の有効範囲を地域指定モーダルにガイド表示するための bbox（+5% buffer 済み）
const baseMapRegionFallbackBbox = computed(() => {
    const raw = gcpAutoRange.bbox.value;
    return raw ? expandBboxByRatio(raw, 0.05) : null;
});

const getVisibleBaseMapID = (): string | null => {
    if (!mercMap) return null;
    const rootLayer = mercMap.getLayers().item(0);
    const layers = rootLayer?.get?.('layers') || rootLayer?.getLayers?.();
    if (!layers?.getArray) return null;
    const visibleLayer = layers.getArray().find((layer: any) => layer.getVisible?.());
    return visibleLayer?.get?.('mapID') || null;
};

// 表示設定APIの地図参照 (ADR-0007): 保存済みならuid、未保存はslug(暫定キー。
// 初回保存時にmain側がuidキーへ引き継ぐ)
const baseMapVisibilityMapRef = (): string => mapUid.value || mapID.value;

const loadBaseMapVisibility = async () => {
    if (!baseMapVisibilityMapRef() || !(window as any).mapedit?.getBaseMapVisibilityOfMapID) return;
    baseMapVisibilityLoading.value = true;
    baseMapVisibilityError.value = '';
    try {
        const list = await (window as any).mapedit.getBaseMapVisibilityOfMapID(baseMapVisibilityMapRef());
        baseMapVisibilityList.value = Array.isArray(list) ? list : [];
    } catch (e: any) {
        console.error('[loadBaseMapVisibility] Failed:', e);
        baseMapVisibilityError.value = e?.message || String(e);
    } finally {
        baseMapVisibilityLoading.value = false;
    }
};

const enabledBaseMapData = () => baseMapVisibilityList.value
    .filter((item) => item.enabled)
    .map((item) => item.data);

const refreshBaseMapLayers = async () => {
    baseMapList.value = enabledBaseMapData();
    await setupBaseMaps();
};

const setupBaseMaps = async () => {
    if (!mercMap) return;

    const existingVisibleBaseMapID = getVisibleBaseMapID();
    if (existingVisibleBaseMapID) currentBaseMapID.value = existingVisibleBaseMapID;

    if (baseMapVisibilityList.value.length === 0 && baseMapVisibilityMapRef()) {
        await loadBaseMapVisibility();
    }

    if (baseMapVisibilityList.value.length > 0) {
        baseMapList.value = enabledBaseMapData();
    }

    if (!baseMapList.value.some((tms) => tms.mapID === currentBaseMapID.value)) {
        currentBaseMapID.value = baseMapList.value[0]?.mapID || 'osm';
    }

    // baseMapList が空の場合に取得する
    if (baseMapList.value.length === 0) {

        // 1. IPCを通じてTMSリストを取得（settings/tmsList.json と settings/tmsList.[mapID].json を参照）
        if ((window as any).mapedit && (window as any).mapedit.getTmsListOfMapID && baseMapVisibilityMapRef()) {
            try {
                // @ts-ignore
                const list = await (window as any).mapedit.getTmsListOfMapID(baseMapVisibilityMapRef());
                console.log("MapEdit.vue: Received tms list from IPC", list);
                if (list && list.length > 0) {
                    baseMapList.value = list;
                    console.log("MapEdit.vue: set baseMapList to", baseMapList.value);
                }
            } catch (e) {
                console.error("Failed to fetch base map list via legacy API:", e);
            }
        }
        
        // 2. IPC失敗またはmapIDなし時のフォールバック: ルートのtms_list.jsonを取得
        if (baseMapList.value.length === 0) {
            try {
                const response = await fetch('/tms_list.json');
                if (response.ok) {
                    const json = await response.json();
                    if (Array.isArray(json)) {
                        baseMapList.value = json;
                    }
                }
            } catch (e) {
                console.log("No tms_list.json found at root or failed to load.", e);
            }
        }
        
        // 3. 最終フォールバック: デフォルトベースマップ
        if (baseMapList.value.length === 0) {
            baseMapList.value = [
                { mapID: 'osm', title: 'OpenStreetMap', maxZoom: 18 },
                { mapID: 'gsi', title: 'GSI Maps', maxZoom: 18 },
                { mapID: 'gsi_ortho', title: 'GSI Ortho', maxZoom: 18 }
            ];
        }
    }

    const layers = await Promise.all([...baseMapList.value].reverse().map(async (tms) => {
        let source;
        const localizedMeta = resolveBaseMapLayerMetadata(tms, currentLang.value);
        try {
            if (['osm', 'gsi', 'gsi_ortho'].includes(tms.mapID)) {
                source = await mapSourceFactory(tms.mapID, {});
            } else {
                 source = await mapSourceFactory({
                     mapID: tms.mapID || 'custom',
                     url: tms.url,
                     attr: localizedMeta.attr,
                     maptype: 'base',
                     maxZoom: tms.maxZoom || 18,
                     minZoom: tms.minZoom || 0
                 }, {});
            }
        } catch (e) {
            console.error(`Failed to create source for ${tms.mapID}:`, e);
            return null;
        }

        if (!source) return null;

        // 旧実装: source.setAttributions(attr) - mapSourceFactory 側で通常処理される
        
        return new Tile({
            source: source,
            properties: {
                title: localizedMeta.title,
                mapID: tms.mapID,
                type: 'base'
            },
            visible: tms.mapID === (currentBaseMapID.value || 'osm')
        });
    }));

    const validLayers = layers.filter(l => l !== null);

    const layerGroup = new Group({
        properties: {
            title: t('mapedit.control_basemap') || 'Base Maps',
        },
        layers: validLayers
    });

    const mapLayers = mercMap.getLayers();
    // インデックス0（デフォルトベースレイヤー）をグループに置き換え
    mapLayers.setAt(0, layerGroup);
};

/*
const changeBaseMap = async () => {
    // 廃止: LayerSwitcher がベースマップ切り替えを処理する
};
*/

// =========================================================
// ProgressModal: 旧実装の vueModal 相当
// vueModal.show() / .progress() / .finish() / .hide() を
// Vue 3 のリアクティブ state として再実装
// =========================================================
const modalVisible = ref(false);
const modalText = ref('');
// M5-T6: modalText と対になる i18n 補間パラメータ。
// 更新は必ず**オブジェクトごと差し替える**（プロパティ単位で書き換えると ref の参照が
// 変わらず ProgressModal 側の computed が再評価されない）
const modalTextParams = ref<Record<string, unknown> | undefined>(undefined);
const modalPercent = ref(0);
const modalProgressText = ref('');
const modalEnableClose = ref(false);

/** vueModal.show(text) 相当 */
const modalShow = (textKey: string, params?: Record<string, unknown>) => {
    modalText.value = textKey;
    modalTextParams.value = params;
    modalPercent.value = 0;
    modalProgressText.value = '';
    modalEnableClose.value = false;
    modalVisible.value = true;
};
/** vueModal.progress(text, percent, progressText) 相当 — IPC progress イベントから呼ぶ */
const modalProgress = (textKey: string, percent: number, progressText: string, params?: Record<string, unknown>) => {
    modalText.value = textKey;
    modalTextParams.value = params;
    modalPercent.value = percent;
    modalProgressText.value = progressText;
};
/** vueModal.finish(text) 相当 — 処理完了時に呼ぶ */
const modalFinish = (textKey: string, params?: Record<string, unknown>) => {
    modalText.value = textKey;
    // オブジェクトごと差し替える（§10 のリアクティビティ設計）
    modalTextParams.value = params;
    modalEnableClose.value = true;
};
/** vueModal.hide() 相当 — OK ボタンクリック or 自動非表示 */
const modalHide = () => {
    modalVisible.value = false;
};

/**
 * 旧実装: $emit('mapUpload') → vueMap.$on('mapUpload') 相当
 * GCPが存在する場合は確認ダイアログを表示してからアップロード
 *
 * 旧実装の処理:
 * 1. GCPがある場合: 上書き確認ダイアログ
 * 2. vueModal.show(t('mapedit.image_uploading'))
 * 3. window.mapupload.showMapSelectDialog(t('mapupload.map_image'))
 * 4. 結果受信後: mapData更新 → loadMapTiles() → gcpsToMarkers() → updateTin()
 */
const mapUpload = async () => {
    // GCPが存在する場合: 上書き確認（旧実装: vueMap.gcpsEditReady 相当）
    const hasGcps = gcpsEditReady.value;
    if (hasGcps) {
        const confirm = await (window as any).dialog.showMessageBox({
            type: 'info',
            buttons: ['OK', 'Cancel'],
            cancelId: 1,
            message: t('mapedit.confirm_override_image')
        });
        if (confirm.response === 1) return;
    }

    // プログレスモーダル表示
    modalShow('mapedit.image_uploading');

    // taskProgress リスナー登録
    const unsubscribe = window.mapedit.onProgress((progress) => {
        modalProgress(progress.text, progress.percent, progress.progress);
    });

    try {
        // 旧実装: window.mapupload.showMapSelectDialog(t('mapupload.map_image'))
        // M12-T20 (§5.1): 下書きの asset uid（3529行の asset-uid / 1988行の draft キーと同一値）を
        // 渡し、staging を <draftTileRoot>/<assetUid> に per-draft 化する
        const invokeUpload = (confirmed?: boolean) =>
            (window as any).mapupload.showMapSelectDialog(
                t('mapupload.map_image'),
                mapUid.value || newMapUid,
                confirmed,
            );
        let arg = await invokeUpload();

        // M5-T8 (§5.6/§5.7): 取り込み前の確認。**同じ IPC へ confirmed を載せて再送**する
        // （useRevisionedAssetSave の revision 衝突と同形）。main が選択を保持しているため
        // ファイル選択ダイアログは再表示されない。この時点でデコードもタイル化も、
        // staging dir のクリアすらまだ起きていないので、キャンセルの後始末は不要である。
        if (arg.needsConfirmation === 'long_import') {
            const confirmLong = await (window as any).dialog.showMessageBox({
                type: 'info',
                buttons: ['OK', 'Cancel'],
                cancelId: 1,
                message: t('mapedit.confirm_long_image_import', {
                    megapixels: Math.round(arg.megapixels),
                }),
            });
            if (confirmLong.response === 1) {
                modalHide();
                return;
            }
            arg = await invokeUpload(true);
        }

        if (arg.err) {
            if (arg.err !== 'Canceled') {
                console.error('[mapUpload] Error:', arg.err);
                // M5-T6 (§6.1): 分岐鍵は arg.prediction の有無。
                // prediction は「全部入りか無しか」なので、あれば数値は揃っている。
                // 無い場合（予測できなかった失敗）は従来どおり汎用文言へ落とす。
                // 英文メッセージの文字列 parse は renderer では行わない（main 側で errorCode 化済み）。
                if (arg.errorCode === 'jpeg_machine_limit') {
                    // M5-T8: この機械では構造的に扱えない。machine は「全部入りか無しか」で
                    // あり、この errorCode のときは必ず揃っている（設計 §6.2）
                    modalFinish('mapedit.error_image_machine_limit', {
                        megapixels: Math.round(arg.machine.megapixels),
                        required: arg.machine.requiredHeapMB,
                        available: arg.machine.availableHeapMB,
                    });
                } else if (arg.errorCode === 'jpeg_memory_limit' && arg.prediction) {
                    modalFinish('mapedit.error_image_memory_limit', {
                        required: arg.prediction.requiredMemoryMB,
                        configured: arg.configuredMB,
                        recommended: arg.prediction.recommendedMemoryMB,
                    });
                } else if (arg.errorCode === 'jpeg_resolution_limit' && arg.prediction) {
                    modalFinish('mapedit.error_image_resolution_limit', {
                        megapixels: Math.round(arg.prediction.megapixels),
                        configured: arg.configuredMP,
                        recommended: arg.prediction.recommendedResolutionMP,
                    });
                } else {
                    modalFinish('mapedit.error_image_upload');
                }
            } else {
                // キャンセル: モーダルを閉じる
                modalHide();
            }
        } else {
            modalFinish('mapedit.success_image_upload');
            // 旧実装: vueMap.width/height/url_/imageExtension の更新
            mapData.value.width = arg.width;
            mapData.value.height = arg.height;
            mapData.value.url_ = arg.url;
            // 旧実装: jpg の場合は imageExtension を undefined に
            if (arg.imageExtension === 'jpg') {
                mapData.value.imageExtension = undefined;
            } else {
                mapData.value.imageExtension = arg.imageExtension;
            }
            // U17（設計 §5.5）: await を跨いで着地した編集。直後に W2 を内包する
            // loadMapTiles() へ入るため、ここで明示確定しないと履歴に残らない
            commitHistorySnapshot();
            // 旧実装: reflectIllstMap() → gcpsToMarkers() → updateTin()
            await loadMapTiles();
            gcpsToMarkers();
            updateTin();
        }
    } finally {
        unsubscribe();
    }
};

/**
 * 旧実装: vueMap.$on('saveMap') 相当 (ADR-0007: uid正準 + revision楽観ロック)
 * 1. 確認ダイアログ
 * 2. 予約再確認 (M11-T7 confirmForSave。改名は UID 維持の slug 付け替え = AC5、
 *    複製化確認ダイアログは撤去。複製は T10 の専用導線が copyFromUid 経路を再利用する)
 * 3. mapedit:save IPC を { mapObject, tins, uid?, slug, expectedRevision?, copyFromUid?,
 *    renameFromSlug?, create? } で呼ぶ
 * 4. 成功反映・revision-conflict(読み直す/上書き)・部分成功 Error{revision} の引き継ぎは
 *    useRevisionedAssetSave (saveHandle) が共通処理する
 */
let mapSaveSucceeded = false;
// M11-T10 (人間検証R6): 確認後〜performSave 開始までの準備区間(予約再確認・TIN計算待ち)も
// Busy カバー対象にする。saving(useRevisionedAssetSave) は performSave 中しか立たないため
const preparingSave = ref(false);
const saveMap = async (): Promise<boolean> => {
    if (preparingSave.value || saving.value) return false; // 準備区間の再入防止
    mapSaveSucceeded = false;
    saveOperationError.value = null;
    // 1. 保存確認ダイアログ（旧実装: t('mapedit.confirm_save')）
    const confirmResult = await (window as any).dialog.showMessageBox({
        type: 'info',
        buttons: ['OK', 'Cancel'],
        cancelId: 1,
        message: t('mapedit.confirm_save')
    });
    if (confirmResult.response === 1) return false; // キャンセル

    preparingSave.value = true;
    try {
        return await saveMapAfterConfirm();
    } finally {
        preparingSave.value = false;
    }
};

const saveMapAfterConfirm = async (): Promise<boolean> => {
    // 2. M11-T7: 保存直前の予約再確認(§7.1 confirmForSave)。他者予約なら保存中断(D7)
    const slugOk = await slugField.value?.confirmForSave() ?? true;
    if (!slugOk) {
        // M11-T7/AC8: 予約 conflict は operation 診断で保存中断(D7)
        saveOperationError.value = t('mapedit.error_duplicate_id');
        return false;
    }

    // M11-T10 (人間検証R5): 複製直後は dirty 即保存が可能なため、TIN 計算完了前に保存すると
    // compiled が失われ store が gcps 素体へ劣化する。未計算なら現在レイヤーの計算を起動し、
    // 進行中の計算の完了を待ってから tins を収集する。
    if (tinObject.value == null && (gcps.value?.length ?? 0) >= 3) {
        await updateTin({ force: true });
    }
    await waitForTinComputeIdle();

    // 保存する値を作成（mapDataのコピー）
    const saveValue = cloneDeep(mapData.value);

    // uid正準の宛先: 既存地図は uid 宛の upsert(改名も同一 uid の slug 付け替え)、
    // 新規は create。copyFromUid 保存経路は温存(導線は T10 複製で再利用)
    const sendUid: string | undefined = mapUid.value ?? undefined;
    // M11-T10: duplicateFrom で複製した場合、copyFromUid に元地図 UID を設定
    const copyFromUid: string | undefined = copyFromUidSource.value || undefined;

    // 3. tins 収集（旧実装: vueMap.tinObjects.map(tin => tin.getCompiled())）
    const tins = tinObjects.value.map((tin: any) => {
        if (!tin || typeof tin === 'string') return tin || 'tooLessGcps';
        return tin.getCompiled();
    });

    // 4. 送信内容を send クロージャへ渡し、共通保存フロー (useRevisionedAssetSave) を実行。
    // pendingSave は意図的に clear しない: send/applySuccess は「最後に saveMap が確定した
    // 送信内容」を参照し続ける必要がある (途中で null に戻すと保存フロー中の参照が壊れる。
    // AppEdit も clear していないのと対称)
    pendingSave = { saveValue, tins, sendUid, copyFromUid };
    if (sendUid) {
        await performSave(); // expectedRevision は handle.revision
    } else {
        // 新規作成・copy 保存は revision チェック対象外
        // (旧実装: sendUid ? revision.value : undefined)
        await performSave({ expectedRevision: undefined });
    }
    return mapSaveSucceeded;
};

/**
 * revision-conflict 後の「読み直す」: 最新の保存済み状態をuidで再取得して編集状態を置き換える
 */
const reloadFromStore = async () => {
    if (!mapUid.value) return;
    try {
        const data = await (window as any).mapedit.request(mapUid.value);
        if (!data) return;
        const reloadCompiledTins = extractCompiledTins(data);
        if (!data.status) data.status = 'Update';
        // wmtsFolder は request 結果に含まれないため現在値を引き継ぐ
        data.wmtsFolder = mapData.value.wmtsFolder;
        adoptLoaded({ uid: data.uid ?? mapUid.value, slug: data.mapID, revision: data.revision });
        mapID.value = data.mapID;
        setMapDocument(data);
        originalMapData.value = cloneDeep(mapData.value);
        sub_maps.value = cloneDeep(data.sub_maps || []);
        currentEditingLayer.value = 0;
        gcps.value = cloneDeep(data.gcps || []);
        edges.value = cloneDeep(data.edges || []);
        homePosition.value = data.homePosition;
        mercZoom.value = data.mercZoom;
        strictMode.value = data.strictMode || 'strict';
        vertexMode.value = data.vertexMode || 'plain';
        tinObjects.value = Array(1 + sub_maps.value.length).fill(undefined);
        seedTinObjects(reloadCompiledTins);
        editingID.value = '';
        newGcp.value = undefined;
        newlyAddEdge.value = undefined;
        resetHistoryBase();
        await nextTick();
        if (data.url_) await loadMapTiles();
        gcpsToMarkers();
        // M11-T10 (R6): compiled 種付け済みなら再計算せず描画のみ
        if (!tinObject.value || typeof tinObject.value === 'string') updateTin();
        else tinResultUpdate();
    } catch (e) {
        console.error('[reloadFromStore] Failed to reload map data:', e);
    }
};

const discardRestoredDraft = async () => {
    if (!draftLifecycle.draftRestored.value) return;
    // 新規(未保存)地図の下書き: 破棄=完全削除でセーブポイントが存在しないため、
    // 削除後は編集対象が無くなり一覧へ戻る(hot-exit flush を通すと下書きが
    // 再保存されるため、flush せず直接遷移する。AppEdit と同型)
    if (!mapUid.value) {
        const name = displayTitle.value || mapData.value.mapID || t('editor_ui.draft_badge');
        const result = await (window as any).dialog.showMessageBox({
            type: 'warning',
            buttons: [t('editor_ui.delete_draft'), t('common.cancel')],
            defaultId: 1,
            cancelId: 1,
            message: t('editor_ui.delete_draft_confirm', { name }),
        });
        if (result.response !== 0) return;
        await draftLifecycle.discard();
        await router.push({ name: 'MapList' });
        return;
    }
    const result = await (window as any).dialog.showMessageBox({
        type: 'warning',
        buttons: [t('editor_ui.discard_draft'), t('common.cancel')],
        defaultId: 1,
        cancelId: 1,
        message: t('editor_ui.discard_draft_confirm'),
    });
    if (result.response !== 0) return;
    await draftLifecycle.discard();
    await reloadFromStore();
};

// A-3: エラー点の順送り表示
// 旧実装 mapedit.js L.1686-1700 に準拠
const viewError = () => {
    const tin = tinObject.value;
    if (!tin || typeof tin !== 'object') return;
    const kinks = tin.kinks?.bakw?.features;
    if (!kinks || kinks.length === 0) return;
    if (errorNumber.value === null) {
        errorNumber.value = 0;
    } else {
        errorNumber.value = (errorNumber.value + 1) % kinks.length;
    }
    const errorPoint = kinks[errorNumber.value].geometry.coordinates;
    const view = mercMap.getView();
    view.setCenter(errorPoint);
    view.setZoom(17);
};

// --- サブマップ操作メソッド ---
const addSubMap = () => {
    const width = Number(mapData.value.width) || 0;
    const height = Number(mapData.value.height) || 0;
    sub_maps.value.push({
        gcps: [],
        edges: [],
        priority: sub_maps.value.length + 1,
        importance: sub_maps.value.length + 1,
        bounds: [[0, 0], [width, 0], [width, height], [0, height]]
    });
    // 旧実装: this.tinObjects.push('') 相当
    tinObjects.value.push(undefined);
    // watcher 経由で mapData.value.sub_maps をリアクティブに更新させる
    currentEditingLayer.value = sub_maps.value.length;
    normalizeImportance(importanceSortedSubMaps.value);
    normalizePriority(prioritySortedSubMaps.value);
};

const removeSubMap = async () => {
    if (currentEditingLayer.value === 0) return;
    
    // 旧実装 mapedit.js L.1701-1710 に準拠: t('mapedit.confirm_layer_delete') を使用
    const confirmResult = await (window as any).dialog.showMessageBox({
        type: 'info',
        buttons: ['OK', 'Cancel'],
        cancelId: 1,
        message: t('mapedit.confirm_layer_delete')
    });
    if (confirmResult.response === 1) return;

    const index = currentEditingLayer.value - 1;
    currentEditingLayer.value = 0;
    sub_maps.value.splice(index, 1);
    // 旧実装: this.tinObjects.splice(index+1, 1) 相当（サブマップはインデックス1以降）
    tinObjects.value.splice(index + 1, 1);

    normalizeImportance(importanceSortedSubMaps.value);
    normalizePriority(prioritySortedSubMaps.value);
};

const upImportance = () => {
    if (!canUpImportance.value) return;
    const arr = [...importanceSortedSubMaps.value];
    const target = currentEditingLayer.value === 0 ? 0 : sub_maps.value[currentEditingLayer.value - 1];
    const index = arr.indexOf(target);
    arr.splice(index - 1, 2, arr[index], arr[index - 1]);
    normalizeImportance(arr);
};

const downImportance = () => {
    if (!canDownImportance.value) return;
    const arr = [...importanceSortedSubMaps.value];
    const target = currentEditingLayer.value === 0 ? 0 : sub_maps.value[currentEditingLayer.value - 1];
    const index = arr.indexOf(target);
    arr.splice(index, 2, arr[index + 1], arr[index]);
    normalizeImportance(arr);
};

const upPriority = () => {
    if (!canUpPriority.value) return;
    const arr = [...prioritySortedSubMaps.value];
    const index = arr.indexOf(sub_maps.value[currentEditingLayer.value - 1]);
    arr.splice(index - 1, 2, arr[index], arr[index - 1]);
    normalizePriority(arr);
};

const downPriority = () => {
    if (!canDownPriority.value) return;
    const arr = [...prioritySortedSubMaps.value];
    const index = arr.indexOf(sub_maps.value[currentEditingLayer.value - 1]);
    arr.splice(index, 2, arr[index + 1], arr[index]);
    normalizePriority(arr);
};
// 旧実装 map.js L.460-468: QGIS GeoReferencer のデフォルト設定を適用
// M12-T22: 休眠パネル専用（削除禁止・M12-T23で再編予定）
const csvQgisSetting = () => {
    csvUploadUiValue.value = Object.assign({}, csvUploadUiValue.value, {
        pixXColumn: 1,
        pixYColumn: 2,
        lngColumn: 3,
        latColumn: 4,
        ignoreHeader: 2,
        reverseMapY: true,
    });
};

// 旧実装: vueMap._updateWholeGcps(gcps) 相当
// M12-T22: 休眠パネル専用（削除禁止・M12-T23で再編予定）
// CSV/インポートで GCP を一括設定する
const updateWholeGcps = (newGcps: any[]) => {
    if (currentEditingLayer.value === 0) {
        gcps.value = cloneDeep(newGcps);
        mapData.value.gcps = newGcps;
        edges.value = [];
        mapData.value.edges = [];
    } else if (sub_maps.value.length > 0) {
        sub_maps.value[currentEditingLayer.value - 1].gcps = cloneDeep(newGcps);
        sub_maps.value[currentEditingLayer.value - 1].edges = [];
    }
};

// 旧実装: vueMap.$on('importMap') 相当
// 有効条件: !dirty && status === 'New'
const importMap = async () => {
    modalShow('mapedit.image_uploading');
    const unsubscribe = window.mapedit.onProgress((progress) => {
        modalProgress(progress.text, progress.percent, progress.progress);
    });
    try {
        const arg = await (window as any).dataupload.showDataSelectDialog();

        if (arg.err) {
            if (arg.err === 'Canceled') {
                modalHide();
            } else if (arg.err === 'Exist') {
                modalFinish('dataupload.error_exist');
            } else if (arg.err === 'NoTile') {
                modalFinish('dataupload.error_no_tile');
            } else if (arg.err === 'NoTmb') {
                modalFinish('dataupload.error_no_tmb');
            } else {
                console.error('[importMap]', arg.err);
                modalFinish('dataupload.error_upload');
            }
        } else {
            modalFinish('dataupload.success_upload');
            // 旧実装: mapDataCommon(arg[0], arg[1]) 相当
            const { mapData: histMap, tins: compiledTins } = arg;
            // インポートで新規作成された地図のuid/revision/slugを正本として追跡 (ADR-0007)
            adoptLoaded({ uid: histMap.uid, slug: histMap.mapID, revision: histMap.revision });
            mapID.value = histMap.mapID;
            setMapDocument(histMap);
            originalMapData.value = cloneDeep(mapData.value);
            sub_maps.value = cloneDeep(histMap.sub_maps || []);
            gcps.value = cloneDeep(histMap.gcps || []);
            edges.value = cloneDeep(histMap.edges || []);
            homePosition.value = histMap.homePosition;
            mercZoom.value = histMap.mercZoom;
            strictMode.value = histMap.strictMode || 'strict';
            vertexMode.value = histMap.vertexMode || 'plain';
            // TIN インスタンスを生成（旧実装: vueMap.tinObjects = tins.map(...)）
            if (compiledTins && compiledTins.length > 0) {
                tinObjects.value = compiledTins.map((compiled: any) => {
                    if (typeof compiled === 'string') return compiled;
                    const tin = new Tin(TIN_V2_OPTIONS);
                    tin.setCompiled(compiled);
                    return tin;
                });
            } else {
                tinObjects.value = Array(1 + sub_maps.value.length).fill(undefined);
            }
            // タイル・マーカー反映
            if (histMap.url_) await loadMapTiles();
            gcpsToMarkers();
            // M3-T6 §5.2 (AC6-2): 非参照 object 要素 (地図内定義型 POI) を含む zip のインポート
            // 成功時にアラートを出す (既存 info ダイアログ文法)。検出は object のみ — URL 文字列は
            // 変換導線が存在しないため対象外 (案内先のない要素で出すのは誤誘導になる)。
            // 既存 DB 内データへの遡及通知は行わない (zip インポート時のみ)
            if (Array.isArray(histMap.pois) && histMap.pois.some(isNonReferenceObjectEntry)) {
                await (window as any).dialog.showMessageBox({
                    type: 'info', buttons: ['OK'],
                    message: t('mapedit.import_inline_poi_alert')
                });
            }
            // M5-T4B (人間検証 2026-08-03): 取込のホストになった新規エディタの下書きを畳む。
            //
            // 取込導線は /mapedit?new=1&import=1 で **新規エディタ**を開くため、mount 時に
            // newMapUid が採番され draftLifecycle がその identity で開かれる。取込が成功すると
            // adoptLoaded がサーバ採番 uid を正本に引き取るが、identity は newMapUid のままで、
            // かつ **履歴が dirty のまま**残る。∴ debounce 後の下書き書き込みが走り、
            // 取り込んだ地図とは別に baseRevision:null の下書き（＝一覧に下書きカードとして出る）
            // が1件生まれていた。実測では取込完了の約1.8秒後に出現する。
            //
            // 保存経路 (:174-183) が M12-T29 で確立した
            //   originalMapData 更新 → markHistorySaved → markSaved → rebase → flush
            // と同一手順を踏む。originalMapData は上で更新済みのため残り4つをここで行う。
            // markHistorySaved を省くと dirty が残り、rebase 後の identity で
            // 「保存済み地図の下書き」が書かれてしまう（実測で確認済み）。
            markHistorySaved();
            await draftLifecycle.markSaved();
            draftLifecycle.rebase(histMap.uid, histMap.revision);
            await draftLifecycle.flush();
        }
    } finally {
        unsubscribe();
    }
};

const chooseMapExport = async (hasSaved: boolean) => {
    const buttons = hasSaved
        ? [
            t('editor_ui.export_save_and_run'),
            t('editor_ui.export_saved_only'),
            t('common.cancel'),
        ]
        : [t('editor_ui.export_save_and_run'), t('common.cancel')];
    const result = await (window as any).dialog.showMessageBox({
        type: 'info',
        buttons,
        cancelId: buttons.length - 1,
        message: t('editor_ui.export_dirty_prompt'),
    });
    if (result.response === 0) return 'save' as const;
    if (hasSaved && result.response === 1) return 'saved' as const;
    return 'cancel' as const;
};

// 保存済み正本だけを入力にし、編集中state/draftを直接出力しない。
// M13-T1 (§2.8): previewSource()(strict throw あり)+download() の2段呼び出しから、
// strict-freeな新IPC mapedit:download-saved(mapRef) の単一呼び出しへ切替える。
// tins組み立てロジックはserver側(MapPurposeService.downloadSavedMap())へ移管したため削除
const downloadSavedMap = async (): Promise<boolean> => {
    if (!mapUid.value) return false;
    modalShow('editor_ui.busy_exporting');
    const unsubscribe = window.mapedit.onProgress((progress) => {
        modalProgress(progress.text, progress.percent, progress.progress);
    });
    try {
        const result = await window.mapedit.downloadSaved(mapUid.value);
        if (result === 'Success') {
            modalFinish('mapedit.export_success');
            return true;
        } else if (result === 'Canceled') {
            modalFinish('mapedit.imexport_canceled');
        } else {
            console.error('[exportMap]', result);
            modalFinish('mapedit.export_error');
        }
        return false;
    } catch (e) {
        // 防御的catch(v1.2追加: t1 review v2 Minor2対応)。
        // MapPurposeService.downloadSavedMap()は契約上reject しないが、
        // ipcRenderer.invoke('mapedit:download-saved', ...)自体はIPC基盤レベル
        // (HMRによるhandler未登録の隙間等)で reject し得るため、その場合に
        // 進捗モーダルが開いたまま残留することを防ぐ保険として維持する。
        console.error('[exportMap]', e);
        modalFinish('mapedit.export_error');
        return false;
    } finally {
        unsubscribe();
    }
};

const exportMap = async () => {
    if (exporting.value || saving.value) return;
    exporting.value = true;
    try {
        await runEditorExportDecision({
            dirty: isDirty.value,
            hasSaved: !!mapUid.value,
            choose: chooseMapExport,
            save: saveMap,
            exportSaved: downloadSavedMap,
        });
    } finally {
        exporting.value = false;
    }
};

// 旧実装: vueMap.$on('wmtsGenerate') 相当
// M12-T22: 休眠パネル専用（削除禁止・M4-(2)へ転用予定）
// 有効条件: wmtsEditReady
const wmtsGenerate = async () => {
    if (!tinObjects.value[0] || typeof tinObjects.value[0] === 'string') return;
    modalShow('wmtsgenerate.generating_tile');
    const unsubscribe = window.mapedit.onProgress((progress) => {
        modalProgress(progress.text, progress.percent, progress.progress);
    });
    try {
        // 旧実装: window.wmtsGen.generate(vueMap.mapID, vueMap.width, vueMap.height, vueMap.tinObjects[0].getCompiled(), vueMap.imageExtension, vueMap.mainLayerHash)
        // M13-T2 (§5.4): uid を先頭引数に追加 (canonical-first runtime read に必要)
        const arg = await (window as any).wmtsGen.generate(
            mapData.value.uid,
            mapData.value.mapID,
            mapData.value.width,
            mapData.value.height,
            JSON.parse(JSON.stringify(tinObjects.value[0].getCompiled())),
            mapData.value.imageExtension || 'jpg',
            mainLayerHash.value
        );
        if (arg.err) {
            console.error('[wmtsGenerate]', arg.err);
            modalFinish('wmtsgenerate.error_generation');
        } else {
            // 旧実装: vueMap.wmtsHash = arg.hash
            mapData.value.wmtsHash = arg.hash;
            // U22（設計 §5.5）: await を跨いで着地した編集の明示確定
            commitHistorySnapshot();
            modalFinish('wmtsgenerate.success_generation');
        }
    } finally {
        unsubscribe();
    }
};

// 旧実装: vueMap.$on('uploadCsv') 相当
// M12-T22: 休眠パネル専用（削除禁止・M12-T23で再編予定）
const uploadCsv = async () => {
    if (gcps.value.length > 0) {
        const confirm = await (window as any).dialog.showMessageBox({
            type: 'info',
            buttons: ['OK', 'Cancel'],
            cancelId: 1,
            message: t('dataio.csv_override_confirm')
        });
        if (confirm.response === 1) return;
    }
    // 旧実装: window.mapedit.uploadCsv(t('dataio.csv_file'), vueMap.csvUploadUiValue, [layer, bounds, strict, vertex])
    const arg = await (window as any).mapedit.uploadCsv(
        t('dataio.csv_file'),
        JSON.parse(JSON.stringify(csvUploadUiValue.value))
    );
    if (arg.err) {
        const message = arg.err === 'Canceled'
            ? t('mapedit.imexport_canceled')
            : `${t('dataio.error_occurs')}: ${t(`dataio.${arg.err}`)}`;
        await (window as any).dialog.showMessageBox({
            type: 'info',
            buttons: ['OK'],
            message
        });
        return;
    }
    if (arg.gcps) {
        updateWholeGcps(arg.gcps);
        gcpsToMarkers();
        updateTin();
    }
};

const goBack = async () => {
    await draftLifecycle.flush();
    // m12-t31: 一覧への遷移は navigateBackToList（router.push 一本）に統一する
    // （preview iframe 内の Maplat viewer が joint session history を汚染するため）。
    await navigateBackToList(router, '/maplist');
};

</script>

<template>
    <div class="d-flex flex-column h-100 text-start">
        <DraftConflictDialog
            :visible="!!draftLifecycle.conflictDraft.value"
            @discard="draftLifecycle.resolveConflict('discard')"
            @apply="applyConflictDraft"
        />

        <!-- ProgressModal: 旧実装の #staticModal 相当 -->
        <ProgressModal
            :visible="modalVisible"
            :text="modalText"
            :text-params="modalTextParams"
            :percent="modalPercent"
            :progress-text="modalProgressText"
            :enable-close="modalEnableClose"
            @close="modalHide"
        />
        <!-- M11-T10 (R6): 保存準備区間(予約再確認・TIN計算待ち)もカバーする -->
        <EditorBusyOverlay
            :visible="saving || preparingSave || exporting"
            :label="saving || preparingSave ? t('editor_ui.save_state.saving') : t('editor_ui.busy_exporting')"
        />

        <EditorActionHeader
            :title="displayTitle"
            :save-state="saveState"
            :active-lang="currentLang"
            :language-options="SUPPORTED_LANGUAGES"
            :can-undo="canUndo"
            :can-redo="canRedo"
            :save-disabled="!!saveError || !isDirty"
            :saving="saving"
            :actions-disabled="exporting"
            :discard-draft-visible="saveState === 'draft-restored'"
            @back="goBack"
            @update:active-lang="currentLang = $event"
            @undo="performUndo"
            @redo="performRedo"
            @save="saveMap"
            @discard-draft="discardRestoredDraft"
        >
            <template #actions="{ disabled }">
                <button
                    type="button"
                    class="btn btn-sm btn-outline-primary"
                    data-editor-action="export"
                    :disabled="disabled || exporting"
                    @click="exportMap"
                >
                    {{ t("editor_ui.export_button") }}
                </button>
            </template>
        </EditorActionHeader>

        <!-- M11-T7/AC8: 保存 operation エラー(予約 conflict/ID 重複/保存失敗)は
             DiagnosticFeedback scope="operation"(旧 error ダイアログから移行) -->
        <DiagnosticFeedback
            v-if="saveOperationError"
            scope="operation"
            dismissible
            :items="[{ key: 'save-error', severity: 'danger', message: saveOperationError }]"
            @dismiss="saveOperationError = null"
        />
        <!-- M12-T1: 対応線操作のエラー（EDGE_NOT_FOUND/ZERO_LENGTH）は operation 診断で表示 -->
        <DiagnosticFeedback
            v-if="edgeOperationError"
            scope="operation"
            dismissible
            :items="[{ key: 'edge-error', severity: 'danger', message: edgeOperationError }]"
            @dismiss="edgeOperationError = null"
        />

        <!-- 2. Tabs (M11-T7/AC9: EditorTabs primitive + §9 語彙。gcpsEditReady の
             disabled/aria/tabindex は EditorTabs の disabled 機構が担う) -->
        <div class="px-4 mt-2">
            <EditorTabs
                :model-value="activeTab"
                :tabs="[
                    { key: 'metadata', labelKey: 'editor_ui.tabs.metadata' },
                    { key: 'gcps', labelKey: 'editor_ui.tabs.gcps', disabled: !gcpsEditReady, disabledReasonKey: 'editor_ui.tabs.gcps_requires_image', testid: 'map-tab-gcps' },
                    { key: 'settings', labelKey: 'editor_ui.tabs.base_maps', testid: 'map-tab-settings' },
                    { key: 'pois', labelKey: 'editor_ui.tabs.pois', testid: 'map-tab-pois' },
                ]"
                @update:model-value="activeTab = $event"
            />
        </div>

        <!-- 3. Main Content Area -->
        <div class="flex-grow-1 position-relative overflow-hidden bg-white border-top">
            
            <!-- Tab: Metadata (Full Page Form) -->
            <div v-show="activeTab === 'metadata'" class="h-100 overflow-auto p-3">
                <form class="container-fluid" @submit.prevent>
                    <!-- Row 1 (M11-T7/AC7・§18b決定2): 先頭は タイトル → スラッグ (ID) → デフォルト言語 -->
                    <div class="row g-1 mb-2">
                        <div class="col-md-5">
                            <div class="form-label fw-bold small mb-0 d-flex align-items-center gap-1">{{ t("mapedit.map_name_repr") }} <LangValueChips :model-value="mapData.title" :active-lang="currentLang" :default-lang="mapData.lang || 'ja'" :language-options="SUPPORTED_LANGUAGES" @select-language="selectEditorLanguage" /> <ContextHelp :text="t('mapedit.map_name_repr_desc')" :ariaLabel="t('mapedit.map_name_repr_desc')" /></div>
                            <input data-testid="map-title" type="text" class="form-control form-control-sm" :class="saveError?.title ? 'is-invalid' : ''" v-model="title" :placeholder="t('mapedit.map_name_repr_pf')">
                            <!-- M11-T10 (人間検証R4): field エラーは共通 DiagnosticFeedback(赤・(i)付き)で表示 -->
                            <DiagnosticFeedback v-if="saveError?.title" scope="field" :items="[{ key: 'title-required', severity: 'danger', message: saveError.title }]" />
                        </div>
                        <!-- Map ID フィールド (M11-T7/AC1/AC5): 共通 SlugField(可用性診断+予約 lifecycle 内蔵)。
                             手動一意性確認ボタンは撤去。改名は UID 維持の slug 付け替え(保存時に
                             renameFromSlug で原本改名の残作業を引き継ぐ) -->
                        <div class="col-md-4">
                            <SlugField
                                ref="slugField"
                                :model-value="mapData.mapID ?? ''"
                                asset-kind="map"
                                :asset-uid="mapUid || newMapUid"
                                :draft-uid="mapUid || newMapUid"
                                :original-slug="confirmedSlug"
                                :required="true"
                                :disabled="translationMode"
                                input-testid="map-slug"
                                @update:model-value="onMapIDLiveInput"
                                @state-change="slugFieldState = $event"
                            />
                        </div>
                        <div class="col-md-3">
                            <label class="form-label fw-bold small mb-0" for="mapDocumentLanguage">
                                {{ t("editor_ui.default_lang_label") }}
                            </label>
                            <select
                                id="mapDocumentLanguage"
                                class="form-select form-select-sm"
                                data-editor-document-language
                                :value="mapData.lang || 'ja'"
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
                        <div class="col-md-2">
                             <label class="form-label fw-bold small mb-0">{{ t("mapedit.image_width") }}</label>
                             <input type="number" class="form-control form-control-sm" v-model="mapData.width" disabled>
                        </div>
                         <div class="col-md-2">
                             <label class="form-label fw-bold small mb-0">{{ t("mapedit.image_height") }}</label>
                             <input type="number" class="form-control form-control-sm" v-model="mapData.height" disabled>
                        </div>
                         <!-- 旧実装 mapedit.html L.82: v-model="imageExtensionCalc" (computed, read-only) に準拠 -->
                         <div class="col-md-1">
                             <label class="form-label fw-bold small mb-0">{{ t("mapedit.extension") }}</label>
                             <input type="text" class="form-control form-control-sm" :value="imageExtensionCalc" disabled>
                        </div>
                         <div class="col-md-2 d-flex align-items-start pt-4">
                            <button class="btn btn-outline-secondary btn-sm w-100 mt-1"
                                    @click="mapUpload"
                                    :disabled="translationMode">{{ t("mapedit.upload_map") }}</button>
                        </div>
                    </div>

                    <!-- Row 2 -->
                    <div class="row g-1 mb-2">
                        <div class="col-md-4">
                            <div class="form-label fw-bold small mb-0 d-flex align-items-center gap-1">{{ t("mapedit.map_label") }} <LangValueChips :model-value="mapData.label" :active-lang="currentLang" :default-lang="mapData.lang || 'ja'" :language-options="SUPPORTED_LANGUAGES" @select-language="selectEditorLanguage" /> <ContextHelp :text="t('mapedit.map_label_desc')" :ariaLabel="t('mapedit.map_label_desc')" /></div>
                            <input data-testid="map-label" type="text" class="form-control form-control-sm" v-model="label">
                        </div>
                        <div class="col-md-4">
                            <div class="form-label fw-bold small mb-0 d-flex align-items-center gap-1">{{ t("mapedit.map_name_ofc") }} <LangValueChips :model-value="mapData.officialTitle" :active-lang="currentLang" :default-lang="mapData.lang || 'ja'" :language-options="SUPPORTED_LANGUAGES" @select-language="selectEditorLanguage" /> <ContextHelp :text="t('mapedit.map_name_ofc_desc')" :ariaLabel="t('mapedit.map_name_ofc_desc')" /></div>
                            <input type="text" class="form-control form-control-sm" v-model="officialTitle" :placeholder="t('mapedit.map_name_ofc_pf')">
                        </div>
                        <div class="col-md-4">
                            <div class="form-label fw-bold small mb-0 d-flex align-items-center gap-1">{{ t("mapedit.map_author") }} <LangValueChips :model-value="mapData.author" :active-lang="currentLang" :default-lang="mapData.lang || 'ja'" :language-options="SUPPORTED_LANGUAGES" @select-language="selectEditorLanguage" /> <ContextHelp :text="t('mapedit.map_author_desc')" :ariaLabel="t('mapedit.map_author_desc')" /></div>
                            <input type="text" class="form-control form-control-sm" v-model="author" :placeholder="t('mapedit.map_author_pf')">
                        </div>
                    </div>

                    <!-- Row 3 -->
                    <div class="row g-1 mb-2">
                         <div class="col-md-3">
                            <div class="form-label fw-bold small mb-0 d-flex align-items-center gap-1">{{ t("mapedit.map_create_at") }} <LangValueChips :model-value="mapData.createdAt" :active-lang="currentLang" :default-lang="mapData.lang || 'ja'" :language-options="SUPPORTED_LANGUAGES" @select-language="selectEditorLanguage" /> <ContextHelp :text="t('mapedit.map_create_at_desc')" :ariaLabel="t('mapedit.map_create_at_desc')" /></div>
                            <input type="text" class="form-control form-control-sm" v-model="createdAt" :placeholder="t('mapedit.map_create_at_pf')">
                        </div>
                        <div class="col-md-3">
                            <div class="form-label fw-bold small mb-0 d-flex align-items-center gap-1">{{ t("mapedit.map_era") }} <LangValueChips :model-value="mapData.era" :active-lang="currentLang" :default-lang="mapData.lang || 'ja'" :language-options="SUPPORTED_LANGUAGES" @select-language="selectEditorLanguage" /> <ContextHelp :text="t('mapedit.map_era_desc')" :ariaLabel="t('mapedit.map_era_desc')" /></div>
                            <input type="text" class="form-control form-control-sm" v-model="era" :placeholder="t('mapedit.map_era_pf')">
                        </div>
                        <div class="col-md-3">
                            <div class="form-label fw-bold small mb-0 d-flex align-items-center gap-1">{{ t("mapedit.map_owner") }} <LangValueChips :model-value="mapData.contributor" :active-lang="currentLang" :default-lang="mapData.lang || 'ja'" :language-options="SUPPORTED_LANGUAGES" @select-language="selectEditorLanguage" /> <ContextHelp :text="t('mapedit.map_owner_desc')" :ariaLabel="t('mapedit.map_owner_desc')" /></div>
                            <input type="text" class="form-control form-control-sm" v-model="contributor" :placeholder="t('mapedit.map_owner_pf')">
                        </div>
                        <div class="col-md-3">
                            <div class="form-label fw-bold small mb-0 d-flex align-items-center gap-1">{{ t("mapedit.map_mapper") }} <LangValueChips :model-value="mapData.mapper" :active-lang="currentLang" :default-lang="mapData.lang || 'ja'" :language-options="SUPPORTED_LANGUAGES" @select-language="selectEditorLanguage" /> <ContextHelp :text="t('mapedit.map_mapper_desc')" :ariaLabel="t('mapedit.map_mapper_desc')" /></div>
                            <!-- 旧実装 mapedit.html L.125: placeholder は 'mapedit.map_mapper'（_pf なし）-->
                            <input type="text" class="form-control form-control-sm" v-model="mapper" :placeholder="t('mapedit.map_mapper')">
                        </div>
                    </div>

                    <!-- Row 4 (m6-t2): 地図画像の帰属・ライセンス・補足（レビュー指摘で 2行×3列 に再構成） -->
                    <div class="row g-1 mb-2">
                        <div class="col-md-4">
                            <div class="form-label fw-bold small mb-0 d-flex align-items-center gap-1">{{ t("mapedit.map_copyright") }} <LangValueChips :model-value="mapData.attr" :active-lang="currentLang" :default-lang="mapData.lang || 'ja'" :language-options="SUPPORTED_LANGUAGES" @select-language="selectEditorLanguage" /> <ContextHelp :text="t('mapedit.map_copyright_desc')" :ariaLabel="t('mapedit.map_copyright_desc')" /></div>
                            <input type="text" class="form-control form-control-sm" :class="saveError?.attr ? 'is-invalid' : ''" v-model="attr" :placeholder="t('mapedit.map_copyright_pf')">
                            <!-- M11-T10 (人間検証R4): field エラーは共通 DiagnosticFeedback(赤・(i)付き)で表示 -->
                            <DiagnosticFeedback v-if="saveError?.attr" scope="field" :items="[{ key: 'attr-required', severity: 'danger', message: saveError.attr }]" />
                        </div>
                        <div class="col-md-4">
                            <label class="form-label fw-bold small mb-0 d-flex align-items-center gap-1">{{ t("mapedit.map_image_license") }} <ContextHelp :text="t('mapedit.map_image_license_desc')" :ariaLabel="t('mapedit.map_image_license_desc')" /></label>
                            <LicenseSelect variant="image" test-id="mapedit-image-license" :model-value="mapData.license" :disabled="translationMode" @update:model-value="mapData.license = $event" />
                        </div>
                        <div class="col-md-4">
                            <div class="form-label fw-bold small mb-0 d-flex align-items-center gap-1">{{ t("mapedit.map_image_license_note") }} <LangValueChips :model-value="mapData.licenseNote" :active-lang="currentLang" :default-lang="mapData.lang || 'ja'" :language-options="SUPPORTED_LANGUAGES" @select-language="selectEditorLanguage" /> <ContextHelp :text="t('mapedit.map_image_license_note_desc')" :ariaLabel="t('mapedit.map_image_license_note_desc')" /></div>
                            <input type="text" class="form-control form-control-sm" v-model="licenseNote" :placeholder="t('mapedit.map_image_license_note')">
                        </div>
                    </div>

                    <!-- Row 4b (m6-t2): データの帰属・ライセンス・補足（レビュー指摘で 2行×3列 に再構成） -->
                    <div class="row g-1 mb-2">
                        <div class="col-md-4">
                            <div class="form-label fw-bold small mb-0 d-flex align-items-center gap-1">{{ t("mapedit.map_gcp_copyright") }} <LangValueChips :model-value="mapData.dataAttr" :active-lang="currentLang" :default-lang="mapData.lang || 'ja'" :language-options="SUPPORTED_LANGUAGES" @select-language="selectEditorLanguage" /> <ContextHelp :text="t('mapedit.map_gcp_copyright_desc')" :ariaLabel="t('mapedit.map_gcp_copyright_desc')" /></div>
                            <input type="text" class="form-control form-control-sm" v-model="dataAttr" :placeholder="t('mapedit.map_gcp_copyright_pf')">
                        </div>
                        <div class="col-md-4">
                            <label class="form-label fw-bold small mb-0 d-flex align-items-center gap-1">{{ t("mapedit.map_gcp_license") }} <ContextHelp :text="t('mapedit.map_gcp_license_desc')" :ariaLabel="t('mapedit.map_gcp_license_desc')" /></label>
                            <LicenseSelect variant="data" test-id="mapedit-data-license" :model-value="mapData.dataLicense" :disabled="translationMode" @update:model-value="mapData.dataLicense = $event" />
                        </div>
                        <div class="col-md-4">
                            <div class="form-label fw-bold small mb-0 d-flex align-items-center gap-1">{{ t("mapedit.map_gcp_license_note") }} <LangValueChips :model-value="mapData.dataLicenseNote" :active-lang="currentLang" :default-lang="mapData.lang || 'ja'" :language-options="SUPPORTED_LANGUAGES" @select-language="selectEditorLanguage" /> <ContextHelp :text="t('mapedit.map_gcp_license_note_desc')" :ariaLabel="t('mapedit.map_gcp_license_note_desc')" /></div>
                            <input type="text" class="form-control form-control-sm" v-model="dataLicenseNote" :placeholder="t('mapedit.map_gcp_license_note')">
                        </div>
                    </div>
                    
                    <!-- Row 5 -->
                    <div class="row g-1 mb-2">
                        <div class="col-md-4">
                             <label class="form-label fw-bold small mb-0 d-flex align-items-center gap-1">{{ t("mapedit.map_source") }} <ContextHelp :text="t('mapedit.map_source_desc')" :ariaLabel="t('mapedit.map_source_desc')" /></label>
                             <input type="text" class="form-control form-control-sm" v-model="mapData.reference" :disabled="translationMode" :placeholder="t('mapedit.map_source_pf')">
                        </div>
                         <div class="col-md-8">
                             <label class="form-label fw-bold small mb-0 d-flex align-items-center gap-1">{{ t("mapedit.map_tile") }} <ContextHelp :text="t('mapedit.map_tile_desc')" :ariaLabel="t('mapedit.map_tile_desc')" /></label>
                             <input type="text" class="form-control form-control-sm" data-testid="map-tile-url" :value="mapData.url" @change="onTileUrlCommitted" :disabled="translationMode" :placeholder="t('mapedit.map_tile_pf')">
                        </div>
                    </div>

                    <!-- Row 6 -->
                     <div class="row g-2">
                         <div class="col-12">
                            <div class="form-label fw-bold small mb-0 d-flex align-items-center gap-1">{{ t("mapedit.map_description") }} <LangValueChips :model-value="mapData.description" :active-lang="currentLang" :default-lang="mapData.lang || 'ja'" :language-options="SUPPORTED_LANGUAGES" @select-language="selectEditorLanguage" /> <ContextHelp :text="t('mapedit.map_description_desc')" :ariaLabel="t('mapedit.map_description_desc')" /></div>
                            <textarea class="form-control form-control-sm" rows="3" v-model="description" :placeholder="t('mapedit.map_description_pf')"></textarea>
                        </div>
                    </div>

                    <!-- M12-T15 (R5): サムネイル管理セクション -->
                    <div class="row g-2 mt-2">
                        <div class="col-12">
                            <div class="card">
                                <div class="card-header bg-light fw-bold small py-1">{{ t("mapedit.thumbnail_manage") }}</div>
                                <div class="card-body py-2">
                                    <div class="d-flex gap-3 align-items-start">
                                        <div class="text-center">
                                            <img v-if="thumbnail512Url" :src="thumbnail512Url" class="border rounded" style="width: 96px; height: 96px; object-fit: contain;" alt="512px">
                                            <div v-else class="border rounded text-muted small d-flex align-items-center justify-content-center" style="width: 96px; height: 96px;">512px</div>
                                            <div class="small text-muted mt-1">512px</div>
                                        </div>
                                        <div class="text-center">
                                            <img v-if="thumbnail52Url" :src="thumbnail52Url" class="border rounded" style="width: 52px; height: 52px; object-fit: contain;" alt="52px">
                                            <div v-else class="border rounded text-muted small d-flex align-items-center justify-content-center" style="width: 52px; height: 52px;">52px</div>
                                            <div class="small text-muted mt-1">52px</div>
                                        </div>
                                        <div class="flex-grow-1">
                                            <div class="form-check mb-2">
                                                <input id="derive52" v-model="derive52FromUpload" class="form-check-input" type="checkbox" data-testid="thumbnail-derive-52">
                                                <label class="form-check-label small" for="derive52">{{ t("mapedit.thumbnail_derive_52") }}</label>
                                            </div>
                                            <div class="d-flex gap-2">
                                                <button type="button" class="btn btn-sm btn-outline-secondary" data-testid="thumbnail-replace-512" @click="replaceThumbnail('512')">{{ t("mapedit.thumbnail_replace_512") }}</button>
                                                <button type="button" class="btn btn-sm btn-outline-secondary" data-testid="thumbnail-replace-52" @click="replaceThumbnail('52')">{{ t("mapedit.thumbnail_replace_52") }}</button>
                                            </div>
                                            <DiagnosticFeedback v-if="thumbnailError" scope="section" :items="[{ key: 'thumb-error', severity: 'danger', message: thumbnailError }]" />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </form>
            </div>

            <!-- Tab: GCP (Map Split View) -->
            <!-- NOTE: v-show を d-flex と同じ div に置くと Bootstrap の display:flex!important に負けて
                 v-show が効かないため、v-show 専用のラッパー div を挟んでいる -->
            <div v-show="activeTab === 'gcps'" class="h-100">
            <div class="d-flex flex-column h-100">
                <!-- Controls Bar -->
                <div class="bg-white border-bottom p-2">
                     <div class="container-fluid">
                        <div class="row g-2 align-items-center">
                            <!-- Function Select -->
                            <div class="col-md-2">
                                <label class="small fw-bold mb-0">{{ t("mapedit.map_function_select") }}</label>
                                <select class="form-select form-select-sm" v-model="mappingUIRow">
                                    <option value="layer">{{ t("mapedit.edit_layer") }}</option>
                                    <option value="coordinate">{{ t("mapedit.edit_coordinate") }}</option>
                                </select>
                            </div>

                            <!-- Layer Editing Row -->
                            <div class="col-md-10" v-if="mappingUIRow === 'layer'">
                                <div class="row g-2 align-items-end">
                                    <div class="col-md-4">
                                        <label class="small fw-bold mb-0">{{ t("mapedit.map_layer_select") }}</label>
                                        <select class="form-select form-select-sm" v-model.number="currentEditingLayer">
                                            <option :value="0">{{ t("mapedit.map_mainlayer") }}</option>
                                            <option v-for="(_, index) in sub_maps" :value="index+1">{{ t("mapedit.map_sublayer") }}{{index+1}}</option>
                                        </select>
                                    </div>
                                    <div class="col-md-3">
                                        <div class="btn-group w-100">
                                            <button class="btn btn-sm btn-outline-secondary" @click="addSubMap">{{ t("mapedit.map_addlayer") }}</button>
                                            <button class="btn btn-sm btn-outline-secondary" @click="removeSubMap" :disabled="currentEditingLayer===0">{{ t("mapedit.map_removelayer") }}</button>
                                        </div>
                                    </div>
                                    <div class="col-md-2 d-flex flex-column align-items-center">
                                         <label class="small fw-bold mb-0">{{ t("mapedit.map_importance") }}: {{ importance }}</label>
                                         <div class="btn-group btn-group-sm">
                                            <button class="btn btn-outline-secondary" @click="upImportance" :disabled="!canUpImportance"><i class="bi bi-arrow-up"></i></button>
                                            <button class="btn btn-outline-secondary" @click="downImportance" :disabled="!canDownImportance"><i class="bi bi-arrow-down"></i></button>
                                        </div>
                                    </div>
                                    <div class="col-md-2 d-flex flex-column align-items-center">
                                         <label class="small fw-bold mb-0">{{ t("mapedit.map_priority") }}: {{ priority }}</label>
                                         <div class="btn-group btn-group-sm">
                                            <button class="btn btn-outline-secondary" @click="upPriority" :disabled="!canUpPriority"><i class="bi bi-arrow-up"></i></button>
                                            <button class="btn btn-outline-secondary" @click="downPriority" :disabled="!canDownPriority"><i class="bi bi-arrow-down"></i></button>
                                        </div>
                                    </div>
                                </div>
                            </div>

                             <!-- Coordinate Editing Row -->
                             <div class="col-md-10" v-if="mappingUIRow === 'coordinate'">
                                 <div class="row g-2 align-items-end">
                                     <div class="col-md-2">
                                         <label class="small fw-bold mb-0">{{ t('mapedit.marker_id') }}</label>
                                         <input type="text" class="form-control form-control-sm" disabled :value="editingID">
                                     </div>
                                      <div class="col-md-2">
                                         <label class="small fw-bold mb-0">X</label>
                                         <input type="text" class="form-control form-control-sm" v-model.lazy.number="editingX" :disabled="editingX === ''">
                                     </div>
                                      <div class="col-md-2">
                                         <label class="small fw-bold mb-0">Y</label>
                                         <input type="text" class="form-control form-control-sm" v-model.lazy.number="editingY" :disabled="editingY === ''">
                                     </div>
                                      <div class="col-md-2">
                                         <label class="small fw-bold mb-0">{{ t('mapedit.longitude') }}</label>
                                         <input type="text" class="form-control form-control-sm" v-model.lazy.number="editingLong" :disabled="editingLong === ''">
                                     </div>
                                      <div class="col-md-2">
                                         <label class="small fw-bold mb-0">{{ t('mapedit.latitude') }}</label>
                                         <input type="text" class="form-control form-control-sm" v-model.lazy.number="editingLat" :disabled="editingLat === ''">
                                     </div>
                                 </div>
                             </div>
                        </div>
                     </div>
                </div>

                <!-- Maps Container -->
                <div class="row g-2 flex-grow-1 border-bottom px-2">
                    <!-- Left: Illustrated Map (Source) -->
                    <div class="col-6 h-100 position-relative px-1">
                        <div id="illstMap" class="w-100 h-100"></div>
                        <!-- Home Button Illst -->
                        <div class="position-absolute bottom-0 end-0 m-3 mb-4" style="z-index: 10;">
                            <button class="btn btn-light btn-sm shadow-sm border" data-testid="map-edit-estimate-home" :disabled="gcps.length === 0" @click="estimateHomeFromGcps" :title="t('common.estimate')">
                                <i class="bi bi-magic"></i>
                            </button>
                            <button class="btn btn-light btn-sm shadow-sm border" :disabled="!enableSetHomeIllst" @click="setHomeIllst"><i class="bi bi-house"></i></button>
                        </div>
                    </div>

                    <!-- Right: Mercator Map (Destination/Reference) -->
                    <div class="col-6 h-100 position-relative px-1">
                        <div id="mercMap" class="w-100 h-100"></div>
                         <!-- Home Button Merc -->
                        <div class="position-absolute bottom-0 end-0 m-3 mb-4" style="z-index: 10;">
                            <button class="btn btn-light btn-sm shadow-sm border" data-testid="map-edit-estimate-home" :disabled="gcps.length === 0" @click="estimateHomeFromGcps" :title="t('common.estimate')">
                                <i class="bi bi-magic"></i>
                            </button>
                            <button class="btn btn-light btn-sm shadow-sm border" :disabled="!enableSetHomeMerc" @click="setHomeMerc"><i class="bi bi-house"></i></button>
                        </div>
                    </div>
                </div>

                <!-- Footer Status Bar -->
                <div class="bg-light p-2 border-top">
                    <div class="container-fluid">
                         <div class="row g-2 align-items-center small">
                            <!-- Column 1: Map Outline -->
                             <div class="col-md-3">
                                 <div class="d-flex flex-column">
                                    <span class="fw-bold mb-1">{{ t("mapedit.map_outline") }}</span>
                                    <div>
                                        <div class="form-check form-check-inline m-0 me-2">
                                            <input class="form-check-input" type="radio" name="outlineMode" id="outlinePlain" value="plain" v-model="vertexMode">
                                            <label class="form-check-label" for="outlinePlain">{{ t("mapedit.map_outline_plain") }}</label>
                                        </div>
                                        <div class="form-check form-check-inline m-0">
                                            <input class="form-check-input" type="radio" name="outlineMode" id="outlineBirdeye" value="birdeye" v-model="vertexMode">
                                            <label class="form-check-label" for="outlineBirdeye">{{ t("mapedit.map_outline_birdeye") }}</label>
                                        </div>
                                    </div>
                                 </div>
                             </div>

                             <!-- Column 2: Map Error Mode -->
                             <div class="col-md-3">
                                  <div class="d-flex flex-column">
                                    <span class="fw-bold mb-1">{{ t("mapedit.map_error") }}</span>
                                    <div>
                                        <div class="form-check form-check-inline m-0 me-2">
                                            <input class="form-check-input" type="radio" name="strictMode" id="errStrict" value="strict" v-model="strictMode">
                                            <label class="form-check-label" for="errStrict">{{ t("mapedit.map_error_valid") }}</label>
                                        </div>
                                        <div class="form-check form-check-inline m-0">
                                            <input class="form-check-input" type="radio" name="strictMode" id="errAuto" value="auto" v-model="strictMode">
                                            <label class="form-check-label" for="errAuto">{{ t("mapedit.map_error_auto") }}</label>
                                        </div>
                                    </div>
                                 </div>
                             </div>

                             <!-- Column 3: Error Status (M12-T11/R4: footer 素表示から DF section バナーへ。
                                  「エラーなし」(strict) は非表示) -->
                             <div class="col-md-3">
                                 <DiagnosticFeedback v-if="gcpErrorStatusMessage" scope="section" :items="[{ key: 'gcp-error', severity: 'danger', message: gcpErrorStatusMessage }]" />
                             </div>

                             <!-- Column 4: View Error Button -->
                             <div class="col-md-3 text-end">
                                 <button class="btn btn-sm btn-outline-danger" v-show="errorStatus === 'strict_error'" @click="viewError">
                                     {{ t('mapedit.map_error_next') }}
                                 </button>
                             </div>
                         </div>
                    </div>
                </div>
            </div>
            </div><!-- /v-show gcps wrapper -->

            <!-- Tab: Data IO -->
            <!-- 旧実装 mapedit.html L.274-375 の wmtsTab に完全準拠 -->
            <!--
              M12-T22: 本ブロックへのUI導線はM11-T3で意図的に撤去済み（activeTabを'inout'へ
              設定する経路が存在しない）。ロジックは削除禁止 — CSV GCPインポートはM12-T23で
              再編復帰予定、WMTS生成はM4-(2)（既存Maplat定義→WMTS出力→ベースマップ登録）へ
              転用予定。本ブロックが参照する i18n キー（public/locales/*/translation.json の
              dataio.* 全28キー・wmtsgenerate.* 全5キー・mapedit.export_map_data）も同様に
              削除禁止（JSON側にコメント記載不可のため本注記が唯一の防御線。§3.4参照）。
              詳細: docs/superpowers/state/nayuta-state.json m12.tasks[t22] / m4.human_direction_2026_07_25
            -->
            <div v-show="activeTab === 'inout'" class="h-100 overflow-auto p-4">
                <div class="card mb-4">
                    <div class="card-header bg-light fw-bold">{{ t("dataio.import_title") }}</div>
                    <div class="card-body">
                        <!-- Import Map Data ボタン -->
                        <!-- 旧実装: v-bind:disabled="dirty || status !== 'New'" -->
                        <div class="mb-3">
                            <label class="form-label d-block">{{ t("dataio.import_map_data") }}</label>
                            <button type="button" class="btn btn-outline-secondary"
                                    :disabled="isDirty || mapData.status !== 'New'"
                                    @click="importMap">{{ t("dataio.import_map_data") }}</button>
                        </div>
                        <hr>
                        <!-- CSV インポートセクション -->
                        <div class="mb-3">
                            <div class="row mb-2">
                                <div class="col-md-3">
                                    <label class="fw-bold">{{ t("dataio.import_csv") }}</label>
                                </div>
                                <div class="col-md-5">
                                    <!-- CSV エラーステータス (M12-T11/R3: inline span から DF field へ) -->
                                    <label>{{ t("dataio.import_csv_status") }}:</label>
                                    <DiagnosticFeedback v-if="csvUpErrorMessage" scope="field" :items="[{ key: 'csv-import', severity: 'danger', message: csvUpErrorMessage }]" />
                                </div>
                                <div class="col-md-4">
                                    <button type="button" class="btn btn-outline-secondary btn-sm"
                                            :disabled="!!csvUpError"
                                            @click="uploadCsv">{{ t("dataio.import_csv_submit") }}</button>
                                </div>
                            </div>
                            <div class="row">
                                <!-- 左半分: カラム設定 + projText -->
                                <div class="col-md-6">
                                    <div class="row g-2 mb-2">
                                        <div class="col-3">
                                            <label class="form-label small">{{ t("dataio.pix_x_column") }}</label>
                                            <input type="number" class="form-control form-control-sm" v-model.lazy.number="csvUploadUiValue.pixXColumn">
                                        </div>
                                        <div class="col-3">
                                            <label class="form-label small">{{ t("dataio.pix_y_column") }}</label>
                                            <input type="number" class="form-control form-control-sm" v-model.lazy.number="csvUploadUiValue.pixYColumn">
                                        </div>
                                        <div class="col-3">
                                            <label class="form-label small">{{ t("dataio.lng_column") }}</label>
                                            <input type="number" class="form-control form-control-sm" v-model.lazy.number="csvUploadUiValue.lngColumn">
                                        </div>
                                        <div class="col-3">
                                            <label class="form-label small">{{ t("dataio.lat_column") }}</label>
                                            <input type="number" class="form-control form-control-sm" v-model.lazy.number="csvUploadUiValue.latColumn">
                                        </div>
                                    </div>
                                    <div class="mb-2">
                                        <label class="form-label small">{{ t("dataio.proj_text") }}</label>
                                        <input type="text" class="form-control form-control-sm"
                                               :disabled="csvProjPreset === 'wgs84' || csvProjPreset === 'mercator'"
                                               v-model="csvUploadUiValue.projText">
                                    </div>
                                </div>
                                <!-- 右半分: 設定チェックボックス群 + プリセット -->
                                <div class="col-md-6">
                                    <div class="row">
                                        <!-- 設定 -->
                                        <div class="col-6">
                                            <label class="fw-bold small">{{ t("dataio.settings_title") }}:</label>
                                            <div class="form-check">
                                                <input class="form-check-input" type="checkbox"
                                                       v-model="csvUploadUiValue.reverseMapY" id="reverseMapY">
                                                <label class="form-check-label small" for="reverseMapY">{{ t("dataio.revert_pix_y") }}</label>
                                            </div>
                                            <div class="d-flex align-items-center gap-2 mb-2">
                                                <label class="form-label small mb-0">{{ t("dataio.ignore_headers") }}</label>
                                                <input class="form-control form-control-sm" type="number" style="width: 60px;"
                                                       v-model.lazy.number="csvUploadUiValue.ignoreHeader">
                                            </div>
                                            <button type="button" class="btn btn-outline-secondary btn-sm"
                                                    @click="csvQgisSetting">{{ t("dataio.use_geo_referencer") }}</button>
                                        </div>
                                        <!-- プリセット -->
                                        <div class="col-6">
                                            <label class="fw-bold small">{{ t("dataio.proj_text_preset") }}:</label>
                                            <div class="form-check">
                                                <input class="form-check-input" type="radio"
                                                       v-model="csvProjPreset" value="wgs84" id="presetWgs84">
                                                <label class="form-check-label small" for="presetWgs84">{{ t("dataio.wgs84_coord") }}</label>
                                            </div>
                                            <div class="form-check">
                                                <input class="form-check-input" type="radio"
                                                       v-model="csvProjPreset" value="mercator" id="presetMercator">
                                                <label class="form-check-label small" for="presetMercator">{{ t("dataio.sp_merc_coord") }}</label>
                                            </div>
                                            <div class="form-check">
                                                <input class="form-check-input" type="radio"
                                                       v-model="csvProjPreset" value="other" id="presetOther">
                                                <label class="form-check-label small" for="presetOther">{{ t("dataio.other_coord") }}</label>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="card">
                    <div class="card-header bg-light fw-bold">{{ t("dataio.export_title") }}</div>
                    <div class="card-body">
                        <!-- Export Map Data ボタン -->
                        <!-- 旧実装: v-bind:disabled="error || dirty" -->
                        <div class="mb-3">
                            <label class="form-label d-block">{{ t("mapedit.export_map_data") }}</label>
                            <button type="button" class="btn btn-outline-secondary me-3"
                                    :disabled="!!saveError || isDirty"
                                    @click="exportMap">{{ t("mapedit.export_map_data") }}</button>
                        </div>
                        <hr>
                        <!-- WMTS 生成 -->
                        <!-- 旧実装: v-bind:disabled="!wmtsEditReady" -->
                        <div class="mb-2">
                            <label class="form-label d-block">{{ t("wmtsgenerate.generate") }}</label>
                            <button type="button" class="btn btn-secondary"
                                    :disabled="!wmtsEditReady"
                                    @click="wmtsGenerate">{{ t("wmtsgenerate.generate") }}</button>
                        </div>
                        <p class="small text-muted text-end">
                            {{ t("wmtsgenerate.result_folder", { folder: mapData.wmtsFolder }) }}
                        </p>
                    </div>
                </div>
            </div>

            <!-- Tab: Base map settings -->
            <!-- NOTE: v-show を d-flex と同じ div に置くと Bootstrap の display:flex!important に負けて
                 v-show が効かない (gcps タブと同じ罠。実害: settings ペインが常時表示になり、後続の
                 POIデータタブを覆い隠していた — 2026-07-12 実機バグ)。v-show 専用ラッパーを挟む -->
            <div v-show="activeTab === 'settings'" class="h-100">
            <div class="h-100 p-4 d-flex flex-column">
                <ResourceSelector class="flex-grow-1 min-h-0" data-testid="map-base-map-selector">
                  <template #list>
                    <ResourceSelectorList
                      ref="baseMapSelectorListRef"
                      v-model:query="baseMapSearchText"
                      :adapter="baseMapVisibilityListAdapter"
                      :placeholder="t('mapedit.base_map_search_placeholder')"
                      :spatial-context="baseMapSpatialContext"
                    >
                      <template #range-filter>
                        <ResourceRangeFilterButton
                          :state="baseMapRangeState"
                          :auto-label="t('mapedit.range_filter_gcp_active')"
                          :manual-label="t('mapedit.range_filter_manual_active')"
                          :none-label="t('mapedit.range_filter_none')"
                          test-id="map-base-map-region-button"
                          clear-test-id="map-base-map-region-clear"
                          :clear-title="t('appedit.envelope_clear')"
                          @open="showBaseMapRegionModal = true"
                          @clear="baseMapFilterRegion = null"
                        />
                      </template>
                      <template #item="{ item }">
                        <ResourceMasterRow
                          :item="asResourceListRowFromVisibility(item)"
                          kind="base-map"
                          variant="selector"
                          :disabled="item.locked"
                          @select="setBaseMapEnabled(item, true)"
                        />
                      </template>
                    </ResourceSelectorList>
                    <div v-if="baseMapVisibilityLoading" class="small text-muted">
                        {{ t("applist.loading") }}
                    </div>
                    <!-- M11-T7/AC8: section 診断へ移行 -->
                    <DiagnosticFeedback
                        v-else-if="baseMapVisibilityError"
                        scope="section"
                        :items="[{ key: 'basemap-visibility', severity: 'danger', message: baseMapVisibilityError }]"
                    />
                  </template>

                  <template #selected>
                    <h5 class="d-flex align-items-center gap-1">{{ t("mapedit.base_map_visibility") }} <ContextHelp :text="t('mapedit.basemap_settings_note')" :ariaLabel="t('mapedit.basemap_settings_note')" /></h5>
                    <ResourceEmptyState
                      v-if="enabledBaseMaps.length === 0"
                      icon-class="bi bi-layers"
                      :message="t('mapedit.no_selected_base_maps')"
                    />
                    <div v-else class="selected-list">
                        <div
                            v-for="item in enabledBaseMaps"
                            :key="`${item.scope}:${item.mapID}`"
                            class="selected-source border rounded p-2 mb-2"
                            :data-testid="`map-selected-basemap-${item.mapID}`"
                        >
                            <div class="d-flex align-items-center justify-content-between gap-2">
                                <div class="d-flex align-items-center gap-2">
                                    <img :src="baseMapThumbnail(item)" :alt="baseMapTitleForSelected(item)" class="selected-source-thumb" style="width: 48px; height: 48px; object-fit: contain; background: #f8f9fa; border: 1px solid var(--bs-border-color);">
                                    <div class="min-width-0">
                                        <div class="fw-bold text-truncate">
                                            {{ baseMapTitleForSelected(item) }}
                                        </div>
                                        <small class="text-muted text-truncate">{{ item.mapID }} / {{ item.scope }}</small>
                                    </div>
                                </div>
                                <div class="btn-group btn-group-sm">
                                    <!-- HM2: locked は × ではなく lock アイコン -->
                                    <span v-if="item.locked" class="text-secondary d-flex align-items-center px-2" :title="t('mapedit.base_map_always_visible')">
                                        <i class="bi bi-lock-fill" aria-hidden="true"></i>
                                    </span>
                                    <button
                                        v-else
                                        type="button"
                                        class="btn btn-outline-danger"
                                        :data-testid="`map-remove-basemap-${item.mapID}`"
                                        @click="setBaseMapEnabled(item, false)"
                                    >×</button>
                                </div>
                            </div>
                        </div>
                    </div>
                  </template>
                </ResourceSelector>
                <!-- 地域指定モーダル(Geocoder内蔵)。指定領域と存在範囲が重なるベースマップに絞り込む -->
                <EnvelopeEditorModal
                    v-if="showBaseMapRegionModal"
                    :model-value="baseMapFilterRegion"
                    title-key="mapedit.base_map_region_modal_title"
                    help-key="mapedit.base_map_region_modal_help"
                    :fallback-bbox="baseMapRegionFallbackBbox"
                    @update:model-value="baseMapFilterRegion = $event"
                    @close="showBaseMapRegionModal = false"
                />
            </div>
            </div>

            <!-- Tab: POIデータ (Phase 8 Task 2)。器は mapData.pois 配列、履歴は mapData の
                 deep-watch (scheduleHistorySnapshot) が拾う (MapEdit の既存方式) -->
            <div v-show="activeTab === 'pois'" class="h-100 p-4 overflow-hidden" data-testid="map-pois-tab-pane">
                <!-- M4-T1: 未対応形式の警告。機構 (DiagnosticFeedback + read-only) は AppEdit と
                     共通で、文言キーだけ画面別 — App は preview/export へ反映されないが Map は
                     生値がそのまま出力されるため (人間判断 2026-08-02) -->
                <div class="h-100 d-flex flex-column">
                <DiagnosticFeedback v-if="poisUnsupported" :items="[{ key: 'h', severity: 'warning', message: t('mapedit.poi_format_unsupported') }]" scope="section" class="flex-shrink-0" />
                <PoiReferenceEditor
                    ref="poiRefEditor"
                    class="flex-grow-1"
                    heading-key="poiref.selected_list_map"
                    :pois="poisForEditor"
                    :read-only="poisUnsupported"
                    :host-slug="mapData.mapID"
                    :host-title="mapData.title"
                    :active-lang="currentLang"
                    :default-lang="(mapData.lang || 'ja') as LangCode"
                    :language-options="SUPPORTED_LANGUAGES"
                    :spatial-context="poiSpatialContext"
                    @toggle-spatial-context="showPoiRegionModal = true"
                    @select-language="selectEditorLanguage"
                    @update:pois="onPoisChange"
                >
                  <template #range-filter>
                    <ResourceRangeFilterButton
                      :state="poiRangeState"
                      :auto-label="t('mapedit.range_filter_gcp_active')"
                      :manual-label="t('mapedit.range_filter_manual_active')"
                      :none-label="t('mapedit.range_filter_none')"
                      test-id="map-poi-range-button"
                      clear-test-id="map-poi-range-clear"
                      :clear-title="t('appedit.envelope_clear')"
                      @open="showPoiRegionModal = true"
                      @clear="poiFilterRegion = null"
                    />
                  </template>
                </PoiReferenceEditor>
                </div>
                <EnvelopeEditorModal
                    v-if="showPoiRegionModal"
                    :model-value="poiFilterRegion"
                    title-key="mapedit.base_map_region_modal_title"
                    help-key="mapedit.base_map_region_modal_help"
                    :fallback-bbox="baseMapRegionFallbackBbox"
                    @update:model-value="poiFilterRegion = $event"
                    @close="showPoiRegionModal = false"
                />
            </div>

        </div>
    </div>
</template>

<style scoped>
/* Ensure map containers fill available space */
.map-container {
    width: 100%;
    height: 100%;
}
.z-index-10 {
    z-index: 10;
}
</style>
