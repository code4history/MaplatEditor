import Vue from 'vue';
import {Language} from './model/language';
import Header from '../vue/header.vue';
const {ipcRenderer} = require('electron'); // eslint-disable-line no-unused-vars,no-undef
const langObj = new Language();

async function initRun() {
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
