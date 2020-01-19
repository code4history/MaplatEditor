requirejs.config({
    baseUrl: 'js',
    map: {
        '*': {
            'css': 'common/js/css.min.js'
        }
    },
    paths: {
        'ol3': '../common/lib/ol-maplat',
        'bootstrap': '../common/lib/bootstrap-native',
        'underscore': 'underscore-min',
        'histmap': '../common/js/histmap',
        'ol-custom': '../common/js/ol-custom',
        'histmap_tin': '../common/js/histmap_tin',
        'tin': '../common/js/tin',
        'turf': '../common/lib/turf_maplat.min',
        'mapshaper': '../common/lib/mapshaper_maplat',
        'resize': '../common/js/detect-element-resize',
        'contextmenu': 'ol3-contextmenu',
        'geocoder': 'ol3-geocoder-debug',
        'switcher': 'ol3-layerswitcher',
        'Vue': 'vue'
    },
    shim: {
        'ol3': {
            exports: 'ol'
        },
        'turf': {
            exports: 'turf'
        },
        'contextmenu': {
            deps: ['ol3']
        },
        'geocoder': {
            deps: ['ol3']
        },
        'switcher': {
            deps: ['ol3']
        }
    }
});
