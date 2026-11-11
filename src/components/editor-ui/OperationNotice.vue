<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';
import DiagnosticFeedback from './DiagnosticFeedback.vue';
import { useOperationNotice } from '../../composables/useOperationNotice';

const props = defineProps<{ fallback?: boolean }>();
const { operationNotices, operationNoticeHosts, clearOperationNotice } = useOperationNotice();
onMounted(() => { if (!props.fallback) operationNoticeHosts.value++; });
onUnmounted(() => { if (!props.fallback) operationNoticeHosts.value--; });
</script>

<template>
  <DiagnosticFeedback
    v-if="!fallback || operationNoticeHosts === 0"
    scope="operation"
    :items="operationNotices"
    dismissible
    data-testid="operation-notice"
    @dismiss="clearOperationNotice"
  />
</template>
