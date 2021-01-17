import Wookmark from 'wookmark/wookmark';
import Vue from 'vue';
import {Language} from './model/language';
import Header from '../vue/header.vue';
import VueContextMenu from "vue-context-menu";

const {ipcRenderer} = require('electron'); // eslint-disable-line no-undef
const langObj = Language.getSingleton();
const backend = require('electron').remote.require('./maplist'); // eslint-disable-line no-undef
backend.init();

//Vue.use(VueContextMenu);
const newMenuData = () => ({ mapID: "", name: "" });

async function initRun() {
  new Vue({
    i18n: langObj.vi18n,
    watch: {
      condition() {
        this.search();
      }
    },
    mounted() {
      backend.request();

      window.addEventListener('resize', this.handleResize);

      ipcRenderer.on("deleteError", (event, result) => {
        alert("削除が失敗しました。");
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
      const size = calcResize(document.body.clientWidth);
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
        const size = calcResize(document.body.clientWidth);
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
        if (!confirm(`${menuData.name}を削除しますか?\n(この処理は元に戻せません)`)) return;
        backend.delete(menuData.mapID, this.condition, this.page);
      }
    },
  });
}

function calcResize(width) {
  const pow = Math.floor((width - 25) / 205);
  return [Math.floor((width - 205 * pow + 5) / 2), 205 * (pow - 2) - 5];
}

initRun();
