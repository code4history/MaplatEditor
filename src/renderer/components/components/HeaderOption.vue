<script setup lang="ts">
import { useRoute } from 'vue-router'
const props = defineProps<{
  target: string;
  title: string;
}>();
const route = useRoute();
const isCurrentPath = (path: string) => {
  return route.path === path;
}
</script>

<template>
  <li v-if="isCurrentPath(target)" class="active"><router-link v-bind:to="target">{{ title }}</router-link></li>
  <li v-else><router-link v-bind:to="target">{{ title }}</router-link>
  </li>
</template>

<style>
.navbar-inverse .navbar-nav > li > a.router-link-active {
    color: #fff;
    background-color: #080808;
}
</style>
