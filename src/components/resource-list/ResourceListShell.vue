<template>
  <section class="resource-list" :class="variantClass" :data-resource-list="kind">
    <ResourceListToolbar
      :query="query"
      :kind-name-key="kindNameKey"
      :new-draft="newDraft"
      :search-placeholder-key="searchPlaceholderKey"
      @create="emit('create')"
      @update:query="(value) => emit('update:query', value)"
      @commit:query="(value) => emit('commit:query', value)"
      @composition-start="emit('composition-start')"
      @composition-end="emit('composition-end')"
    >
      <template #secondary><slot name="secondary"></slot></template>
      <template #range><slot name="range"></slot></template>
    </ResourceListToolbar>

    <!-- nov26-editor-feat1 §4.7: チップ行は検索入力の直下（入力と同じ行に並べると狭い幅で入力欄が潰れる） -->
    <RecentSearchChips
      :entries="recentSearches ?? []"
      :active-query="recentActiveQuery"
      :error="recentError"
      @apply="(q) => emit('apply-recent', q)"
      @remove="(q) => emit('remove-recent', q)"
    />

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
import RecentSearchChips from "./RecentSearchChips.vue";
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
  // nov26-editor-feat1: 直近の検索条件（新しい順）。空のときはチップ行を出さない
  recentSearches?: ReadonlyArray<{ q: string }>;
  // 現在の検索語（一致するチップを active にする）
  recentActiveQuery?: string;
  recentError?: string | null;
}>();
const emit = defineEmits<{
  create: [];
  "update:query": [value: string];
  // レビュー指示 1/2: 検索入力の確定と変換区間を親（view）へ中継する
  "commit:query": [value: string];
  "composition-start": [];
  "composition-end": [];
  retry: [];
  "load-more": [];
  // nov26-editor-feat1: チップの適用・削除
  "apply-recent": [q: string];
  "remove-recent": [q: string];
}>();

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
