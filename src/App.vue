<script setup lang="ts">
import Header from "./components/Header.vue";
</script>

<template>
  <Header />
  <div class="main-content">
    <router-view />
  </div>
</template>

<style>
/* Global styles or minimal reset */
#app {
  font-family: Avenir, Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  color: #2c3e50;
}
.main-content {
  margin-top: 56px; /* Navbar height */
  height: calc(100vh - 56px);
  overflow-y: auto;
  padding: 0; /* Remove padding here so scrollbar is at the edge */
  width: 100%;
}
</style>

<style>
/* Global reset to prevent body scroll */
html, body {
  height: 100%;
  margin: 0;
  overflow: hidden;
}
</style>
