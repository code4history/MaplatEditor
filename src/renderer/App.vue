<script setup lang="ts">
import { useRoute } from 'vue-router'
import { ref } from 'vue';
import header_option from './components/components/HeaderOption.vue'
let current = ref('/')
const route = useRoute()
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
          <component :is="header_option" v-bind:current="current" target="/edit#1?edit=1"
            v-bind:title="$t('navbar.edit_app')">
          </component>
          <component :is="header_option" v-bind:current="current" target="/edit#2"
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
</style>
