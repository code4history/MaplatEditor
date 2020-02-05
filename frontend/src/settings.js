import Vue from 'vue';
import {Language} from './model/language';
import Header from '../vue/header.vue';
const {ipcRenderer} = require('electron'); // eslint-disable-line no-undef
const langObj = new Language();

async function initRun() {
    const t = await langObj.awaitT();
    const vueSettings = new Vue({
        i18n: langObj.vi18n,
        created() {
            const self = this;
            self.backend = require('electron').remote.require('./settings'); // eslint-disable-line no-undef
            self.saveFolder = self.saveFolder_ = self.backend.getSetting('saveFolder');
            self.lang = self.lang_ = self.backend.getSetting('lang');

            ipcRenderer.on('saveFolderSelected', (event, arg) => {
                self.saveFolder = arg;
            });
        },
        computed: {
            dirty() {
                return !(this.lang === this.lang_ && this.saveFolder === this.saveFolder_);
            }
        },
        el: '#container',
        template: '#settings-vue-template',
        components: {
            'header-template': Header
        },
        data: {
            saveFolder: '',
            saveFolder_: '',
            lang: '',
            lang_: ''
        },
        methods: {
            resetSettings() {
                this.saveFolder = this.saveFolder_;
                this.lang = this.lang_;
            },
            saveSettings() {
                if (this.saveFolder !== this.saveFolder_) {
                    this.backend.setSetting('saveFolder', this.saveFolder);
                    this.saveFolder_ = this.saveFolder;
                }
                if (this.lang !== this.lang_) {
                    this.backend.setSetting('lang', this.lang);
                    this.lang_ = this.lang;
                    this.$i18n.i18next.changeLanguage(this.lang);
                }
            },
            focusSettings(evt) {
                evt.target.blur();
                this.backend.showSaveFolderDialog(this.saveFolder);
            }
        }
    });

    let allowClose = false;

    // When move to other pages
    const dataNav = document.querySelectorAll('a[data-nav]'); // eslint-disable-line no-undef
    for (let i = 0; i < dataNav.length; i++) {
        dataNav[i].addEventListener('click', (ev) => {
            if (!vueSettings.dirty || confirm(t('settings.confirm_close_no_save'))) { // eslint-disable-line no-undef
                allowClose = true;
                window.location.href = ev.target.getAttribute('data-nav'); // eslint-disable-line no-undef
            }
        });
    }

    // When application will close
    window.addEventListener('beforeunload', (e) => { // eslint-disable-line no-undef
        if (!vueSettings.dirty) return;
        if (allowClose) {
            allowClose = false;
            return;
        }
        e.returnValue = 'false';
        setTimeout(() => { // eslint-disable-line no-undef
            if (confirm(t('settings.confirm_close_no_save'))) { // eslint-disable-line no-undef
                allowClose = true;
                window.close(); // eslint-disable-line no-undef
            }
        }, 2);
    });
}

initRun();