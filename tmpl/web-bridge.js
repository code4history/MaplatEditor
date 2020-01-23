//var MaplatApp = require('../src/index').MaplatApp;
import {MaplatApp} from '@maplat/core';
import Map from '../frontend/src/model/map';
console.log(Map);
var Maplat = window.Maplat = {};
Maplat.createObject = function(option) {
    return new Promise(function(resolve) {
        var app = new MaplatApp(option);
        app.waitReady.then(function() {
            resolve(app);
        });
    });
};