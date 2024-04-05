<!--template>
  <router-link to="/">Home</router-link> ・
  <router-link to="/edit">Edit</router-link>
  <h1>My ToDo App</h1>
  <router-view />
</template-->

<script setup lang="ts">
import { useRoute } from 'vue-router'
import { ref, computed } from 'vue';
import header_option from './components/components/HeaderOption.vue'
let current = ref('/')
let target0 = ref('/')
const route = useRoute()
console.log(route.query.page)
const target0_ = computed(() => {
  return target0 || 'maplist.html'
})
/*export default {
  props: [
    '$t',
    'current',
    'target0'
  ],
  computed: {
    target0_() {
      return this.target0 || 'maplist.html';
    }
  },
  components: {
    'header-option': {
      props: [
        'current',
        'target',
        'title'
      ],
      template: '<li v-if="current == target" class="active"><a href="#">{{title}}</a></li><li v-else><a v-bind:href="target">{{title}}</a></li>'
    }
  }
}*/
</script>

<template>
  <nav class="navbar navbar-inverse navbar-fixed-top">
    <div class="container">
      <div class="navbar-header">
        <button type="button" class="navbar-toggle collapsed" data-toggle="collapse" data-target="#navbar"
          aria-expanded="false" aria-controls="navbar">
          <span class="sr-only">Toggle navigation</span>
          <span class="icon-bar"></span>
          <span class="icon-bar"></span>
          <span class="icon-bar"></span>
        </button>
        <a class="navbar-brand" href="#">Maplat Editor</a>
      </div>
      <div id="navbar" class="navbar-collapse collapse">
        <ul class="nav navbar-nav">
          <component :is="header_option" v-bind:current="current" target="/"
            v-bind:title="$t('navbar.edit_map')">
          </component>
          <component :is="header_option" v-bind:current="current" target="/edit"
            v-bind:title="$t('navbar.edit_app')">
          </component>
          <component :is="header_option" v-bind:current="current" target="/edit"
            v-bind:title="$t('navbar.settings')">
          </component>
        </ul>
      </div><!--/.nav-collapse -->
    </div>
  </nav>
  <router-view />
</template>

<style>

.container {
  width: auto;
}

/*
.navbar-static-top,
.navbar-fixed-top,
.navbar-fixed-bottom {
  border-radius: 0;
}

.navbar-inverse {
  background-image: -webkit-linear-gradient(top, #3c3c3c 0%, #222 100%);
  background-image: -o-linear-gradient(top, #3c3c3c 0%, #222 100%);
  background-image: -webkit-gradient(linear, left top, left bottom, from(#3c3c3c), to(#222));
  background-image: linear-gradient(to bottom, #3c3c3c 0%, #222 100%);
  filter: progid:DXImageTransform.Microsoft.gradient(startColorstr='#ff3c3c3c', endColorstr='#ff222222', GradientType=0);
  filter: progid:DXImageTransform.Microsoft.gradient(enabled=false);
  background-repeat: repeat-x;
  border-radius: 4px;
}

.navbar-inverse {
  background-color: #222;
  border-color: #080808;
}

.navbar-fixed-top {
  top: 0;
  border-width: 0 0 1px;
}

@media (min-width: 768px) {
  .navbar-fixed-top,
  .navbar-fixed-bottom {
    border-radius: 0;
  }
}

.navbar-fixed-top,
.navbar-fixed-bottom {
  position: fixed;
  right: 0;
  left: 0;
  z-index: 1030;
}

@media (min-width: 768px) {
  .navbar {
    border-radius: 4px;
  }
}

article,
aside,
details,
figcaption,
figure,
footer,
header,
hgroup,
main,
menu,
nav,
section,
summary {
  display: block;
}

.navbar {
  position: relative;
  min-height: 50px;
  margin-bottom: 20px;
  border: 1px solid transparent;
}

.container {
  width: auto;
}

.container {
  width: 970px;
  max-width: none !important;
}

@media (min-width: 992px) {
  .container {
    width: 970px;
  }
}

@media (min-width: 768px) {
  .container {
    width: 750px;
  }
}

.container {
  padding-right: 15px;
  padding-left: 15px;
  margin-right: auto;
  margin-left: auto;
}

.container>.navbar-header,
.container-fluid>.navbar-header,
.container>.navbar-collapse,
.container-fluid>.navbar-collapse {
  margin-right: -15px;
  margin-left: -15px;
}

@media (min-width: 768px) {
  .container>.navbar-header,
  .container-fluid>.navbar-header,
  .container>.navbar-collapse,
  .container-fluid>.navbar-collapse {
    margin-right: 0;
    margin-left: 0;
  }
}

.navbar-header {
  float: left;
}

@media (min-width: 768px) {
  .navbar-header {
    float: left;
  }
}

.navbar-inverse .navbar-toggle {
  border-color: #333;
}

.navbar-toggle {
  display: none;
}

@media (min-width: 768px) {
  .navbar-toggle {
    display: none;
  }
}

.navbar-toggle {
  position: relative;
  float: right;
  padding: 9px 10px;
  margin-top: 8px;
  margin-right: 15px;
  margin-bottom: 8px;
  background-color: transparent;
  background-image: none;
  border: 1px solid transparent;
  border-radius: 4px;
}

input,
button,
select,
textarea {
  font-family: inherit;
  font-size: inherit;
  line-height: inherit;
}

button,
html input[type="button"],
input[type="reset"],
input[type="submit"] {
  -webkit-appearance: button;
  cursor: pointer;
}

button,
select {
  text-transform: none;
}

button {
  overflow: visible;
}

button,
input,
optgroup,
select,
textarea {
  margin: 0;
  font: inherit;
  color: inherit;
}

button {
  appearance: auto;
  writing-mode: horizontal-tb !important;
  text-rendering: auto;
  color: buttontext;
  letter-spacing: normal;
  word-spacing: normal;
  line-height: normal;
  text-transform: none;
  text-indent: 0px;
  text-shadow: none;
  display: inline-block;
  text-align: center;
  align-items: flex-start;
  cursor: default;
  box-sizing: border-box;
  background-color: buttonface;
  margin: 0em;
  padding: 1px 6px;
  border-width: 2px;
  border-style: outset;
  border-color: buttonborder;
  border-image: initial;
}

/* 折りたたみ中のナビゲーションバーを元に戻す */
/*.navbar-collapse {
  display: block !important;
  height: auto !important;
  padding-bottom: 0;
  overflow: visible !important;
  visibility: visible !important;
}

.navbar-toggle {
  display: none;
}

.navbar-collapse {
  border-top: 0;
}

.navbar-brand {
  margin-left: -15px;
}

/* ナビゲーションバーを常に左寄せに適用 */
/*.navbar-nav {
  float: left;
  margin: 0;
}

.navbar-nav>li {
  float: left;
}

.navbar-nav>li>a {
  padding: 15px;
}

/* 上記でfloatを再定義したので右寄せ用に再設定 */
/*.navbar-nav.navbar-right {
  float: right;
}

/* カスタムのドロップダウンを元に戻す */
/*.navbar .navbar-nav .open .dropdown-menu {
  position: absolute;
  float: left;
  background-color: #fff;
  border: 1px solid #ccc;
  border: 1px solid rgba(0, 0, 0, .15);
  border-width: 0 1px 1px;
  border-radius: 0 0 4px 4px;
  -webkit-box-shadow: 0 6px 12px rgba(0, 0, 0, .175);
  box-shadow: 0 6px 12px rgba(0, 0, 0, .175);
}

.navbar-default .navbar-nav .open .dropdown-menu>li>a {
  color: #333;
}

.navbar .navbar-nav .open .dropdown-menu>li>a:hover,
.navbar .navbar-nav .open .dropdown-menu>li>a:focus,
.navbar .navbar-nav .open .dropdown-menu>.active>a,
.navbar .navbar-nav .open .dropdown-menu>.active>a:hover,
.navbar .navbar-nav .open .dropdown-menu>.active>a:focus {
  color: #fff !important;
  background-color: #428bca !important;
}

.navbar .navbar-nav .open .dropdown-menu>.disabled>a,
.navbar .navbar-nav .open .dropdown-menu>.disabled>a:hover,
.navbar .navbar-nav .open .dropdown-menu>.disabled>a:focus {
  color: #999 !important;
  background-color: transparent !important;
}

/* フォームの展開を元に戻す */
/*.navbar-form {
  float: left;
  width: auto;
  padding-top: 0;
  padding-bottom: 0;
  margin-right: 0;
  margin-left: 0;
  border: 0;
  -webkit-box-shadow: none;
  box-shadow: none;
}

/* .form-inlineスタイルをミックスインするので、forms.lessからコピーして貼り付け */
/*.navbar-form .form-group {
  display: inline-block;
  margin-bottom: 0;
  vertical-align: middle;
}

.navbar-form .form-control {
  display: inline-block;
  width: auto;
  vertical-align: middle;
}

.navbar-form .form-control-static {
  display: inline-block;
}

.navbar-form .input-group {
  display: inline-table;
  vertical-align: middle;
}

.navbar-form .input-group .input-group-addon,
.navbar-form .input-group .input-group-btn,
.navbar-form .input-group .form-control {
  width: auto;
}

.navbar-form .input-group>.form-control {
  width: 100%;
}

.navbar-form .control-label {
  margin-bottom: 0;
  vertical-align: middle;
}

.navbar-form .radio,
.navbar-form .checkbox {
  display: inline-block;
  margin-top: 0;
  margin-bottom: 0;
  vertical-align: middle;
}

.navbar-form .radio label,
.navbar-form .checkbox label {
  padding-left: 0;
}

.navbar-form .radio input[type="radio"],
.navbar-form .checkbox input[type="checkbox"] {
  position: relative;
  margin-left: 0;
}

.navbar-form .has-feedback .form-control-feedback {
  top: 0;
}*/
</style>
