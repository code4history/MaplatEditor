import Vue from 'vue';

const {ipcRenderer} = require('electron'); // eslint-disable-line no-undef

const vueSettings = new Vue({
    created() {
        const self = this;
        self.backend = require('electron').remote.require('./settings'); // eslint-disable-line no-undef
        self.saveFolder = self.saveFolder_ = self.backend.getSetting('saveFolder');

        ipcRenderer.on('saveFolderSelected', (event, arg) => {
            self.saveFolder = arg;
        });
    },
    computed: {
        dirty() {
            return !(this.saveFolder === this.saveFolder_);
        }
    },
    el: '#dataFolderTab',
    data: {
        saveFolder: '',
        saveFolder_: ''
    },
    methods: {
        resetSettings() {
            this.saveFolder = this.saveFolder_;
        },
        saveSettings() {
            this.backend.setSetting('saveFolder', this.saveFolder);
            this.saveFolder_ = this.saveFolder;
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
for (let i=0; i< dataNav.length; i++) {
    dataNav[i].addEventListener('click', (ev) => {
        if (!vueSettings.dirty || confirm('設定に変更が加えられていますが保存されていません。\n保存せずに閉じてよいですか?')) { // eslint-disable-line no-undef
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
        if (confirm('設定に変更が加えられていますが保存されていません。\n保存せずに閉じてよいですか?')) { // eslint-disable-line no-undef
            allowClose = true;
            window.close(); // eslint-disable-line no-undef
        }
    }, 2);
});