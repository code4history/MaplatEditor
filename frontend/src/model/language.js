import i18next from 'i18next';
import i18nxhr from 'i18next-xhr-backend';
import Vue from 'vue';
import VueI18Next from "@panter/vue-i18next";

let singleton;

export class Language {
    constructor() {
        const backend = this.backend = require('electron').remote.require('./settings').init(); // eslint-disable-line no-undef
        const lang = backend.getSetting('lang');
        const i18n = i18next.use(i18nxhr);
        Vue.use(VueI18Next);
        const i18nPromise = i18n.init({
            lng: lang,
            fallbackLng: 'en',
            backend: {
                loadPath: '../locales/{{lng}}/{{ns}}.json'
            }
        });
        i18nPromise.then((t) => {
            this.t = t;
        });

        this.vi18n = new VueI18Next(i18n);
        this.awaitT = function() {
            return i18nPromise.then((t) => t);
        }

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