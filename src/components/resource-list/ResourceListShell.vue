<template>
  <section class="resource-list" :class="variantClass" :data-resource-list="kind">
    <ResourceListToolbar
      :query="query"
      :kind-name-key="kindNameKey"
      :new-draft="newDraft"
      :search-placeholder-key="searchPlaceholderKey"
      @create="emit('create')"
      @update:query="(value) => emit('update:query', value)"
    >
      <template #secondary><slot name="secondary"></slot></template>
      <template #range><slot name="range"></slot></template>
    </ResourceListToolbar>

    <ResourceResultStatus :state="state" :total="total" :loaded="loaded" @retry="emit('retry')" />

    <div ref="contentRef" class="resource-list__content resource-list__rows" :data-resource-content="kind">
      <slot></slot>
      <div ref="sentinelRef" class="resource-list__sentinel" data-resource-sentinel></div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import ResourceListToolbar from "./ResourceListToolbar.vue";
import ResourceResultStatus from "./ResourceResultStatus.vue";
import type { ResourceListKind, ResourceListState } from "./resourceListTypes";

const props = defineProps<{
  kind: ResourceListKind;
  kindNameKey: string;
  query: string;
  state: ResourceListState;
  total: number | null;
  loaded: number;
  newDraft?: boolean;
  variant?: "grid" | "master";
  // optional: kindNameKey 構築の検索 placeholder を上書きする完全なキー（toolbar へ中継）
  searchPlaceholderKey?: string;
}>();
const emit = defineEmits<{ create: []; "update:query": [value: string]; retry: []; "load-more": [] }>();

const contentRef = ref<HTMLElement | null>(null);
const sentinelRef = ref<HTMLElement | null>(null);
const variantClass = computed(() => (props.variant === "master" ? "resource-list--master" : "resource-list--grid"));
let observer: IntersectionObserver | null = null;

onMounted(() => {
  if (!sentinelRef.value || !contentRef.value) return;
  observer = new IntersectionObserver(
    (entries) => { if (entries.some((entry) => entry.isIntersecting)) emit("load-more"); },
    { root: contentRef.value, rootMargin: "200px" },
  );
  observer.observe(sentinelRef.value);
});
onBeforeUnmount(() => { observer?.disconnect(); observer = null; });

defineExpose({ contentRef });
</script>
