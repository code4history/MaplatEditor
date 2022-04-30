import Vue from 'vue';
import {Language} from './model/language';
import Header from '../vue/header.vue';
let langObj;

async function initRun() {
  langObj = await Language.getSingleton();
  const t = langObj.t;
  const vueSettings = new Vue({
    i18n: langObj.vi18n,
    async created() {
      const self = this;
      self.saveFolder = self.saveFolder_ = await window.settings.getSetting('saveFolder'); // eslint-disable-line no-undef
      self.lang = self.lang_ = await window.settings.getSetting('lang'); // eslint-disable-line no-undef

      window.settings.on('saveFolderSelected', (event, arg) => { // eslint-disable-line no-undef
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
      async saveSettings() {
        if (this.saveFolder !== this.saveFolder_) {
          await window.settings.setSetting('saveFolder', this.saveFolder); // eslint-disable-line no-undef
          this.saveFolder_ = this.saveFolder;
        }
        if (this.lang !== this.lang_) {
          await window.settings.setSetting('lang', this.lang); // eslint-disable-line no-undef
          this.lang_ = this.lang;
          this.$i18n.i18next.changeLanguage(this.lang);
        }
      },
      async focusSettings(evt) {
        evt.target.blur();
        window.settings.showSaveFolderDialog(this.saveFolder); // eslint-disable-line no-undef
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
