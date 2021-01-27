import Wookmark from 'wookmark/wookmark';
import Vue from 'vue';
import {Language} from './model/language';
import Header from '../vue/header.vue';
import VueContextMenu from "vue-context-menu";
import bsn from "bootstrap.native";

const {ipcRenderer} = require('electron'); // eslint-disable-line no-undef
const langObj = Language.getSingleton();
const backend = require('electron').remote.require('./maplist'); // eslint-disable-line no-undef
backend.init();

const newMenuData = () => ({ mapID: "", name: "" });

let vueModal; // eslint-disable-line prefer-const

async function initRun() {
  new Vue({
    i18n: langObj.vi18n,
    watch: {
      condition() {
        this.search();
      }
    },
    mounted() {
      const t = langObj.t;
      backend.start();

      window.addEventListener('resize', this.handleResize);

      ipcRenderer.on("migrationConfirm", (_event, _result) => {
        if (confirm(t("maplist.migration_confirm"))) {
          vueModal.show(t("maplist.migrating"));
          setTimeout(() => {
            backend.migration();
          }, 1000);
        } else {
          backend.request();
        }
      });
      ipcRenderer.on("deleteOldConfirm", (_event, _result) => {
        vueModal.hide();
        setTimeout(() => {
          if (confirm(t("maplist.delete_old_confirm"))) {
            vueModal.show(t("maplist.deleting_old"));
            setTimeout(() => {
              backend.deleteOld();
            }, 1000);
          }
        }, 1000);
      });
      ipcRenderer.on("deletedOld", (_event, _result) => {
        const t = langObj.t;
        vueModal.finish(t('maplist.deleted_old'));
      });
      ipcRenderer.on("deleteError", (_event, _result) => {
        const t = langObj.t;
        alert(t('maplist.delete_error'));
      });
      ipcRenderer.on('taskProgress', (event, arg) => {
        const t = langObj.t;
        vueModal.progress(t(arg.text), arg.percent, arg.progress);
      });
      ipcRenderer.on('mapList', (event, result) => {
        this.maplist = [];
        this.prev = result.prev;
        this.next = result.next;
        if (result.pageUpdate) {
          this.page = result.pageUpdate;
        }
        result.docs.forEach((arg) => {
          const map = {
            mapID: arg.mapID,
            name: arg.title,
          };
          if (!arg.width || !arg.height || !arg.thumbnail) {
            map.width = 190;
            map.height = 190;
            map.image = '../img/no_image.png';
          } else {
            map.width = arg.width > arg.height ? 190 : Math.floor(190 / arg.height * arg.width);
            map.height = arg.width > arg.height ? Math.floor(190 / arg.width * arg.height) : 190;
            map.image = arg.thumbnail;
          }

          this.maplist.push(map);
        });

        Vue.nextTick(() => {
          new Wookmark('#maplist');
          this.handleResize();
        });
      });
      Vue.nextTick(() => {
        new Wookmark('#maplist');
        this.handleResize();
      });
    },
    el: '#container',
    template: "#maplist-vue-template",
    components: {
      "header-template": Header,
      "context-menu": VueContextMenu
    },
    data() {
      const size = calcResize(document.body.clientWidth);  // eslint-disable-line no-undef
      return {
        maplist: [],
        padding: size[0],
        searchWidth: size[1],
        prev: false,
        next: false,
        page: 1,
        condition: "",
        menuData: newMenuData(),
        showCtx: false,
        contextClicks: []
      }
    },
    methods: {
      handleResize() {
        const size = calcResize(document.body.clientWidth);  // eslint-disable-line no-undef
        this.padding = size[0];
        this.searchWidth = size[1];
      },
      prevSearch() {
        this.page--;
        this.search();
      },
      nextSearch() {
        this.page++;
        this.search();
      },
      search() {
        backend.request(this.condition, this.page);
      },
      onCtxOpen(locals) {
        this.menuData = locals;
      },
      onCtxClose(locals) {
      },
      resetCtxLocals() {
        this.menuData = newMenuData();
      },
      deleteMap(menuData) {
        const t = langObj.t;
        if (!confirm(t('maplist.delete_confirm', { name: menuData.name }))) return;  // eslint-disable-line no-undef
        backend.delete(menuData.mapID, this.condition, this.page);
      }
    },
  });
}

vueModal = new Vue({
  el: "#modalBody",
  data: {
    modal: new bsn.Modal(document.getElementById('staticModal'), {}), //eslint-disable-line no-undef
    percent: 0,
    progressText: '',
    enableClose: false,
    text: ''
  },
  methods: {
    show(text) {
      this.text = text;
      this.percent = 0;
      this.progressText = '';
      this.enableClose = false;
      this.modal.show();
    },
    progress(text, perecent, progress) {
      this.text = text;
      this.percent = perecent;
      this.progressText = progress;
    },
    finish(text) {
      this.text = text;
      this.enableClose = true;
    },
    hide() {
      this.modal.hide();
    }
  }
});

function calcResize(width) {
  const pow = Math.floor((width - 25) / 205);
  return [Math.floor((width - 205 * pow + 5) / 2), 205 * (pow - 2) - 5];
}

initRun();
