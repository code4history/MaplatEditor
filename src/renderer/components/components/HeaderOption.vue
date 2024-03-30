<script setup lang="ts">
import { ref, defineProps } from 'vue';
const props = defineProps<{
  current: string;
  target: string;
  title: string;
}>();
</script>

<template>
  <li v-if="current == target" class="active"><a href="#">{{ title }}</a></li>
  <li v-else><a v-bind:href="target">{{ title }}</a></li>
</template>

<style>
</style>
