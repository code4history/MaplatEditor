<template>
  <div class="container-fluid p-4">
    <div class="mb-3">
      <button class="btn btn-outline-secondary" @click="goBack">
        &lt; Back to List
      </button>
    </div>
    <h2>Map Edit</h2>
    <div class="alert alert-info">
      Current Map ID: <strong>{{ mapID }}</strong>
    </div>
    <p>Placeholder for MapEdit View</p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';

const route = useRoute();
const router = useRouter();

const mapID = computed(() => route.query.mapid || 'Unknown');

const goBack = () => {
  router.push('/');
};
</script>
