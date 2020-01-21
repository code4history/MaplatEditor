define(['bootstrap', 'wookmark', 'Vue'],
    function(bsn, Wookmark, Vue) {
        const {ipcRenderer} = require('electron');

        var app = new Vue({
            created: function () {
                var wookmark;
                var self = this;

                var backend = require('electron').remote.require('./maplist');
                backend.request();

                ipcRenderer.on('mapListAdd', function(event, arg) {
                    var calcHeight;
                    var thumbnail;
                    var map = {
                        mapID: arg.mapID,
                        name: arg.title,
                    };
                    if (!arg.width || !arg.height || !arg.thumbnail) {
                        map.height = 190;
                        map.image = 'img/no_image.png';
                    } else {
                        map.height = Math.floor(190 / arg.width * arg.height);
                        map.image = arg.thumbnail;
                    }

                    self.maplist.push(map);
                    self.maplist = self.maplist.sort(function compare(a, b) {
                        if (a.mapID < b.mapID) return -1;
                        if (a.mapID > b.mapID) return 1;
                        // a は b と等しいはず
                        return 0;
                    });

                    Vue.nextTick(function () {
                        wookmark = new Wookmark('#maplist');
                    });
                });
                Vue.nextTick(function () {
                    wookmark = new Wookmark('#maplist');
                });
            },
            el: '#maplist',
            data: {
                maplist: []
            }
        });
    });
