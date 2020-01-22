//マーカードラッグ用
import { Pointer } from 'ol/interaction';

/**
 * @constructor
 * @extends {ol.interaction.Pointer}
 */

export class Drag extends Pointer {
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
        let feature = map.forEachFeatureAtPixel(evt.pixel, (feature, layer) => {
            return feature;
        }, {
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
            const feature = map.forEachFeatureAtPixel(evt.pixel, (feature, layer) => {
                return feature;
            }, {
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
    };

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
            var gcps = vueMap.gcps;
            var gcp = gcps[gcpIndex];
            gcp[isIllst ? 0 : 1] = xy;
            gcps.splice(gcpIndex, 1, gcp);
            gcpsToMarkers();
        } else {
            newlyAddGcp[isIllst ? 0 : 1] = xy;
        }
        this.coordinate_ = null;
        this.feature_ = null;
        return false;
    };
}


