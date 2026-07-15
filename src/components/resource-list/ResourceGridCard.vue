<template>
  <div class="resource-grid-card" :data-resource-uid="item.uid">
    <router-link :to="to" class="text-decoration-none text-dark d-block" @contextmenu.prevent="onContextMenu">
      <div class="resource-grid-card__thumb">
        <img v-if="item.thumbnailUrl" :src="item.thumbnailUrl" loading="lazy" decoding="async" :alt="item.title">
        <img v-else :src="fallbackImage" :alt="item.title">
      </div>
      <p class="resource-item__title text-break mt-2 mb-0">{{ item.title }}</p>
      <small v-if="item.slug" class="resource-item__slug d-block text-break">{{ item.slug }}</small>
      <small v-for="meta in item.metadata" :key="meta" class="resource-item__meta d-block text-break">{{ meta }}</small>
      <slot name="meta"></slot>
      <span
        v-for="badge in visibleBadges" :key="badge.key"
        class="badge ms-0 me-1" :class="badgeClass(badge.tone)"
      >{{ badge.label }}</span>
    </router-link>
    <div class="resource-grid-card__actions">
      <ResourceActionMenu ref="menuRef" :actions="actions" @select="(key) => emit('action', key, item)" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import ResourceActionMenu from "./ResourceActionMenu.vue";
import { buildResourceListActions } from "./buildResourceListActions";
import type { ResourceListItemViewModel, ResourceListKind } from "./resourceListTypes";

const props = defineProps<{
  item: ResourceListItemViewModel;
  kind: ResourceListKind;
  to: string;
  fallbackImage: string;
  draftLabel: string;
}>();
const emit = defineEmits<{ action: [key: string, item: ResourceListItemViewModel] }>();

const menuRef = ref<InstanceType<typeof ResourceActionMenu> | null>(null);
const actions = computed(() => buildResourceListActions(props.kind, props.item));
const visibleBadges = computed(() => [
  ...(props.item.hasDraft ? [{ key: "__draft", label: props.draftLabel, tone: "warning" as const }] : []),
  ...props.item.badges,
]);
function badgeClass(tone: "info" | "warning" | "neutral"): string {
  return tone === "warning" ? "bg-warning text-dark" : tone === "info" ? "bg-info text-dark" : "bg-secondary";
}
function onContextMenu(event: MouseEvent): void {
  menuRef.value?.openAt(event.clientX, event.clientY);
}
</script>

<style scoped>
.resource-grid-card { position: relative; width: 200px; }
.resource-grid-card__thumb { width: 190px; height: 190px; margin: 0 auto; overflow: hidden; position: relative; display: grid; place-items: center; }
.resource-grid-card__thumb img { max-width: 100%; max-height: 100%; width: auto; height: auto; }
.resource-grid-card__actions { position: absolute; top: 4px; right: 4px; }
</style>
