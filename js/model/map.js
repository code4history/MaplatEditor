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
            url: ''
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
        }
    });
    return Map;
});
