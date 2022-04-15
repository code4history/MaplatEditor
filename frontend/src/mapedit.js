import { mapSourceFactory } from "@maplat/core/lib/source_ex";
import bsn from 'bootstrap.native';
import {polygon, booleanPointInPolygon} from '@turf/turf';
import Map from "./model/map";
import Vue from "vue";
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
import {MERC_MAX, MERC_CROSSMATRIX} from "@maplat/core/lib/const_ex";
import {MaplatMap} from "@maplat/core/lib/map_ex";
import {altKeyOnly} from "ol/events/condition";
import {Vector as layerVector, Tile, Group} from "ol/layer";
import {Vector as sourceVector} from "ol/source";
import {Language} from './model/language';
import Header from '../vue/header.vue';
import roundTo from "round-to";

function arrayRoundTo(array, decimal) {
  return array.map((item) => roundTo(item, decimal));
}

const labelFontStyle = "Normal 12px Arial";
//const {ipcRenderer, dialog} = require('electron'); // eslint-disable-line no-undef
const electron = require('electron'); // eslint-disable-line no-undef
const ipcRenderer = electron.ipcRenderer;
const dialog = electron.remote.dialog;
const backend = require('electron').remote.require('./mapedit'); // eslint-disable-line no-undef
backend.init();
const langObj = Language.getSingleton();

let uploader;
let dataUploader;
let wmtsGenerator;
let mapID;
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

// 地図座標5地点情報から地図サイズ情報（中心座標、サイズ、回転）を得る
function xys2Size(xys, size) {
  const center = xys[0];
  const nesw = xys.slice(1, 5);
  const neswDelta = nesw.map((val) => [
    val[0] - center[0],
    val[1] - center[1]
  ]);
  const normal = [
    [0.0, 1.0],
    [1.0, 0.0],
    [0.0, -1.0],
    [-1.0, 0.0]
  ];
  let abss = 0;
  let cosx = 0;
  let sinx = 0;
  for (let i = 0; i < 4; i++) {
    const delta = neswDelta[i];
    const norm = normal[i];
    const abs = Math.sqrt(Math.pow(delta[0], 2) + Math.pow(delta[1], 2));
    abss += abs;
    const outer = delta[0] * norm[1] - delta[1] * norm[0];
    const inner = Math.acos(
      (delta[0] * norm[0] + delta[1] * norm[1]) / abs
    );
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

function getRadius(size, zoom) {
  const radius = Math.floor(Math.min(size[0], size[1]) / 4);
  return (radius * MERC_MAX) / 128 / Math.pow(2, zoom);
}

function size2Xys(center, zoom, rotate) {
  const size = mercMap.getSize();
  const radius = getRadius(size, zoom);
  const crossDelta = rotateMatrix(MERC_CROSSMATRIX, rotate);
  const cross = crossDelta.map((xy) => [
    xy[0] * radius + center[0],
    xy[1] * radius + center[1]
  ]);
  cross.push(size);
  return cross;
}

function updateHomeMarkers() {
  const iFeature = illstMap.getSource('marker').getFeatures().filter((feature) => {
    const gcpIndex = feature.get('gcpIndex');
    return gcpIndex === 'home';
  })[0];
  const mFeature = mercMap.getSource('marker').getFeatures().filter((feature) => {
    const gcpIndex = feature.get('gcpIndex');
    return gcpIndex === 'home';
  })[0];
  if (iFeature) illstMap.getSource('marker').removeFeature(iFeature);
  if (mFeature) mercMap.getSource('marker').removeFeature(mFeature);

  homeToMarkers();
}

function homeToMarkers() {
  if (vueMap.homePosition) {
    const homeSVG = `<svg version="1.1" id="Layer_1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
x="0px" y="0px" width="20px" height="20px" viewBox="0 0 20 20" enable-background="new 0 0 20 20" xml:space="preserve">
<polygon x="0" y="0" points="10,0 20,10 17,10 17,20 3,20 3,10 0,10 10,0" stroke="#FF0000" fill="#FF0000" stroke-width="2"></polygon></svg>`;
    const homeElement = new Image(); // eslint-disable-line no-undef
    homeElement.src = `data:image/svg+xml,${encodeURIComponent(homeSVG)}`;
    const homeStyle = new Style({
      image: new Icon({
        "img": homeElement,
        "imgSize": [20, 20],
        "anchor": [0.5, 1.0]
      })
    });
    const merc = transform(vueMap.homePosition, 'EPSG:4326', 'EPSG:3857');
    mercMap.setMarker(merc, {gcpIndex: 'home'}, homeStyle);
    if (vueMap.errorStatus === 'strict' || vueMap.errorStatus === 'loose') {
      const tinObject = vueMap.tinObjects[0];
      const xy = tinObject.transform(merc, true);
      const histCoord = illstSource.xy2SysCoord(xy);
      illstMap.setMarker(histCoord, {gcpIndex: 'home'}, homeStyle);
    }
  }
}

function gcpsToMarkers (targetIndex) {
  const gcps = vueMap.gcps;
  const edges = vueMap.edges;
  illstMap.resetMarker();
  mercMap.resetMarker();
  edgesClear();

  homeToMarkers();

  for (let i=0; i<gcps.length; i++) {
    const gcp = gcps[i];
    const mapXyIllst = illstSource.xy2SysCoord(gcp[0]);

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
    const gcp1 = gcps[edges[i][2][0]];
    const gcp2 = gcps[edges[i][2][1]];
    const illst1 = illstSource.xy2SysCoord(gcp1[0]);
    const illst2 = illstSource.xy2SysCoord(gcp2[0]);
    const style = new Style({
      stroke: new Stroke({
        color: 'red',
        width: 2
      })
    });
    const mercCoords = [gcp1[1]];
    edges[i][1].map((node) => {
      mercCoords.push(node);
    });
    mercCoords.push(gcp2[1]);
    const mercLine = {
      geometry: new LineString(mercCoords),
      startEnd: edges[i][2]
    };
    const illstCoords = [illst1];
    edges[i][0].map((node) => {
      illstCoords.push(illstSource.xy2SysCoord(node));
    });
    illstCoords.push(illst2);
    const illstLine = {
      geometry: new LineString(illstCoords),
      startEnd: edges[i][2]
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

async function edgeEndMarker (arg, map) { // eslint-disable-line no-unused-vars
  const t = langObj.t;
  const marker = arg.data.marker;
  const gcpIndex = marker.get('gcpIndex');
  if (gcpIndex !== 'new') {
    const edge = [newlyAddEdge, gcpIndex].sort((a, b) => a > b ? 1 : a < b ? -1 : 0);
    newlyAddEdge = undefined;
    if (vueMap.edges.findIndex((item) => item[2][0] === edge[0] && item[2][1] === edge[1]) < 0) {
      vueMap.edges.push([[], [], edge]);
    } else {
      await dialog.showMessageBox({
        type: 'info',
        buttons: ['OK'],
        message: t('mapedit.line_selected_already')
      });
    }
    gcpsToMarkers();
  }
}

function edgeCancelMarker (arg, map) { // eslint-disable-line no-unused-vars
  newlyAddEdge = undefined;
  gcpsToMarkers();
}

function addNewCancelMarker (arg, map) { // eslint-disable-line no-unused-vars
  vueMap.newGcp = undefined;
  //vueMap.editingID = '';
  const gcps = vueMap.gcps;
  gcpsToMarkers(gcps);
}

function pairingMarker (arg, map) { // eslint-disable-line no-unused-vars
  const marker = arg.data.marker;
  const gcpIndex = marker.get('gcpIndex');
  if (gcpIndex !== 'new') {
    const gcps = vueMap.gcps;
    const gcp = gcps[gcpIndex];
    const forw = illstSource.xy2SysCoord(gcp[0]);
    const bakw = gcp[1];
    const forView = illstMap.getView();
    const bakView = mercMap.getView();
    forView.setCenter(forw);
    bakView.setCenter(bakw);
    forView.setZoom(illstSource.maxZoom - 1);
    bakView.setZoom(17);
  }
}

function removeHomePosition(arg, map) { // eslint-disable-line no-unused-vars
  vueMap.homePosition = undefined;
  vueMap.mercZoom = undefined;
  gcpsToMarkers();
}

function rotateMatrix(xys, theta) {
  const result = [];
  for (let i = 0; i < xys.length; i++) {
    const xy = xys[i];
    const x = xy[0] * Math.cos(theta) - xy[1] * Math.sin(theta);
    const y = xy[0] * Math.sin(theta) + xy[1] * Math.cos(theta);
    result.push([x, y]);
  }
  return result;
}

function showHomePosition(arg, map) { // eslint-disable-line no-unused-vars
  if (vueMap.homePosition) {
    const mercView = mercMap.getView();
    const merc = transform(vueMap.homePosition, 'EPSG:4326', 'EPSG:3857');
    mercView.setCenter(merc);
    mercView.setZoom(vueMap.mercZoom);

    if (vueMap.errorStatus === 'strict' || vueMap.errorStatus === 'loose') {
      const mercSize = size2Xys(merc, vueMap.mercZoom, 0);
      const wh = mercSize[5];
      delete mercSize[5];

      const illstSize = mercSize.map((coord) => {
        const xy = vueMap.tinObjects[0].transform(coord, true);
        return illstSource.xy2SysCoord(xy);
      });

      const centerZoom = xys2Size(illstSize, wh);

      const illstView = illstMap.getView();
      illstView.setCenter(centerZoom[0]);
      illstView.setZoom(centerZoom[1]);
      illstView.setRotation(0);
      mercView.setRotation(-centerZoom[2]);
    }
  }
}

function removeEdge (arg, map) { // eslint-disable-line no-unused-vars
  const edge = arg.data.edge;
  const startEnd = edge.get('startEnd');
  const edges = vueMap.edges;
  const edgeIndex = edges.findIndex((item) => item[2][0] === startEnd[0] && item[2][1] === startEnd[1]);
  if (edgeIndex > -1) {
    edges.splice(edgeIndex, 1);
  }
  gcpsToMarkers();
}

function addMarkerOnEdge (arg, map) {
  const edgeGeom = arg.data.edge;
  const isIllst = map === illstMap;
  const coord = edgeGeom.getGeometry().getClosestPoint(arg.coordinate);
  const xy = isIllst ? arrayRoundTo(illstSource.sysCoord2Xy(coord), 2) : arrayRoundTo(coord, 6);
  const startEnd = edgeGeom.get('startEnd');
  const edgeIndex = vueMap.edges.findIndex((edge) => edge[2][0] === startEnd[0] && edge[2][1] === startEnd[1]);
  const edge = vueMap.edges[edgeIndex];

  const gcp1 = vueMap.gcps[startEnd[0]];
  const gcp2 = vueMap.gcps[startEnd[1]];
  const this1 = gcp1[isIllst ? 0 : 1];
  const this2 = gcp2[isIllst ? 0 : 1];
  const that1 = gcp1[isIllst ? 1 : 0];
  const that2 = gcp2[isIllst ? 1 : 0];

  const thisNodes = Object.assign([], isIllst ? edge[0] : edge[1]);
  const thatNodes = Object.assign([], isIllst ? edge[1] : edge[0]);
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
  vueMap.editingID = newGcpIndex + 1;
  vueMap.edges.splice(edgeIndex, 1, [
    isIllst ? thisPrevNodes : thatPrevNodes,
    isIllst ? thatPrevNodes : thisPrevNodes,
    [startEnd[0], newGcpIndex]
  ]);
  vueMap.edges.push([
    isIllst ? thisLastNodes : thatLastNodes,
    isIllst ? thatLastNodes : thisLastNodes,
    [newGcpIndex, startEnd[1]]
  ]);
  gcpsToMarkers();
}

function removeMarker (arg, map) {
  const marker = arg.data.marker;
  const gcpIndex = marker.get('gcpIndex');
  if (gcpIndex === 'new') {
    vueMap.newGcp = undefined;
    //vueMap.editingID = '';
    map.getSource('marker').removeFeature(marker);
  } else {
    const gcps = vueMap.gcps;
    gcps.splice(gcpIndex, 1);
    const edges = vueMap.edges;
    for (let i = edges.length-1; i >= 0; i--) {
      const edge = edges[i];
      if (edge[2][0] === gcpIndex || edge[2][1] === gcpIndex) {
        edges.splice(i, 1);
      } else {
        if (edge[2][0] > gcpIndex) edge[2][0] = edge[2][0] - 1;
        if (edge[2][1] > gcpIndex) edge[2][1] = edge[2][1] - 1;
      }
    }
    gcpsToMarkers();
  }
  vueMap.editingID = '';
}

function addNewMarker (arg, map) {
  const gcps = vueMap.gcps;
  const number = gcps.length + 1;
  const isIllst = map === illstMap;
  const coord = arg.coordinate;
  const xy = isIllst ? arrayRoundTo(illstSource.sysCoord2Xy(coord), 2) : arrayRoundTo(coord, 6);

  if (!vueMap.newGcp) {
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

    vueMap.newGcp = isIllst ? [xy, , number] : [, xy, number]; // eslint-disable-line no-sparse-arrays
    //vueMap.editingID = number;
  } else if ((isIllst && !vueMap.newGcp[0]) || (!isIllst && !vueMap.newGcp[1])) {
    if (isIllst) { vueMap.newGcp[0] = xy; } else { vueMap.newGcp[1] = xy; }
    delete vueMap.newGcp[2];
    //vueMap.editingID = '';
    gcps.push(vueMap.newGcp);
    gcpsToMarkers();
    vueMap.newGcp = undefined;
    vueMap.editingID = gcps.length;
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

async function onClick(evt) {
  if (evt.originalEvent.altKey) return;
  const t = langObj.t;
  const isIllst = this === illstMap;
  const srcMap = isIllst ? illstMap : mercMap;
  const distMap = isIllst ? mercMap : illstMap;
  const srcMarkerLoc = evt.coordinate;
  const srcXy = isIllst ? arrayRoundTo(illstSource.sysCoord2Xy(srcMarkerLoc),2) : arrayRoundTo(srcMarkerLoc, 6);

  const srcCheck = srcMap.getSource('check');
  const distCheck = distMap.getSource('check');
  srcCheck.clear();
  distCheck.clear();

  const tinObject = vueMap.tinObject;
  if (typeof tinObject === 'string') {
    await dialog.showMessageBox({
      type: 'info',
      buttons: ['OK'],
      message: tinObject === 'tooLessGcps' ? t('mapedit.testerror_too_short') :
        tinObject === 'tooLinear' ? t('mapedit.testerror_too_linear') :
          tinObject === 'pointsOutside' ? t('mapedit.testerror_outside') :
            tinObject === 'edgeError' ? t('mapedit.testerror_line') :
              t('mapedit.testerror_unknown')
    });
    return;
  }
  if (tinObject.strict_status === 'strict_error' && !isIllst) {
    await dialog.showMessageBox({
      type: 'info',
      buttons: ['OK'],
      message: t('mapedit.testerror_valid_error')
    });
    return;
  }
  const distXy = tinObject.transform(srcXy, !isIllst);

  if (!distXy) {
    await dialog.showMessageBox({
      type: 'info',
      buttons: ['OK'],
      message: t('mapedit.testerror_outside_map')
    });
    return;
  }

  const distMarkerLoc = isIllst ? distXy : illstSource.xy2SysCoord(distXy);
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
        index !== array.length - 1).map((merc) => transform(merc, 'EPSG:3857', forProj));
      backend.updateTin(vueMap.gcps, vueMap.edges, vueMap.currentEditingLayer, vueMap.bounds, vueMap.strictMode, vueMap.vertexMode);
    });
    snap = new Snap({source: boundsSource});
    illstMap.addInteraction(modify);
    illstMap.addInteraction(snap);
  }

  updateHomeMarkers();

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
  return mapSourceFactory({
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
      const initialCenter = illstSource.xy2SysCoord([vueMap.width / 2, vueMap.height / 2]);
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
    if (evt.originalEvent.button === 2) return;
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
      } else if (feature.get('gcpIndex') === 'home') {
        feature = undefined;
      } else {
        this.coordinate_ = evt.coordinate;
        this.feature_ = feature;
        if (feature.get('gcpIndex') !== 'new') vueMap.editingID = feature.get('gcpIndex') + 1;
      }
    }

    return !!feature;
  }

  /**
   * @param {ol.MapBrowserEvent} evt Map browser event.
   */
  handleDragEvent(evt) {
    if (evt.originalEvent.button === 2) return;

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
    if (evt.originalEvent.button === 2) return;
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
    if (evt.originalEvent.button === 2) return;
    const map = evt.map;
    const isIllst = map === illstMap;
    const feature = this.feature_;
    let xy = feature.getGeometry().getCoordinates();
    xy = isIllst ? arrayRoundTo(illstSource.sysCoord2Xy(xy), 2) : arrayRoundTo(xy, 6);

    const gcpIndex = feature.get('gcpIndex');
    if (gcpIndex !== 'new') {
      const gcps = vueMap.gcps;
      const gcp = gcps[gcpIndex];
      gcp[isIllst ? 0 : 1] = xy;
      gcps.splice(gcpIndex, 1, gcp);
      gcpsToMarkers();
    } else {
      // vueMap.newGcp[isIllst ? 0 : 1] = xy;
      vueMap.newGcp.splice(isIllst ? 0 : 1, 1, xy);
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

  const removeHomePositionConextMenu = {
    text: t('mapedit.context_home_remove'),
    callback: removeHomePosition
  };

  const showHomePositionConextMenu = {
    text: t('mapedit.context_home_show'),
    callback: showHomePosition
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
      } else if (vueMap.newGcp !== undefined) {
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
          if (feature.get('gcpIndex') === 'home') {
            contextmenu.push(removeHomePositionConextMenu);
            contextmenu.push(showHomePositionConextMenu);
          } else {
            if (feature.get('gcpIndex') !== 'new') {
              vueMap.editingID = feature.get('gcpIndex') + 1;
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
      }
      restore = true;
    } else if (newlyAddEdge !== undefined) {
      contextmenu.clear();
      contextmenu.push(edgeCancelContextMenu);
      restore = true;
    } else if (vueMap.newGcp !== undefined && vueMap.newGcp[map === illstMap ? 0 : 1] !== undefined) {
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
      const xy = arrayRoundTo(illstSource.sysCoord2Xy(evt.coordinate), 2);
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
  // bounds表示用レイヤー設定
  const boundsLayer = new layerVector({
    source: new sourceVector({
      wrapX: false
    }),
    style: boundsStyle
  });
  boundsLayer.set('name', 'bounds');
  illstMap.getLayer('overlay').getLayers().push(boundsLayer);
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
    if (e.originalEvent.button === 2) return false;
    const f = this.getMap().getFeaturesAtPixel(e.pixel, {
      layerFilter(layer) {
        const name = layer.get('name');
        return name === 'edges' || name === 'marker';
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
    const edgeIndex = vueMap.edges.findIndex((edge) => edge[2][0] === startEnd[0] && edge[2][1] === startEnd[1]);
    const edge = vueMap.edges[edgeIndex];
    const points = feature.getGeometry().getCoordinates().filter((item, index, array) =>
      (index === 0 || index === array.length - 1) ? false : true).map((merc) =>
      transform(merc, 'EPSG:3857', forProj));
    if (isIllust) edge[0] = points;
    else edge[1] = points;
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
  const extentCheck = async (view) => {
    const extent = view.calculateExtent();
    backend.checkExtentMap(extent);
  };
  /*mercMap.getView().on('change', (evt) => {
    extentCheck(evt.target);
  });*/
  let firstRender = false;//true;
  mercMap.on('postrender', (evt) => { // eslint-disable-line no-unused-vars
    if (!firstRender) {
      firstRender = false;
      extentCheck(mercMap.getView());
    }
  });
  ipcRenderer.on('extentMapList', (event, arg) => {
    console.log(arg); // eslint-disable-line no-undef
    vueMap.templateMaps = arg;
  });

    // ベースマップリスト作成
  let tmsList;
  const promises = backend.getTmsListOfMapID(mapID).then((list) => {
    tmsList = list;
    return Promise.all(tmsList.reverse().map((tms) =>
      ((tms) => {
        const promise = tms.attr ?
          mapSourceFactory({
            mapID: tms.mapID,
            attr: tms.attr,
            maptype: 'base',
            url: tms.url,
            maxZoom: tms.maxZoom
          }, {}) :
          mapSourceFactory(tms.mapID, {});
        return promise.then((source) => {
          const attr = langObj.translate(source.attr);
          source.setAttributions(attr);
          return new Tile({
            title: tms.title,
            type: 'base',
            visible: tms.mapID === 'osm',
            source
          })
        });
      })(tms)
    ));
  });
  // ベースマップコントロール追加
  const t = langObj.t;
  promises.then((layers) => {
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
let vueModal; // eslint-disable-line prefer-const

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
    },
    data: {
      wmtsFolder: backend.getWmtsFolder()
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

  vueMap.$on('setHomeMerc', () => {
    const view = mercMap.getView();
    const longlat = transform(view.getCenter(), 'EPSG:3857', 'EPSG:4326');
    const zoom = view.getZoom();
    vueMap.homePosition = longlat;
    vueMap.mercZoom = zoom;
    gcpsToMarkers();
  });

  // Prepare for future implements
  vueMap.$on('setHomeIllst', () => {
    const view = illstMap.getView();
    const illstCenter = view.getCenter();
    const illstZoom = view.getZoom();

    const [illstSize, wh] = illstSource.viewpoint2SysCoords([illstCenter, illstZoom, 0]);

    const mercSize = illstSize.map((coords) => {
      const xy = illstSource.sysCoord2Xy(coords);
      const merc = vueMap.tinObjects[0].transform(xy, false);
      return merc;
    });

    const sizeArray = xys2Size(mercSize, wh);

    const longlat = transform(sizeArray[0], 'EPSG:3857', 'EPSG:4326');
    vueMap.homePosition = longlat;
    vueMap.mercZoom = sizeArray[1];
    gcpsToMarkers();
  });

  vueMap.$on('setXY', () => {
    const feature = illstMap.getSource('marker').getFeatures().filter((feature) => {
      const gcpIndex = feature.get('gcpIndex');
      if (vueMap.newGcp) return gcpIndex === 'new';
      else return gcpIndex === vueMap.editingID - 1;
    })[0];
    const xy = illstSource.xy2SysCoord(vueMap.newGcp ? vueMap.newGcp[0] : vueMap.gcps[vueMap.editingID - 1][0]);
    feature.getGeometry().setCoordinates(xy);
  });

  vueMap.$on('setLongLat', () => {
    const feature = mercMap.getSource('marker').getFeatures().filter((feature) => {
      const gcpIndex = feature.get('gcpIndex');
      if (vueMap.newGcp) return gcpIndex === 'new';
      else return gcpIndex === vueMap.editingID - 1;
    })[0];
    const xy = vueMap.newGcp ? vueMap.newGcp[1] : vueMap.gcps[vueMap.editingID - 1][1];
    feature.getGeometry().setCoordinates(xy);
  });

  vueMap.$on('updateMapID', async () => {
    const confirm = await dialog.showMessageBox({
      type: 'info',
      buttons: ['OK', 'Cancel'],
      cancelId: 1,
      message: t('mapedit.confirm_change_mapid')
    });
    if (confirm.response === 1) return;
    vueMap.onlyOne = false;
  });
  vueMap.$on('checkOnlyOne', () => {
    document.body.style.pointerEvents = 'none'; // eslint-disable-line no-undef
    const checked = backend.checkID(vueMap.mapID); // eslint-disable-line no-unused-vars
    ipcRenderer.once('checkIDResult', async (event, arg) => {
      document.body.style.pointerEvents = null; // eslint-disable-line no-undef
      if (arg) {
        await dialog.showMessageBox({
          type: 'info',
          buttons: ['OK'],
          message: t('mapedit.alert_mapid_checked')
        });
        vueMap.onlyOne = true;
        if (vueMap.status === 'Update') {
          vueMap.status = `Change:${mapID}`;
        }
      } else {
        await dialog.showMessageBox({
          type: 'info',
          buttons: ['OK'],
          message: t('mapedit.alert_mapid_duplicated')
        });
        vueMap.onlyOne = false;
      }
    });
  });
  vueMap.$on('wmtsGenerate', () => {
    if (!wmtsGenerator) {
      wmtsGenerator = require('electron').remote.require('./wmts_generator'); // eslint-disable-line no-undef
      wmtsGenerator.init();
      ipcRenderer.on('wmtsGenerated', (event, arg) => {
        document.body.style.pointerEvents = null; // eslint-disable-line no-undef
        if (arg.err) {
          console.log(arg.err); // eslint-disable-line no-undef
          vueModal.finish(t('wmtsgenerate.error_generation')); // eslint-disable-line no-undef
        } else {
          vueMap.wmtsHash = arg.hash;
          vueModal.finish(t('wmtsgenerate.success_generation')); // eslint-disable-line no-undef
        }
      });
    }
    document.body.style.pointerEvents = 'none'; // eslint-disable-line no-undef
    vueModal.show(t('wmtsgenerate.generating_tile'));
    setTimeout(() => { // eslint-disable-line no-undef
      wmtsGenerator.generate(vueMap.mapID, vueMap.width, vueMap.height, vueMap.tinObjects[0].getCompiled(), vueMap.imageExtension, vueMap.mainLayerHash);
    }, 1);
  });
  vueMap.$on('mapUpload', async () => {
    if (vueMap.gcpsEditReady && (await dialog.showMessageBox({
      type: 'info',
      buttons: ['OK', 'Cancel'],
      cancelId: 1,
      message: t('mapedit.confirm_override_image')
    })).response === 1) return;
    if (!uploader) {
      uploader = require('electron').remote.require('./mapupload'); // eslint-disable-line no-undef
      uploader.init();
      ipcRenderer.on('uploadedMap', (event, arg) => {
        document.body.style.pointerEvents = null; // eslint-disable-line no-undef
        if (arg.err) {
          if (arg.err !== 'Canceled') {
            console.log(arg.err); // eslint-disable-line no-undef
            vueModal.finish(t('mapedit.error_image_upload'));
          } else vueModal.finish(t('mapedit.imexport_canceled'));
          return;
        } else {
          vueModal.finish(t('mapedit.success_image_upload'));
        }
        vueMap.width = arg.width;
        vueMap.height = arg.height;
        vueMap.url_ = arg.url;
        if (arg.imageExtension === 'jpg') {
          vueMap.imageExtension = undefined;
        } else {
          vueMap.imageExtension = arg.imageExtension;
        }

        reflectIllstMap().then(() => {
          gcpsToMarkers();
          backend.updateTin(vueMap.gcps, vueMap.edges, vueMap.currentEditingLayer, vueMap.bounds, vueMap.strictMode, vueMap.vertexMode);
        });
      });
    }
    document.body.style.pointerEvents = 'none'; // eslint-disable-line no-undef
    vueModal.show(t('mapedit.image_uploading'));
    uploader.showMapSelectDialog(t('mapupload.map_image'));
  });
  vueMap.$on('importMap', () => {
    if (!dataUploader) {
      dataUploader = require('electron').remote.require('./dataupload'); // eslint-disable-line no-undef
      dataUploader.init();

      ipcRenderer.on('uploadedData', (event, arg) => {
        document.body.style.pointerEvents = null; // eslint-disable-line no-undef
        if (arg.err) {
          if (arg.err === 'Canceled') {
            vueModal.finish('キャンセルされました。');
          } else if (arg.err === 'Exist') {
            vueModal.finish('存在する地図IDです。処理を停止します。');
          } else if (arg.err === 'NoTile') {
            vueModal.finish('データにタイル画像が含まれていません。処理を停止します。');
          } else if (arg.err === 'NoTmb') {
            vueModal.finish('データにサムネイルが含まれていません。処理を停止します。');
          } else {
            console.log(arg.err); // eslint-disable-line no-undef
            vueModal.finish('地図データ登録でエラーが発生しました。');
          }
          return;
        } else {
          vueModal.finish('正常に地図データが登録できました。');
          mapDataCommon(arg[0], arg[1]);
        }
      });
    }
    document.body.style.pointerEvents = 'none'; // eslint-disable-line no-undef
    vueModal.show(t('mapedit.image_uploading'));
    dataUploader.showDataSelectDialog(t('dataupload.data_zip'));
  });
  vueMap.$on('exportMap', () => {
    document.body.style.pointerEvents = 'none'; // eslint-disable-line no-undef
    vueModal.show(t('mapedit.message_export'));
    ipcRenderer.once('mapDownloadResult', (event, arg) => {
      document.body.style.pointerEvents = null; // eslint-disable-line no-undef
      if (arg === 'Success') {
        vueModal.finish(t('mapedit.export_success')); // eslint-disable-line no-undef
      } else if (arg === 'Canceled') {
        vueModal.finish(t('mapedit.imexport_canceled')); // eslint-disable-line no-undef
      } else {
        console.log(arg); // eslint-disable-line no-undef,no-console
        vueModal.finish(t('mapedit.export_error')); // eslint-disable-line no-undef
      }
    });
    backend.download(vueMap.map, vueMap.tinObjects.map((tin) => {
      if (typeof tin === 'string') return tin;
      return tin.getCompiled();
    }));
  });
  vueMap.$on('uploadCsv', async () => {
    if (vueMap.gcps.length > 0) {
      if ((await dialog.showMessageBox({
        type: 'info',
        buttons: ['OK', 'Cancel'],
        cancelId: 1,
        message: t('dataio.csv_override_confirm')
      })).response === 1) return; // eslint-disable-line no-undef
    }
    document.body.style.pointerEvents = 'none'; // eslint-disable-line no-undef
    backend.uploadCsv(t('dataio.csv_file'), vueMap.csvUploadUiValue, [vueMap.currentEditingLayer, vueMap.bounds, vueMap.strictMode, vueMap.vertexMode]);
    ipcRenderer.once('uploadedCsv', async (event, arg) => {
      document.body.style.pointerEvents = null; // eslint-disable-line no-undef
      if (arg.err) {
        const message = arg.err === 'Canceled' ? t('mapedit.updownload_canceled') : `${t('dataio.error_occurs')}: ${t(`dataio.${arg.err}`)}`;
        await dialog.showMessageBox({
          type: 'info',
          buttons: ['OK'],
          message
        });
        return;
      } else if (arg.gcps) {
        vueMap._updateWholeGcps(arg.gcps);
        gcpsToMarkers();
      }
    });
  });
  vueMap.$on('saveMap', async () => {
    if ((await dialog.showMessageBox({
      type: 'info',
      buttons: ['OK', 'Cancel'],
      cancelId: 1,
      message: t('mapedit.confirm_save')
    })).response === 1) return; // eslint-disable-line no-undef
    const saveValue = vueMap.map;
    if (saveValue.status.match(/^Change:(.+)$/) &&
      (await dialog.showMessageBox({
        type: 'info',
        buttons: ['OK', 'Cancel'],
        cancelId: 1,
        message: t('mapedit.confirm_save')
      })).response === 0) {
      saveValue.status = `Copy:${mapID}`;
    }
    document.body.style.pointerEvents = 'none'; // eslint-disable-line no-undef
    backend.save(saveValue, vueMap.tinObjects.map((tin) => {
      if (typeof tin === 'string') return tin;
      return tin.getCompiled();
    }));
    ipcRenderer.once('saveResult', async (event, arg) => {
      document.body.style.pointerEvents = null; // eslint-disable-line no-undef
      if (arg === 'Success') {
        await dialog.showMessageBox({
          type: 'info',
          buttons: ['OK'],
          message: t('mapedit.success_save')
        });
        if (mapID !== vueMap.mapID) {
          mapID = vueMap.mapID;
        }
        backend.request(mapID);
      } else if (arg === 'Exist') {
        await dialog.showMessageBox({
          type: 'info',
          buttons: ['OK'],
          message: t('mapedit.error_duplicate_id')
        });
      } else {
        console.log(arg); // eslint-disable-line no-undef,no-console
        await dialog.showMessageBox({
          type: 'info',
          buttons: ['OK'],
          message: t('mapedit.error_saving')
        });
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
  vueMap.$on('removeSubMap', async () => {
    if ((await dialog.showMessageBox({
      type: 'info',
      buttons: ['OK', 'Cancel'],
      cancelId: 1,
      message: t('mapedit.confirm_layer_delete')
    })).response === 0) { // eslint-disable-line no-undef
      vueMap.removeSubMap();
    }
  });

  let allowClose = false;

  // When move to other pages
  const dataNav = document.querySelectorAll('a[data-nav]'); // eslint-disable-line no-undef
  for (let i=0; i< dataNav.length; i++) {
    dataNav[i].addEventListener('click', async (ev) => {
      if (!vueMap.dirty || (await dialog.showMessageBox({
        type: 'info',
        buttons: ['OK', 'Cancel'],
        cancelId: 1,
        message: t('mapedit.confirm_no_save')
      })).response === 0) {
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
    setTimeout(async () => { // eslint-disable-line no-undef
      const confirm = await dialog.showMessageBox({
        type: 'info',
        buttons: ['OK', 'Cancel'],
        cancelId: 1,
        message: t('mapedit.confirm_no_save')
      });

      if (confirm.response === 0) { // eslint-disable-line no-undef
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

  ipcRenderer.on('taskProgress', (event, arg) => {
    vueModal.progress(t(arg.text), arg.percent, arg.progress);
  });
}
// バックエンドからマップファイル読み込み完了の通知が届いた際の処理
ipcRenderer.on('mapData', (event, arg) => {
  mapDataCommon(arg[0], arg[1]);
});
// 起動時処理: Vue Mapオブジェクト関連の設定ここまで

function mapDataCommon(json, tins) {
  document.body.style.pointerEvents = null; // eslint-disable-line no-undef
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
}

// 起動時処理: 地図外のUI設定ここから
// モーダルオブジェクト作成
vueModal = new Vue({
  el: "#modalBody",
  data: {
    modal: new bsn.Modal(document.getElementById('staticModal'), {}), //eslint-disable-line no-undef
    percent: 0,
    progressText: '',
    enableClose: false,
    text: ''
  },
  methods: {
    show(text) {
      this.text = text;
      this.percent = 0;
      this.progressText = '';
      this.enableClose = false;
      this.modal.show();
    },
    progress(text, perecent, progress) {
      this.text = text;
      this.percent = perecent;
      this.progressText = progress;
    },
    finish(text) {
      this.text = text;
      this.enableClose = true;
    },
    hide() {
      this.modal.hide();
    }
  }
});
/*vueModal.$on('closeModal', function() {
  this.modal.hide();
});*/
// 起動時処理: 地図外のUI設定ここまで
