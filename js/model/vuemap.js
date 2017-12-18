define(['underscore_extension', 'Vue'],
    function(_, Vue) {
        Vue.config.debug = true;

        var defaultMap = {
            title: '',
            attr: '',
            dataAttr: '',
            gcps: [],
            status: 'New',
            onlyOne: false,
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
            lang: 'ja'
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
        computed.defaultLangFlag = {
            get: function() {
                return this.share.map.lang == this.share.currentLang;
            },
            set: function(newValue) {
                if (newValue) {
                    // this.share.map.lang = this.share.currentLang;
                    var oldLang = this.share.map.lang;
                    var newLang = this.share.currentLang;
                    var buffer = {};
                    for (var i=0; i < langAttr.length; i++) {
                        var attr = langAttr[i];
                        buffer[attr] = this.localedGetBylocale(oldLang, attr);
                    }
                    this.share.map.lang = newLang;
                    for (var i=0; i < langAttr.length; i++) {
                        var attr = langAttr[i];
                        this.localedSetBylocale(oldLang, attr, buffer[attr]);
                        this.localedSetBylocale(newLang, attr, this[attr]);
                    }
                }
            }
        };
        computed.gcpsEditReady = function() {
            return (this.share.map.width && this.share.map.height && this.share.map.url_) || false;
        };
        computed.dirty = function() {
            return !_.isDeepEqual(this.share.map_, this.share.map);
        };
        computed.error = function() {
            var err = {};
            if (this.share.map.mapID == null || this.share.map.mapID == '') err['mapID'] = '地図IDを指定してください。';
            else if (this.share.map.mapID && !this.share.map.mapID.match(/^[\d\w_\-]+$/)) err['mapID'] = '地図IDは英数字とアンダーバー、ハイフンのみが使えます。';
            else if (!this.share.onlyOne) err['mapID'] = '地図IDの一意性チェックを行ってください。';
            if (this.share.map.title == null || this.share.map.title == '') err['title'] = '表示用タイトルを指定してください。';
            else {
                if (typeof this.share.map.title != 'object') {
                    if (zenHankakuLength(this.share.map.title) > 30) err['title'] = '表示用タイトル(' + this.langs[this.share.map.lang] + ')を15文字(半角30文字)以内にしてください。';
                } else {
                    var keys = Object.keys(this.langs);
                    for (var i=0; i<keys.length; i++) {
                        if (this.share.map.title[keys[i]] && zenHankakuLength(this.share.map.title[keys[i]]) > 30)
                            err['title'] = '表示用タイトル(' + this.langs[keys[i]] + ')を15文字(半角30文字)以内にしてください。';
                    }
                }
            }
            if (this.share.map.attr == null || this.share.map.attr == '') err['attr'] = 'アトリビューションを指定してください。';
            return Object.keys(err).length > 0 ? err : null;
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
                        onlyOne: false
                    },
                    langs: langs
                };
            },
            methods: {
                setInitialMap: function(map) {
                    var setMap = _.deepClone(defaultMap);
                    Object.assign(setMap, map);
                    this.share.map = setMap;
                    this.share.map_ = _.deepClone(setMap);
                    this.share.currentLang = this.share.map.lang;
                    this.share.onlyOne = true;
                },
                createSharedClone: function() {
                    var newVueMap = new VueMap();
                    newVueMap.share = this.share;
                    return newVueMap;
                },
                localedGetBylocale: function(locale, key) {
                    var lang = this.share.map.lang;
                    var val = this.share.map[key];
                    if (typeof val != 'object') {
                        return lang == locale ? val : '';
                    } else {
                        return val[locale] != null ? val[locale] : '';
                    }
                },
                localedGet: function(key) {
                    return this.localedGetBylocale(this.share.currentLang, key);
                },
                localedSetBylocale: function(locale, key, value) {
                    var lang = this.share.map.lang;
                    var val = this.share.map[key];
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
                    this.share.map[key] = val;
                },
                localedSet: function(key, value) {
                    this.localedSetBylocale(this.share.currentLang, key, value);
                }
            },
            computed: computed
        });

        return VueMap;
    });