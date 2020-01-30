import Vue from 'vue';
import {Language} from './model/language';

const {ipcRenderer} = require('electron'); // eslint-disable-line no-undef
const langObj = new Language();

new Vue({
    i18n: langObj.vi18n,
    el: '#applist'
});
