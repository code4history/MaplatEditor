<script setup lang="ts">
import { ref, onMounted, computed, watch, nextTick } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { isEqual, cloneDeep } from 'lodash-es';
import ProgressModal from '../components/ProgressModal.vue';
// @ts-ignore
import { useTranslation } from 'i18next-vue';
// @ts-ignore
import crypto from 'crypto';
// @ts-ignore
import Geocoder from 'ol-geocoder';
import 'ol-geocoder/dist/ol-geocoder.min.css';
// @ts-ignore
import ContextMenu from 'ol-contextmenu';
// @ts-ignore
import { MaplatMap } from '@maplat/core/src/map_ex';
// @ts-ignore
import { mapSourceFactory } from '@maplat/core/src/source_ex';
import Tin from '@maplat/tin';
import { GeoJSON } from 'ol/format';

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
// import { getCenter } from 'ol/extent';
// import { Projection } from 'ol/proj';
// import { XYZ } from 'ol/source';
import type { MapBrowserEvent } from 'ol';
import type Feature from 'ol/Feature';
import type { SimpleGeometry } from 'ol/geom';

const { t } = useTranslation();
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

const mapID = ref('');
/**
 * 旧実装 defaultMap 相当: 新規作成時の初期値
 * map.js defaultMap に完全準拠
 */
const defaultMapData = () => ({
    title: '',
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
/**
 * onlyOne: 旧実装の vueMap.onlyOne 相当
 * true  = 既存地図（mapID 変更不可、"Change Map ID" ボタン表示）
 * false = 新規地図（mapID 入力可、一意性チェックボタン表示）
 */
const onlyOne = ref(false);
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

const activeTab = ref('metadata');

const gcps = ref<any[]>([]);
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

const currentLang = ref('ja');

// const onOffAttr = ['license', 'dataLicense', 'reference', 'url'];
const langAttr = ['title', 'officialTitle', 'author', 'era', 'createdAt', 'contributor',
  'mapper', 'attr', 'dataAttr', 'description'];

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

const localedGet = (key: string) => {
    const lang = mapData.value.lang || 'ja';
    const locale = currentLang.value;
    const val = mapData.value[key];
    if (typeof val !== 'object' || val === null) {
        return lang === locale ? (val || '') : '';
    } else {
        return val[locale] != null ? val[locale] : '';
    }
};

const localedSet = (key: string, value: string) => {
    const lang = mapData.value.lang || 'ja';
    const locale = currentLang.value;
    let val = mapData.value[key];
    if (value == null) value = '';
    
    if (typeof val !== 'object' || val === null) {
        if (lang === locale) {
            val = value;
        } else if (value !== '') {
            const val_: any = {};
            val_[lang] = val || ''; // 旧値を保持する
            val_[locale] = value;
            val = val_;
        }
    } else {
        if (value === '' && lang !== locale) {
            delete val[locale];
            const keys = Object.keys(val);
            if (keys.length === 0) {
                val = '';
            } else if (keys.length === 1 && keys[0] === lang) {
                val = val[lang];
            }
        } else {
            // val = cloneDeep(val); // リアクティブオブジェクトの直接変更で問題が出る場合はクローンを使用
            val[locale] = value;
        }
    }
    mapData.value[key] = val;
};

const createLangComputed = (key: string) => computed({
    get: () => localedGet(key),
    set: (val: string) => localedSet(key, val)
});

// ローカライズフィールドの computed プロパティ
const title = createLangComputed('title');
const officialTitle = createLangComputed('officialTitle');
const author = createLangComputed('author');
const era = createLangComputed('era');
const createdAt = createLangComputed('createdAt');
const contributor = createLangComputed('contributor'); // テンプレートでは 'owner' として参照される
const mapper = createLangComputed('mapper');
const attr = createLangComputed('attr');
const dataAttr = createLangComputed('dataAttr');
const description = createLangComputed('description');

// テンプレート変数名とlangAttrキー名のマッピング
// テンプレート: title, officialTitle, author, createAt(=createdAt), era, owner(=contributor), mapper
// v-model="mapData.createAt" → langAttr の createdAt に対応
// v-model="mapData.owner"    → langAttr の contributor に対応

const isDefaultLang = computed({
    get: () => (mapData.value.lang || 'ja') === currentLang.value,
    set: (newValue: boolean) => {
        if (newValue) {
            const oldLang = mapData.value.lang || 'ja';
            const newLang = currentLang.value;
            if (oldLang === newLang) return;

            const buffer: any = {};
            // 1. 旧言語の各フィールド値を退避
            for (const attr of langAttr) {
                let val = mapData.value[attr];
                if (typeof val !== 'object' || val === null) {
                    buffer[attr] = val || '';
                } else {
                    buffer[attr] = val[oldLang] || '';
                }
            }

            // 2. 言語を切り替え
            mapData.value.lang = newLang;

            // 3. 各フィールドを新言語構造に再構築
            for (const attr of langAttr) {
                const newVal = localedGet(attr); // 新言語の値（currentLang で取得）
                const oldVal = buffer[attr];     // 退避した旧言語の値

                // 既存オブジェクトに oldLang と newLang の両方をセット
                let combined: any = mapData.value[attr];
                if (typeof combined !== 'object' || combined === null) {
                    combined = {};
                }

                combined[oldLang] = oldVal;
                combined[newLang] = newVal;

                mapData.value[attr] = combined;

                // 単一言語のみの場合はプレーン文字列に最適化
                const keys = Object.keys(combined);
                if (keys.length === 1 && keys[0] === newLang) {
                     mapData.value[attr] = combined[newLang];
                }
            }
        }
    }
});
const isDirty = computed(() => {
    return !isEqual(mapData.value, originalMapData.value);
});

/**
 * 旧実装 computed.error の mapID 部分を再実装
 * - 空: 'mapedit.error_set_mapid'
 * - 使用不可文字: 'mapedit.error_mapid_character'  (/^[\d\w_-]+$/ に不一致)
 * - 未確認（新規）: 'mapedit.check_uniqueness'  ← onlyOne が false の間
 */
const mapIDError = computed(() => {
    const id = mapData.value.mapID;
    if (id == null || id === '') return 'mapedit.error_set_mapid';
    if (!id.match(/^[\d\w_-]+$/)) return 'mapedit.error_mapid_character';
    if (!onlyOne.value) return 'mapedit.check_uniqueness';
    return null;
});

/**
 * 旧実装 computed.displayTitle 相当（map.js L.123）
 * タイトル未設定時は 'mapmodel.untitled' キーを使う
 */
const displayTitle = computed(() => {
    const title = mapData.value.title;
    if (!title) return t('mapmodel.untitled');
    if (typeof title !== 'object') return title;
    const lang = mapData.value.lang || 'ja';
    const defTitle = title[lang];
    if (defTitle) return defTitle;
    return t('mapmodel.untitled');
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

/**
 * 旧実装 langs マップ相当（map.js L.44）
 * lang コード → common.* i18n キー名
 */
const langsMap: Record<string, string> = {
    'ja': 'japanese',
    'en': 'english',
    'de': 'germany',
    'fr': 'french',
    'es': 'spanish',
    'ko': 'korean',
    'zh': 'simplified',
    'zh-TW': 'traditional'
};

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

    // --- mapID ---
    const id = mapData.value.mapID as string | undefined;
    if (id == null || id === '') {
        err['mapID'] = 'mapedit.error_set_mapid';
    } else if (!id.match(/^[\d\w_-]+$/)) {
        err['mapID'] = 'mapedit.error_mapid_character';
    } else if (!onlyOne.value) {
        err['mapIDOnlyOne'] = 'mapedit.check_uniqueness';
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
const mainLayerHash = computed(() => {
    const tin = tinObjects.value[0];
    if (!tin || typeof tin === 'string') return undefined;
    try {
        const hashsum = crypto.createHash('sha1');
        hashsum.update(JSON.stringify(tin.getCompiled()));
        return hashsum.digest('hex');
    } catch {
        return undefined;
    }
});

// 旧実装 map.js L.211-213
const wmtsDirty = computed(() => mapData.value.wmtsHash !== mainLayerHash.value);

// 旧実装 map.js L.172-175 (Tin.STATUS_STRICT = 'strict')
const wmtsEditReady = computed(() => {
    const tin = tinObjects.value[0];
    return !!(mainLayerHash.value && wmtsDirty.value &&
              tin && typeof tin === 'object' && tin.strict_status === 'strict');
});

// 旧実装 map.js L.431-439: csvUploadUiValue 初期値
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

// 旧実装 map.js L.198-207
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

onMounted(async () => {
    const id = route.query.mapid as string | undefined;

    // 旧実装: mapIDが無い場合は initVueMap()/setVueMap() を呼んで空の地図を初期化
    // 旧実装: mapIDが有る場合は mapedit.request(mapID) を呼んで既存地図を読み込む
    // 新実装では mapid=new または mapid 未指定を「新規作成」として扱う
    const isNew = !id || id === 'new';

    if (isNew) {
        // 新規地図: defaultMap で初期化、onlyOne = false（mapID編集可）
        const fresh = defaultMapData();
        mapData.value = fresh;
        originalMapData.value = cloneDeep(fresh);
        onlyOne.value = false;
    } else {
        // 既存地図: バックエンドから読み込み
        mapID.value = id;
        try {
            const data = await (window as any).mapedit.request(mapID.value);
            if (data) {
                // 旧実装: res[0].mapID = mapID; res[0].status = 'Update'; res[0].onlyOne = true;
                // バックエンドがすでに設定してくれているが、念のため確認
                if (!data.mapID) data.mapID = mapID.value;
                if (!data.status) data.status = 'Update';
                mapData.value = data;
                originalMapData.value = cloneDeep(data);
            }
        } catch (e) {
            console.error("Failed to load map data:", e);
        }
        onlyOne.value = true;
    }

    // wmtsフォルダパスをバックエンドから取得
    // NOTE: mapData と originalMapData 両方に設定しないと isDirty が常に true になる
    try {
        const wmtsFolder = await (window as any).mapedit.getWmtsFolder();
        mapData.value.wmtsFolder = wmtsFolder;
        originalMapData.value.wmtsFolder = wmtsFolder;
    } catch (_e) { /* 取得失敗時はデフォルト空文字のまま */ }

    sub_maps.value = cloneDeep(mapData.value.sub_maps || []);
    gcps.value = cloneDeep(mapData.value.gcps || []);
    edges.value = cloneDeep(mapData.value.edges || []);
    homePosition.value = mapData.value.homePosition;
    mercZoom.value = mapData.value.mercZoom;
    // 旧実装の defaultMap に合わせ、デフォルトは 'strict'（'auto' ではない）
    strictMode.value = mapData.value.strictMode || 'strict';
    vertexMode.value = mapData.value.vertexMode || 'plain';
    // tinObjects: メインレイヤー + サブマップ分 の undefined で初期化（旧実装: vueMap.tinObjects = [...]）
    tinObjects.value = Array(1 + sub_maps.value.length).fill(undefined);

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
        }
    });
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

const updateTin = async () => {
    if (!illstSource) return;
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
    try {
        // Vue の Proxy は IPC の Structured Clone に対応しないため、JSON でプレーンオブジェクトに変換する
        const plainGcps = JSON.parse(JSON.stringify(gcpList.map((g: any[]) => [g[0], g[1]])));
        const plainEdges = JSON.parse(JSON.stringify(edges.value));
        const plainBounds = bounds ? JSON.parse(JSON.stringify(bounds)) : null;
        const [, compiled] = await (window as any).mapedit.updateTin(
            plainGcps,
            plainEdges,
            index,
            plainBounds,
            strictMode.value,
            vertexMode.value
        );
        if (typeof compiled === 'string') {
            // エラー文字列が返ってきた場合
            tinObject.value = compiled;
        } else {
            // コンパイル済みデータをフロントで Tin に復元して tins プロパティを使えるようにする
            const tin = new Tin({});
            tin.setCompiled(compiled);
            tinObject.value = tin;
        }
    } catch (err: any) {
        console.error('[updateTin] IPC error:', err);
        tinObject.value = 'unknownError';
    }
    tinResultUpdate();
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

const loadMapTiles = async () => {
    if (!illstMap) return;
    
    // 旧実装 reflectIllstMap に準拠: mapSourceFactory を使用
    // 非正方形タイル（HistMap）などの設定を適切に処理する
    const options = {
        mapID: mapID.value,
        url: mapData.value.url_,
        width: mapData.value.width,
        height: mapData.value.height,
        attr: mapData.value.attr,
        noload: true, // HistMap/HistMap_tin を直接生成するためのフラグ
        imageExtension: mapData.value.extension || 'jpg'
    };

    try {
        const source = await mapSourceFactory(options, {});
        illstSource = source;
        illstMap.exchangeSource(source);
        console.log('[loadMapTiles] source ready, mapData.gcps:', mapData.value.gcps?.length);

        // illstMapのビュー中心を設定（旧実装 reflectIllstMap に完全準拠）
        // 旧実装は illstView.setCenter(initialCenter) のみ実行し、ビューのプロジェクションは変更しない
        const initialCenter = source.xy2SysCoord([mapData.value.width / 2, mapData.value.height / 2]);
        const illstView = illstMap.getView();
        illstView.setCenter(initialCenter);

        // 旧実装の mapDataCommon フロー（vueMap.setInitialMap(json) 相当）:
        // mapData から gcps/edges/homePosition を反映
        if (mapData.value.gcps) gcps.value = mapData.value.gcps;
        if (mapData.value.edges) edges.value = mapData.value.edges;
        if (mapData.value.homePosition) homePosition.value = mapData.value.homePosition;
        if (mapData.value.mercZoom) mercZoom.value = mapData.value.mercZoom;
        if (mapData.value.strictMode) strictMode.value = mapData.value.strictMode;
        if (mapData.value.vertexMode) vertexMode.value = mapData.value.vertexMode;

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
        updateTin();

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

const setupBaseMaps = async () => {
    if (!mercMap) return;

    // baseMapList が空の場合に取得する
    if (baseMapList.value.length === 0) {

        // 1. IPCを通じてTMSリストを取得（settings/tmsList.json と settings/tmsList.[mapID].json を参照）
        if ((window as any).mapedit && (window as any).mapedit.getTmsListOfMapID && mapID.value) {
            try {
                // @ts-ignore
                const list = await (window as any).mapedit.getTmsListOfMapID(mapID.value);
                console.log("MapEdit.vue: Received tms list from IPC", list);
                if (list && list.length > 0) {
                    baseMapList.value = list.reverse();
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
                        baseMapList.value = json.reverse();
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
            ].reverse();
        }
    }

    const layers = await Promise.all(baseMapList.value.map(async (tms) => {
        let source;
        try {
            if (['osm', 'gsi', 'gsi_ortho'].includes(tms.mapID)) {
                source = await mapSourceFactory(tms.mapID, {});
            } else {
                 source = await mapSourceFactory({
                     mapID: tms.mapID || 'custom',
                     url: tms.url,
                     attr: tms.attr,
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
                title: tms.title,
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
const modalPercent = ref(0);
const modalProgressText = ref('');
const modalEnableClose = ref(false);

/** vueModal.show(text) 相当 */
const modalShow = (textKey: string) => {
    modalText.value = textKey;
    modalPercent.value = 0;
    modalProgressText.value = '';
    modalEnableClose.value = false;
    modalVisible.value = true;
};
/** vueModal.progress(text, percent, progressText) 相当 — IPC progress イベントから呼ぶ */
const modalProgress = (textKey: string, percent: number, progressText: string) => {
    modalText.value = textKey;
    modalPercent.value = percent;
    modalProgressText.value = progressText;
};
/** vueModal.finish(text) 相当 — 処理完了時に呼ぶ */
const modalFinish = (textKey: string) => {
    modalText.value = textKey;
    modalEnableClose.value = true;
};
/** vueModal.hide() 相当 — OK ボタンクリック or 自動非表示 */
const modalHide = () => {
    modalVisible.value = false;
};

/**
 * 旧実装: vueMap.$on('updateMapID') 相当
 * "Change Map ID" ボタン: 確認ダイアログ後 onlyOne を false にして mapID 入力を解放
 */
const changeMapID = async () => {
    const result = await (window as any).dialog.showMessageBox({
        type: 'info',
        buttons: ['OK', 'Cancel'],
        cancelId: 1,
        message: t('mapedit.confirm_change_mapid')
    });
    if (result.response === 1) return; // キャンセル
    onlyOne.value = false;
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

    // taskProgress リスナー登録（旧実装: window.mapedit.on('taskProgress', ...)）
    const progressHandler = (_event: any, arg: any) => {
        modalProgress(arg.text, arg.percent, arg.progress);
    };
    (window as any).ipcRenderer.on('mapedit:taskProgress', progressHandler);

    try {
        // 旧実装: window.mapupload.showMapSelectDialog(t('mapupload.map_image'))
        const arg = await (window as any).mapupload.showMapSelectDialog(t('mapupload.map_image'));

        if (arg.err) {
            if (arg.err !== 'Canceled') {
                console.error('[mapUpload] Error:', arg.err);
                modalFinish('mapedit.error_image_upload');
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
            // 旧実装: reflectIllstMap() → gcpsToMarkers() → updateTin()
            await loadMapTiles();
            gcpsToMarkers();
            updateTin();
        }
    } finally {
        (window as any).ipcRenderer.off('mapedit:taskProgress', progressHandler);
    }
};

/**
 * 旧実装: vueMap.$on('checkOnlyOne') 相当
 * mapID 一意性チェック（新規 or Change:... 時）
 * 旧実装: window.mapedit.checkID → once('checkIDResult')
 * 新実装: await window.mapedit.checkID(mapID)
 */
const checkOnlyOne = async () => {
    const currentMapID = mapData.value.mapID as string;
    const isUnique = await (window as any).mapedit.checkID(currentMapID);
    if (isUnique) {
        await (window as any).dialog.showMessageBox({
            type: 'info',
            buttons: ['OK'],
            message: t('mapedit.alert_mapid_checked')
        });
        onlyOne.value = true;
        // 旧実装: status が 'Update' の場合 Change:{oldMapID} に変更
        const origMapID = originalMapData.value.mapID as string | undefined;
        if (mapData.value.status === 'Update' && origMapID) {
            mapData.value.status = `Change:${origMapID}`;
        }
    } else {
        await (window as any).dialog.showMessageBox({
            type: 'info',
            buttons: ['OK'],
            message: t('mapedit.alert_mapid_duplicated')
        });
        onlyOne.value = false;
    }
};

/**
 * 旧実装: vueMap.$on('saveMap') 相当
 * 1. 確認ダイアログ
 * 2. Change: ステータスの場合、Copy に変えるかどうかの追加確認
 * 3. mapedit:save IPC を呼んで結果に応じてダイアログ表示
 * 4. 成功時: originalMapData を更新, 必要に応じて mapID 更新, request で再ロード
 */
const saveMap = async () => {
    // 1. 保存確認ダイアログ（旧実装: t('mapedit.confirm_save')）
    const confirmResult = await (window as any).dialog.showMessageBox({
        type: 'info',
        buttons: ['OK', 'Cancel'],
        cancelId: 1,
        message: t('mapedit.confirm_save')
    });
    if (confirmResult.response === 1) return; // キャンセル

    // 保存する値を作成（mapDataのコピー）
    const saveValue = cloneDeep(mapData.value);

    // 2. Change: ステータスの場合、Copy に変更するかの確認
    // 旧実装: response===0(OK) → Copy, response===1(Cancel) → Keep Change
    // 新実装翻訳ファイルに copy_or_move キーがあるのでそちらを使用
    if (saveValue.status && saveValue.status.match(/^Change:(.+)$/)) {
        const copyResult = await (window as any).dialog.showMessageBox({
            type: 'info',
            buttons: ['OK', 'Cancel'],
            cancelId: 1,
            message: t('mapedit.copy_or_move')
        });
        if (copyResult.response === 0) {
            // OK → Copy（旧 mapID を保持、新 mapID でコピー）
            const origMapID = originalMapData.value.mapID as string;
            saveValue.status = `Copy:${origMapID}`;
        }
        // キャンセル → そのまま Change（リネーム）
    }

    // 3. tins 収集（旧実装: vueMap.tinObjects.map(tin => tin.getCompiled())）
    const tins = tinObjects.value.map((tin: any) => {
        if (!tin || typeof tin === 'string') return tin || 'tooLessGcps';
        return tin.getCompiled();
    });

    // 4. IPC で保存（旧実装: window.mapedit.save + once('saveResult')）
    // JSON ラウンドトリップで Vue リアクティブプロキシ・非シリアライズ可能値を除去してから送信
    const result = await (window as any).mapedit.save(
        JSON.parse(JSON.stringify(saveValue)),
        JSON.parse(JSON.stringify(tins))
    );

    if (result === 'Success') {
        await (window as any).dialog.showMessageBox({
            type: 'info',
            buttons: ['OK'],
            message: t('mapedit.success_save')
        });
        // mapID が変わっている場合は更新（旧実装: mapID = vueMap.mapID）
        mapID.value = saveValue.mapID;
        // 旧実装: window.mapedit.request(mapID) で再ロード
        try {
            const reloadedData = await (window as any).mapedit.request(mapID.value);
            if (reloadedData) {
                if (!reloadedData.mapID) reloadedData.mapID = mapID.value;
                if (!reloadedData.status) reloadedData.status = 'Update';
                mapData.value = reloadedData;
                originalMapData.value = cloneDeep(reloadedData);
                sub_maps.value = cloneDeep(reloadedData.sub_maps || []);
                gcps.value = cloneDeep(reloadedData.gcps || []);
                edges.value = cloneDeep(reloadedData.edges || []);
                homePosition.value = reloadedData.homePosition;
                mercZoom.value = reloadedData.mercZoom;
                strictMode.value = reloadedData.strictMode || 'strict';
                vertexMode.value = reloadedData.vertexMode || 'plain';
                // TINsリセット（再ロード後は全レイヤー未計算状態）
                tinObjects.value = Array(1 + sub_maps.value.length).fill(undefined);
            }
        } catch (e) {
            console.error('[saveMap] Failed to reload after save:', e);
            // 最低限 isDirty をリセット
            originalMapData.value = cloneDeep(mapData.value);
        }
        onlyOne.value = true;
    } else if (result === 'Exist') {
        await (window as any).dialog.showMessageBox({
            type: 'info',
            buttons: ['OK'],
            message: t('mapedit.error_duplicate_id')
        });
    } else {
        console.error('[saveMap] Save error:', result);
        await (window as any).dialog.showMessageBox({
            type: 'info',
            buttons: ['OK'],
            message: t('mapedit.error_saving')
        });
    }
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
    const progressHandler = (_event: any, arg: any) => {
        modalProgress(arg.text, arg.percent, arg.progress);
    };
    (window as any).ipcRenderer.on('mapedit:taskProgress', progressHandler);
    try {
        const arg = await (window as any).dataupload.showDataSelectDialog();

        if (arg.err) {
            if (arg.err === 'Canceled') {
                modalHide();
            } else if (arg.err === 'Exist') {
                modalFinish(t('dataupload.error_exist'));
            } else if (arg.err === 'NoTile') {
                modalFinish(t('dataupload.error_no_tile'));
            } else if (arg.err === 'NoTmb') {
                modalFinish(t('dataupload.error_no_tmb'));
            } else {
                console.error('[importMap]', arg.err);
                modalFinish(t('dataupload.error_upload'));
            }
        } else {
            modalFinish(t('dataupload.success_upload'));
            // 旧実装: mapDataCommon(arg[0], arg[1]) 相当
            const { mapData: histMap, tins: compiledTins } = arg;
            mapData.value = histMap;
            originalMapData.value = cloneDeep(histMap);
            sub_maps.value = cloneDeep(histMap.sub_maps || []);
            gcps.value = cloneDeep(histMap.gcps || []);
            edges.value = cloneDeep(histMap.edges || []);
            homePosition.value = histMap.homePosition;
            mercZoom.value = histMap.mercZoom;
            strictMode.value = histMap.strictMode || 'strict';
            vertexMode.value = histMap.vertexMode || 'plain';
            onlyOne.value = true;
            // TIN インスタンスを生成（旧実装: vueMap.tinObjects = tins.map(...)）
            if (compiledTins && compiledTins.length > 0) {
                tinObjects.value = compiledTins.map((compiled: any) => {
                    if (typeof compiled === 'string') return compiled;
                    const tin = new Tin({});
                    tin.setCompiled(compiled);
                    return tin;
                });
            } else {
                tinObjects.value = Array(1 + sub_maps.value.length).fill(undefined);
            }
            // タイル・マーカー反映
            if (histMap.url_) await loadMapTiles();
            gcpsToMarkers();
        }
    } finally {
        (window as any).ipcRenderer.off('mapedit:taskProgress', progressHandler);
    }
};

// 旧実装: vueMap.$on('exportMap') 相当
// 有効条件: !error && !dirty
const exportMap = async () => {
    modalShow('mapedit.message_export');
    const progressHandler = (_event: any, arg: any) => {
        modalProgress(arg.text, arg.percent, arg.progress);
    };
    (window as any).ipcRenderer.on('mapedit:taskProgress', progressHandler);
    try {
        // 旧実装: window.mapedit.download(vueMap.map, vueMap.tinObjects.map(...))
        const tins = tinObjects.value.map((tin: any) => {
            if (!tin || typeof tin === 'string') return tin || 'tooLessGcps';
            return tin.getCompiled();
        });
        const result = await (window as any).mapedit.download(
            JSON.parse(JSON.stringify(mapData.value)),
            JSON.parse(JSON.stringify(tins))
        );
        if (result === 'Success') {
            modalFinish(t('mapedit.export_success'));
        } else if (result === 'Canceled') {
            modalFinish(t('mapedit.imexport_canceled'));
        } else {
            console.error('[exportMap]', result);
            modalFinish(t('mapedit.export_error'));
        }
    } finally {
        (window as any).ipcRenderer.off('mapedit:taskProgress', progressHandler);
    }
};

// 旧実装: vueMap.$on('wmtsGenerate') 相当
// 有効条件: wmtsEditReady
const wmtsGenerate = async () => {
    if (!tinObjects.value[0] || typeof tinObjects.value[0] === 'string') return;
    modalShow(t('wmtsgenerate.generating_tile'));
    const progressHandler = (_event: any, arg: any) => {
        modalProgress(arg.text, arg.percent, arg.progress);
    };
    (window as any).ipcRenderer.on('mapedit:taskProgress', progressHandler);
    try {
        // 旧実装: window.wmtsGen.generate(vueMap.mapID, vueMap.width, vueMap.height, vueMap.tinObjects[0].getCompiled(), vueMap.imageExtension, vueMap.mainLayerHash)
        const arg = await (window as any).wmtsGen.generate(
            mapData.value.mapID,
            mapData.value.width,
            mapData.value.height,
            JSON.parse(JSON.stringify(tinObjects.value[0].getCompiled())),
            mapData.value.imageExtension || 'jpg',
            mainLayerHash.value
        );
        if (arg.err) {
            console.error('[wmtsGenerate]', arg.err);
            modalFinish(t('wmtsgenerate.error_generation'));
        } else {
            // 旧実装: vueMap.wmtsHash = arg.hash
            mapData.value.wmtsHash = arg.hash;
            modalFinish(t('wmtsgenerate.success_generation'));
        }
    } finally {
        (window as any).ipcRenderer.off('mapedit:taskProgress', progressHandler);
    }
};

// 旧実装: vueMap.$on('uploadCsv') 相当
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
    if (isDirty.value) {
        const response = await (window as any).dialog.showMessageBox({
            type: 'info',
            buttons: ['OK', 'Cancel'],
            cancelId: 1,
            message: t('mapedit.confirm_no_save')
        });
        if (response.response !== 0) return;
    }
    router.push({ name: 'MapList' });
};

</script>

<template>
    <div class="d-flex flex-column h-100 text-start">

        <!-- ProgressModal: 旧実装の #staticModal 相当 -->
        <ProgressModal
            :visible="modalVisible"
            :text="modalText"
            :percent="modalPercent"
            :progress-text="modalProgressText"
            :enable-close="modalEnableClose"
            @close="modalHide"
        />

        <!-- 1. Header Area (Mimicking title-container) -->
        <div class="px-4 py-3 pb-0 d-flex align-items-center flex-shrink-0 bg-white">
            <div class="row w-100 align-items-center g-2">
                <!-- Title & Back -->
                <div class="col-5 d-flex align-items-center gap-2">
                    <h4>
                        <a href="#" class="text-decoration-none" @click.prevent="goBack">&lt;&lt;</a>
                        <span class="ms-2 text-dark">{{ displayTitle || mapData.mapID || mapID }}</span>
                    </h4>
                </div>
                
                <!-- Language Label -->
                <div class="col-1 text-end">
                    <label class="fw-bold" for="lang">{{ t("common.language") }}</label>
                </div>
                
                <!-- Language Select -->
                <div class="col-2">
                    <!-- 旧実装 mapedit.html L.33-36: v-for="(v, k) in langs" に準拠 -->
                    <select class="form-select" id="lang" v-model="currentLang">
                        <option v-for="(v, k) in langsMap" :key="k" :value="k">{{ t('common.' + v) }}</option>
                    </select>
                </div>
                
                <!-- Default Checkbox -->
                <div class="col-2">
                    <div class="form-check d-flex align-items-center gap-1">
                        <input class="form-check-input" type="checkbox" id="langDefault" v-model="isDefaultLang" :disabled="isDefaultLang">
                        <label class="form-check-label fw-bold" for="langDefault">{{ t("mapedit.set_default") }}</label>
                    </div>
                </div>

                <!-- Save Button: 旧実装 v-bind:disabled="error || !dirty" 相当 -->
                <div class="col-2 text-end">
                    <button type="button" class="btn btn-primary w-100" @click="saveMap"
                            :disabled="!!saveError || !isDirty">{{ t("common.save") }}</button>
                </div>
            </div>
        </div>

        <!-- 2. Tabs -->
        <div class="px-4 mt-2">
             <ul class="nav nav-tabs nav-fill bg-white flex-shrink-0 border-bottom-0">
                <li class="nav-item">
                    <a class="nav-link" :class="{ active: activeTab === 'metadata' }" @click.prevent="activeTab = 'metadata'" href="#">
                        {{ t("mapedit.edit_metadata") }}
                    </a>
                </li>
                <!-- 旧実装 mapedit.html L.47: v-bind:class="{ disabled: !gcpsEditReady }" に準拠 -->
                <li class="nav-item">
                    <a class="nav-link"
                       :class="{ active: activeTab === 'gcps', disabled: !gcpsEditReady }"
                       :aria-disabled="!gcpsEditReady"
                       :tabindex="!gcpsEditReady ? -1 : undefined"
                       @click.prevent="gcpsEditReady && (activeTab = 'gcps')"
                       href="#">
                        {{ t("mapedit.edit_gcp") }}
                    </a>
                </li>
                <li class="nav-item">
                    <a class="nav-link" :class="{ active: activeTab === 'inout' }" @click.prevent="activeTab = 'inout'" href="#">
                        {{ t("mapedit.dataset_inout") }}
                    </a>
                </li>
                <li class="nav-item">
                    <a class="nav-link disabled" href="#" tabindex="-1" aria-disabled="true">
                        {{ t("mapedit.configure_map") }}
                    </a>
                </li>
            </ul>
        </div>

        <!-- 3. Main Content Area -->
        <div class="flex-grow-1 position-relative overflow-hidden bg-white border-top">
            
            <!-- Tab: Metadata (Full Page Form) -->
            <div v-show="activeTab === 'metadata'" class="h-100 overflow-auto p-3">
                <form class="container-fluid" @submit.prevent>
                    <!-- Row 1 -->
                    <div class="row g-1 mb-2">
                        <!-- Map ID フィールド: 旧実装 v-bind:disabled="onlyOne" 相当 -->
                        <div class="col-md-3" :class="mapIDError && mapIDError !== 'mapedit.check_uniqueness' ? 'has-error' : ''">
                            <label class="form-label fw-bold small mb-0">{{ t("mapedit.mapid") }}</label>
                            <input
                                type="text"
                                class="form-control form-control-sm"
                                :class="mapIDError && mapIDError !== 'mapedit.check_uniqueness' ? 'is-invalid' : ''"
                                v-model="mapData.mapID"
                                :disabled="onlyOne"
                                :placeholder="t('mapedit.input_mapid')"
                            >
                            <!-- バリデーションエラーメッセージ（旧実装 small.text-danger 相当） -->
                            <div v-if="mapIDError && mapIDError !== 'mapedit.check_uniqueness'"
                                 class="form-text small text-danger mb-0" style="font-size: 0.75rem;">
                                {{ t(mapIDError) }}
                            </div>
                            <!-- 一意性未確認メッセージ（旧実装 mapedit.check_uniqueness 相当） -->
                            <div v-else-if="mapIDError === 'mapedit.check_uniqueness'"
                                 class="form-text small text-danger mb-0" style="font-size: 0.75rem;">
                                {{ t('mapedit.check_uniqueness') }}
                            </div>
                            <div v-else class="form-text small mb-0" style="font-size: 0.75rem;">{{ t("mapedit.unique_mapid") }}</div>
                        </div>
                        <!-- ボタン: 旧実装 v-if="onlyOne"（Change）/ v-else（Check Uniqueness）相当 -->
                        <div class="col-md-2 d-flex align-items-start pt-4">
                            <!-- 既存地図: Change Map ID ボタン（フェーズ2.1で実装） -->
                            <button v-if="onlyOne"
                                    class="btn btn-danger btn-sm w-100 mt-1"
                                    @click="changeMapID">
                                {{ t("mapedit.change_mapid") }}
                            </button>
                            <!-- 新規地図: 一意性チェックボタン（フェーズ2.1で完全実装） -->
                            <button v-else
                                    class="btn btn-secondary btn-sm w-100 mt-1"
                                    :disabled="!!(mapIDError && mapIDError !== 'mapedit.check_uniqueness')"
                                    @click="checkOnlyOne">
                                {{ t("mapedit.uniqueness_button") }}
                            </button>
                        </div>
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
                                    @click="mapUpload">{{ t("mapedit.upload_map") }}</button>
                        </div>
                    </div>

                    <!-- Row 2 -->
                    <div class="row g-1 mb-2">
                        <div class="col-md-4">
                            <label class="form-label fw-bold small mb-0">{{ t("mapedit.map_name_repr") }}</label>
                            <input type="text" class="form-control form-control-sm" :class="saveError?.title ? 'is-invalid' : ''" v-model="title" :placeholder="t('mapedit.map_name_repr_pf')">
                            <div v-if="saveError?.title" class="form-text small text-muted text-danger mb-0" style="font-size: 0.75rem;">{{ saveError.title }}</div>
                            <div v-else class="form-text small mb-0" style="font-size: 0.75rem;">{{ t("mapedit.map_name_repr_desc") }}</div>
                        </div>
                        <div class="col-md-5">
                            <label class="form-label fw-bold small mb-0">{{ t("mapedit.map_name_ofc") }}</label>
                            <input type="text" class="form-control form-control-sm" v-model="officialTitle" :placeholder="t('mapedit.map_name_ofc_pf')">
                            <div class="form-text small mb-0" style="font-size: 0.75rem;">{{ t("mapedit.map_name_ofc_desc") }}</div>
                        </div>
                        <div class="col-md-3">
                            <label class="form-label fw-bold small mb-0">{{ t("mapedit.map_author") }}</label>
                            <input type="text" class="form-control form-control-sm" v-model="author" :placeholder="t('mapedit.map_author_pf')">
                            <div class="form-text small mb-0" style="font-size: 0.75rem;">{{ t("mapedit.map_author_desc") }}</div>
                        </div>
                    </div>

                    <!-- Row 3 -->
                    <div class="row g-1 mb-2">
                         <div class="col-md-3">
                            <label class="form-label fw-bold small mb-0">{{ t("mapedit.map_create_at") }}</label>
                            <input type="text" class="form-control form-control-sm" v-model="createdAt" :placeholder="t('mapedit.map_create_at_pf')">
                            <div class="form-text small mb-0" style="font-size: 0.75rem;">{{ t("mapedit.map_create_at_desc") }}</div>
                        </div>
                        <div class="col-md-3">
                            <label class="form-label fw-bold small mb-0">{{ t("mapedit.map_era") }}</label>
                            <input type="text" class="form-control form-control-sm" v-model="era" :placeholder="t('mapedit.map_era_pf')">
                            <div class="form-text small mb-0" style="font-size: 0.75rem;">{{ t("mapedit.map_era_desc") }}</div>
                        </div>
                        <div class="col-md-3">
                            <label class="form-label fw-bold small mb-0">{{ t("mapedit.map_owner") }}</label>
                            <input type="text" class="form-control form-control-sm" v-model="contributor" :placeholder="t('mapedit.map_owner_pf')">
                            <div class="form-text small mb-0" style="font-size: 0.75rem;">{{ t("mapedit.map_owner_desc") }}</div>
                        </div>
                        <div class="col-md-3">
                            <label class="form-label fw-bold small mb-0">{{ t("mapedit.map_mapper") }}</label>
                            <!-- 旧実装 mapedit.html L.125: placeholder は 'mapedit.map_mapper'（_pf なし）-->
                            <input type="text" class="form-control form-control-sm" v-model="mapper" :placeholder="t('mapedit.map_mapper')">
                            <div class="form-text small mb-0" style="font-size: 0.75rem;">{{ t("mapedit.map_mapper_desc") }}</div>
                        </div>
                    </div>

                    <!-- Row 4 -->
                    <div class="row g-1 mb-2">
                         <div class="col-md-3">
                            <label class="form-label fw-bold small mb-0">{{ t("mapedit.map_image_license") }}</label>
                            <select class="form-select form-select-sm" v-model="mapData.license" :disabled="!isDefaultLang">
                                <option value="All right reserved">{{ t("mapedit.cc_allright_reserved") }}</option>
                                <option value="CC BY">{{ t("mapedit.cc_by") }}</option>
                                <option value="CC BY-SA">{{ t("mapedit.cc_by_sa") }}</option>
                                <option value="CC BY-ND">{{ t("mapedit.cc_by_nd") }}</option>
                                <option value="CC BY-NC">{{ t("mapedit.cc_by_nc") }}</option>
                                <option value="CC BY-NC-SA">{{ t("mapedit.cc_by_nc_sa") }}</option>
                                <option value="CC BY-NC-ND">{{ t("mapedit.cc_by_nc_nd") }}</option>
                                <option value="CC0">{{ t("mapedit.cc0") }}</option>
                                <option value="PD">{{ t("mapedit.cc_pd") }}</option>
                            </select>
                            <div class="form-text small mb-0" style="font-size: 0.75rem;">{{ t("mapedit.map_image_license_desc") }}</div>
                        </div>
                         <div class="col-md-3">
                            <label class="form-label fw-bold small mb-0">{{ t("mapedit.map_gcp_license") }}</label>
                             <select class="form-select form-select-sm" v-model="mapData.dataLicense" :disabled="!isDefaultLang">
                                <option value="All right reserved">{{ t("mapedit.cc_allright_reserved") }}</option>
                                <option value="CC BY">{{ t("mapedit.cc_by") }}</option>
                                <option value="CC BY-SA">{{ t("mapedit.cc_by_sa") }}</option>
                                <option value="CC BY-ND">{{ t("mapedit.cc_by_nd") }}</option>
                                <option value="CC BY-NC">{{ t("mapedit.cc_by_nc") }}</option>
                                <option value="CC BY-NC-SA">{{ t("mapedit.cc_by_nc_sa") }}</option>
                                <option value="CC BY-NC-ND">{{ t("mapedit.cc_by_nc_nd") }}</option>
                                <option value="CC0">{{ t("mapedit.cc0") }}</option>
                            </select>
                            <div class="form-text small mb-0" style="font-size: 0.75rem;">{{ t("mapedit.map_gcp_license_desc") }}</div>
                        </div>
                        <div class="col-md-3">
                            <label class="form-label fw-bold small mb-0">{{ t("mapedit.map_copyright") }}</label>
                            <input type="text" class="form-control form-control-sm" :class="saveError?.attr ? 'is-invalid' : ''" v-model="attr" :placeholder="t('mapedit.map_copyright_pf')">
                            <div v-if="saveError?.attr" class="form-text small text-muted text-danger mb-0" style="font-size: 0.75rem;">{{ saveError.attr }}</div>
                            <div v-else class="form-text small mb-0" style="font-size: 0.75rem;">{{ t("mapedit.map_copyright_desc") }}</div>
                        </div>
                         <div class="col-md-3">
                            <label class="form-label fw-bold small mb-0">{{ t("mapedit.map_gcp_copyright") }}</label>
                            <input type="text" class="form-control form-control-sm" v-model="dataAttr" :placeholder="t('mapedit.map_gcp_copyright_pf')">
                             <div class="form-text small mb-0" style="font-size: 0.75rem;">{{ t("mapedit.map_gcp_copyright_desc") }}</div>
                        </div>
                    </div>
                    
                    <!-- Row 5 -->
                    <div class="row g-1 mb-2">
                        <div class="col-md-4">
                             <label class="form-label fw-bold small mb-0">{{ t("mapedit.map_source") }}</label>
                             <input type="text" class="form-control form-control-sm" v-model="mapData.reference" :disabled="!isDefaultLang" :placeholder="t('mapedit.map_source_pf')">
                             <div class="form-text small mb-0" style="font-size: 0.75rem;">{{ t("mapedit.map_source_desc") }}</div>
                        </div>
                         <div class="col-md-8">
                             <label class="form-label fw-bold small mb-0">{{ t("mapedit.map_tile") }}</label>
                             <input type="text" class="form-control form-control-sm" v-model="mapData.url" :disabled="!isDefaultLang" :placeholder="t('mapedit.map_tile_pf')">
                             <div class="form-text small mb-0" style="font-size: 0.75rem;">{{ t("mapedit.map_tile_desc") }}</div>
                        </div>
                    </div>

                    <!-- Row 6 -->
                     <div class="row g-2">
                         <div class="col-12">
                            <label class="form-label fw-bold small mb-0">{{ t("mapedit.map_description") }}</label>
                            <textarea class="form-control form-control-sm" rows="3" v-model="description" :placeholder="t('mapedit.map_description_pf')"></textarea>
                            <div class="form-text small mb-0" style="font-size: 0.75rem;">{{ t("mapedit.map_description_desc") }}</div>
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
                             <button class="btn btn-light btn-sm shadow-sm border" :disabled="!enableSetHomeIllst" @click="setHomeIllst"><i class="bi bi-house"></i></button>
                        </div>
                    </div>
                    
                    <!-- Right: Mercator Map (Destination/Reference) -->
                    <div class="col-6 h-100 position-relative px-1">
                        <div id="mercMap" class="w-100 h-100"></div>
                         <!-- Home Button Merc -->
                        <div class="position-absolute bottom-0 end-0 m-3 mb-4" style="z-index: 10;">
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

                             <!-- Column 3: Error Status -->
                             <div class="col-md-3">
                                 <span class="fw-bold">{{ t("mapedit.map_error_status") }}: </span>
                                 <span v-if="errorStatus === 'tooLessGcps'">{{ t('mapedit.map_error_too_short') }}</span>
                                 <span v-else-if="errorStatus === 'tooLinear'">{{ t('mapedit.map_error_linear') }}</span>
                                 <span v-else-if="errorStatus === 'pointsOutside'">{{ t('mapedit.map_error_outside') }}</span>
                                 <span v-else-if="errorStatus === 'edgeError'">{{ t('mapedit.map_error_crossing') }}</span>
                                 <span v-else-if="errorStatus === 'strict'">{{ t('mapedit.map_no_error') }}</span>
                                 <span v-else-if="errorStatus === 'strict_error'">{{ t('mapedit.map_error_number', {num: kinksCount}) }}</span>
                                 <span v-else-if="errorStatus === 'loose'">{{ t('mapedit.map_loose_by_error') }}</span>
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
                                    <!-- CSV エラーステータス -->
                                    <label>{{ t("dataio.import_csv_status") }}:</label>
                                    <span v-if="csvUpError === 'column_dup'" class="text-danger small ms-1">{{ t("dataio.csv_error_column_dup") }}</span>
                                    <span v-else-if="csvUpError === 'column_null'" class="text-danger small ms-1">{{ t("dataio.csv_error_column_null") }}</span>
                                    <span v-else-if="csvUpError === 'ignore_header'" class="text-danger small ms-1">{{ t("dataio.csv_error_ignore_header") }}</span>
                                    <span v-else-if="csvUpError === 'proj_text'" class="text-danger small ms-1">{{ t("dataio.csv_error_proj_text") }}</span>
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

            <!-- Tab: Settings (Placeholder) -->
            <div v-show="activeTab === 'settings'" class="p-4">
                <h4>{{ t("mapedit.configure_map") }}</h4>
                <p>Map specific settings here...</p>
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
