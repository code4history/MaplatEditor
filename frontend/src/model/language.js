import Vue from 'vue';
import VueI18Next from "@panter/vue-i18next";

let singleton;

export class Language {
  constructor() {
    const backend = this.backend = require('electron').remote.require('./settings').init(); // eslint-disable-line no-undef
    const i18n = backend.i18n;
    Vue.use(VueI18Next);

    this.vi18n = new VueI18Next(i18n);
    this.t = backend.t;
    this.translate = backend.translate;

    const items = document.querySelectorAll('.vi18n'); // eslint-disable-line no-undef

    items.forEach((el) => {
      new Vue({
        el, // HTMLElementをそのままelプロパティに渡す
        i18n: this.vi18n
      });
    });
  }

  static getSingleton() {
    if (!singleton) singleton = new Language();
    return singleton;
  }
}