<script setup lang="ts">
import { ref, onMounted, computed, watch, onUnmounted, nextTick } from 'vue';
import { useRouter } from 'vue-router';
import { isEqual, cloneDeep } from 'lodash-es';
// @ts-ignore
import { useTranslation } from 'i18next-vue';
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
import { LineString, Point } from 'ol/geom';
import { transform } from 'ol/proj';
import { getCenter } from 'ol/extent';
import { Projection } from 'ol/proj';
import { XYZ } from 'ol/source';
import type { MapBrowserEvent } from 'ol';
import type Feature from 'ol/Feature';
import type { SimpleGeometry } from 'ol/geom';

const { t } = useTranslation();
const router = useRouter();
const mapID = ref('oba'); // Default or get from route?
const mapData = ref<any>({});
const originalMapData = ref<any>({}); // Store as deep clone for robust comparison
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
        
        // Update OpenLayers marker to mirror Vue Event Bus behavior
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
const sub_maps = ref([]); // Placeholder for sub_maps
const importance = ref(0);
const priority = ref(0);
const baseMapList = ref<any[]>([]);
const currentBaseMapID = ref('osm');

const activeTab = ref('metadata');

const gcps = ref<any[]>([]);
const newGcp = ref<any>(undefined);
const homePosition = ref<any>(undefined);
const mercZoom = ref<number | undefined>(undefined);
const edges = ref<any[]>([]);
const newlyAddEdge = ref<number | undefined>(undefined);
const tinObject = ref<any>(undefined);
const errorNumber = ref<number | null>(null);
// Module-level VectorSource references for check (coordinate test) layers
let illstCheckSource: VectorSource | null = null;
let mercCheckSource: VectorSource | null = null;
// errorStatus: TIN strict_status string
// NOTE: strict_status is a direct property of Transform class (not inside getCompiled())
const errorStatus = computed(() => {
    const tin = tinObject.value;
    if (!tin || typeof tin !== 'object') return tin as string | undefined;
    // Transform.strict_status is set directly after setCompiled()
    return tin.strict_status as string | undefined;
});

// kinksCount: kinks のエラー点数（strict_error 時に使用）
const kinksCount = computed(() => {
    const tin = tinObject.value;
    if (!tin || typeof tin !== 'object') return 0;
    return tin.kinks?.bakw?.features?.length ?? 0;
});

const editingID_ = ref('');
const strictMode = ref('auto');
const vertexMode = ref<'plain' | 'birdeye'>('plain');

const editableGCPID = computed({
  get() {
    if (newGcp.value) editingID_.value = '';
    return newGcp.value ? newGcp.value[2] : editingID_.value;
  },
  set(newValue) {
    if (newGcp.value) {
      editingID_.value = '';
    } else {
      editingID_.value = newValue;
    }
  }
});

const currentLang = ref('ja');

const onOffAttr = ['license', 'dataLicense', 'reference', 'url'];
const langAttr = ['title', 'officialTitle', 'author', 'era', 'createdAt', 'contributor',
  'mapper', 'attr', 'dataAttr', 'description'];

const arrayRoundTo = (array: number[], decimal: number) => {
    const factor = Math.pow(10, decimal);
    return array.map((item) => Math.round(item * factor) / factor);
};

// Custom Drag Interaction class, replicating MaplatEditor legacy behavior
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
                    // Triggers the reactive state updates natively instead of touching generic vueMap properties
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
        
        // Handling cursor pointer styling
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
        xy = isIllst && illstSource ? arrayRoundTo(illstSource.sysCoord2Xy(xy), 2) : arrayRoundTo(xy, 6);

        const gcpIndex = feature.get('gcpIndex');
        if (gcpIndex !== 'new') {
            const index = Number(gcpIndex);
            if (gcps.value[index]) {
                const gcp = gcps.value[index];
                gcp[isIllst ? 0 : 1] = xy;
                gcps.value.splice(index, 1, gcp);
                gcpsToMarkers();
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

let illstMap: any = null;
let illstSource: any = null;
let mercMap: any = null;
let mercSource: any = null;

// Cached VectorSource references for json/bounds layers (not exposed via MaplatMap.getSource)
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

    // Clear existing markers
    const illstSourceMarker = illstMap?.getSource('marker') as VectorSource;
    const mercSourceMarker = mercMap?.getSource('marker') as VectorSource;

    if (illstSourceMarker) illstSourceMarker.clear();
    if (mercSourceMarker) mercSourceMarker.clear();

    const addMarkerToMap = (pt1: number[], pt2: number[], index: number | string, isCurrentEditing: boolean) => {
        const isEditing = typeof index === 'number' && currentEditingLayer.value !== 0 && currentEditingLayer.value !== (gcps.value[index] ? gcps.value[index][2] : 0);
        
        let iconSrc;
        if (index === 'home') {
             // Home Marker (Red House)
             const homeSVG = `<svg version="1.1" id="Layer_2" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" x="0px" y="0px" width="20px" height="20px" viewBox="0 0 20 20" enable-background="new 0 0 20 20" xml:space="preserve">
<polygon x="0" y="0" points="10,0 20,10 17,10 17,20 3,20 3,10 0,10 10,0" stroke="#FF0000" fill="#FF0000" stroke-width="2"></polygon></svg>`;
             iconSrc = `data:image/svg+xml,${encodeURIComponent(homeSVG)}`;
        } else {
             // Regular GCP Marker (original label shape)
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

    // Add all existing GCPs
    gcps.value.forEach((gcp, index) => {
        addMarkerToMap(gcp[0], gcp[1], index, currentEditingLayer.value === gcp[2]);
    });

    // Add new GCP if it exists
    if (newGcp.value) {
        addMarkerToMap(newGcp.value[0], newGcp.value[1], 'new', true);
    }
    
    // Add home position marker if it exists
    if (homePosition.value) {
        const merc = transform(homePosition.value, 'EPSG:4326', 'EPSG:3857');
        // We only add to Mercator map right now, IllstMap requires TIN object to translate Mercator back to Pixels
        addMarkerToMap(undefined as any, merc, 'home', false);
    }

    // Draw Edges (Delaunay Borders)
    edges.value.forEach((edge, i) => {
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

const enableSetHomeIllst = computed(() => {
    return strictMode.value === 'strict' || strictMode.value === 'loose'; // Depends on TIN feature
});

const enableSetHomeMerc = computed(() => {
    return true; // Always allowed
});

const setHomeIllst = () => {
    console.warn("setHomeIllst visually requires TIN feature to translate illustrated map bounds to Mercator bounds.");
};

const setHomeMerc = () => {
    const view = mercMap.getView();
    const longlat = transform(view.getCenter(), 'EPSG:3857', 'EPSG:4326');
    const zoom = view.getZoom();
    
    homePosition.value = longlat;
    mercZoom.value = zoom;
    
    // Explicitly update mapData so isDirty triggers
    mapData.value.homePosition = cloneDeep(longlat);
    mapData.value.mercZoom = zoom;
    
    gcpsToMarkers();
};


const addNewMarker = (arg: any, map: any) => {
  const number = gcps.value.length + 1;
  const isIllst = map === illstMap;
  const coord = arg.coordinate;
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
    
    // Clear the pending marker BEFORE redrawing
    newGcp.value = undefined;
    editingID.value = String(gcps.value.length);
    gcpsToMarkers();
    mapData.value.gcps = cloneDeep(gcps.value);
  }
};

const removeMarker = (arg: any, map: any) => {
  const marker = arg.data.marker;
  const gcpIndex = marker.get('gcpIndex');
  if (gcpIndex === 'new') {
    newGcp.value = undefined;
    map.getSource('marker').removeFeature(marker);
  } else {
    // Delete connected edges and cascade indices
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
    mapData.value.edges = cloneDeep(edges.value);
    mapData.value.gcps = cloneDeep(gcps.value);
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
        // Check if edge already exists
        const exists = edges.value.some(e => e[2][0] === edgeIndices[0] && e[2][1] === edgeIndices[1]);
        if (!exists) {
            edges.value.push([[], [], edgeIndices]);
            gcpsToMarkers();
            mapData.value.edges = cloneDeep(edges.value);
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
        mapData.value.edges = cloneDeep(edges.value);
    }
};

const createContextMenu = (map: any) => {
  const contextmenu = new ContextMenu({
    width: 170,
    defaultItems: false,
    items: [
      { text: t('mapedit.context_add_marker'), callback: (e: any) => addNewMarker(e, map) }
    ]
  });
  
  contextmenu.on('open', (evt: any) => {
    // Typecast map element correctly below (contextmenu instance doesn't strictly type map property, so we use map arg directly)
    const feature = map.forEachFeatureAtPixel(evt.pixel, (ft: any) => ft as Feature, {
      layerFilter(layer: any) {
        return layer.get('name') === 'marker' || layer.get('name') === 'edges';
      },
      hitTolerance: 5
    });
    
    contextmenu.clear();
    
    if (feature) {
      if (feature.getGeometry()?.getType() === 'LineString') {
         // Feature is an Edge
         const edgeStartEnd = feature.get('startEnd');
         contextmenu.push({ 
             text: t('mapedit.context_correspond_line_remove') || 'Remove Edge', 
             data: { startEnd: edgeStartEnd }, 
             callback: (e: any) => removeEdge(e) 
         });
      } else {
        // Feature is a Marker
        const gcpIndex = feature.get('gcpIndex');
        if (gcpIndex !== 'home' && gcpIndex !== 'new') {
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
      // Pending marker adding logic
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
        setTimeout(() => loadMapTiles(), 100);
    }
    
    // Watch for tab switch to GCP: v-show hides the map container until the user clicks the tab,
    // so OpenLayers renders into a 0-height div. updateSize() forces a re-render.
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
    mapData.value.edges = cloneDeep(edges.value);
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
    // Original mapedit.js L.731-743
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

    // Render bounds (valid domain) on illstMap
    let bboxPoints: number[][];
    if (currentEditingLayer.value === 0) {
        bboxPoints = [
            [0, 0], [mapData.value.width, 0],
            [mapData.value.width, mapData.value.height],
            [0, mapData.value.height], [0, 0]
        ];
    } else {
        // For sub-layers: use bounds polygon (Phase 5)
        const bd = mapData.value.bounds || [];
        bboxPoints = [...bd, bd[0]];
    }
    if (bboxPoints && bboxPoints.length > 1) {
        const bboxGeoJson = { type: 'Feature', geometry: { type: 'Polygon', coordinates: [bboxPoints] }, properties: {} };
        const bboxFeatures = jsonReader.readFeatures(bboxGeoJson, { dataProjection: forProj, featureProjection: 'EPSG:3857' });
        if (illstBoundsSource) illstBoundsSource.addFeatures(bboxFeatures);
    }

    const tin = tinObject.value;
    if (!tin || typeof tin === 'string') return;

    // Render TIN mesh on both maps
    // NOTE: tins is a direct property on the Tin instance, NOT inside getCompiled()
    // Original mapedit.js: tinObject.tins.forw / tinObject.tins.bakw
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
        // Original mapedit.js L.706-709
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
    const wh = index === 0 ? [mapData.value.width, mapData.value.height] : null;
    const bounds = index !== 0 ? (mapData.value.bounds || null) : wh; // index=0 は wh として使う
    try {
        // Vue の Proxy は IPC の Structured Clone に対応しないため、JSON でプレーンオブジェクトに変換する
        const plainGcps = JSON.parse(JSON.stringify(gcpList.map((g: any[]) => [g[0], g[1]])));
        const plainEdges = JSON.parse(JSON.stringify(edges.value));
        const [, compiled] = await (window as any).mapedit.updateTin(
            plainGcps,
            plainEdges,
            index,
            bounds,
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

// A-1: 座標変換テスト（クリックした地点を相手地図に対応点で表示）
// Original mapedit.js onClick (L.581-649)
const onMapClick = async (evt: MapBrowserEvent<PointerEvent>) => {
    if (evt.originalEvent.altKey) return;
    if (!illstMap || !mercMap || !illstSource) return;

    const isIllst = (evt.map ?? (evt as any).target) === illstMap;
    const distMap = isIllst ? mercMap : illstMap;
    const srcMarkerLoc = evt.coordinate;

    // Clear previous test pins
    illstCheckSource?.clear();
    mercCheckSource?.clear();

    const tin = tinObject.value;
    if (typeof tin === 'string' || !tin) {
        // TIN error state
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

    // srcXy: TIN coordinate space ([illst_x, illst_y] or [merc_x, merc_y])
    const srcXy = isIllst
        ? illstSource.sysCoord2Xy(srcMarkerLoc)
        : srcMarkerLoc;

    // transform: isIllst=true → forwardTransform (illst→merc), false → backwardTransform (merc→illst)
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

    // bounds display layer (red polygon for valid domain)
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
    // json layer (TIN triangulation mesh)
    const illstJsonVSrc = new VectorSource({ wrapX: false });
    illstJsonSource = illstJsonVSrc;
    const illstJsonLayer = new VectorLayer({
        source: illstJsonVSrc
    });
    illstJsonLayer.set('name', 'json');
    // check layer (coordinate transform test pins)
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
    // check layer is added at top level (not overlay)
    illstMap.getLayers().push(illstCheckLayer);
    // onClick: coordinate transform test
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

    // bounds display layer
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
    // json layer (TIN mesh)
    const mercJsonVSrc = new VectorSource({ wrapX: false });
    mercJsonSource = mercJsonVSrc;
    const mercJsonLayer = new VectorLayer({
        source: mercJsonVSrc
    });
    mercJsonLayer.set('name', 'json');
    // check layer
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
    // check layer at top level
    mercMap.getLayers().push(mercCheckLayer);
    // onClick: coordinate transform test
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
    
    // Disable the pin marker when searching an address
    geocoder.on('addresschosen', () => {
        if (geocoder.getLayer && geocoder.getLayer()) {
            geocoder.getLayer().getSource().clear();
        }
    });
    
    mercMap.addControl(geocoder);
    
    // Set default view for Mercator
    const mercView = mercMap.getView();
    mercView.setCenter([15545266.36, 4253560.83]); // Tokyo
    mercView.setZoom(5);

    // Initial Base Map setup
    await setupBaseMaps();
};

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
        console.log('[loadMapTiles] source ready, mapData.gcps:', mapData.value.gcps?.length);

        // Set View center for illstMap — exact replica of legacy reflectIllstMap
        // Legacy does: illstView.setCenter(initialCenter) and NOTHING ELSE
        // It does NOT change view projection (stays EPSG:3857)
        const initialCenter = source.xy2SysCoord([mapData.value.width / 2, mapData.value.height / 2]);
        const illstView = illstMap.getView();
        illstView.setCenter(initialCenter);

        // --- Replicate legacy mapDataCommon flow ---
        // Populate gcps/edges/homePosition from loaded mapData (equivalent to vueMap.setInitialMap(json))
        if (mapData.value.gcps) gcps.value = mapData.value.gcps;
        if (mapData.value.edges) edges.value = mapData.value.edges;
        if (mapData.value.homePosition) homePosition.value = mapData.value.homePosition;
        if (mapData.value.mercZoom) mercZoom.value = mapData.value.mercZoom;
        if (mapData.value.strictMode) strictMode.value = mapData.value.strictMode;
        if (mapData.value.vertexMode) vertexMode.value = mapData.value.vertexMode;

        // Set mercMap view — replicate legacy reflectIllstMap GCP bounding box calculation
        // gcp[1] is ALREADY in EPSG:3857 (stored as merc coords from mercMap clicks)
        const MERC_MAX = 20037508.342789244;
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
            // Fallback: use homePosition (also EPSG:3857)
            mercMap.getView().setCenter(homePosition.value);
            if (mercZoom.value) mercMap.getView().setZoom(mercZoom.value);
        }

        // Draw markers, then compute & render TIN (equivalent to legacy gcpsToMarkers() + tinResultUpdate())
        gcpsToMarkers();
        updateTin();

    } catch (e) {
        console.error("Failed to load map tiles via factory:", e);
    }
};

// Mirror original vueMap watchers: gcps/edges/strictMode/vertexMode → updateTin()
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

    // Populate baseMapList if empty
    if (baseMapList.value.length === 0) {
        
        // 1. Fetch via legacy API which now properly checks custom settings/tmsList.json 
        // and settings/tmsList.[mapID].json logic
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
        
        // 2. Try fetching tms_list.json from root (public) as fallback if IPC fails or mapID missing
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
        
        // 3. Fallback to defaults
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

        // Legacy: source.setAttributions(attr) - mapSourceFactory handles this usually.
        
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
    // Replace index 0 (default base layer) with our Group
    mapLayers.setAt(0, layerGroup);
};

const changeBaseMap = async () => {
    // Deprecated: LayerSwitcher handles switching.
    // We might want to update currentBaseMapID if we listen to layer changes, but strictly speaking checking visual is enough.
};

const saveMap = () => {
    console.log("Saving map...", mapData.value);
    // TODO: Actually save data
    originalMapData.value = cloneDeep(mapData.value);
};

// A-3: エラー点の順送り表示
// Original mapedit.js L.1686-1700
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

// Placeholder functions for new UI elements
const addSubMap = () => { console.log("Add sub map"); };
const upImportance = () => { console.log("Up importance"); };
const downImportance = () => { console.log("Down importance"); };
const upPriority = () => { console.log("Up priority"); };
const downPriority = () => { console.log("Down priority"); };
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
                                            <option v-for="(_, index) in sub_maps" :value="index+1">{{ t("mapedit.map_sublayer") }}{{index+1}}</option>
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
