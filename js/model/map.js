define(['model/maplatbase', 'backbone', 'underscore_extension'], function(MaplatBase, Backbone, _) {
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
    var Map = MaplatBase.extend({
        defaults: {
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
            lang: 'ja'
        },
        validate: function(attrs) {
            var err = {};
            if (attrs.mapID == null || attrs.mapID == '') err['mapID'] = '地図IDを指定してください。';
            else if (attrs.mapID && !attrs.mapID.match(/^[\d\w_\-]+$/)) err['mapID'] = '地図IDは英数字とアンダーバー、ハイフンのみが使えます。';
            else if (!attrs.onlyOne) err['mapID'] = '地図IDの一意性チェックを行ってください。';
            if (attrs.title == null || attrs.title == '') err['title'] = '表示用タイトルを指定してください。';
            else {
                if (typeof attrs.title != 'object') {
                    if (zenHankakuLength(attrs.title) > 30) err['title'] = '表示用タイトル(' + langs[attrs.lang] + ')を15文字(半角30文字)以内にしてください。';
                } else {
                    var keys = Object.keys(langs);
                    for (var i=0; i<keys.length; i++) {
                        if (attrs.title[keys[i]] && zenHankakuLength(attrs.title[keys[i]]) > 30)
                            err['title'] = '表示用タイトル(' + langs[keys[i]] + ')を15文字(半角30文字)以内にしてください。';
                    }
                }
            }
            if (attrs.attr == null || attrs.attr == '') err['attr'] = 'アトリビューションを指定してください。';
            if (Object.keys(err).length > 0) return err;
        },
        gcpsEditReady: function() {
            var attrs = this.attributes;
            return attrs.width && attrs.height && attrs.url_;
        },
        localedGet: function(locale, key) {
            var lang = this.get('lang');
            var val = this.get(key);
            if (typeof val != 'object') {
                return lang == locale ? val : '';
            } else {
                return val[locale] != null ? val[locale] : '';
            }
        },
        localedSet: function(locale, key, value) {
            var lang = this.get('lang');
            var val = this.get(key);
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
                    val = _.deepClone(val);
                    val[locale] = value;
                }
            }
            this.set(key, val);
        },
        langs: langs
    });
    return Map;
});
