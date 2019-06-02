define(['underscore_extension', 'Vue'],
    function(_, Vue) {
        Vue.config.debug = true;

        var defaultMap = {
            title: '',
            attr: '',
            dataAttr: '',
            strictMode: 'strict',
            vertexMode: 'plain',
            gcps: [],
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
            width: undefined,
            height: undefined,
            url_: '',
            lang: 'ja',
            imageExtention: undefined
        };
        var langs = {
            'ja': '日本語',
            'en': '英語',
            'de': 'ドイツ語',
            'fr': 'フランス語',
            'es': 'スペイン語',
            'ko': '韓国語',
            'zh-Hans': '中国語簡体字',
            'zh-Hant': '中国語繁体字'
        };
        function zenHankakuLength(text) {
            var len = 0;
            var str = escape(text);
            for (var i=0; i<str.length; i++,len++) {
                if (str.charAt(i) == "%") {
                    if (str.charAt(++i) == "u") {
                        i += 3;
                        len++;
                    }
                    i++;
                }
            }
            return len;
        }
        var onOffAttr = ['license', 'dataLicense', 'reference', 'url'];
        var langAttr = ['title', 'officialTitle', 'author', 'era', 'createdAt', 'contributor',
            'mapper', 'attr', 'dataAttr', 'description'];
        var computed = {};
        for (var i=0; i<langAttr.length; i++) {
            var key = langAttr[i];
            computed[key] = {
                get:(function(key){
                    return function() {
                        return this.localedGet(key);
                    };
                })(key),
                set:(function(key){
                    return function(newValue) {
                        return this.localedSet(key, newValue);
                    };
                })(key),
            }
        }
        var shareAttr = ['currentLang', 'onlyOne', 'gcpsInit', 'vueInit', 'currentEditingLayer', 'map',
            'map_'];
        for (var i=0; i<shareAttr.length; i++) {
            var key = shareAttr[i];
            computed[key] = {
                get:(function(key){
                    return function() {
                        return this.share[key];
                    };
                })(key),
                set:(function(key){
                    return function(newValue) {
                        return this.share[key] = newValue;
                    };
                })(key),
            }
        }
        var mapAttr = ['vertexMode', 'strictMode', 'status', 'width', 'height', 'url_', 'imageExtention', 'mapID', 'lang',
            'license', 'dataLicense', 'reference', 'url'];
        for (var i=0; i<mapAttr.length; i++) {
            var key = mapAttr[i];
            computed[key] = {
                get:(function(key){
                    return function() {
                        return this.share.map[key];
                    };
                })(key),
                set:(function(key){
                    return function(newValue) {
                        return this.share.map[key] = newValue;
                    };
                })(key),
            }
        }
        computed.displayTitle = function() {
            if (this.map.title == null || this.map.title == '') return 'タイトル未設定';
            else {
                if (typeof this.map.title != 'object') {
                    return this.map.title;
                } else {
                    var title = this.map.title[this.lang];
                    if (title == null || title == '') return 'タイトル未設定';
                    return title;
                }
            }
        };
        computed.defaultLangFlag = {
            get: function() {
                return this.lang == this.currentLang;
            },
            set: function(newValue) {
                if (newValue) {
                    var oldLang = this.lang;
                    var newLang = this.currentLang;
                    var buffer = {};
                    for (var i=0; i < langAttr.length; i++) {
                        var attr = langAttr[i];
                        buffer[attr] = this.localedGetBylocale(oldLang, attr);
                    }
                    this.lang = newLang;
                    for (var i=0; i < langAttr.length; i++) {
                        var attr = langAttr[i];
                        this.localedSetBylocale(oldLang, attr, buffer[attr]);
                        this.localedSetBylocale(newLang, attr, this[attr]);
                    }
                }
            }
        };
        computed.imageExtentionCalc = function() {
            if (this.imageExtention) return this.imageExtention;
            if (this.width && this.height) return 'jpg';
            return;
        };
        computed.gcpsEditReady = function() {
            return (this.width && this.height && this.url_) || false;
        };
        computed.dirty = function() {
            return !_.isDeepEqual(this.map_, this.map);
        };
        computed.gcps = function() {
            if (this.currentEditingLayer == 0) {
                return this.map.gcps;
            } else if (this.map.sub_maps.length > 0) {
                return this.map.sub_maps[this.currentEditingLayer - 1].gcps;
            } else {
                return;
            }
        };
        computed.tinObject = {
            get: function() {
                return this.tinObjects[this.currentEditingLayer];
            },
            set: function(newValue) {
                this.tinObjects.splice(this.currentEditingLayer, 1, newValue);
            }
        };
        computed.tinObjects = {
            get: function() {
                return this.share.tinObjects;
            },
            set: function(newValue) {
                this.share.tinObjects = newValue;
            }
        };
        computed.bounds = {
            get: function() {
                if (this.currentEditingLayer == 0) {
                    return [this.width, this.height];
                }
                return this.map.sub_maps[this.currentEditingLayer - 1].bounds;
            },
            set: function(newValue) {
                if (this.currentEditingLayer != 0) {
                    this.map.sub_maps[this.currentEditingLayer - 1].bounds = newValue;
                }
            }
        };
        computed.error = function() {
            var err = {};
            if (this.mapID == null || this.mapID == '') err['mapID'] = '地図IDを指定してください。';
            else if (this.mapID && !this.mapID.match(/^[\d\w_\-]+$/)) err['mapID'] = '地図IDは英数字とアンダーバー、ハイフンのみが使えます。';
            else if (!this.onlyOne) err['mapIDOnlyOne'] = '地図IDの一意性チェックを行ってください。';
            if (this.map.title == null || this.map.title == '') err['title'] = '表示用タイトルを指定してください。';
            else {
                if (typeof this.map.title != 'object') {
                    if (zenHankakuLength(this.map.title) > 30) err['title'] = '表示用タイトル(' + this.langs[this.lang] + ')を15文字(半角30文字)以内にしてください。';
                } else {
                    var keys = Object.keys(this.langs);
                    for (var i=0; i<keys.length; i++) {
                        if (this.map.title[keys[i]] && zenHankakuLength(this.map.title[keys[i]]) > 30)
                            err['title'] = '表示用タイトル(' + this.langs[keys[i]] + ')を15文字(半角30文字)以内にしてください。';
                    }
                }
            }
            if (this.map.attr == null || this.map.attr == '') err['attr'] = '地図画像のコピーライト表記を指定してください。';
            if (this.linearGcps) err['linearGcps'] = 'linearGcps';
            return Object.keys(err).length > 0 ? err : null;
        };
        computed.linearGcps = function() {
            return this.tinObjects.reduce(function(prev, curr) {
                return curr == 'tooLinear' || prev;
            }, false);
        };

        var VueMap = Vue.extend({
            created: function () {
                var langKeys = Object.keys(langs);
                var langOpts = '';
                for (var i = 0; i < langKeys.length; i++) {
                    langOpts = langOpts + '<option value="' + langKeys[i] + '">' + langs[langKeys[i]] + '</oprion>';
                }
                document.querySelector('#lang').innerHTML = langOpts;
            },
            data: function() {
                return {
                    share: {
                        map: _.deepClone(defaultMap),
                        map_: _.deepClone(defaultMap),
                        currentLang: 'ja',
                        onlyOne: false,
                        gcpsInit: false,
                        vueInit: false,
                        currentEditingLayer: 0,
                        tinObjects: []
                    },
                    langs: langs
                };
            },
            methods: {
                setCurrentAsDefault: function() {
                    this.map_ = _.deepClone(this.map);
                },
                setInitialMap: function(map) {
                    var setMap = _.deepClone(defaultMap);
                    Object.assign(setMap, map);
                    this.map = setMap;
                    this.map_ = _.deepClone(setMap);
                    this.currentLang = this.lang;
                    this.onlyOne = true;
                },
                createSharedClone: function(template) {
                    var newVueMap = new VueMap({
                        template: template
                    });
                    newVueMap.share = this.share;
                    return newVueMap;
                },
                localedGetBylocale: function(locale, key) {
                    var lang = this.lang;
                    var val = this.map[key];
                    if (typeof val != 'object') {
                        return lang == locale ? val : '';
                    } else {
                        return val[locale] != null ? val[locale] : '';
                    }
                },
                localedGet: function(key) {
                    return this.localedGetBylocale(this.currentLang, key);
                },
                localedSetBylocale: function(locale, key, value) {
                    var lang = this.lang;
                    var val = this.map[key];
                    if (value == null) value = '';
                    if (typeof val != 'object') {
                        if (lang == locale) {
                            val = value;
                        } else if (value != '') {
                            var val_ = {};
                            val_[lang] = val;
                            val_[locale] = value;
                            val = val_;
                        }
                    } else {
                        if (value == '' && lang != locale) {
                            delete val[locale];
                            var keys = Object.keys(val);
                            if (keys.length == 0) {
                                val = '';
                            } else if (keys.length == 1 && keys[0] == lang) {
                                val = val[lang];
                            }
                        } else {
                            // val = _.deepClone(val);
                            val[locale] = value;
                        }
                    }
                    this.map[key] = val;
                },
                localedSet: function(key, value) {
                    this.localedSetBylocale(this.currentLang, key, value);
                }
            },
            computed: computed
        });

        return VueMap;
    });
