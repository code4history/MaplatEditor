import i18next from 'i18next';
import i18nxhr from 'i18next-xhr-backend';
import Vue from 'vue';
import VueI18Next from "@panter/vue-i18next";

export class Language {
    constructor() {
        const backend = this.backend = require('electron').remote.require('./settings');
        const lang = backend.getSetting('lang');
        const i18n = i18next.use(i18nxhr);
        Vue.use(VueI18Next);
        i18n.init({
            lng: lang,
            fallbackLng: 'en',
            backend: {
                loadPath: '../locales/{{lng}}/{{ns}}.json'
            }
        });

        this.i18n = new VueI18Next(i18n);
    }
}