<script setup lang="ts">
import { ref, onMounted, computed, watch, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { isEqual, cloneDeep } from 'lodash-es';
// @ts-ignore
import { useTranslation } from 'i18next-vue';
// @ts-ignore
import Geocoder from 'ol-geocoder';
import 'ol-geocoder/dist/ol-geocoder.min.css';
// @ts-ignore
import { MaplatMap } from '@maplat/core/src/map_ex';
// @ts-ignore
import { mapSourceFactory } from '@maplat/core/src/source_ex';
import { defaults as interactionDefaults } from 'ol/interaction';
import { defaults as controlDefaults } from 'ol/control';
import { altKeyOnly } from 'ol/events/condition';
import { DragRotateAndZoom } from 'ol/interaction';

const { t } = useTranslation();
const router = useRouter();

// ... imports
const activeTab = ref('metadata');
const mapID = ref('oba'); // Default or get from route?
const mapData = ref<any>({});
const originalMapData = ref<any>({}); // Store as deep clone for robust comparison
const mappingUIRow = ref('layer');
const currentEditingLayer = ref(0);
const editingID = ref('');
const editingX = ref<number | ''>('');
const editingY = ref<number | ''>('');
const editingLong = ref<number | ''>('');
const editingLat = ref<number | ''>('');
const sub_maps = ref([]); // Placeholder for sub_maps
const importance = ref(0);
const priority = ref(0);
const baseMapList = ref<any[]>([]);
const currentBaseMapID = ref('osm');

const currentLang = ref('ja');

const onOffAttr = ['license', 'dataLicense', 'reference', 'url'];
const langAttr = ['title', 'officialTitle', 'author', 'era', 'createdAt', 'contributor',
  'mapper', 'attr', 'dataAttr', 'description'];

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
            val_[lang] = val || ''; // Ensure old val is preserved
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
            // val = cloneDeep(val); // Avoid mutation issues if needed, but direct mutation works with reactive
            val[locale] = value;
        }
    }
    mapData.value[key] = val;
};

const createLangComputed = (key: string) => computed({
    get: () => localedGet(key),
    set: (val: string) => localedSet(key, val)
});

// Computed properties for localized fields
const title = createLangComputed('title');
const officialTitle = createLangComputed('officialTitle');
const author = createLangComputed('author');
const era = createLangComputed('era');
const createdAt = createLangComputed('createdAt');
const contributor = createLangComputed('contributor'); // defined as 'owner' in template? check template
const mapper = createLangComputed('mapper');
const attr = createLangComputed('attr');
const dataAttr = createLangComputed('dataAttr');
const description = createLangComputed('description');

// Mapping for template variable names if they differ
// Template uses: title, officialTitle, author, createAt (createdAt?), era, owner (contributor?), mapper
// Check template binding names:
// v-model="mapData.createAt" -> createdAt in langAttr
// v-model="mapData.owner" -> contributor in langAttr

const isDefaultLang = computed({
    get: () => (mapData.value.lang || 'ja') === currentLang.value,
    set: (newValue: boolean) => {
        if (newValue) {
            const oldLang = mapData.value.lang || 'ja';
            const newLang = currentLang.value;
            if (oldLang === newLang) return;

            const buffer: any = {};
            // 1. Get all values for oldLang
            for (const attr of langAttr) {
                // We need to use localedGetBylocale equivalent logic
                // But simplified: extract value for oldLang
                let val = mapData.value[attr];
                if (typeof val !== 'object' || val === null) {
                    buffer[attr] = val || '';
                } else {
                    buffer[attr] = val[oldLang] || '';
                }
            }
            
            // 2. Set new lang
            mapData.value.lang = newLang;
            
            // 3. Re-set values to swap/update structure
            for (const attr of langAttr) {
                // Set oldLang value (now secondary)
                // We can reuse localedSet logic but we need to force the locale
                // It's complicated to call localedSet because it depends on currentLang.
                // Better to manipulate object directly.
                
                let currentVal = mapData.value[attr];
                // Resetting to normalize is tricky.
                // Let's use the logic:
                // We need to ensure newLang value is at root (or top of object?)
                // Actually, the storage format doesn't care which is root if it's an object,
                // BUT single string optimization depends on it.
                
                // Let's reconstruct.
                // We need the value for newLang (which is in `this[attr]` in original, i.e., localedGet(attr))
                const newVal = localedGet(attr); // This retrieves value for newLang (currentLang)
                const oldVal = buffer[attr]; // Retrieved above
                
                // Now constructs the new state
                // If we set newLang as default, we might want to consolidate.
                // But `localedSet` handles specific locale setting.
                
                // Simplest approach:
                // 1. Clear the field to empty or {}
                // 2. Set oldVal for oldLang
                // 3. Set newVal for newLang
                
                // But avoiding data loss if other langs exist.
                let combined: any = mapData.value[attr];
                if (typeof combined !== 'object' || combined === null) {
                    combined = {}; 
                }
                
                combined[oldLang] = oldVal;
                combined[newLang] = newVal;
                
                // Optimization: if other langs empty, maybe simpler? 
                // Let's just set the object with correct keys.
                mapData.value[attr] = combined;
                
                // Trigger cleanup (single string optimization) via the setter logic?
                // Or just manually run the cleanup logic
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

const displayTitle = computed(() => {
    const title = mapData.value.title;
    if (!title) return t('mapedit.untitled') || "Untitled";
    if (typeof title !== 'object') return title;
    
    // Default lang title
    const lang = mapData.value.lang || 'ja';
    const defTitle = title[lang];
    if (defTitle) return defTitle;
    
    return t('mapedit.untitled') || "Untitled";
});

const canUpImportance = computed(() => false); // Placeholder
const canDownImportance = computed(() => false); // Placeholder
const canUpPriority = computed(() => false); // Placeholder
const canDownPriority = computed(() => false);

const enableSetHomeIllst = computed(() => true); // Temporary enable for UI test
const enableSetHomeMerc = computed(() => true);

const errorNumber = ref(0); // Placeholder
const errorStatus = ref(''); // Placeholder for error status

let illstMap: any = null;
let illstSource: any = null;
let mercMap: any = null;
let mercSource: any = null;

onMounted(async () => {
    const urlParams = new URLSearchParams(window.location.hash.split('?')[1]);
    const id = urlParams.get('mapid');
    if (id) {
        mapID.value = id;
    }

    try {
        const data = await (window as any).mapedit.request(mapID.value);
        if (data) {
            mapData.value = data;
            originalMapData.value = cloneDeep(data);
        }
        
        const tmsList = await (window as any).settings.get('tmsList');
        if (tmsList && Array.isArray(tmsList)) {
            baseMapList.value = tmsList;
        } else {
             // Fallback default
             baseMapList.value = [
                 { mapID: 'osm', title: 'OpenStreetMap' },
                 { mapID: 'gsi', title: 'Geospatial Information Authority of Japan' }
             ];
        }
        
    } catch (e) {
        console.error("Failed to load map data or settings:", e);
    }

    initMaps();
    if (mapData.value.url_) {
        // Delay load slightly to ensure div is ready?
        setTimeout(() => loadMapTiles(), 100);
    }
});

const initMaps = () => {
    // 1. Initialize Illustrated Map (LEFT side)
    illstMap = new MaplatMap({
        div: 'illstMap',
        interactions: interactionDefaults().extend([
            new DragRotateAndZoom({
                condition: altKeyOnly
            })
        ]),
        controls: controlDefaults()
    });

    // 2. Initialize Mercator Map (RIGHT side)
    mercMap = new MaplatMap({
        div: 'mercMap',
        interactions: interactionDefaults().extend([
            new DragRotateAndZoom({
                condition: altKeyOnly
            })
        ]),
        controls: controlDefaults().extend([
            new LayerSwitcher()
        ])
    });
    
    // Add Geocoder
    const geocoder = new Geocoder('nominatim', {
        provider: 'osm',
        lang: 'en-US',
        placeholder: t('mapedit.control_put_address'),
        limit: 5,
        keepOpen: false
    });
    mercMap.addControl(geocoder);
    
    // Set default view for Mercator
    const mercView = mercMap.getView();
    mercView.setCenter([15545266.36, 4253560.83]); // Tokyo
    mercView.setZoom(5);

    // Initial Base Map
    changeBaseMap();
};

import LayerSwitcher from 'ol-layerswitcher';

// ... (imports)

const loadMapTiles = async () => {
    if (!illstMap) return;
    
    // Using mapSourceFactory as per legacy logic (reflectIllstMap)
    // This handles non-square tiles (HistMap) and other settings properly.
    const options = {
        mapID: mapID.value,
        url: mapData.value.url_,
        width: mapData.value.width,
        height: mapData.value.height,
        attr: mapData.value.attr,
        noload: true, // IMPORTANT: This tells factory to create HistMap/HistMap_tin for direct use
        imageExtension: mapData.value.extension || 'jpg'
    };

    try {
        const source = await mapSourceFactory(options, {});
        illstSource = source;
        illstMap.exchangeSource(source);

        // Set View logic (simplified from legacy xys2Size logic for now, aiming for center/fit)
        const initialCenter = source.xy2SysCoord([mapData.value.width / 2, mapData.value.height / 2]);
        const illstView = illstMap.getView();
        illstView.setCenter(initialCenter);
        // Zoom defaults?
        illstView.setZoom(2); 
    } catch (e) {
        console.error("Failed to load map tiles via factory:", e);
    }
};

const changeBaseMap = async () => {
    if (!mercMap) return;
    
    const targetID = currentBaseMapID.value;
    const targetMap = baseMapList.value.find(m => m.mapID === targetID);
    
    if (targetMap) {
        try {
            let source;
            if (['osm', 'gsi', 'gsi_ortho'].includes(targetMap.mapID)) {
                source = await mapSourceFactory(targetMap.mapID, {});
            } else {
                 // Generic XYZ or TMS from tmsList
                 source = await mapSourceFactory({
                     mapID: targetMap.mapID || 'custom',
                     url: targetMap.url,
                     attr: targetMap.attr,
                     maptype: 'base', // or 'xyz'
                     maxZoom: targetMap.maxZoom || 18,
                     minZoom: targetMap.minZoom || 0
                 }, {});
            }
            
            if (source) {
                // For Mercator map (which is a MaplatMap), exchangeSource might be the way?
                // Or standard OL setSource.
                // MaplatMap.exchangeSource replaces the first layer.
                mercMap.exchangeSource(source);
                mercSource = source;
            }
        } catch (e) {
            console.error("Failed to change base map:", e);
        }
    }
};

const saveMap = () => {
    console.log("Saving map...", mapData.value);
    // TODO: Actually save data
    originalMapData.value = cloneDeep(mapData.value);
};

// Placeholder functions for new UI elements
const addSubMap = () => { console.log("Add sub map"); };
const upImportance = () => { console.log("Up importance"); };
const downImportance = () => { console.log("Down importance"); };
const upPriority = () => { console.log("Up priority"); };
const downPriority = () => { console.log("Down priority"); };
const setHomeIllst = () => { console.log("Set home illst"); };
const setHomeMerc = () => { console.log("Set home merc"); };
const goBack = async () => {
    if (isDirty.value) {
        const response = await (window as any).dialog.showMessageBox({
            type: 'info',
            buttons: ['OK', 'Cancel'],
            cancelId: 1,
            message: t('mapedit.confirm_no_save') || "Discard changes?"
        });
        if (response.response !== 0) return;
    }
    router.push({ name: 'MapList' });
};

</script>

<template>
    <div class="d-flex flex-column h-100 text-start">
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
                    <select class="form-select" id="lang" v-model="currentLang">
                        <option value="ja">{{ t("common.japanese") }}</option>
                        <option value="en">{{ t("common.english") }}</option>
                        <option value="fr">{{ t("common.french") }}</option>
                        <option value="de">{{ t("common.germany") }}</option>
                        <option value="es">{{ t("common.spanish") }}</option>
                        <option value="ko">{{ t("common.korean") }}</option>
                        <option value="zh-cn">{{ t("common.simplified") }}</option>
                        <option value="zh-tw">{{ t("common.traditional") }}</option>
                    </select>
                </div>
                
                <!-- Default Checkbox -->
                <div class="col-2">
                    <div class="form-check d-flex align-items-center gap-1">
                        <input class="form-check-input" type="checkbox" id="langDefault" v-model="isDefaultLang" :disabled="isDefaultLang">
                        <label class="form-check-label fw-bold" for="langDefault">{{ t("mapedit.set_default") }}</label>
                    </div>
                </div>

                <!-- Save Button -->
                <div class="col-2 text-end">
                    <button type="button" class="btn btn-primary w-100" @click="saveMap" :disabled="!isDirty">{{ t("common.save") }}</button>
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
                <li class="nav-item">
                    <a class="nav-link" :class="{ active: activeTab === 'gcps' }" @click.prevent="activeTab = 'gcps'" href="#">
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
                <form class="container-fluid">
                    <!-- Row 1 -->
                    <div class="row g-1 mb-2">
                        <div class="col-md-3">
                            <label class="form-label fw-bold small mb-0">{{ t("mapedit.mapid") }}</label>
                            <input type="text" class="form-control form-control-sm" v-model="mapData.mapID" disabled>
                            <div class="form-text small mb-0" style="font-size: 0.75rem;">{{ t("mapedit.unique_mapid") }}</div>
                        </div>
                        <div class="col-md-2 d-flex align-items-start pt-4">
                            <button class="btn btn-danger btn-sm w-100 mt-1">{{ t("mapedit.change_mapid") }}</button>
                        </div>
                        <div class="col-md-2">
                             <label class="form-label fw-bold small mb-0">{{ t("mapedit.image_width") }}</label>
                             <input type="number" class="form-control form-control-sm" v-model="mapData.width" disabled>
                        </div>
                         <div class="col-md-2">
                             <label class="form-label fw-bold small mb-0">{{ t("mapedit.image_height") }}</label>
                             <input type="number" class="form-control form-control-sm" v-model="mapData.height" disabled>
                        </div>
                         <div class="col-md-1">
                             <label class="form-label fw-bold small mb-0">{{ t("mapedit.extension") }}</label>
                             <input type="text" class="form-control form-control-sm" v-model="mapData.extension" disabled>
                        </div>
                         <div class="col-md-2 d-flex align-items-start pt-4">
                            <button class="btn btn-outline-secondary btn-sm w-100 mt-1">{{ t("mapedit.upload_map") }}</button>
                        </div>
                    </div>

                    <!-- Row 2 -->
                    <div class="row g-1 mb-2">
                        <div class="col-md-4">
                            <label class="form-label fw-bold small mb-0">{{ t("mapedit.map_name_repr") }}</label>
                            <input type="text" class="form-control form-control-sm" v-model="title">
                            <div class="form-text small mb-0" style="font-size: 0.75rem;">{{ t("mapedit.map_name_repr_desc") }}</div>
                        </div>
                        <div class="col-md-5">
                            <label class="form-label fw-bold small mb-0">{{ t("mapedit.map_name_ofc") }}</label>
                            <input type="text" class="form-control form-control-sm" v-model="officialTitle">
                            <div class="form-text small mb-0" style="font-size: 0.75rem;">{{ t("mapedit.map_name_ofc_desc") }}</div>
                        </div>
                        <div class="col-md-3">
                            <label class="form-label fw-bold small mb-0">{{ t("mapedit.map_author") }}</label>
                            <input type="text" class="form-control form-control-sm" v-model="author">
                            <div class="form-text small mb-0" style="font-size: 0.75rem;">{{ t("mapedit.map_author_desc") }}</div>
                        </div>
                    </div>

                    <!-- Row 3 -->
                    <div class="row g-1 mb-2">
                         <div class="col-md-3">
                            <label class="form-label fw-bold small mb-0">{{ t("mapedit.map_create_at") }}</label>
                            <input type="text" class="form-control form-control-sm" v-model="createdAt">
                            <div class="form-text small mb-0" style="font-size: 0.75rem;">{{ t("mapedit.map_create_at_desc") }}</div>
                        </div>
                        <div class="col-md-3">
                            <label class="form-label fw-bold small mb-0">{{ t("mapedit.map_era") }}</label>
                            <input type="text" class="form-control form-control-sm" v-model="era">
                            <div class="form-text small mb-0" style="font-size: 0.75rem;">{{ t("mapedit.map_era_desc") }}</div>
                        </div>
                        <div class="col-md-3">
                            <label class="form-label fw-bold small mb-0">{{ t("mapedit.map_owner") }}</label> <!-- Contributor -->
                            <input type="text" class="form-control form-control-sm" v-model="contributor">
                            <div class="form-text small mb-0" style="font-size: 0.75rem;">{{ t("mapedit.map_owner_desc") }}</div>
                        </div>
                        <div class="col-md-3">
                            <label class="form-label fw-bold small mb-0">{{ t("mapedit.map_mapper") }}</label>
                            <input type="text" class="form-control form-control-sm" v-model="mapper">
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
                            <input type="text" class="form-control form-control-sm" v-model="attr">
                             <div class="form-text small mb-0" style="font-size: 0.75rem;">{{ t("mapedit.map_copyright_desc") }}</div>
                        </div>
                         <div class="col-md-3">
                            <label class="form-label fw-bold small mb-0">{{ t("mapedit.map_gcp_copyright") }}</label>
                            <input type="text" class="form-control form-control-sm" v-model="dataAttr">
                             <div class="form-text small mb-0" style="font-size: 0.75rem;">{{ t("mapedit.map_gcp_copyright_desc") }}</div>
                        </div>
                    </div>
                    
                    <!-- Row 5 -->
                    <div class="row g-1 mb-2">
                        <div class="col-md-4">
                             <label class="form-label fw-bold small mb-0">{{ t("mapedit.map_source") }}</label>
                             <input type="text" class="form-control form-control-sm" v-model="mapData.reference" :disabled="!isDefaultLang">
                             <div class="form-text small mb-0" style="font-size: 0.75rem;">{{ t("mapedit.map_source_desc") }}</div>
                        </div>
                         <div class="col-md-8">
                             <label class="form-label fw-bold small mb-0">{{ t("mapedit.map_tile") }}</label>
                             <input type="text" class="form-control form-control-sm" v-model="mapData.url" :disabled="!isDefaultLang">
                             <div class="form-text small mb-0" style="font-size: 0.75rem;">{{ t("mapedit.map_tile_desc") }}</div>
                        </div>
                    </div>

                    <!-- Row 6 -->
                     <div class="row g-2">
                         <div class="col-12">
                            <label class="form-label fw-bold small mb-0">{{ t("mapedit.map_description") }}</label>
                            <textarea class="form-control form-control-sm" rows="3" v-model="description"></textarea>
                            <div class="form-text small mb-0" style="font-size: 0.75rem;">{{ t("mapedit.map_description_desc") }}</div>
                        </div>
                    </div>
                </form>
            </div>

            <!-- Tab: GCP (Map Split View) -->
            <div v-show="activeTab === 'gcps'" class="d-flex flex-column h-100">
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
                                            <option v-for="(sub_map, index) in sub_maps" :value="index+1">{{ t("mapedit.map_sublayer") }}{{index+1}}</option>
                                        </select>
                                    </div>
                                    <div class="col-md-3">
                                        <div class="btn-group w-100">
                                            <button class="btn btn-sm btn-outline-secondary" @click="addSubMap">{{ t("mapedit.map_addlayer") }}</button>
                                            <button class="btn btn-sm btn-outline-secondary" @click="$emit('removeSubMap')" :disabled="currentEditingLayer===0">{{ t("mapedit.map_removelayer") }}</button>
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
                                 <span v-else-if="errorStatus === 'strict_error'">{{ t('mapedit.map_error_number', {num: errorNumber}) }}</span>
                                 <span v-else-if="errorStatus === 'loose'">{{ t('mapedit.map_loose_by_error') }}</span>
                             </div>

                             <!-- Column 4: View Error Button -->
                             <div class="col-md-3 text-end">
                                 <button class="btn btn-sm btn-outline-danger" :class="{ 'd-none': errorNumber === 0 }" @click="$emit('viewError')">
                                     {{ t('mapedit.map_error_next') }}
                                 </button>
                             </div>
                         </div>
                    </div>
                </div>
            </div>

            <!-- Tab: Data IO -->
            <div v-show="activeTab === 'inout'" class="h-100 overflow-auto p-4">
                <div class="card mb-4">
                    <div class="card-header bg-light fw-bold">{{ t("dataio.import_title") }}</div>
                    <div class="card-body">
                        <div class="mb-3">
                            <label class="form-label d-block">{{ t("dataio.import_map_data") }}</label>
                            <button class="btn btn-outline-secondary">{{ t("dataio.import_map_data") }}</button>
                        </div>
                        <hr>
                        <div class="mb-3">
                             <h6 class="fw-bold">{{ t("dataio.import_csv") }}</h6>
                             <!-- CSV Input form placeholer -->
                             <div class="row g-3 align-items-end">
                                 <div class="col-md-2">
                                     <label class="form-label small">{{ t("dataio.pix_x_column") }}</label>
                                     <input type="number" class="form-control form-control-sm" value="1">
                                 </div>
                                  <div class="col-md-2">
                                     <label class="form-label small">{{ t("dataio.pix_y_column") }}</label>
                                     <input type="number" class="form-control form-control-sm" value="2">
                                 </div>
                                  <div class="col-md-2">
                                     <label class="form-label small">{{ t("dataio.lng_column") }}</label>
                                     <input type="number" class="form-control form-control-sm" value="3">
                                 </div>
                                  <div class="col-md-2">
                                     <label class="form-label small">{{ t("dataio.lat_column") }}</label>
                                     <input type="number" class="form-control form-control-sm" value="4">
                                 </div>
                                 <div class="col-md-2">
                                     <button class="btn btn-secondary btn-sm w-100">{{ t("dataio.import_csv_submit") }}</button>
                                 </div>
                             </div>
                        </div>
                    </div>
                </div>

                <div class="card">
                     <div class="card-header bg-light fw-bold">{{ t("dataio.export_title") }}</div>
                     <div class="card-body">
                         <div class="mb-3">
                             <button class="btn btn-outline-secondary me-3">{{ t("dataio.export_map_data") }}</button>
                             <button class="btn btn-secondary" disabled>{{ t("wmtsgenerate.generate") }}</button>
                         </div>
                         <p class="small text-muted text-end">
                             {{ t("wmtsgenerate.result_folder", { folder: "C:\\Users\\kochi\\OneDrive\\MaplatEditor\\wmts" }) }}
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
