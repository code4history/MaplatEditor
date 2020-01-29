import i18n from 'i18next';
import i18nxhr from 'i18next-xhr-backend';

export class Language {
    constructor() {
        this.backend = require('electron').remote.require('./settings');
    }




}