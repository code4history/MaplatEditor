define(['model/maplatbase', 'backbone', 'underscore'], function(MaplatBase, Backbone, _) {
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
            lang: 'jp'
        },
        validate: function(attrs) {
            var err = {};
            if (attrs.mapID == null || attrs.mapID == '') err['mapID'] = '地図IDを指定してください。';
            else if (attrs.mapID && !attrs.mapID.match(/^[\d\w_\-]+$/)) err['mapID'] = '地図IDは英数字とアンダーバー、ハイフンのみが使えます。';
            else if (!attrs.onlyOne) err['mapID'] = '地図IDの一意性チェックを行ってください。';
            if (attrs.title == null || attrs.title == '') err['title'] = '表示用タイトルを指定してください。';
            else if (attrs.title.length > 15) err['title'] = '表示用タイトルは15文字以内にしてください。';
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
                    val[locale] = value;
                }
            }
            this.set(key, val);
        }
    });
    return Map;
});
