define(['histmap', 'bootstrap', 'underscore_extension', 'turf', 'model/vuemap', 'contextmenu', 'geocoder', 'tin', 'switcher'],
    function(ol, bsn, _, turf, VueMap, ContextMenu, Geocoder, Tin) {
        var onOffAttr = ['license', 'dataLicense', 'reference', 'url'];
        var langAttr = ['title', 'officialTitle', 'author', 'era', 'createdAt', 'contributor',
            'mapper', 'attr', 'dataAttr', 'description'];

        var labelFontStyle = "Normal 12px Arial";
        const {ipcRenderer} = require('electron');
        var backend = require('electron').remote.require('../lib/mapedit');
        backend.init();
        var uploader;
        var mapID;
        var newlyAddGcp;
        var newlyAddEdge;
        var errorNumber;
        var illstMap;
        var illstSource;
        var mercMap;
        var modify;
        var snap;
        var hashes = window.location.href.slice(window.location.href.indexOf('?') + 1).split('&');
        for (var i = 0; i < hashes.length; i++) {
            hash = hashes[i].split('=');
            if (hash[0] === 'mapid') mapID = hash[1];
        }
        var formHelp = {
            'mapID': '一意な地図IDを入力してください。',
            'title': '地図の表示用名称を入力してください。',
            'attr': 'コピーライト表記等地図隅に表示しておく文字列を入力してください。'
        };

        function getTextWidth ( _text, _fontStyle ) {
            var canvas = undefined,
                context = undefined,
                metrics = undefined;

            canvas = document.createElement( "canvas" );

            context = canvas.getContext( "2d" );

            context.font = _fontStyle;
            metrics = context.measureText( _text );

            return metrics.width;
        }

        function gcpsToMarkers (gcps) {
            illstMap.resetMarker();
            mercMap.resetMarker();

            for (var i=0; i<gcps.length; i++) {
                var gcp = gcps[i];
                var mapXyIllst = illstSource.xy2HistMapCoords(gcp[0]);

                var labelWidth = getTextWidth( (i + 1), labelFontStyle ) + 10;

                var iconSVG = '<svg ' +
                    'version="1.1" id="Layer_1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ' +
                    'x="0px" y="0px" width="' + labelWidth + 'px" height="20px" ' +
                    'viewBox="0 0 ' + labelWidth + ' 20" enable-background="new 0 0 ' + labelWidth + ' 20" xml:space="preserve">'+
                    '<polygon x="0" y="0" points="0,0 ' + labelWidth + ',0 ' + labelWidth + ',16 ' + (labelWidth / 2 + 4) + ',16 ' +
                    (labelWidth / 2) + ',20 ' + (labelWidth / 2 - 4) + ',16 0,16 0,0" stroke="#000000" fill="#DEEFAE" stroke-width="2"></polygon>' +
                    '<text x="5" y="13" fill="#000000" font-family="Arial" font-size="12" font-weight="normal">' + (i + 1) + '</text>' +
                    '</svg>';

                var imageElement = new Image();
                imageElement.src = 'data:image/svg+xml,' + encodeURIComponent( iconSVG );

                var iconStyle = new ol.style.Style({
                    "image": new ol.style.Icon({
                        "img": imageElement,
                        "imgSize":[labelWidth, 70],
                        "anchor": [0.5, 1],
                        "offset": [0, -50]
                    })
                });

                illstMap.setMarker(mapXyIllst, { gcpIndex: i }, iconStyle);
                mercMap.setMarker(gcp[1], { gcpIndex: i }, iconStyle);
            }
        }

        function edgeStartMarker (arg, map) {
            var marker = arg.data.marker;
            var gcpIndex = marker.get('gcpIndex');
            if (gcpIndex !== 'new') {
                newlyAddEdge = gcpIndex;
            }
        }

        function edgeEndMarker (arg, map) {
            var marker = arg.data.marker;
            var gcpIndex = marker.get('gcpIndex');
            if (gcpIndex !== 'new') {
                newlyAddEdge = undefined;
            }
        }

        function edgeCancelMarker (arg, map) {
            newlyAddEdge = undefined;
        }

        function pairingMarker (arg, map) {
            var marker = arg.data.marker;
            var gcpIndex = marker.get('gcpIndex');
            if (gcpIndex !== 'new') {
                var gcps = vueMap.gcps;
                var gcp = gcps[gcpIndex];
                var forw = illstSource.xy2HistMapCoords(gcp[0]);
                var bakw = gcp[1];
                var forView = illstMap.getView();
                var bakView = mercMap.getView();
                forView.setCenter(forw);
                bakView.setCenter(bakw);
                forView.setZoom(illstSource.maxZoom - 1);
                bakView.setZoom(17);
            }
        }

        function removeMarker (arg, map) {
            var marker = arg.data.marker;
            var gcpIndex = marker.get('gcpIndex');
            if (gcpIndex === 'new') {
                newlyAddGcp = null;
                map.getSource('marker').removeFeature(marker);
            } else {
                var gcps = vueMap.gcps;
                gcps.splice(gcpIndex, 1);
                gcpsToMarkers(gcps);
            }
        }

        function addNewMarker (arg, map) {
            var gcps = vueMap.gcps;
            var number = gcps.length + 1;
            var isIllst = map === illstMap;
            var coord = arg.coordinate;
            var xy = isIllst ? illstSource.histMapCoords2Xy(coord) : coord;

            if (!newlyAddGcp) {
                var labelWidth = getTextWidth( number, labelFontStyle ) + 10;

                var iconSVG = '<svg ' +
                    'version="1.1" id="Layer_1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ' +
                    'x="0px" y="0px" width="' + labelWidth + 'px" height="20px" ' +
                    'viewBox="0 0 ' + labelWidth + ' 20" enable-background="new 0 0 ' + labelWidth + ' 20" xml:space="preserve">'+
                    '<polygon x="0" y="0" points="0,0 ' + labelWidth + ',0 ' + labelWidth + ',16 ' + (labelWidth / 2 + 4) + ',16 ' +
                    (labelWidth / 2) + ',20 ' + (labelWidth / 2 - 4) + ',16 0,16 0,0" stroke="#000000" fill="#FFCCCC" stroke-width="2"></polygon>' +
                    '<text x="5" y="13" fill="#000000" font-family="Arial" font-size="12" font-weight="normal">' + number + '</text>' +
                    '</svg>';

                var imageElement = new Image();
                imageElement.src = 'data:image/svg+xml,' + encodeURIComponent( iconSVG );

                var iconStyle = new ol.style.Style({
                    "image": new ol.style.Icon({
                        "img": imageElement,
                        "imgSize":[labelWidth, 70],
                        "anchor": [0.5, 1],
                        "offset": [0, -50]
                    })
                });

                map.setMarker(coord, { gcpIndex: 'new' }, iconStyle);

                newlyAddGcp = isIllst ? [xy, ] : [, xy];
            } else if ((isIllst && !newlyAddGcp[0]) || (!isIllst && !newlyAddGcp[1])) {
                if (isIllst) { newlyAddGcp[0] = xy; } else { newlyAddGcp[1] = xy; }
                gcps.push(newlyAddGcp);
                gcpsToMarkers(gcps);
                newlyAddGcp = null;
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

        function onClick(evt) {
            if (evt.pointerEvent.altKey) return;
            var isIllst = this === illstMap;
            var srcMap = isIllst ? illstMap : mercMap;
            var distMap = isIllst ? mercMap : illstMap;
            var srcMarkerLoc = evt.coordinate;
            var srcXy = isIllst ? illstSource.histMapCoords2Xy(srcMarkerLoc) : srcMarkerLoc;

            var srcCheck = srcMap.getSource('check');
            var distCheck = distMap.getSource('check');
            srcCheck.clear();
            distCheck.clear();

            var tinObject = vueMap.tinObject;
            if (typeof tinObject === 'string') {
                alert(tinObject === 'tooLessGcps' ? '変換テストに必要な対応点の数が少なすぎます' :
                tinObject === 'tooLinear' ? '対応点が直線的に並びすぎているため、変換テストが実行できません。' :
                tinObject === 'pointsOutside' ? '対応点が地図領域外にあるため、変換テストが実行できません。' :
                '原因不明のエラーのため、変換テストが実行できません。');
                return;
            }
            if (tinObject.strict_status === 'strict_error' && !isIllst) {
                alert('厳格モードでエラーがある際は、逆変換ができません。');
                return;
            }
            var distXy = tinObject.transform(srcXy, !isIllst);

            if (!distXy) {
                alert('地図領域範囲外のため、変換ができません。');
                return;
            }

            var distMarkerLoc = isIllst ? distXy : illstSource.xy2HistMapCoords(distXy);
            distMap.getView().setCenter(distMarkerLoc);

            var iconSVG = '<svg ' +
                'version="1.1" id="Layer_1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ' +
                'x="0px" y="0px" width="10px" height="15px" ' +
                'viewBox="0 0 10 15" enable-background="new 0 0 10 15" xml:space="preserve">'+
                '<polygon x="0" y="0" points="5,1 9,5 5,14 1,5 5,1" ' +
                'stroke="#FF0000" fill="#FFFF00" stroke-width="2"></polygon>' +
                '</svg>';
            var imageElement = new Image();
            imageElement.src = 'data:image/svg+xml,' + encodeURIComponent( iconSVG );

            var style = new ol.style.Style({
                "image": new ol.style.Icon({
                    "img": imageElement,
                    "imgSize":[10, 15],
                    "anchor": [0.5, 1]
                })
            });
            var srcFeature = new ol.Feature({geometry: new ol.geom.Point(srcMarkerLoc)});
            var distFeature = new ol.Feature({geometry: new ol.geom.Point(distMarkerLoc)});
            srcFeature.setStyle(style);
            distFeature.setStyle(style);
            srcCheck.addFeature(srcFeature);
            distCheck.addFeature(distFeature);
        }

        function tinResultUpdate() {
            var tinObject = vueMap.tinObject;

            jsonClear();
            boundsClear();

            var forProj = 'ZOOM:' + illstSource.maxZoom;
            var jsonReader = new ol.format.GeoJSON();

            var boundsSource = illstMap.getSource('bounds');
            var bboxPoints;
            if (vueMap.currentEditingLayer === 0) {
                bboxPoints = [[0, 0], [vueMap.width, 0], [vueMap.width, vueMap.height], [0, vueMap.height], [0, 0]];
            } else {
                bboxPoints = Object.assign([], vueMap.bounds);
                bboxPoints.push(vueMap.bounds[0]);
            }
            var bbox = turf.polygon([bboxPoints]);
            var bboxFeature = jsonReader.readFeatures(bbox, {dataProjection:forProj, featureProjection:'EPSG:3857'});
            boundsSource.addFeatures(bboxFeature);

            if (modify) {
                illstMap.removeInteraction(modify);
            }
            if (snap) {
                illstMap.removeInteraction(snap);
            }
            if (vueMap.currentEditingLayer !== 0) {
                modify = new ol.interaction.Modify({
                    source: boundsSource
                });
                modify.on('modifyend', function(evt) {
                    vueMap.bounds = evt.features.item(0).getGeometry().getCoordinates()[0].filter(function(item, index, array) {
                        return index === array.length - 1 ? false : true;
                    }).map(function(merc) {
                        return ol.proj.transform(merc, 'EPSG:3857', forProj);
                    });
                    backend.updateTin(vueMap.gcps, vueMap.currentEditingLayer, vueMap.bounds, vueMap.strictMode, vueMap.vertexMode);
                });
                snap = new ol.interaction.Snap({source: boundsSource});
                illstMap.addInteraction(modify);
                illstMap.addInteraction(snap);
            }

            if (typeof tinObject === 'string') {
                return;
            }

            var forTin = tinObject.tins.forw;
            var bakTin = tinObject.tins.bakw;
            var bakFeatures = jsonReader.readFeatures(bakTin, {dataProjection:'EPSG:3857'});
            var forFeatures = jsonReader.readFeatures(forTin, {dataProjection:forProj, featureProjection:'EPSG:3857'});
            mercMap.getSource('json').addFeatures(bakFeatures);
            illstMap.getSource('json').addFeatures(forFeatures);

            errorNumber = null;
            if (tinObject.strict_status === 'strict_error') {
                var kinkFeatures = jsonReader.readFeatures(tinObject.kinks.bakw, {dataProjection:'EPSG:3857'});
                mercMap.getSource('json').addFeatures(kinkFeatures);
            }
        }

        function tinStyle(feature) {
            if (feature.getGeometry().getType() === 'Polygon') {
                return new ol.style.Style({
                    stroke: new ol.style.Stroke({
                        color: 'blue',
                        width: 1
                    }),
                    fill: new ol.style.Fill({
                        color: 'rgba(0, 0, 255, 0.05)'
                    })
                });
            } else if (feature.getGeometry().getType() === 'LineString') {
                return new ol.style.Style({
                    stroke: new ol.style.Stroke({
                        color: 'red',
                        width: 2
                    })
                });
            }
            var iconSVG = '<svg ' +
                'version="1.1" id="Layer_1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ' +
                'x="0px" y="0px" width="6px" height="6px" ' +
                'viewBox="0 0 6 6" enable-background="new 0 0 6 6" xml:space="preserve">'+
                '<polygon x="0" y="0" points="3,0 6,3 3,6 0,3 ' +
                '3,0" stroke="#FF0000" fill="#FFFF00" stroke-width="2"></polygon>' +
                '</svg>';
            var imageElement = new Image();
            imageElement.src = 'data:image/svg+xml,' + encodeURIComponent( iconSVG );

            return new ol.style.Style({
                "image": new ol.style.Icon({
                    "img": imageElement,
                    "imgSize":[6, 6],
                    "anchor": [0.5, 0.5]
                })
            });
        }

        var boundsStyle = new ol.style.Style({
            stroke: new ol.style.Stroke({
                color: 'red',
                width: 2
            }),
            fill: new ol.style.Fill({
                color: 'rgba(0, 0, 0, 0)'
            })
        });

        function reflectIllstMap() {
            return ol.source.HistMap.createAsync({
                mapID: mapID,
                url: vueMap.url_,
                width: vueMap.width,
                height: vueMap.height,
                attr: vueMap.attr,
                noload: true
            },{})
                .then(function(source) {
                    illstSource = source;
                    illstMap.exchangeSource(illstSource);
                    var initialCenter = illstSource.xy2HistMapCoords([vueMap.width / 2, vueMap.height / 2]);
                    var illstView = illstMap.getView();
                    illstView.setCenter(initialCenter);

                    var gcps = vueMap.gcps;
                    if (gcps && gcps.length > 0) {
                        var center;
                        var zoom;
                        if (gcps.length === 1) {
                            center = gcps[0][1];
                            zoom = 16;
                        } else {
                            var results = gcps.reduce(function(prev, curr, index) {
                                var merc = curr[1];
                                prev[0][0] = prev[0][0] + merc[0];
                                prev[0][1] = prev[0][1] + merc[1];
                                if (merc[0] > prev[1][0]) prev[1][0] = merc[0];
                                if (merc[1] > prev[1][1]) prev[1][1] = merc[1];
                                if (merc[0] < prev[2][0]) prev[2][0] = merc[0];
                                if (merc[1] < prev[2][1]) prev[2][1] = merc[1];
                                if (index === gcps.length - 1) {
                                    var center = [prev[0][0]/gcps.length, prev[0][1]/gcps.length];
                                    var deltax = prev[1][0] - prev[2][0];
                                    var deltay = prev[1][1] - prev[2][1];
                                    var delta = deltax > deltay ? deltax : deltay;
                                    var zoom = Math.log(600 / 256 * ol.const.MERC_MAX * 2 / deltax) / Math.log(2);
                                    return [center, zoom];
                                } else return prev;
                            },[[0,0],[-1*ol.const.MERC_MAX,-1*ol.const.MERC_MAX],[ol.const.MERC_MAX,ol.const.MERC_MAX]]);
                        }
                        var mercView = mercMap.getView();
                        mercView.setCenter(results[0]);
                        mercView.setZoom(results[1]);
                    }
                }).catch(function (err) {
                    console.log(err);
                });
        }

        var app = {};
        //マーカードラッグ用(Exampleよりコピペ)
        /**
         * @constructor
         * @extends {ol.interaction.Pointer}
         */
        app.Drag = function() {
            ol.interaction.Pointer.call(this, {
                handleDownEvent: app.Drag.prototype.handleDownEvent,
                handleDragEvent: app.Drag.prototype.handleDragEvent,
                handleMoveEvent: app.Drag.prototype.handleMoveEvent,
                handleUpEvent: app.Drag.prototype.handleUpEvent
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

        };
        ol.inherits(app.Drag, ol.interaction.Pointer);

        /**
         * @param {ol.MapBrowserEvent} evt Map browser event.
         * @return {boolean} `true` to start the drag sequence.
         */
        app.Drag.prototype.handleDownEvent = function(evt) {
            if (evt.pointerEvent.button === 2) return;
            var map = evt.map;

            var this_ = this;
            var feature = map.forEachFeatureAtPixel(evt.pixel, function(feature, layer) {
                return feature;
            }, {
                layerFilter: function(layer) {
                    return layer.get('name') === this_.layerFilter;
                }
            });

            if (feature) {
                this.coordinate_ = evt.coordinate;
                this.feature_ = feature;
            }

            return !!feature;
        };

        /**
         * @param {ol.MapBrowserEvent} evt Map browser event.
         */
        app.Drag.prototype.handleDragEvent = function(evt) {
            if (evt.pointerEvent.button === 2) return;
            var map = evt.map;

            var this_ = this;

            var deltaX = evt.coordinate[0] - this.coordinate_[0];
            var deltaY = evt.coordinate[1] - this.coordinate_[1];

            var geometry = /** @type {ol.geom.SimpleGeometry} */
                (this.feature_.getGeometry());
            geometry.translate(deltaX, deltaY);

            this.coordinate_[0] = evt.coordinate[0];
            this.coordinate_[1] = evt.coordinate[1];
        };

        /**
         * @param {ol.MapBrowserEvent} evt Event.
         */
        app.Drag.prototype.handleMoveEvent = function(evt) {
            if (evt.pointerEvent.button === 2) return;
            var anotherMap = evt.map === illstMap ? mercMap : illstMap;
            anotherMap.closeContextMenu();
            if (this.cursor_) {
                var map = evt.map;

                var this_ = this;
                var feature = map.forEachFeatureAtPixel(evt.pixel, function(feature, layer) {
                    return feature;
                }, {
                    layerFilter: function(layer) {
                        return layer.get('name') === this_.layerFilter;
                    }
                });

                var element = evt.map.getTargetElement();
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
        };

        /**
         * @param {ol.MapBrowserEvent} evt Map browser event.
         * @return {boolean} `false` to stop the drag sequence.
         */
        app.Drag.prototype.handleUpEvent = function(evt) {
            if (evt.pointerEvent.button === 2) return;
            var map = evt.map;
            var isIllst = map === illstMap;
            var feature = this.feature_;
            var xy = feature.getGeometry().getCoordinates();
            xy = isIllst ? illstSource.histMapCoords2Xy(xy) : xy;

            var gcpIndex = feature.get('gcpIndex');
            if (gcpIndex !== 'new') {
                var gcps = vueMap.gcps;
                var gcp = gcps[gcpIndex];
                gcp[isIllst ? 0 : 1] = xy;
                gcps.splice(gcpIndex, 1, gcp);
            } else {
                newlyAddGcp[isIllst ? 0 : 1] = xy;
            }
            this.coordinate_ = null;
            this.feature_ = null;
            return false;
        };

        ol.MaplatMap.prototype.initContextMenu = function() {
            var normalContextMenu = {
                text: 'マーカー追加',
                callback: addNewMarker
            };

            var removeContextMenu = {
                text: 'マーカー削除',
                callback: removeMarker
            };

            var pairingContextMenu = {
                text: '対応マーカー表示',
                callback: pairingMarker
            };

            var edgeStartContextMenu = {
                text: '対応線開始マーカー指定',
                callback: edgeStartMarker
            };

            var edgeEndContextMenu = {
                text: '対応線終了マーカー指定',
                callback: edgeEndMarker
            };

            var edgeCancelContextMenu = {
                text: '対応線指定キャンセル',
                callback: edgeCancelMarker
            };

            var contextmenu = this.contextmenu = new ContextMenu({
                width: 170,
                defaultItems: false,
                items: [ normalContextMenu ]
            });
            this.addControl(contextmenu);
            var restore = false;

            contextmenu.on('open', function(evt){
                var feature = this.map_.forEachFeatureAtPixel(evt.pixel, function(ft, l){
                    return ft;
                }, {
                    layerFilter: function(layer) {
                        return layer.get('name') === 'marker';
                    }
                });
                if (feature) {
                    contextmenu.clear();
                    if (newlyAddEdge !== undefined) {
                        if (feature.get('gcpIndex') !== 'new' && feature.get('gcpIndex') !== newlyAddEdge) {
                            edgeEndContextMenu.data = {
                                marker: feature
                            };
                            contextmenu.push(edgeEndContextMenu);
                        } else {
                            contextmenu.push(edgeCancelContextMenu);
                        }
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
                    restore = true;
                } else if (newlyAddEdge !== undefined) {
                    contextmenu.clear();
                    contextmenu.push(edgeCancelContextMenu);
                } else if (restore) {
                    contextmenu.clear();
                    contextmenu.push(normalContextMenu);
                    //contextmenu.extend(contextmenu.getDefaultItems());
                    restore = false;
                }
                if (this.map_ === illstMap) {
                    var xy = illstSource.histMapCoords2Xy(evt.coordinate);
                    var outsideCheck = vueMap.currentEditingLayer ? function(xy) {
                        var bboxPoints = Object.assign([], vueMap.bounds);
                        bboxPoints.push(vueMap.bounds[0]);
                        var bbox = turf.polygon([bboxPoints]);
                        return !turf.booleanPointInPolygon(xy, bbox);
                    } : function(xy) {
                        return xy[0] < 0 || xy[1] < 0 ||
                            xy[0] > vueMap.width || xy[1] > vueMap.height;
                    };
                    if (outsideCheck(xy)) setTimeout(function() {contextmenu.close();}, 10);
                }
            });

            this.on('unfocus',function() {
                console.log('unfocus');
            });
        };
        ol.MaplatMap.prototype.closeContextMenu = function() {
            this.contextmenu.close();
        };

        function mapObjectInit() {
            // 起動時処理: 編集用地図の設定、絵地図側OpenLayersの設定ここから
            illstMap = new ol.MaplatMap({
                div: 'illstMap',
                interactions: ol.interaction.defaults().extend([
                    new ol.interaction.DragRotateAndZoom({
                        condition: ol.events.condition.altKeyOnly
                    })
                ]),
                controls: ol.control.defaults()
            });
            // コンテクストメニュー初期化
            illstMap.initContextMenu();
            // マーカーなど表示用レイヤー設定
            var jsonLayer = new ol.layer.Vector({
                source: new ol.source.Vector({
                    wrapX: false
                }),
                style: tinStyle
            });
            jsonLayer.set('name', 'json');
            illstMap.getLayer('overlay').getLayers().push(jsonLayer);
            // 三角網など表示用レイヤー設定
            var checkLayer = new ol.layer.Vector({
                source: new ol.source.Vector({
                    wrapX: false
                }),
                style: tinStyle
            });
            checkLayer.set('name', 'check');
            illstMap.getLayers().push(checkLayer);
            // bounds表示用レイヤー設定
            var boundsLayer = new ol.layer.Vector({
                source: new ol.source.Vector({
                    wrapX: false
                }),
                style: boundsStyle
            });
            boundsLayer.set('name', 'bounds');
            illstMap.getLayer('overlay').getLayers().push(boundsLayer);
            // インタラクション設定
            illstMap.on('click', onClick);
            illstMap.addInteraction(new app.Drag());

            // 起動時処理: 編集用地図の設定、絵地図側OpenLayersの設定ここまで

            // 起動時処理: 編集用地図の設定、ベースマップ側OpenLayersの設定ここから
            mercMap = new ol.MaplatMap({
                div: 'mercMap',
                interactions: ol.interaction.defaults().extend([
                    new ol.interaction.DragRotateAndZoom({
                        condition: ol.events.condition.altKeyOnly
                    })
                ]),
                controls: ol.control.defaults()
            });
            // コンテクストメニュー初期化
            mercMap.initContextMenu();
            // マーカーなど表示用レイヤー設定
            jsonLayer = new ol.layer.Vector({
                source: new ol.source.Vector({
                    wrapX: false
                }),
                style: tinStyle
            });
            jsonLayer.set('name', 'json');
            mercMap.getLayer('overlay').getLayers().push(jsonLayer);
            // 三角網など表示用レイヤー設定
            checkLayer = new ol.layer.Vector({
                source: new ol.source.Vector({
                    wrapX: false
                }),
                style: tinStyle
            });
            checkLayer.set('name', 'check');
            mercMap.getLayers().push(checkLayer);
            // インタラクション設定
            mercMap.on('click', onClick);
            mercMap.addInteraction(new app.Drag());
            var mercSource;
            // ベースマップリスト作成
            var tmsList = backend.getTmsList();
            var promises = tmsList.reverse().map(function(tms) {
                return (function(tms){
                    var promise = tms.label ?
                        ol.source.HistMap.createAsync({
                            mapID: tms.mapID,
                            label: tms.label,
                            attr: tms.attr,
                            maptype: 'base',
                            url: tms.url,
                            maxZoom: tms.maxZoom
                        }, {}) :
                        ol.source.HistMap.createAsync(tms.mapID, {});
                    return promise.then(function(source){
                        return new ol.layer.Tile({
                            title: tms.title,
                            type: 'base',
                            visible: tms.mapID === 'osm',
                            source: source
                        });
                    });
                })(tms);
            });
            // ベースマップコントロール追加
            Promise.all(promises).then(function(layers) {
                var layerGroup = new ol.layer.Group({
                    'title': 'ベースマップ',
                    layers: layers
                });
                var layers = mercMap.getLayers();
                layers.removeAt(0);
                layers.insertAt(0, layerGroup);

                var layerSwitcher = new ol.control.LayerSwitcher({});
                mercMap.addControl(layerSwitcher);
            });
            // ジオコーダコントロール追加
            var geocoder = new Geocoder('nominatim', {
                provider: 'osm',
                lang: 'en-US', //en-US, fr-FR
                placeholder: '住所を指定してください',
                limit: 5,
                keepOpen: false
            });
            mercMap.addControl(geocoder);

            // var switcher = new ol.control.LayerSwitcher();
            // mercMap.addControl(switcher);

            // 起動時処理: 編集用地図の設定、ベースマップ側OpenLayersの設定ここまで
        }

        // 起動時処理: Vue Mapオブジェクト関連の設定ここから
        var vueMap = new VueMap({
            el: '#title-vue',
            template: '#title-vue-template',
            watch: {
                gcpsEditReady: gcpsEditReady,
                gcps: function(val) {
                    if (!illstSource) return;
                    backend.updateTin(val, this.currentEditingLayer, this.bounds, this.strictMode, this.vertexMode);
                },
                sub_maps: function(val) {
                    console.log('sub_maps');
                },
                vertexMode: function() {
                    if (!illstSource) return;
                    backend.updateTin(this.gcps, this.currentEditingLayer, this.bounds, this.strictMode, this.vertexMode);
                },
                strictMode: function() {
                    if (!illstSource) return;
                    backend.updateTin(this.gcps, this.currentEditingLayer, this.bounds, this.strictMode, this.vertexMode);
                },
                currentEditingLayer: function() {
                    if (!illstSource) return;
                    gcpsToMarkers(vueMap.gcps);
                }
            }
        });
        function gcpsEditReady(val) {
            var a = document.querySelector('a[href="#gcpsTab"]');
            var li = a.parentNode;
            if (val) {
                li.classList.remove('disabled');
            } else {
                li.classList.add('disabled');
            }
        }
        if (mapID) {
            var mapIDElm = document.querySelector('#mapID');
            backend.request(mapID);
        } else {
            setVueMap();
        }
        function setVueMap() {
            vueMap.vueInit = true;
            var vueMap2 = vueMap.createSharedClone('#metadataTabForm-template');
            vueMap2.$mount('#metadataTabForm');
            var vueMap3 = vueMap.createSharedClone('#gcpsTabDiv-template');
            vueMap3.$mount('#gcpsTabDiv');
            mapObjectInit();
            vueMap2.$on('updateMapID', function(){
                if (!confirm('地図IDを変更してよろしいですか?')) return;
                vueMap2.onlyOne = false;
            });
            vueMap2.$on('checkOnlyOne', function(){
                document.body.style.pointerEvents = 'none';
                var checked = backend.checkID(vueMap.mapID);
                ipcRenderer.once('checkIDResult', function(event, arg) {
                    document.body.style.pointerEvents = null;
                    if (arg) {
                        alert('一意な地図IDです。');
                        vueMap.onlyOne = true;
                        if (vueMap.status === 'Update') {
                            vueMap.status = 'Change:' + mapID;
                        }
                    } else {
                        alert('この地図IDは存在します。他のIDにしてください。');
                        vueMap.onlyOne = false;
                    }
                });
            });
            vueMap2.$on('mapUpload', function(){
                if (vueMap.gcpsEditReady && !confirm('地図画像は既に登録されています。\n置き換えてよいですか?')) return;
                if (!uploader) {
                    uploader = require('electron').remote.require('../lib/mapupload');
                    uploader.init();
                    ipcRenderer.on('mapUploaded', function(event, arg) {
                        document.body.style.pointerEvents = null;
                        myModal.hide();
                        if (arg.err) {
                            if (arg.err !== 'Canceled') alert('地図アップロードでエラーが発生しました。');
                            return;
                        } else {
                            alert('正常に地図がアップロードできました。');
                        }
                        vueMap.width = arg.width;
                        vueMap.height = arg.height;
                        vueMap.url_ = arg.url;
                        if (arg.imageExtention === 'jpg') {
                            vueMap.imageExtention = undefined;
                        } else {
                            vueMap.imageExtention = arg.imageExtention;
                        }

                        reflectIllstMap().then(function() {
                            gcpsToMarkers(vueMap.gcps);
                            backend.updateTin(vueMap.gcps, vueMap.currentEditingLayer, vueMap.bounds, vueMap.strictMode, vueMap.vertexMode);
                        });
                    });
                }
                document.body.style.pointerEvents = 'none';
                document.querySelector('div.modal-body > p').innerText = '地図アップロード中です。';
                myModal.show();
                uploader.showMapSelectDialog();
            });
            vueMap.$on('saveMap', function(){
                if (!confirm('変更を保存します。\nよろしいですか?')) return;
                var saveValue = vueMap.map;
                if (saveValue.status.match(/^Change:(.+)$/) &&
                    confirm('地図IDが変更されています。コピーを行いますか?\nコピーの場合はOK、移動の場合はキャンセルを選んでください。')) {
                    saveValue.status = 'Copy:' + mapID;
                }
                document.body.style.pointerEvents = 'none';
                backend.save(saveValue, vueMap.tinObjects.map(function(tin) {
                    if (typeof tin === 'string') return tin;
                    return tin.getCompiled();
                }));
                ipcRenderer.once('saveResult', function(event, arg) {
                    document.body.style.pointerEvents = null;
                    if (arg === 'Success') {
                        alert('正常に保存できました。');
                        if (mapID !== vueMap.mapID) {
                            mapID = vueMap.mapID;
                        }
                        backend.request(mapID);
                    } else if (arg === 'Exist') {
                        alert('地図IDが重複しています。\n地図IDを変更してください。');
                    } else {
                        console.log(arg);
                        alert('保存時エラーが発生しました。');
                    }
                });
            });
            vueMap3.$on('viewError', function(){
                var tinObject = vueMap.tinObject;
                if (!(tinObject instanceof Tin)) return;
                var kinks = tinObject.kinks.bakw.features;
                if (errorNumber === null) {
                    errorNumber = 0;
                } else {
                    errorNumber++;
                    if (errorNumber >= kinks.length) errorNumber = 0;
                }
                var errorPoint = kinks[errorNumber].geometry.coordinates;
                var view = mercMap.getView();
                view.setCenter(errorPoint);
                view.setZoom(17);
            });
            vueMap3.$on('removeSubMap', function(){
                if (confirm('本当にこのサブレイヤを削除してよろしいですか?')) {
                    vueMap.removeSubMap();
                }
            });
            gcpsEditReady(vueMap.gcpsEditReady);

            var allowClose = false;

            // When move to other pages
            var dataNav = document.querySelectorAll('a[data-nav]');
            for (var i=0; i< dataNav.length; i++) {
                dataNav[i].addEventListener('click', function(ev) {
                    if (!vueMap.dirty || confirm('地図に変更が加えられていますが保存されていません。\n保存せずに閉じてよいですか?')) {
                        allowClose = true;
                        window.location.href = ev.target.getAttribute('data-nav');
                    }
                });
            }

            // When application will close
            window.addEventListener('beforeunload', function(e) {
                if (!vueMap.dirty) return;
                if (allowClose) {
                    allowClose = false;
                    return;
                }
                e.returnValue = 'false';
                setTimeout(function() {
                    if (confirm('地図に変更が加えられていますが保存されていません。\n保存せずに閉じてよいですか?')) {
                        allowClose = true;
                        window.close();
                    }
                }, 2);
            });

            ipcRenderer.on('updatedTin', function(event, arg) {
                var index = arg[0];
                var tin;
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
        ipcRenderer.on('mapData', function(event, arg) {
            var json = arg[0];
            var tins = arg[1];
            json.mapID = mapID;
            json.status = 'Update';
            json.onlyOne = true;
            vueMap.setInitialMap(json);
            vueMap.tinObjects = tins.map(function(compiled) {
                if (typeof compiled === 'string') return compiled;
                var tin = new Tin({});
                tin.setCompiled(compiled);
                return tin;
            });
            if (!vueMap.vueInit) {
                setVueMap();
            }
            reflectIllstMap().then(function() {
                gcpsToMarkers(vueMap.gcps);
                tinResultUpdate();
            });
        });
        // 起動時処理: Vue Mapオブジェクト関連の設定ここまで

        // 起動時処理: 地図外のUI設定ここから
        // モーダルオブジェクト作成
        var myModal = new bsn.Modal(document.getElementById('staticModal'), {});
        // 対応点設定タブが選ばれた際、OpenLayersを初期化
        var myMapTab = document.querySelector('a[href="#gcpsTab"]');
        myMapTab.addEventListener('shown.bs.tab', function(e) {
            illstMap.updateSize();
            mercMap.updateSize();
        });
        // 起動時処理: 地図外のUI設定ここまで
    });
