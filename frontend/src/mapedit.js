import { HistMap_tin } from '@maplat/core/src/histmap_tin'; // eslint-disable-line no-unused-vars
import {HistMap} from '@maplat/core/src/histmap';
import bsn from 'bootstrap.native';
import {polygon, booleanPointInPolygon} from '@turf/turf';
import Map from "./model/map";
import ContextMenu from 'ol-contextmenu';
import Geocoder from 'ol-geocoder';
import Tin from '@maplat/tin';
import LayerSwitcher from "ol-layerswitcher/dist/ol-layerswitcher";
import { Pointer, Modify, Snap, DragRotateAndZoom, defaults as interactionDefaults } from 'ol/interaction';
import { defaults as controlDefaults } from 'ol/control';
import {Style, Icon, Stroke, Fill} from "ol/style";
import {LineString, Point} from "ol/geom";
import {Feature} from "ol";
import {GeoJSON} from "ol/format";
import {transform} from "ol/proj";
import {MERC_MAX} from "@maplat/core/src/const_ex";
import {MaplatMap} from "@maplat/core/src/map_ex";
import {altKeyOnly} from "ol/events/condition";
import {Vector as layerVector, Tile, Group} from "ol/layer";
import {Vector as sourceVector} from "ol/source";
import {Language} from './model/language';
import Header from '../vue/header.vue';

const onOffAttr = ['license', 'dataLicense', 'reference', 'url']; // eslint-disable-line no-unused-vars
const langAttr = ['title', 'officialTitle', 'author', 'era', 'createdAt', 'contributor', // eslint-disable-line no-unused-vars
    'mapper', 'attr', 'dataAttr', 'description'];

const labelFontStyle = "Normal 12px Arial";
const {ipcRenderer} = require('electron'); // eslint-disable-line no-undef
const backend = require('electron').remote.require('./mapedit'); // eslint-disable-line no-undef
backend.init();
const langObj = Language.getSingleton();

let uploader;
let mapID;
let newlyAddGcp;
let newlyAddEdge;
let errorNumber;
let illstMap;
let illstSource;
let mercMap;
let modify;
let snap;
const hashes = window.location.href.slice(window.location.href.indexOf('?') + 1).split('&'); // eslint-disable-line no-undef
for (let i = 0; i < hashes.length; i++) {
    const hash = hashes[i].split('=');
    if (hash[0] === 'mapid') mapID = hash[1];
}

function getTextWidth ( _text, _fontStyle ) {
    let canvas = undefined,
        context = undefined,
        metrics = undefined;

    canvas = document.createElement( "canvas" ); // eslint-disable-line no-undef

    context = canvas.getContext( "2d" );

    context.font = _fontStyle;
    metrics = context.measureText( _text );

    return metrics.width;
}

function gcpsToMarkers (targetIndex) {
    const gcps = vueMap.gcps;
    const edges = vueMap.edges;
    illstMap.resetMarker();
    mercMap.resetMarker();
    edgesClear();

    for (let i=0; i<gcps.length; i++) {
        const gcp = gcps[i];
        const mapXyIllst = illstSource.xy2HistMapCoords(gcp[0]);

        const labelWidth = getTextWidth( (i + 1), labelFontStyle ) + 10;

        const iconSVG = `<svg version="1.1" id="Layer_1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
x="0px" y="0px" width="${labelWidth}px" height="20px"
viewBox="0 0 ${labelWidth} 20" enable-background="new 0 0 ${labelWidth} 20" xml:space="preserve">
<polygon x="0" y="0" points="0,0 ${labelWidth},0 ${labelWidth},16 ${(labelWidth / 2 + 4)},16
${(labelWidth / 2)},20 ${(labelWidth / 2 - 4)},16 0,16 0,0" stroke="#000000" fill="${(i === targetIndex ? '#FF0000' : '#DEEFAE')}"
stroke-width="2"></polygon>
<text x="5" y="13" fill="#000000" font-family="Arial" font-size="12" font-weight="normal">${(i + 1)}</text></svg>`;

        const imageElement = new Image(); // eslint-disable-line no-undef
        imageElement.src = `data:image/svg+xml,${encodeURIComponent( iconSVG )}`;

        const iconStyle = new Style({
            "image": new Icon({
                "img": imageElement,
                "imgSize":[labelWidth, 70],
                "anchor": [0.5, 1],
                "offset": [0, -50]
            })
        });

        illstMap.setMarker(mapXyIllst, { gcpIndex: i }, iconStyle);
        mercMap.setMarker(gcp[1], { gcpIndex: i }, iconStyle);
    }
    for (let i=0; i<edges.length; i++) {
        const gcp1 = gcps[edges[i].startEnd[0]];
        const gcp2 = gcps[edges[i].startEnd[1]];
        const illst1 = illstSource.xy2HistMapCoords(gcp1[0]);
        const illst2 = illstSource.xy2HistMapCoords(gcp2[0]);
        const style = new Style({
            stroke: new Stroke({
                color: 'red',
                width: 2
            })
        });
        const mercCoords = [gcp1[1]];
        edges[i].mercNodes.map((node) => {
            mercCoords.push(node);
        });
        mercCoords.push(gcp2[1]);
        const mercLine = {
            geometry: new LineString(mercCoords),
            startEnd: edges[i].startEnd
        };
        const illstCoords = [illst1];
        edges[i].illstNodes.map((node) => {
            illstCoords.push(illstSource.xy2HistMapCoords(node));
        });
        illstCoords.push(illst2);
        const illstLine = {
            geometry: new LineString(illstCoords),
            startEnd: edges[i].startEnd
        };
        illstMap.setFeature(illstLine, style, 'edges');
        mercMap.setFeature(mercLine, style, 'edges');
    }
}

function edgeStartMarker (arg, map) { // eslint-disable-line no-unused-vars
    const marker = arg.data.marker;
    const gcpIndex = marker.get('gcpIndex');
    if (gcpIndex !== 'new') {
        newlyAddEdge = gcpIndex;
        gcpsToMarkers(gcpIndex);
    }
}

function edgeEndMarker (arg, map) { // eslint-disable-line no-unused-vars
    const marker = arg.data.marker;
    const gcpIndex = marker.get('gcpIndex');
    if (gcpIndex !== 'new') {
        const edge = [newlyAddEdge, gcpIndex].sort((a, b) => a > b ? 1 : a < b ? -1 : 0);
        newlyAddEdge = undefined;
        if (vueMap.edges.findIndex((item) => item.startEnd[0] === edge[0] && item.startEnd[1] === edge[1]) < 0) {
            vueMap.edges.push({
                startEnd: edge,
                mercNodes: [],
                illstNodes: []
            });
        } else {
            alert('その対応線は指定済です。'); // eslint-disable-line no-undef
        }
        gcpsToMarkers();
    }
}

function edgeCancelMarker (arg, map) { // eslint-disable-line no-unused-vars
    newlyAddEdge = undefined;
    gcpsToMarkers();
}

function addNewCancelMarker (arg, map) { // eslint-disable-line no-unused-vars
    newlyAddGcp = undefined;
    const gcps = vueMap.gcps;
    gcpsToMarkers(gcps);
}

function pairingMarker (arg, map) { // eslint-disable-line no-unused-vars
    const marker = arg.data.marker;
    const gcpIndex = marker.get('gcpIndex');
    if (gcpIndex !== 'new') {
        const gcps = vueMap.gcps;
        const gcp = gcps[gcpIndex];
        const forw = illstSource.xy2HistMapCoords(gcp[0]);
        const bakw = gcp[1];
        const forView = illstMap.getView();
        const bakView = mercMap.getView();
        forView.setCenter(forw);
        bakView.setCenter(bakw);
        forView.setZoom(illstSource.maxZoom - 1);
        bakView.setZoom(17);
    }
}

function removeEdge (arg, map) { // eslint-disable-line no-unused-vars
    const edge = arg.data.edge;
    const startEnd = edge.get('startEnd');
    const edges = vueMap.edges;
    const edgeIndex = edges.findIndex((item) => item.startEnd[0] === startEnd[0] && item.startEnd[1] === startEnd[1]);
    if (edgeIndex > -1) {
        edges.splice(edgeIndex, 1);
    }
    gcpsToMarkers();
}

function addMarkerOnEdge (arg, map) {
    const edgeGeom = arg.data.edge;
    const isIllst = map === illstMap;
    const coord = edgeGeom.getGeometry().getClosestPoint(arg.coordinate);
    const xy = isIllst ? illstSource.histMapCoords2Xy(coord) : coord;
    const startEnd = edgeGeom.get('startEnd');
    const edgeIndex = vueMap.edges.findIndex((edge) => edge.startEnd[0] === startEnd[0] && edge.startEnd[1] === startEnd[1]);
    const edge = vueMap.edges[edgeIndex];

    console.log(xy); // eslint-disable-line no-undef,no-console

    const gcp1 = vueMap.gcps[startEnd[0]];
    const gcp2 = vueMap.gcps[startEnd[1]];
    const this1 = gcp1[isIllst ? 0 : 1];
    const this2 = gcp2[isIllst ? 0 : 1];
    const that1 = gcp1[isIllst ? 1 : 0];
    const that2 = gcp2[isIllst ? 1 : 0];

    const thisNodes = Object.assign([], isIllst ? edge.illstNodes : edge.mercNodes);
    const thatNodes = Object.assign([], isIllst ? edge.mercNodes : edge.illstNodes);
    thisNodes.unshift(this1);
    thisNodes.push(this2);
    thatNodes.unshift(that1);
    thatNodes.push(that2);
    let nearest = 0;
    let nearestIndex = 0;
    let nearestLength = 0;
    const thisResults = thisNodes.reduce((prev, curr, index, arr) => {
        if (index === 0) {
            prev.push([0,0]);
            return prev;
        }
        const prevCoord = arr[index - 1];
        const length = Math.sqrt(Math.pow(curr[1] - prevCoord[1], 2) + Math.pow(curr[0] - prevCoord[0], 2));
        const distance = Math.abs((curr[1] - prevCoord[1]) * xy[0] - (curr[0] - prevCoord[0]) * xy[1] + curr[0] * prevCoord[1] - curr[1] * prevCoord[0]) / length;
        const sum = prev[index-1][1] + length;
        prev.push([length, sum, distance]);
        if (!nearestIndex || nearest > distance) {
            nearestIndex = index;
            nearest = distance;
            nearestLength = prev[index-1][1] + Math.sqrt(Math.pow(xy[1] - prevCoord[1], 2) + Math.pow(xy[0] - prevCoord[0], 2));
        }
        return prev;
    }, []);
    const thisPrevNodes = thisNodes.slice(1, nearestIndex);
    const thisLastNodes = thisNodes.slice(nearestIndex, thisNodes.length - 1);
    const nearestRatio = nearestLength / thisResults[thisResults.length - 1][1];

    const thatResults = thatNodes.reduce((prev, curr, index, arr) => {
        if (index === 0) {
            prev.push([0,0]);
            return prev;
        }
        const prevCoord = arr[index - 1];
        const length = Math.sqrt(Math.pow(curr[1] - prevCoord[1], 2) + Math.pow(curr[0] - prevCoord[0], 2));
        const sum = prev[index-1][1] + length;
        prev.push([length, sum]);
        return prev;
    }, []);
    let thatXy = [];
    let thatIndex  = 0;
    const thatLengthToXy = nearestRatio * thatResults[thatResults.length - 1][1];
    thatResults.map((result, index, arr) => {
        if (thatLengthToXy < result[1] && !thatIndex) {
            thatIndex = index;
            const localRatio = (thatLengthToXy - arr[index - 1][1]) / result[0];
            const prevNode = thatNodes[index - 1];
            const nextNode = thatNodes[index];
            thatXy = [(nextNode[0] - prevNode[0]) * localRatio + prevNode[0],
                (nextNode[1] - prevNode[1]) * localRatio + prevNode[1]];
        }
    });
    const thatPrevNodes = thatNodes.slice(1, thatIndex);
    const thatLastNodes = thatNodes.slice(thatIndex, thatNodes.length - 1);
    vueMap.gcps.push([isIllst ? xy : thatXy, isIllst ? thatXy : xy]);
    const newGcpIndex = vueMap.gcps.length - 1;
    vueMap.edges.splice(edgeIndex, 1, {
        startEnd: [startEnd[0], newGcpIndex],
        illstNodes: isIllst ? thisPrevNodes : thatPrevNodes,
        mercNodes: isIllst ? thatPrevNodes : thisPrevNodes
    });
    vueMap.edges.push({
        startEnd: [newGcpIndex, startEnd[1]],
        illstNodes: isIllst ? thisLastNodes : thatLastNodes,
        mercNodes: isIllst ? thatLastNodes : thisLastNodes
    });
    gcpsToMarkers();
}

function removeMarker (arg, map) {
    const marker = arg.data.marker;
    const gcpIndex = marker.get('gcpIndex');
    if (gcpIndex === 'new') {
        newlyAddGcp = undefined;
        map.getSource('marker').removeFeature(marker);
    } else {
        const gcps = vueMap.gcps;
        gcps.splice(gcpIndex, 1);
        const edges = vueMap.edges;
        for (let i = edges.length-1; i >= 0; i--) {
            const edge = edges[i];
            if (edge.startEnd[0] === gcpIndex || edge.startEnd[1] === gcpIndex) {
                edges.splice(i, 1);
            } else {
                if (edge.startEnd[0] > gcpIndex) edge.startEnd[0] = edge.startEnd[0] - 1;
                if (edge.startEnd[1] > gcpIndex) edge.startEnd[1] = edge.startEnd[1] - 1;
            }
        }
        gcpsToMarkers();
    }
}

function addNewMarker (arg, map) {
    const gcps = vueMap.gcps;
    const number = gcps.length + 1;
    const isIllst = map === illstMap;
    const coord = arg.coordinate;
    const xy = isIllst ? illstSource.histMapCoords2Xy(coord) : coord;

    if (!newlyAddGcp) {
        const labelWidth = getTextWidth( number, labelFontStyle ) + 10;

        const iconSVG = `<svg version="1.1" id="Layer_1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
x="0px" y="0px" width="${labelWidth}px" height="20px" viewBox="0 0 ${labelWidth} 20"
enable-background="new 0 0 ${labelWidth} 20" xml:space="preserve">
<polygon x="0" y="0" points="0,0 ${labelWidth},0 ${labelWidth},16 ${(labelWidth / 2 + 4)},16
${(labelWidth / 2)},20 ${(labelWidth / 2 - 4)},16 0,16 0,0" stroke="#000000" fill="#FFCCCC" stroke-width="2"></polygon>
<text x="5" y="13" fill="#000000" font-family="Arial" font-size="12" font-weight="normal">${number}</text></svg>`;

        const imageElement = new Image(); // eslint-disable-line no-undef
        imageElement.src = `data:image/svg+xml,${encodeURIComponent( iconSVG )}`;

        const iconStyle = new Style({
            "image": new Icon({
                "img": imageElement,
                "imgSize":[labelWidth, 70],
                "anchor": [0.5, 1],
                "offset": [0, -50]
            })
        });

        map.setMarker(coord, { gcpIndex: 'new' }, iconStyle);

        newlyAddGcp = isIllst ? [xy, ] : [, xy]; // eslint-disable-line no-sparse-arrays
    } else if ((isIllst && !newlyAddGcp[0]) || (!isIllst && !newlyAddGcp[1])) {
        if (isIllst) { newlyAddGcp[0] = xy; } else { newlyAddGcp[1] = xy; }
        gcps.push(newlyAddGcp);
        gcpsToMarkers();
        newlyAddGcp = undefined;
    }
}

function jsonClear() {
    illstMap.getSource('json').clear();
    mercMap.getSource('json').clear();
}

function checkClear() {
    illstMap.getSource('check').clear();
    mercMap.getSource('check').clear();
}

function boundsClear() {
    illstMap.getSource('bounds').clear();
}

function edgesClear() {
    illstMap.getSource('edges').clear();
    mercMap.getSource('edges').clear();
}

function onClick(evt) {
    if (evt.pointerEvent.altKey) return;
    const t = langObj.t;
    const isIllst = this === illstMap;
    const srcMap = isIllst ? illstMap : mercMap;
    const distMap = isIllst ? mercMap : illstMap;
    const srcMarkerLoc = evt.coordinate;
    const srcXy = isIllst ? illstSource.histMapCoords2Xy(srcMarkerLoc) : srcMarkerLoc;

    const srcCheck = srcMap.getSource('check');
    const distCheck = distMap.getSource('check');
    srcCheck.clear();
    distCheck.clear();

    const tinObject = vueMap.tinObject;
    if (typeof tinObject === 'string') {
        alert(tinObject === 'tooLessGcps' ? t('mapedit.testerror_too_short') : // eslint-disable-line no-undef
            tinObject === 'tooLinear' ? t('mapedit.testerror_too_linear') :
                tinObject === 'pointsOutside' ? t('mapedit.testerror_outside') :
                    tinObject === 'edgeError' ? t('mapedit.testerror_line') :
                        t('mapedit.testerror_unknown'));
        return;
    }
    if (tinObject.strict_status === 'strict_error' && !isIllst) {
        alert(t('mapedit.testerror_valid_error')); // eslint-disable-line no-undef
        return;
    }
    const distXy = tinObject.transform(srcXy, !isIllst);

    if (!distXy) {
        alert(t('mapedit.testerror_outside_map')); // eslint-disable-line no-undef
        return;
    }

    const distMarkerLoc = isIllst ? distXy : illstSource.xy2HistMapCoords(distXy);
    distMap.getView().setCenter(distMarkerLoc);

    const iconSVG = `<svg version="1.1" id="Layer_1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
x="0px" y="0px" width="10px" height="15px" viewBox="0 0 10 15" enable-background="new 0 0 10 15" xml:space="preserve">
<polygon x="0" y="0" points="5,1 9,5 5,14 1,5 5,1" stroke="#FF0000" fill="#FFFF00" stroke-width="2"></polygon></svg>`;
    const imageElement = new Image(); // eslint-disable-line no-undef
    imageElement.src = `data:image/svg+xml,${encodeURIComponent( iconSVG )}`;

    const style = new Style({
        "image": new Icon({
            "img": imageElement,
            "imgSize":[10, 15],
            "anchor": [0.5, 1]
        })
    });
    const srcFeature = new Feature({geometry: new Point(srcMarkerLoc)});
    const distFeature = new Feature({geometry: new Point(distMarkerLoc)});
    srcFeature.setStyle(style);
    distFeature.setStyle(style);
    srcCheck.addFeature(srcFeature);
    distCheck.addFeature(distFeature);
}

function tinResultUpdate() {
    const tinObject = vueMap.tinObject;

    jsonClear();
    boundsClear();

    const forProj = `ZOOM:${illstSource.maxZoom}`;
    const jsonReader = new GeoJSON();

    const boundsSource = illstMap.getSource('bounds');
    let bboxPoints;
    if (vueMap.currentEditingLayer === 0) {
        bboxPoints = [[0, 0], [vueMap.width, 0], [vueMap.width, vueMap.height], [0, vueMap.height], [0, 0]];
    } else {
        bboxPoints = Object.assign([], vueMap.bounds);
        bboxPoints.push(vueMap.bounds[0]);
    }
    const bbox = polygon([bboxPoints]);
    const bboxFeature = jsonReader.readFeatures(bbox, {dataProjection:forProj, featureProjection:'EPSG:3857'});
    boundsSource.addFeatures(bboxFeature);

    if (modify) {
        illstMap.removeInteraction(modify);
    }
    if (snap) {
        illstMap.removeInteraction(snap);
    }
    if (vueMap.currentEditingLayer !== 0) {
        modify = new Modify({
            source: boundsSource
        });
        modify.on('modifyend', (evt) => {
            vueMap.bounds = evt.features.item(0).getGeometry().getCoordinates()[0].filter((item, index, array) =>
                index === array.length - 1 ? false : true).map((merc) => transform(merc, 'EPSG:3857', forProj));
            backend.updateTin(vueMap.gcps, vueMap.edges, vueMap.currentEditingLayer, vueMap.bounds, vueMap.strictMode, vueMap.vertexMode);
        });
        snap = new Snap({source: boundsSource});
        illstMap.addInteraction(modify);
        illstMap.addInteraction(snap);
    }

    if (typeof tinObject === 'string') {
        return;
    }

    const forTin = tinObject.tins.forw;
    const bakTin = tinObject.tins.bakw;
    const bakFeatures = jsonReader.readFeatures(bakTin, {dataProjection:'EPSG:3857'});
    const forFeatures = jsonReader.readFeatures(forTin, {dataProjection:forProj, featureProjection:'EPSG:3857'});
    mercMap.getSource('json').addFeatures(bakFeatures);
    illstMap.getSource('json').addFeatures(forFeatures);

    errorNumber = null;
    if (tinObject.strict_status === 'strict_error') {
        const kinkFeatures = jsonReader.readFeatures(tinObject.kinks.bakw, {dataProjection:'EPSG:3857'});
        mercMap.getSource('json').addFeatures(kinkFeatures);
    }
}

function tinStyle(feature) {
    if (feature.getGeometry().getType() === 'Polygon') {
        return new Style({
            stroke: new Stroke({
                color: 'blue',
                width: 1
            }),
            fill: new Fill({
                color: 'rgba(0, 0, 255, 0.05)'
            })
        });
    } else if (feature.getGeometry().getType() === 'LineString') {
        return new Style({
            stroke: new Stroke({
                color: 'red',
                width: 2
            })
        });
    }
    const iconSVG = `<svg version="1.1" id="Layer_1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
x="0px" y="0px" width="6px" height="6px" viewBox="0 0 6 6" enable-background="new 0 0 6 6" xml:space="preserve">
<polygon x="0" y="0" points="3,0 6,3 3,6 0,3 3,0" stroke="#FF0000" fill="#FFFF00" stroke-width="2"></polygon></svg>`;
    const imageElement = new Image(); // eslint-disable-line no-undef
    imageElement.src = `data:image/svg+xml,${encodeURIComponent( iconSVG )}`;

    return new Style({
        "image": new Icon({
            "img": imageElement,
            "imgSize":[6, 6],
            "anchor": [0.5, 0.5]
        })
    });
}

const boundsStyle = new Style({
    stroke: new Stroke({
        color: 'red',
        width: 2
    }),
    fill: new Fill({
        color: 'rgba(0, 0, 0, 0)'
    })
});

function reflectIllstMap() {
    return HistMap.createAsync({
        mapID,
        url: vueMap.url_,
        width: vueMap.width,
        height: vueMap.height,
        attr: vueMap.attr,
        noload: true
    },{})
        .then((source) => {
            illstSource = source;
            illstMap.exchangeSource(illstSource);
            const initialCenter = illstSource.xy2HistMapCoords([vueMap.width / 2, vueMap.height / 2]);
            const illstView = illstMap.getView();
            illstView.setCenter(initialCenter);

            const gcps = vueMap.gcps;
            if (gcps && gcps.length > 0) {
                let center;
                let zoom;
                if (gcps.length === 1) {
                    center = gcps[0][1];
                    zoom = 16;
                } else {
                    const results = gcps.reduce((prev, curr, index) => {
                        const merc = curr[1];
                        prev[0][0] = prev[0][0] + merc[0];
                        prev[0][1] = prev[0][1] + merc[1];
                        if (merc[0] > prev[1][0]) prev[1][0] = merc[0];
                        if (merc[1] > prev[1][1]) prev[1][1] = merc[1];
                        if (merc[0] < prev[2][0]) prev[2][0] = merc[0];
                        if (merc[1] < prev[2][1]) prev[2][1] = merc[1];
                        if (index === gcps.length - 1) {
                            const center = [prev[0][0]/gcps.length, prev[0][1]/gcps.length];
                            const deltax = prev[1][0] - prev[2][0];
                            const deltay = prev[1][1] - prev[2][1];
                            const delta = deltax > deltay ? deltax : deltay; // eslint-disable-line no-unused-vars
                            const zoom = Math.log(600 / 256 * MERC_MAX * 2 / deltax) / Math.log(2);
                            return [center, zoom];
                        } else return prev;
                    },[[0,0],[-1*MERC_MAX,-1*MERC_MAX],[MERC_MAX,MERC_MAX]]);
                    center = results[0];
                    zoom = results[1];
                }
                const mercView = mercMap.getView();
                mercView.setCenter(center);
                mercView.setZoom(zoom);
            }
        }).catch((err) => {
            console.log(err); // eslint-disable-line no-undef,no-console
        });
}

//マーカードラッグ用(Exampleよりコピペ)
class Drag extends Pointer {
    /**
     * @constructor
     * @extends {ol.interaction.Pointer}
     */
    constructor() {
        super({
            handleDownEvent: Drag.prototype.handleDownEvent,
            handleDragEvent: Drag.prototype.handleDragEvent,
            handleMoveEvent: Drag.prototype.handleMoveEvent,
            handleUpEvent: Drag.prototype.handleUpEvent
        });

        /**
         * @type {ol.Pixel}
         * @private
         */
        this.coordinate_ = null;

        /**
         * @type {string|undefined}
         * @private
         */
        this.cursor_ = 'pointer';

        /**
         * @type {ol.Feature}
         * @private
         */
        this.feature_ = null;

        /**
         * @type {string|undefined}
         * @private
         */
        this.previousCursor_ = undefined;

        //マーカーレイヤのみ対象とするようにlayerFilterを設定
        this.layerFilter = 'marker';
    }
    /**
     * @param {ol.MapBrowserEvent} evt Map browser event.
     * @return {boolean} `true` to start the drag sequence.
     */
    handleDownEvent(evt) {
        if (evt.pointerEvent.button === 2) return;
        const map = evt.map;

        const this_ = this;
        let feature = map.forEachFeatureAtPixel(evt.pixel, (feature, layer) => feature, { // eslint-disable-line no-unused-vars
            layerFilter(layer) {
                return layer.get('name') === this_.layerFilter;
            }
        });

        if (feature) {
            if (feature.getGeometry().getType() === 'LineString') {
                feature = undefined;
            } else {
                this.coordinate_ = evt.coordinate;
                this.feature_ = feature;
            }
        }

        return !!feature;
    }

    /**
     * @param {ol.MapBrowserEvent} evt Map browser event.
     */
    handleDragEvent(evt) {
        if (evt.pointerEvent.button === 2) return;

        const deltaX = evt.coordinate[0] - this.coordinate_[0];
        const deltaY = evt.coordinate[1] - this.coordinate_[1];

        const geometry = /** @type {ol.geom.SimpleGeometry} */
            (this.feature_.getGeometry());
        geometry.translate(deltaX, deltaY);

        this.coordinate_[0] = evt.coordinate[0];
        this.coordinate_[1] = evt.coordinate[1];
    }
    /**
     * @param {ol.MapBrowserEvent} evt Event.
     */
    handleMoveEvent(evt) {
        if (evt.pointerEvent.button === 2) return;
        const anotherMap = evt.map === illstMap ? mercMap : illstMap;
        anotherMap.closeContextMenu();
        if (this.cursor_) {
            const map = evt.map;

            const this_ = this;
            const feature = map.forEachFeatureAtPixel(evt.pixel, (feature, layer) => feature, { // eslint-disable-line no-unused-vars
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
    /**
     * @param {ol.MapBrowserEvent} evt Map browser event.
     * @return {boolean} `false` to stop the drag sequence.
     */
    handleUpEvent(evt) {
        if (evt.pointerEvent.button === 2) return;
        const map = evt.map;
        const isIllst = map === illstMap;
        const feature = this.feature_;
        let xy = feature.getGeometry().getCoordinates();
        xy = isIllst ? illstSource.histMapCoords2Xy(xy) : xy;

        const gcpIndex = feature.get('gcpIndex');
        if (gcpIndex !== 'new') {
            const gcps = vueMap.gcps;
            const gcp = gcps[gcpIndex];
            gcp[isIllst ? 0 : 1] = xy;
            gcps.splice(gcpIndex, 1, gcp);
            gcpsToMarkers();
        } else {
            newlyAddGcp[isIllst ? 0 : 1] = xy;
        }
        this.coordinate_ = null;
        this.feature_ = null;
        return false;
    }
}

MaplatMap.prototype.initContextMenu = function() { // eslint-disable-line
    const map = this;
    const t = langObj.t;
    const normalContextMenu = {
        text: t('mapedit.context_add_marker'),
        callback: addNewMarker
    };

    const removeContextMenu = {
        text: t('mapedit.context_remove_marker'),
        callback: removeMarker
    };

    const pairingContextMenu = {
        text: t('mapedit.context_correspond_marker'),
        callback: pairingMarker
    };

    const addNewCancelContextMenu = {
        text: t('mapedit.context_cancel_add_marker'),
        callback: addNewCancelMarker
    };

    const edgeStartContextMenu = {
        text: t('mapedit.context_correspond_line_start'),
        callback: edgeStartMarker
    };

    const edgeEndContextMenu = {
        text: t('mapedit.context_correspond_line_end'),
        callback: edgeEndMarker
    };

    const edgeCancelContextMenu = {
        text: t('mapedit.context_correspond_line_cancel'),
        callback: edgeCancelMarker
    };

    const removeEdgeContextMenu = {
        text: t('mapedit.context_correspond_line_cancel'),
        callback: removeEdge
    };

    const addMarkerOnEdgeContextMenu = {
        text: t('mapedit.context_marker_on_line'),
        callback: addMarkerOnEdge
    };

    const contextmenu = this.contextmenu = new ContextMenu({
        width: 170,
        defaultItems: false,
        items: [ normalContextMenu ]
    });
    this.addControl(contextmenu);
    let restore = false;

    contextmenu.on('open', function(evt) {
        const feature = this.map_.forEachFeatureAtPixel(evt.pixel, (ft, l) => ft, { // eslint-disable-line no-unused-vars
            layerFilter(layer) {
                return layer.get('name') === 'marker' || layer.get('name') === 'edges';
            },
            hitTolerance: 5
        });
        if (feature) {
            const isLine = feature.getGeometry().getType() === 'LineString';
            contextmenu.clear();
            if (newlyAddEdge !== undefined) {
                if (!isLine && feature.get('gcpIndex') !== 'new' && feature.get('gcpIndex') !== newlyAddEdge) {
                    edgeEndContextMenu.data = {
                        marker: feature
                    };
                    contextmenu.push(edgeEndContextMenu);
                } else {
                    contextmenu.push(edgeCancelContextMenu);
                }
            } else if (newlyAddGcp !== undefined) {
                contextmenu.push(addNewCancelContextMenu);
            } else {
                if (isLine) {
                    removeEdgeContextMenu.data = {
                        edge: feature
                    };
                    contextmenu.push(removeEdgeContextMenu);
                    addMarkerOnEdgeContextMenu.data = {
                        edge: feature
                    };
                    contextmenu.push(addMarkerOnEdgeContextMenu);
                } else {
                    if (feature.get('gcpIndex') !== 'new') {
                        pairingContextMenu.data = {
                            marker: feature
                        };
                        contextmenu.push(pairingContextMenu);
                        edgeStartContextMenu.data = {
                            marker: feature
                        };
                        contextmenu.push(edgeStartContextMenu);
                    }
                    removeContextMenu.data = {
                        marker: feature
                    };
                    contextmenu.push(removeContextMenu);
                }
            }
            restore = true;
        } else if (newlyAddEdge !== undefined) {
            contextmenu.clear();
            contextmenu.push(edgeCancelContextMenu);
            restore = true;
        } else if (newlyAddGcp !== undefined && newlyAddGcp[map === illstMap ? 0 : 1] !== undefined) {
            contextmenu.clear();
            contextmenu.push(addNewCancelContextMenu);
            restore = true;
        } else if (restore) {
            contextmenu.clear();
            contextmenu.push(normalContextMenu);
            //contextmenu.extend(contextmenu.getDefaultItems());
            restore = false;
        }
        if (this.map_ === illstMap) {
            const xy = illstSource.histMapCoords2Xy(evt.coordinate);
            const outsideCheck = vueMap.currentEditingLayer ? (xy) => {
                const bboxPoints = Object.assign([], vueMap.bounds);
                bboxPoints.push(vueMap.bounds[0]);
                const bbox = polygon([bboxPoints]);
                return !booleanPointInPolygon(xy, bbox);
            } : (xy) => xy[0] < 0 || xy[1] < 0 || xy[0] > vueMap.width || xy[1] > vueMap.height;
            if (outsideCheck(xy)) setTimeout(() => {contextmenu.close();}, 10); // eslint-disable-line no-undef
        }
    });

    this.on('unfocus', () => {
        console.log('unfocus'); // eslint-disable-line no-undef,no-console
    });
};
MaplatMap.prototype.closeContextMenu = function() {
    this.contextmenu.close();
};

function mapObjectInit() {
    // 起動時処理: 編集用地図の設定、絵地図側OpenLayersの設定ここから
    illstMap = new MaplatMap({
        div: 'illstMap',
        interactions: interactionDefaults().extend([
            new DragRotateAndZoom({
                condition: altKeyOnly
            })
        ]),
        controls: controlDefaults()
    });
    // コンテクストメニュー初期化
    illstMap.initContextMenu();
    // マーカーなど表示用レイヤー設定
    let jsonLayer = new layerVector({
        source: new sourceVector({
            wrapX: false
        }),
        style: tinStyle
    });
    jsonLayer.set('name', 'json');
    illstMap.getLayer('overlay').getLayers().push(jsonLayer);
    // 三角網など表示用レイヤー設定
    let checkLayer = new layerVector({
        source: new sourceVector({
            wrapX: false
        }),
        style: tinStyle
    });
    checkLayer.set('name', 'check');
    illstMap.getLayers().push(checkLayer);
    // bounds表示用レイヤー設定
    const boundsLayer = new layerVector({
        source: new sourceVector({
            wrapX: false
        }),
        style: boundsStyle
    });
    boundsLayer.set('name', 'bounds');
    illstMap.getLayer('overlay').getLayers().push(boundsLayer);
    // edge表示用レイヤー設定
    let edgesLayer = new layerVector({
        source: new sourceVector({
            wrapX: false
        }),
        style: boundsStyle
    });
    edgesLayer.set('name', 'edges');
    illstMap.getLayer('overlay').getLayers().push(edgesLayer);
    // インタラクション設定
    illstMap.on('click', onClick);
    illstMap.addInteraction(new Drag());
    const edgeModifyFunc = function(e) {
        if (e.pointerEvent.button === 2) return false;
        const f = this.getMap().getFeaturesAtPixel(e.pixel, {
            layerFilter(layer) {
                return layer.get('name') === 'edges';
            }
        });
        if (f && f.length > 0 && f[0].getGeometry().getType() == 'LineString') {
            const coordinates = f[0].getGeometry().getCoordinates();
            const p0 = e.pixel;
            let p1 = this.getMap().getPixelFromCoordinate(coordinates[0]);
            let dx = p0[0]-p1[0];
            let dy = p0[1]-p1[1];
            if (Math.sqrt(dx*dx+dy*dy) <= 10) {
                return false;
            }
            p1 = this.getMap().getPixelFromCoordinate(coordinates.slice(-1)[0]);
            dx = p0[0]-p1[0];
            dy = p0[1]-p1[1];
            if (Math.sqrt(dx*dx+dy*dy) <= 10) {
                return false;
            }
            return true;
        }
        return false;
    };
    let edgesSource = illstMap.getSource('edges');
    let edgeModify = new Modify({
        source: edgesSource,
        condition: edgeModifyFunc
    });
    let edgeRevisionBuffer = [];
    const edgeModifyStart = function (evt) {
        edgeRevisionBuffer = [];
        evt.features.forEach((f) => {
            edgeRevisionBuffer.push(f.getRevision());
        });
    }
    const edgeModifyEnd = function(evt) {
        const isIllust = evt.target.getMap() === illstMap;
        const forProj = isIllust ? `ZOOM:${illstSource.maxZoom}` : 'EPSG:3857';
        let feature = null;
        evt.features.forEach((f, i) => {
            if (f.getRevision() !== edgeRevisionBuffer[i]) feature = f;
        });
        const startEnd = feature.get('startEnd');
        const start = vueMap.gcps[startEnd[0]]; // eslint-disable-line no-unused-vars
        const end = vueMap.gcps[startEnd[1]]; // eslint-disable-line no-unused-vars
        const edgeIndex = vueMap.edges.findIndex((edge) => edge.startEnd[0] === startEnd[0] && edge.startEnd[1] === startEnd[1]);
        const edge = vueMap.edges[edgeIndex];
        const points = feature.getGeometry().getCoordinates().filter((item, index, array) =>
            (index === 0 || index === array.length - 1) ? false : true).map((merc) =>
            transform(merc, 'EPSG:3857', forProj));
        if (isIllust) edge.illstNodes = points;
        else edge.mercNodes = points;
        vueMap.edges.splice(edgeIndex, 1, edge);
    };
    edgeModify.on('modifystart', edgeModifyStart);
    edgeModify.on('modifyend', edgeModifyEnd);
    let edgeSnap = new Snap({
        source: edgesSource
    });
    illstMap.addInteraction(edgeModify);
    illstMap.addInteraction(edgeSnap);

    // 起動時処理: 編集用地図の設定、絵地図側OpenLayersの設定ここまで

    // 起動時処理: 編集用地図の設定、ベースマップ側OpenLayersの設定ここから
    mercMap = new MaplatMap({
        div: 'mercMap',
        interactions: interactionDefaults().extend([
            new DragRotateAndZoom({
                condition: altKeyOnly
            })
        ]),
        controls: controlDefaults()
    });
    // コンテクストメニュー初期化
    mercMap.initContextMenu();
    // マーカーなど表示用レイヤー設定
    jsonLayer = new layerVector({
        source: new sourceVector({
            wrapX: false
        }),
        style: tinStyle
    });
    jsonLayer.set('name', 'json');
    mercMap.getLayer('overlay').getLayers().push(jsonLayer);
    // 三角網など表示用レイヤー設定
    checkLayer = new layerVector({
        source: new sourceVector({
            wrapX: false
        }),
        style: tinStyle
    });
    checkLayer.set('name', 'check');
    mercMap.getLayers().push(checkLayer);
    // edge表示用レイヤー設定
    edgesLayer = new layerVector({
        source: new sourceVector({
            wrapX: false
        }),
        style: boundsStyle
    });
    edgesLayer.set('name', 'edges');
    mercMap.getLayer('overlay').getLayers().push(edgesLayer);
    // インタラクション設定
    mercMap.on('click', onClick);
    mercMap.addInteraction(new Drag());
    edgesSource = mercMap.getSource('edges');
    edgeModify = new Modify({
        source: edgesSource,
        condition: edgeModifyFunc
    });
    edgeModify.on('modifystart', edgeModifyStart);
    edgeModify.on('modifyend', edgeModifyEnd);
    edgeSnap = new Snap({
        source: edgesSource
    });
    mercMap.addInteraction(edgeModify);
    mercMap.addInteraction(edgeSnap);

    // ベースマップリスト作成
    const tmsList = backend.getTmsList();
    const promises = tmsList.reverse().map((tms) => ((tms) => {
        const promise = tms.label ?
            HistMap.createAsync({
                mapID: tms.mapID,
                label: tms.label,
                attr: tms.attr,
                maptype: 'base',
                url: tms.url,
                maxZoom: tms.maxZoom
            }, {}) :
            HistMap.createAsync(tms.mapID, {});
        return promise.then((source) => new Tile({
            title: tms.title,
            type: 'base',
            visible: tms.mapID === 'osm',
            source
        }));
    })(tms));
    // ベースマップコントロール追加
    const t = langObj.t;
    Promise.all(promises).then((layers) => {
        const layerGroup = new Group({
            'title': t('mapedit.control_basemap'),
            layers
        });
        const mapLayers = mercMap.getLayers();
        mapLayers.removeAt(0);
        mapLayers.insertAt(0, layerGroup);

        const layerSwitcher = new LayerSwitcher({});
        mercMap.addControl(layerSwitcher);
    });
    // ジオコーダコントロール追加
    const geocoder = new Geocoder('nominatim', {
        provider: 'osm',
        lang: 'en-US', //en-US, fr-FR
        placeholder: t('mapedit.control_put_address'),
        limit: 5,
        keepOpen: false
    });
    mercMap.addControl(geocoder);

    // 起動時処理: 編集用地図の設定、ベースマップ側OpenLayersの設定ここまで
}

// 起動時処理: Vue Mapオブジェクト関連の設定ここから
let vueMap;
function gcpsEditReady(val) {
    const a = document.querySelector('a[href="#gcpsTab"]'); // eslint-disable-line no-undef
    const li = a.parentNode;
    if (val) {
        li.classList.remove('disabled');
    } else {
        li.classList.add('disabled');
    }
}

if (mapID) {
    const mapIDElm = document.querySelector('#mapID'); // eslint-disable-line no-unused-vars,no-undef
    backend.request(mapID);
} else {
    initVueMap();
    setVueMap();
}

function initVueMap(json) {
    const options = {
        mounted() {
            const tabs = document.querySelectorAll('a[data-toggle="tab"]'); //eslint-disable-line no-undef
            for (let i = 0; i < tabs.length; i++) {
                new bsn.Tab(tabs[i],
                    {
                        height: true
                    });
            }
            mapObjectInit();
            const myMapTab = document.querySelector('a[href="#gcpsTab"]'); //eslint-disable-line no-undef
            myMapTab.addEventListener('shown.bs.tab', (e) => { //eslint-disable-line no-unused-vars
                illstMap.updateSize();
                mercMap.updateSize();
            });
        },
        components: {
            "header-template": Header
        },
        i18n: langObj.vi18n,
        el: '#container',
        template: '#mapedit-vue-template',
        watch: {
            gcpsEditReady,
            gcps(val) { // eslint-disable-line no-unused-vars
                if (!illstSource) return;
                backend.updateTin(this.gcps, this.edges, this.currentEditingLayer, this.bounds, this.strictMode, this.vertexMode);
            },
            edges(val) { // eslint-disable-line no-unused-vars
                if (!illstSource) return;
                backend.updateTin(this.gcps, this.edges, this.currentEditingLayer, this.bounds, this.strictMode, this.vertexMode);
            },
            sub_maps(val) { // eslint-disable-line no-unused-vars
            },
            vertexMode() {
                if (!illstSource) return;
                backend.updateTin(this.gcps, this.edges, this.currentEditingLayer, this.bounds, this.strictMode, this.vertexMode);
            },
            strictMode() {
                if (!illstSource) return;
                backend.updateTin(this.gcps, this.edges, this.currentEditingLayer, this.bounds, this.strictMode, this.vertexMode);
            },
            currentEditingLayer() {
                if (!illstSource) return;
                gcpsToMarkers();
            }
        }
    };
    if (json) {
        options.data = function() {

        };
    }
    vueMap = new Map(options);
}

function setVueMap() {
    vueMap.vueInit = true;
    const t = langObj.t;

    vueMap.$on('updateMapID', () => {
        if (!confirm(t('mapedit.confirm_change_mapid'))) return; // eslint-disable-line no-undef
        vueMap.onlyOne = false;
    });
    vueMap.$on('checkOnlyOne', () => {
        document.body.style.pointerEvents = 'none'; // eslint-disable-line no-undef
        const checked = backend.checkID(vueMap.mapID); // eslint-disable-line no-unused-vars
        ipcRenderer.once('checkIDResult', (event, arg) => {
            document.body.style.pointerEvents = null; // eslint-disable-line no-undef
            if (arg) {
                alert(t('mapedit.alert_mapid_checked')); // eslint-disable-line no-undef
                vueMap.onlyOne = true;
                if (vueMap.status === 'Update') {
                    vueMap.status = `Change:${mapID}`;
                }
            } else {
                alert(t('mapedit.alert_mapid_duplicated')); // eslint-disable-line no-undef
                vueMap.onlyOne = false;
            }
        });
    });
    vueMap.$on('mapUpload', () => {
        if (vueMap.gcpsEditReady && !confirm(t('mapedit.confirm_override_image'))) return; // eslint-disable-line no-undef
        if (!uploader) {
            uploader = require('electron').remote.require('./mapupload'); // eslint-disable-line no-undef
            uploader.init();
            ipcRenderer.on('mapUploaded', (event, arg) => {
                document.body.style.pointerEvents = null; // eslint-disable-line no-undef
                myModal.hide();
                if (arg.err) {
                    if (arg.err !== 'Canceled') alert(t('mapedit.error_image_upload')); // eslint-disable-line no-undef
                    return;
                } else {
                    alert(t('mapedit.success_image_upload')); // eslint-disable-line no-undef
                }
                vueMap.width = arg.width;
                vueMap.height = arg.height;
                vueMap.url_ = arg.url;
                if (arg.imageExtention === 'jpg') {
                    vueMap.imageExtention = undefined;
                } else {
                    vueMap.imageExtention = arg.imageExtention;
                }

                reflectIllstMap().then(() => {
                    gcpsToMarkers();
                    backend.updateTin(vueMap.gcps, vueMap.edges, vueMap.currentEditingLayer, vueMap.bounds, vueMap.strictMode, vueMap.vertexMode);
                });
            });
        }
        document.body.style.pointerEvents = 'none'; // eslint-disable-line no-undef
        document.querySelector('div.modal-body > p').innerText = t('mapedit.image_uploading'); // eslint-disable-line no-undef
        myModal.show();
        uploader.showMapSelectDialog(t('mapupload.map_image'));
    });
    vueMap.$on('dlMap', () => {
        document.body.style.pointerEvents = 'none'; // eslint-disable-line no-undef
        document.querySelector('div.modal-body > p').innerText = t('mapedit.message_download'); // eslint-disable-line no-undef
        myModal.show();
        ipcRenderer.once('mapDownloadResult', (event, arg) => {
            document.body.style.pointerEvents = null; // eslint-disable-line no-undef
            myModal.hide();
            if (arg === 'Success') {
                alert(t('mapedit.download_success')); // eslint-disable-line no-undef
            } else if (arg === 'Canceled') {
                alert(t('mapedit.download_canceled')); // eslint-disable-line no-undef
            } else {
                console.log(arg); // eslint-disable-line no-undef,no-console
                alert(t('mapedit.download_error')); // eslint-disable-line no-undef
            }
        });
        backend.download(vueMap.map);
    });
    vueMap.$on('saveMap', () => {
        if (!confirm(t('mapedit.confirm_save'))) return; // eslint-disable-line no-undef
        const saveValue = vueMap.map;
        if (saveValue.status.match(/^Change:(.+)$/) &&
            confirm(t('mapedit.copy_or_move'))) { // eslint-disable-line no-undef
            saveValue.status = `Copy:${mapID}`;
        }
        document.body.style.pointerEvents = 'none'; // eslint-disable-line no-undef
        backend.save(saveValue, vueMap.tinObjects.map((tin) => {
            if (typeof tin === 'string') return tin;
            return tin.getCompiled();
        }));
        ipcRenderer.once('saveResult', (event, arg) => {
            document.body.style.pointerEvents = null; // eslint-disable-line no-undef
            if (arg === 'Success') {
                alert(t('mapedit.success_save')); // eslint-disable-line no-undef
                if (mapID !== vueMap.mapID) {
                    mapID = vueMap.mapID;
                }
                backend.request(mapID);
            } else if (arg === 'Exist') {
                alert(t('mapedit.error_duplicate_id')); // eslint-disable-line no-undef
            } else {
                console.log(arg); // eslint-disable-line no-undef,no-console
                alert(t('mapedit.error_saving')); // eslint-disable-line no-undef
            }
        });
    });
    vueMap.$on('viewError', () => {
        const tinObject = vueMap.tinObject;
        if (!(tinObject instanceof Tin)) return;
        const kinks = tinObject.kinks.bakw.features;
        if (errorNumber === null) {
            errorNumber = 0;
        } else {
            errorNumber++;
            if (errorNumber >= kinks.length) errorNumber = 0;
        }
        const errorPoint = kinks[errorNumber].geometry.coordinates;
        const view = mercMap.getView();
        view.setCenter(errorPoint);
        view.setZoom(17);
    });
    vueMap.$on('removeSubMap', () => {
        if (confirm(t('mapedit.confirm_layer_delete'))) { // eslint-disable-line no-undef
            vueMap.removeSubMap();
        }
    });
    gcpsEditReady(vueMap.gcpsEditReady);

    let allowClose = false;

    // When move to other pages
    const dataNav = document.querySelectorAll('a[data-nav]'); // eslint-disable-line no-undef
    for (let i=0; i< dataNav.length; i++) {
        dataNav[i].addEventListener('click', (ev) => {
            if (!vueMap.dirty || confirm(t('mapedit.confirm_no_save'))) { // eslint-disable-line no-undef
                allowClose = true;
                window.location.href = ev.target.getAttribute('data-nav'); // eslint-disable-line no-undef
            }
        });
    }

    // When application will close
    window.addEventListener('beforeunload', (e) => { // eslint-disable-line no-undef
        if (!vueMap.dirty) return;
        if (allowClose) {
            allowClose = false;
            return;
        }
        e.returnValue = 'false';
        setTimeout(() => { // eslint-disable-line no-undef
            if (confirm(t('mapedit.confirm_no_save'))) { // eslint-disable-line no-undef
                allowClose = true;
                window.close(); // eslint-disable-line no-undef
            }
        }, 2);
    });

    ipcRenderer.on('updatedTin', (event, arg) => {
        const index = arg[0];
        let tin;
        if (typeof arg[1] === 'string') {
            tin = arg[1];
        } else {
            tin = new Tin({});
            tin.setCompiled(arg[1]);
        }
        vueMap.tinObjects.splice(index, 1, tin);
        checkClear();
        tinResultUpdate();
    });
}
// バックエンドからマップファイル読み込み完了の通知が届いた際の処理
ipcRenderer.on('mapData', (event, arg) => {
    const json = arg[0];
    const tins = arg[1];
    json.mapID = mapID;
    json.status = 'Update';
    json.onlyOne = true;
    if (!vueMap) {
        initVueMap();
    }
    vueMap.setInitialMap(json);
    if (tins) {
        vueMap.tinObjects = tins.map((compiled) => {
            if (typeof compiled === 'string') return compiled;
            const tin = new Tin({});
            tin.setCompiled(compiled);
            return tin;
        });
    }
    if (!vueMap.vueInit) {
        setVueMap();
    }
    reflectIllstMap().then(() => {
        gcpsToMarkers();
        tinResultUpdate();
    });
});
// 起動時処理: Vue Mapオブジェクト関連の設定ここまで

// 起動時処理: 地図外のUI設定ここから
// モーダルオブジェクト作成
const myModal = new bsn.Modal(document.getElementById('staticModal'), {}); //eslint-disable-line no-undef
// 起動時処理: 地図外のUI設定ここまで
