import _ from '../../lib/underscore_extension';
import Vue from 'vue';
import {Language} from "./language";
import crypto from 'crypto';
import Tin from '@maplat/tin';
import {transform} from "ol/proj";
import proj from "proj4";

Vue.config.debug = true;
const langObj = Language.getSingleton();

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
  imageExtension: undefined,
  wmtsHash: undefined,
  wmtsFolder: '',
  homePosition: undefined,
  mercZoom: undefined
};
const langs = {
  'ja': 'japanese',
  'en': 'english',
  'de': 'germany',
  'fr': 'french',
  'es': 'spanish',
  'ko': 'korean',
  'zh': 'simplified',
  'zh-TW': 'traditional'
};
defaultMap.langs = langs;
function zenHankakuLength(text) {
  let len = 0;
  const str = escape(text);
  for (let i=0; i<str.length; i++,len++) {
    if (str.charAt(i) === "%") {
      if (str.charAt(++i) === "u") {
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
const shareAttr = ['currentLang', 'onlyOne', 'vueInit', 'currentEditingLayer', 'csvUploadUiValue', 'map',
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
const mapAttr = ['vertexMode', 'strictMode', 'status', 'width', 'height', 'url_', 'imageExtension', 'mapID', 'lang',
  'license', 'dataLicense', 'reference', 'url', 'sub_maps', 'homePosition', 'mercZoom'];
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
  if (this.map.title == null || this.map.title === '') return this.$t('mapmodel.untitled');
  else {
    if (typeof this.map.title != 'object') {
      return this.map.title;
    } else {
      const title = this.map.title[this.lang];
      if (title == null || title === '') return this.$t('mapmodel.untitled');
      return title;
    }
  }
};
computed.defaultLangFlag = {
  get() {
    return this.lang === this.currentLang;
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
computed.templateMaps = {
  get() {
    return this.gcps.length > 0 ? this.templateMaps_ : [];
  },
  set(maps) {
    this.templateMaps_ = maps;
  }
};
computed.imageExtensionCalc = function() {
  if (this.imageExtension) return this.imageExtension;
  if (this.width && this.height) return 'jpg';
};
computed.gcpsEditReady = function() {
  return (this.width && this.height && this.url_) || false;
};
computed.wmtsEditReady = function() {
  const tin = this.share.tinObjects[0];
  return (this.mainLayerHash && this.wmtsDirty && tin.strict_status === Tin.STATUS_STRICT);
}
computed.csvUpError = function() {
  const uiValue = this.csvUploadUiValue;
  if (uiValue.pixXColumn === uiValue.pixYColumn || uiValue.pixXColumn === uiValue.lngColumn || uiValue.pixXColumn === uiValue.latColumn ||
    uiValue.pixYColumn === uiValue.lngColumn || uiValue.pixYColumn === uiValue.latColumn || uiValue.lngColumn === uiValue.latColumn) {
    return "column_dup";
  } else if (!(typeof uiValue.pixXColumn == 'number' && typeof uiValue.pixYColumn == 'number' && typeof uiValue.lngColumn == 'number' && typeof uiValue.latColumn == 'number')) {
    return "column_null";
  } else if (!(typeof uiValue.ignoreHeader == 'number')) {
    return "ignore_header";
  } else {
    if (uiValue.projText === "") return "proj_text";
    try {
      proj(uiValue.projText, "EPSG:4326");
      return false;
    } catch(e) {
      return "proj_text";
    }
  }
}
computed.csvProjTextError = function() {

}
computed.csvProjPreset = {
  get() {
    const uiValue = this.csvUploadUiValue;
    return uiValue.projText === "EPSG:4326" ? "wgs84" : uiValue.projText === "EPSG:3857" ? "mercator" : "other";
  },
  set(newValue) {
    const uiValue = this.csvUploadUiValue;
    uiValue.projText = newValue === "wgs84" ? "EPSG:4326" : newValue === "mercator" ? "EPSG:3857" : "";
  }
}
computed.dirty = function() {
  return !_.isDeepEqual(this.map_, this.map);
};
computed.wmtsDirty = function() {
  return this.wmtsHash !== this.mainLayerHash;
};
computed.gcps = function() {
  if (this.currentEditingLayer === 0) {
    return this.map.gcps;
  } else if (this.map.sub_maps.length > 0) {
    return this.map.sub_maps[this.currentEditingLayer - 1].gcps;
  }
};
computed.edges = function() {
  if (this.currentEditingLayer === 0) {
    if (!this.map.edges) this.$set(this.map, 'edges', []);
    return this.map.edges;
  } else if (this.map.sub_maps.length > 0) {
    if (!this.map.sub_maps[this.currentEditingLayer - 1].edges) {
      this.$set(this.map.sub_maps[this.currentEditingLayer - 1], 'edges', []);
    }
    return this.map.sub_maps[this.currentEditingLayer - 1].edges;
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
computed.mainLayerHash = function() {
  const tin = this.share.tinObjects[0];
  if (!tin || typeof tin === 'string') return;
  const hashsum = crypto.createHash('sha1');
  hashsum.update(JSON.stringify(tin.getCompiled()));
  return hashsum.digest('hex');
};
computed.bounds = {
  get() {
    if (this.currentEditingLayer === 0) {
      return [this.width, this.height];
    }
    return this.map.sub_maps[this.currentEditingLayer - 1].bounds;
    },
  set(newValue) {
    if (this.currentEditingLayer !== 0) {
      this.map.sub_maps[this.currentEditingLayer - 1].bounds = newValue;
    }
  }
};
computed.error = function() {
  const err = {};
  if (this.mapID == null || this.mapID === '') err['mapID'] = 'mapedit.error_set_mapid';
  else if (this.mapID && !this.mapID.match(/^[\d\w_-]+$/)) err['mapID'] = 'mapedit.error_mapid_character';
  else if (!this.onlyOne) err['mapIDOnlyOne'] = 'mapedit.check_uniqueness';
  if (this.map.title == null || this.map.title === '') err['title'] = this.$t('mapmodel.no_title');
  else {
    if (typeof this.map.title != 'object') {
      if (zenHankakuLength(this.map.title) > 30) err['title'] = this.$t('mapmodel.over_title', {lang: this.$t(`common.${this.langs[this.lang]}`)});
    } else {
      const keys = Object.keys(this.langs);
      for (let i=0; i<keys.length; i++) {
        if (this.map.title[keys[i]] && zenHankakuLength(this.map.title[keys[i]]) > 30)
          err['title'] = this.$t('mapmodel.over_title', {lang: this.$t(`common.${this.langs[keys[i]]}`)});
      }
    }
  }
  if (this.map.attr == null || this.map.attr === '') err['attr'] = this.$t('mapmodel.image_copyright');
  if (this.blockingGcpsError) err['blockingGcpsError'] = 'blockingGcpsError';
  return Object.keys(err).length > 0 ? err : null;
};
computed.blockingGcpsError = function() {
  return this.tinObjects.reduce((prev, curr) => curr === 'tooLinear' || curr === 'pointsOutside' || prev, false);
}
computed.errorStatus = function() {
  const tinObject = this.tinObject;
  if (!tinObject) return;
  return typeof tinObject == 'string' ? this.tinObject :
    tinObject.strict_status ? tinObject.strict_status : undefined;
};
computed.errorNumber = function() {
  return this.errorStatus === 'strict_error' ? this.tinObject.kinks.bakw.features.length : 0;
}
computed.importanceSortedSubMaps = function() {
  const array = Object.assign([], this.sub_maps);
  array.push(0);
  return array.sort((a, b) => {
    const ac = a === 0 ? 0 : a.importance;
    const bc = b === 0 ? 0 : b.importance;
    return (ac < bc ? 1 : -1);
  });
};
computed.prioritySortedSubMaps = function() {
  const array = Object.assign([], this.sub_maps);
  return array.sort((a, b) => (a.priority < b.priority ? 1 : -1));
};
computed.canUpImportance = function() {
  const most = this.importanceSortedSubMaps[0];
  const mostImportance = most === 0 ? 0 : most.importance;
  return this.importance !== mostImportance;
};
computed.canDownImportance = function() {
  const least = this.importanceSortedSubMaps[this.importanceSortedSubMaps.length - 1];
  const leastImportance = least === 0 ? 0 : least.importance;
  return this.importance !== leastImportance;
};
computed.canUpPriority = function() {
  if (this.currentEditingLayer === 0) return false;
  const mostPriority = this.prioritySortedSubMaps[0].priority;
  return this.priority !== mostPriority;
};
computed.canDownPriority = function() {
  if (this.currentEditingLayer === 0) return false;
  const leastPriority = this.prioritySortedSubMaps[this.prioritySortedSubMaps.length - 1].priority;
  return this.priority !== leastPriority;
};
computed.importance = function() {
  return this.currentEditingLayer === 0 ? 0 : this.sub_maps[this.currentEditingLayer - 1].importance;
}
computed.priority = function() {
  return this.currentEditingLayer === 0 ? 0 : this.sub_maps[this.currentEditingLayer - 1].priority;
}
computed.editingID = {
  get() {
    if (this.newGcp) this.editingID_ = '';
    return this.newGcp ? this.newGcp[2] : this.editingID_;
  },
  set(newValue) {
    if (this.newGcp) {
      this.editingID_ = '';
    } else {
      this.editingID_ = newValue;
    }
  }
}
computed.editingX = {
  get() {
    return this.newGcp ? this.newGcp[0] ? this.newGcp[0][0] : '' : this.editingID === '' ? '' : this.gcps[this.editingID - 1][0][0];
  },
  set(newValue) {
    if (this.newGcp && this.newGcp[0]) {
      this.newGcp.splice(0, 1, [newValue, this.editingY]);
      this.$emit('setXY');
    } else if ((!this.newGcp) && this.editingID !== '') {
      this.gcps[this.editingID - 1].splice(0, 1, [newValue, this.editingY]);
      this.$emit('setXY');
    }
  }
}
computed.editingY = {
  get() {
    return this.newGcp ? this.newGcp[0] ? this.newGcp[0][1] : '' : this.editingID === '' ? '' : this.gcps[this.editingID - 1][0][1];
  },
  set(newValue) {
    if (this.newGcp && this.newGcp[0]) {
      this.newGcp.splice(0, 1, [this.editingX, newValue]);
      this.$emit('setXY');
    } else if ((!this.newGcp) && this.editingID !== '') {
      this.gcps[this.editingID - 1].splice(0, 1, [this.editingX, newValue]);
      this.$emit('setXY');
    }
  }
}
computed.editingLongLat = {
  get() {
    const merc = this.newGcp ? this.newGcp[1] ? this.newGcp[1] : '' : this.editingID === '' ? '' : this.gcps[this.editingID - 1][1];
    return merc === '' ? '' : transform(merc, 'EPSG:3857', 'EPSG:4326');
  },
  set(newValue) {
    const merc = transform(newValue, 'EPSG:4326', 'EPSG:3857');
    if (this.newGcp && this.newGcp[1]) {
      this.newGcp.splice(1, 1, merc);
      this.$emit('setLongLat');
    } else if ((!this.newGcp) && this.editingID !== '') {
      this.gcps[this.editingID - 1].splice(1, 1, merc);
      this.$emit('setLongLat');
    }
  }
}
computed.editingLong = {
  get() {
    return this.editingLongLat === '' ? '' : this.editingLongLat[0];
  },
  set(newValue) {
    this.editingLongLat = [newValue, this.editingLat];
  }
}
computed.editingLat = {
  get() {
    return this.editingLongLat === '' ? '' : this.editingLongLat[1];
  },
  set(newValue) {
    this.editingLongLat = [this.editingLong, newValue];
  }
}
computed.enableSetHomeIllst = function() {
  return (this.errorStatus === 'strict' || this.errorStatus === 'loose') && !this.homePosition;
}
computed.enableSetHomeMerc = function() {
  return !this.homePosition;
}

const VueMap = Vue.extend({
  i18n: langObj.vi18n,
  data() {
    return {
      share: {
        map: _.deepClone(defaultMap),
        map_: _.deepClone(defaultMap),
        currentLang: 'ja',
        onlyOne: false,
        vueInit: false,
        currentEditingLayer: 0,
        csvUploadUiValue: {
          pixXColumn: 1,
          pixYColumn: 2,
          lngColumn: 3,
          latColumn: 4,
          ignoreHeader: 0,
          reverseMapY: false,
          projText: "EPSG:4326"
        },
        csvProjPreset: "wgs84",
        tinObjects: []
      },
      langs,
      editingID_: '',
      newGcp: undefined,
      mappingUIRow: 'layer',
      templateMaps_: []
    };
    },
  methods: {
    _updateWholeGcps(gcps) {
      if (this.currentEditingLayer === 0) {
        this.map.gcps = gcps;
        this.$set(this.map, 'edges', []);
      } else if (this.map.sub_maps.length > 0) {
        this.map.sub_maps[this.currentEditingLayer - 1].gcps = gcps;
        this.$set(this.map.sub_maps[this.currentEditingLayer - 1], 'edges', []);
      }
    },
    csvQgisSetting() {
      this.csvUploadUiValue = Object.assign(this.csvUploadUiValue, {
        pixXColumn: 1,
        pixYColumn: 2,
        lngColumn: 3,
        latColumn: 4,
        ignoreHeader: 2,
        reverseMapY: true,
      });
    },
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
    localedGetBylocale(locale, key) {
      const lang = this.lang;
      const val = this.map[key];
      if (typeof val != 'object') {
        return lang === locale ? val : '';
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
        if (lang === locale) {
          val = value;
        } else if (value !== '') {
          const val_ = {};
          val_[lang] = val;
          val_[locale] = value;
          val = val_;
        }
      } else {
        if (value === '' && lang !== locale) {
          delete val[locale];
          const keys = Object.keys(val);
          if (keys.length === 0) {
            val = '';
          } else if (keys.length === 1 && keys[0] === lang) {
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
      if (this.currentEditingLayer === 0) return;
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
        if (index === zeroIndex) return;
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
      const target = this.currentEditingLayer === 0 ? 0 : this.sub_maps[this.currentEditingLayer-1];
      const index = arr.indexOf(target);
      arr.splice(index-1, 2, arr[index], arr[index-1]);
      this.normalizeImportance(arr);
      },
    downImportance() {
      if (!this.canDownImportance) return;
      const arr = this.importanceSortedSubMaps;
      const target = this.currentEditingLayer === 0 ? 0 : this.sub_maps[this.currentEditingLayer-1];
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
