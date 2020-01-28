import Vue from 'vue';

Vue.config.debug = true;

const VueMap = Vue.extend({
    data() {
        return {
            saveFolder: ''
        };
    },
});