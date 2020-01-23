import _ from '../../lib/underscore_extension';
import Vue from 'vue';

Vue.config.debug = true;

const defaultMap = {
    title: '',
    attr: '',
    dataAttr: '',
    strictMode: 'strict',
    vertexMode: 'plain',
    gcps: [],
    edges: [],
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
const langs = {
    'ja': '日本語',
    'en': '英語',
    'de': 'ドイツ語',
    'fr': 'フランス語',
    'es': 'スペイン語',
    'ko': '韓国語',
    'zh': '中国語簡体字',
    'zh-TW': '中国語繁体字'
};
function zenHankakuLength(text) {
    let len = 0;
    const str = escape(text);
    for (let i=0; i<str.length; i++,len++) {
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
const onOffAttr = ['license', 'dataLicense', 'reference', 'url']; // eslint-disable-line no-unused-vars
const langAttr = ['title', 'officialTitle', 'author', 'era', 'createdAt', 'contributor',
    'mapper', 'attr', 'dataAttr', 'description'];
const computed = {};
for (let i=0; i<langAttr.length; i++) {
    const key = langAttr[i];
    computed[key] = {
        get:(function(key) {
            return function() {
                return this.localedGet(key);
            };
        })(key),
        set:(function(key) {
            return function(newValue) {
                return this.localedSet(key, newValue);
            };
        })(key),
    }
}
const shareAttr = ['currentLang', 'onlyOne', 'vueInit', 'currentEditingLayer', 'map',
    'map_'];
for (let i=0; i<shareAttr.length; i++) {
    const key = shareAttr[i];
    computed[key] = {
        get:(function(key) {
            return function() {
                return this.share[key];
            };
        })(key),
        set:(function(key) {
            return function(newValue) {
                this.$set(this.share, key, newValue);
                return newValue;
            };
        })(key),
    }
}
const mapAttr = ['vertexMode', 'strictMode', 'status', 'width', 'height', 'url_', 'imageExtention', 'mapID', 'lang',
    'license', 'dataLicense', 'reference', 'url', 'sub_maps'];
for (let i=0; i<mapAttr.length; i++) {
    const key = mapAttr[i];
    computed[key] = {
        get:(function(key) {
            return function() {
                return this.share.map[key];
            };
        })(key),
        set:(function(key) {
            return function(newValue) {
                this.$set(this.share.map, key, newValue);
                return newValue;
            };
        })(key),
    };
}
computed.displayTitle = function() {
    if (this.map.title == null || this.map.title == '') return 'タイトル未設定';
    else {
        if (typeof this.map.title != 'object') {
            return this.map.title;
        } else {
            const title = this.map.title[this.lang];
            if (title == null || title == '') return 'タイトル未設定';
            return title;
        }
    }
};
computed.defaultLangFlag = {
    get() {
        return this.lang == this.currentLang;
        },
    set(newValue) {
        if (newValue) {
            const oldLang = this.lang;
            const newLang = this.currentLang;
            const buffer = {};
            for (let i=0; i < langAttr.length; i++) {
                const attr = langAttr[i];
                buffer[attr] = this.localedGetBylocale(oldLang, attr);
            }
            this.lang = newLang;
            for (let i=0; i < langAttr.length; i++) {
                const attr = langAttr[i];
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
computed.edges = function() {
    if (this.currentEditingLayer == 0) {
        if (!this.map.edges) this.$set(this.map, 'edges', []);
        return this.map.edges;
    } else if (this.map.sub_maps.length > 0) {
        if (!this.map.sub_maps[this.currentEditingLayer - 1].edges) {
            this.$set(this.map.sub_maps[this.currentEditingLayer - 1], 'edges', []);
        }
        return this.map.sub_maps[this.currentEditingLayer - 1].edges;
    } else {
        return;
    }
};
computed.tinObject = {
    get() {
        return this.tinObjects[this.currentEditingLayer];
        },
    set(newValue) {
        this.tinObjects.splice(this.currentEditingLayer, 1, newValue);
    }
};
computed.tinObjects = {
    get() {
        return this.share.tinObjects;
        },
    set(newValue) {
        this.share.tinObjects = newValue;
    }
};
computed.bounds = {
    get() {
        if (this.currentEditingLayer == 0) {
            return [this.width, this.height];
        }
        return this.map.sub_maps[this.currentEditingLayer - 1].bounds;
        },
    set(newValue) {
        if (this.currentEditingLayer != 0) {
            this.map.sub_maps[this.currentEditingLayer - 1].bounds = newValue;
        }
    }
};
computed.error = function() {
    const err = {};
    if (this.mapID == null || this.mapID == '') err['mapID'] = '地図IDを指定してください。';
    else if (this.mapID && !this.mapID.match(/^[\d\w_-]+$/)) err['mapID'] = '地図IDは英数字とアンダーバー、ハイフンのみが使えます。';
    else if (!this.onlyOne) err['mapIDOnlyOne'] = '地図IDの一意性チェックを行ってください。';
    if (this.map.title == null || this.map.title == '') err['title'] = '表示用タイトルを指定してください。';
    else {
        if (typeof this.map.title != 'object') {
            if (zenHankakuLength(this.map.title) > 30) err['title'] = `表示用タイトル(${this.langs[this.lang]})を15文字(半角30文字)以内にしてください。`;
        } else {
            const keys = Object.keys(this.langs);
            for (let i=0; i<keys.length; i++) {
                if (this.map.title[keys[i]] && zenHankakuLength(this.map.title[keys[i]]) > 30)
                    err['title'] = `表示用タイトル(${this.langs[keys[i]]})を15文字(半角30文字)以内にしてください。`;
            }
        }
    }
    if (this.map.attr == null || this.map.attr == '') err['attr'] = '地図画像のコピーライト表記を指定してください。';
    if (this.blockingGcpsError) err['blockingGcpsError'] = 'blockingGcpsError';
    return Object.keys(err).length > 0 ? err : null;
};
computed.blockingGcpsError = function() {
    return this.tinObjects.reduce((prev, curr) => curr == 'tooLinear' || curr == 'pointsOutside' || prev, false);
}
computed.errorStatus = function() {
    const tinObject = this.tinObject;
    if (!tinObject) return;
    return typeof tinObject == 'string' ? this.tinObject :
        tinObject.strict_status ? tinObject.strict_status : undefined;
};
computed.errorNumber = function() {
    return this.errorStatus == 'strict_error' ? this.tinObject.kinks.bakw.features.length : 0;
}
computed.importanceSortedSubMaps = function() {
    const array = Object.assign([], this.sub_maps);
    array.push(0);
    return array.sort((a, b) => {
        const ac = a == 0 ? 0 : a.importance;
        const bc = b == 0 ? 0 : b.importance;
        return (ac < bc ? 1 : -1);
    });
};
computed.prioritySortedSubMaps = function() {
    const array = Object.assign([], this.sub_maps);
    return array.sort((a, b) => (a.priority < b.priority ? 1 : -1));
};
computed.canUpImportance = function() {
    const most = this.importanceSortedSubMaps[0];
    const mostImportance = most == 0 ? 0 : most.importance;
    return this.importance != mostImportance;
};
computed.canDownImportance = function() {
    const least = this.importanceSortedSubMaps[this.importanceSortedSubMaps.length - 1];
    const leastImportance = least == 0 ? 0 : least.importance;
    return this.importance != leastImportance;
};
computed.canUpPriority = function() {
    if (this.currentEditingLayer == 0) return false;
    const mostPriority = this.prioritySortedSubMaps[0].priority;
    return this.priority != mostPriority;
};
computed.canDownPriority = function() {
    if (this.currentEditingLayer == 0) return false;
    const leastPriority = this.prioritySortedSubMaps[this.prioritySortedSubMaps.length - 1].priority;
    return this.priority != leastPriority;
};
computed.importance = function() {
    return this.currentEditingLayer == 0 ? 0 : this.sub_maps[this.currentEditingLayer - 1].importance;
}
computed.priority = function() {
    return this.currentEditingLayer == 0 ? 0 : this.sub_maps[this.currentEditingLayer - 1].priority;
}

const VueMap = Vue.extend({
    created() {
        const langKeys = Object.keys(langs);
        let langOpts = '';
        for (let i = 0; i < langKeys.length; i++) {
            langOpts = `${langOpts}<option value="${langKeys[i]}">${langs[langKeys[i]]}</oprion>`;
        }
        document.querySelector('#lang').innerHTML = langOpts; // eslint-disable-line no-undef
        },
    data() {
        return {
            share: {
                map: _.deepClone(defaultMap),
                map_: _.deepClone(defaultMap),
                currentLang: 'ja',
                onlyOne: false,
                vueInit: false,
                currentEditingLayer: 0,
                tinObjects: []
            },
            langs
        };
        },
    methods: {
        setCurrentAsDefault() {
            this.map_ = _.deepClone(this.map);
            },
        setInitialMap(map) {
            const setMap = _.deepClone(defaultMap);
            Object.assign(setMap, map);
            this.map = setMap;
            this.map_ = _.deepClone(setMap);
            this.currentLang = this.lang;
            this.onlyOne = true;
            },
        createSharedClone(template) {
            const newVueMap = new VueMap({
                template
            });
            newVueMap.share = this.share;
            return newVueMap;
            },
        localedGetBylocale(locale, key) {
            const lang = this.lang;
            const val = this.map[key];
            if (typeof val != 'object') {
                return lang == locale ? val : '';
            } else {
                return val[locale] != null ? val[locale] : '';
            }
            },
        localedGet(key) {
            return this.localedGetBylocale(this.currentLang, key);
            },
        localedSetBylocale(locale, key, value) {
            const lang = this.lang;
            let val = this.map[key];
            if (value == null) value = '';
            if (typeof val != 'object') {
                if (lang == locale) {
                    val = value;
                } else if (value != '') {
                    const val_ = {};
                    val_[lang] = val;
                    val_[locale] = value;
                    val = val_;
                }
            } else {
                if (value == '' && lang != locale) {
                    delete val[locale];
                    const keys = Object.keys(val);
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
            this.$set(this.map, key, val);
            },
        localedSet(key, value) {
            this.localedSetBylocale(this.currentLang, key, value);
            },
        addSubMap() {
            this.sub_maps.push({
                gcps:[],
                edges: [],
                priority: this.sub_maps.length+1,
                importance: this.sub_maps.length+1,
                bounds: [[0,0], [this.width, 0], [this.width, this.height], [0, this.height]]
            });
            this.tinObjects.push('');
            this.currentEditingLayer = this.sub_maps.length;
            this.normalizeImportance(this.importanceSortedSubMaps);
            this.normalizePriority(this.prioritySortedSubMaps);
            },
        removeSubMap() {
            if (this.currentEditingLayer == 0) return;
            const index = this.currentEditingLayer - 1;
            this.currentEditingLayer = 0;
            this.sub_maps.splice(index, 1);
            this.tinObjects.splice(index+1, 1);
            this.normalizeImportance(this.importanceSortedSubMaps);
            this.normalizePriority(this.prioritySortedSubMaps);
            },
        normalizeImportance(arr) {
            const zeroIndex = arr.indexOf(0);
            arr.map((item, index) => {
                if (index == zeroIndex) return;
                item.importance = zeroIndex - index;
            });
            },
        normalizePriority(arr) {
            arr.map((item, index) => {
                item.priority = arr.length - index;
            });
            },
        upImportance() {
            if (!this.canUpImportance) return;
            const arr = this.importanceSortedSubMaps;
            const target = this.currentEditingLayer == 0 ? 0 : this.sub_maps[this.currentEditingLayer-1];
            const index = arr.indexOf(target);
            arr.splice(index-1, 2, arr[index], arr[index-1]);
            this.normalizeImportance(arr);
            },
        downImportance() {
            if (!this.canDownImportance) return;
            const arr = this.importanceSortedSubMaps;
            const target = this.currentEditingLayer == 0 ? 0 : this.sub_maps[this.currentEditingLayer-1];
            const index = arr.indexOf(target);
            arr.splice(index, 2, arr[index+1], arr[index]);
            this.normalizeImportance(arr);
            },
        upPriority() {
            if (!this.canUpPriority) return;
            const arr = this.prioritySortedSubMaps;
            const index = arr.indexOf(this.sub_maps[this.currentEditingLayer-1]);
            arr.splice(index-1, 2, arr[index], arr[index-1]);
            this.normalizePriority(arr);
            },
        downPriority() {
            if (!this.canDownPriority) return;
            const arr = this.prioritySortedSubMaps;
            const index = arr.indexOf(this.sub_maps[this.currentEditingLayer-1]);
            arr.splice(index, 2, arr[index+1], arr[index]);
            this.normalizePriority(arr);
        }
        },
    computed
});

export default VueMap;
