import Vue from 'vue';
import {Language} from './model/language';
import Header from '../vue/header.vue';
let langObj;

async function initRun() {
  langObj = await Language.getSingleton();
  new Vue({
    i18n: langObj.vi18n,
    el: '#container',
    template: '#applist-vue-template',
    components: {
      "header-template": Header
    }
  });
}

initRun();
