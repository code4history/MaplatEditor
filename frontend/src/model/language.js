import Vue from 'vue';
import i18next from 'i18next';
import HttpApi from 'i18next-http-backend';
import VueI18Next from "@panter/vue-i18next";

let singleton;

export class Language {
  async setup() {
    await window.baseApi.require('settings'); // eslint-disable-line no-undef
    //const backend = this.backend = require('electron').remote.require('./settings').init(); // eslint-disable-line no-undef
    this.i18n = i18next.use(HttpApi); //backend.i18n;
    Vue.use(VueI18Next);

    const lang = await window.settings.lang(); // eslint-disable-line no-undef
    this.vi18n = new VueI18Next(this.i18n);
    this.t = await this.i18n.init({
      lng: lang,
      fallbackLng: 'en',
      backend: {
        loadPath: `../locales/{{lng}}/{{ns}}.json` // eslint-disable-line no-undef
      }
    });
    this.translate = (dataFragment) => {
      if (!dataFragment || typeof dataFragment != 'object') return dataFragment;
      const langs = Object.keys(dataFragment);
      let key = langs.reduce((prev, curr) => {
        if (curr === 'en' || !prev) {
          prev = dataFragment[curr];
        }
        return prev;
      }, null);
      key = (typeof key == 'string') ? key : `${key}`;
      if (this.i18n.exists(key, {ns: 'translation', nsSeparator: '__X__yX__X__'}))
        return this.t(key, {ns: 'translation', nsSeparator: '__X__yX__X__'});
      for (let i = 0; i < langs.length; i++) {
        const lang = langs[i];
        this.i18n.addResource(lang, 'translation', key, dataFragment[lang]);
      }
      return this.t(key, {ns: 'translation', nsSeparator: '__X__yX__X__'});
    };

    const items = document.querySelectorAll('.vi18n'); // eslint-disable-line no-undef

    items.forEach((el) => {
      new Vue({
        el, // HTMLElementをそのままelプロパティに渡す
        i18n: this.vi18n
      });
    });
  }

  static async getSingleton() {
    if (!singleton) {
      const temp = new Language();
      await temp.setup();
      singleton = temp;
    }
    return singleton;
  }
}