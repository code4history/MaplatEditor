<script setup lang="ts">
const props = defineProps<{
  current: string;
  target: string;
  title: string;
}>();
</script>

<template>
  <li v-if="current == target" class="active"><router-link v-bind:to="target">{{ title }}</router-link></li>
  <li v-else><router-link v-bind:to="target">{{ title }}</router-link>
  </li>
</template>

<style>
</style>
