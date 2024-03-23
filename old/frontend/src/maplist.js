import Wookmark from 'wookmark/wookmark';
import Vue from 'vue';
import {Language} from './model/language';
import Header from '../vue/header.vue';
import VueContextMenu from "vue-context-menu";
import bsn from "bootstrap.native";

let langObj;
const newMenuData = () => ({ mapID: "", name: "" });

let vueModal; // eslint-disable-line prefer-const

async function initRun() {
  await window.baseApi.require('maplist'); // eslint-disable-line no-undef
  langObj = await Language.getSingleton();
  new Vue({
    i18n: langObj.vi18n,
    watch: {
      condition() {
        this.search();
      }
    },
    mounted() {
      const t = langObj.t;
      window.maplist.start(); // eslint-disable-line no-undef

      window.addEventListener('resize', this.handleResize); // eslint-disable-line no-undef

      window.maplist.on("migrationConfirm", () => { // eslint-disable-line no-undef
        if (confirm(t("maplist.migration_confirm"))) { // eslint-disable-line no-undef
          vueModal.show(t("maplist.migrating"));
          setTimeout(() => { // eslint-disable-line no-undef
            window.maplist.migration(); // eslint-disable-line no-undef
          }, 1000);
        } else {
          window.maplist.request(); // eslint-disable-line no-undef
        }
      });
      window.maplist.on("deleteOldConfirm", () => { // eslint-disable-line no-undef
        vueModal.hide();
        setTimeout(() => { // eslint-disable-line no-undef
          if (confirm(t("maplist.delete_old_confirm"))) { // eslint-disable-line no-undef
            vueModal.show(t("maplist.deleting_old"));
            setTimeout(() => { // eslint-disable-line no-undef
              window.maplist.deleteOld(); // eslint-disable-line no-undef
            }, 1000);
          }
        }, 1000);
      });
      window.maplist.on("deletedOld", () => { // eslint-disable-line no-undef
        const t = langObj.t;
        vueModal.finish(t('maplist.deleted_old'));
      });
      window.maplist.on("deleteError", () => { // eslint-disable-line no-undef
        const t = langObj.t;
        alert(t('maplist.delete_error')); // eslint-disable-line no-undef
      });
      window.maplist.on('taskProgress', (ev, args) => { // eslint-disable-line no-undef
        const t = langObj.t;
        vueModal.progress(t(args.text), args.percent, args.progress);
      });
      window.maplist.on('mapList', (ev, args) => { // eslint-disable-line no-undef
        this.maplist = [];
        this.prev = args.prev;
        this.next = args.next;
        if (args.pageUpdate) {
          this.page = args.pageUpdate;
        }
        args.docs.forEach((doc) => {
          const map = {
            mapID: doc.mapID,
            name: doc.title,
          };
          if (!doc.width || !doc.height || !doc.thumbnail) {
            map.width = 190;
            map.height = 190;
            map.image = '../img/no_image.png';
          } else {
            map.width = doc.width > doc.height ? 190 : Math.floor(190 / doc.height * doc.width);
            map.height = doc.width > doc.height ? Math.floor(190 / doc.width * doc.height) : 190;
            map.image = doc.thumbnail;
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
        window.maplist.request(this.condition, this.page); // eslint-disable-line no-undef
      },
      onCtxOpen(locals) {
        this.menuData = locals;
      },
      onCtxClose(locals) { // eslint-disable-line no-unused-vars
      },
      resetCtxLocals() {
        this.menuData = newMenuData();
      },
      deleteMap(menuData) {
        const t = langObj.t;
        if (!confirm(t('maplist.delete_confirm', { name: menuData.name }))) return; // eslint-disable-line no-undef
        window.maplist.delete(menuData.mapID, this.condition, this.page); // eslint-disable-line no-undef
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
