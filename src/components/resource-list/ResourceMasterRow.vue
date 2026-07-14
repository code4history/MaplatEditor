<template>
  <div
    role="button"
    tabindex="0"
    class="resource-master-row list-group-item list-group-item-action border-0 border-bottom rounded-0 px-3 py-2"
    :class="{ active: item.selected }"
    :data-resource-uid="item.uid"
    :aria-current="item.selected ? 'true' : undefined"
    @click="emit('select', item.uid)"
    @keydown.enter.prevent="emit('select', item.uid)"
    @keydown.space.prevent="emit('select', item.uid)"
    @contextmenu.prevent="onContextMenu"
  >
    <span class="resource-master-row__thumb">
      <img v-if="item.thumbnailUrl && !thumbBroken" :src="item.thumbnailUrl" loading="lazy" :alt="item.title" @error="thumbBroken = true">
      <span v-else class="resource-master-row__placeholder"><i class="bi bi-image" aria-hidden="true"></i></span>
    </span>
    <span class="min-w-0 flex-grow-1">
      <span class="resource-item__title d-block text-truncate">{{ item.title }}</span>
      <small v-if="item.slug" class="resource-item__slug d-block text-truncate">{{ item.slug }}</small>
      <small v-for="meta in item.metadata" :key="meta" class="resource-item__meta d-block text-truncate">{{ meta }}</small>
    </span>
    <span v-if="item.hasDraft" class="badge bg-warning text-dark" data-resource-draft-badge :data-testid="draftBadgeTestId">{{ draftLabel }}</span>
    <span v-for="badge in item.badges" :key="badge.key" class="badge" :class="badgeClass(badge.tone)">{{ badge.label }}</span>
    <slot name="extra"></slot>
    <ResourceActionMenu ref="menuRef" :actions="actions" @select="(key) => emit('action', key, item)" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import ResourceActionMenu from "./ResourceActionMenu.vue";
import { buildResourceListActions } from "./buildResourceListActions";
import type { ResourceListItemViewModel, ResourceListKind } from "./resourceListTypes";

const props = defineProps<{ item: ResourceListItemViewModel; kind: ResourceListKind; draftLabel: string; draftBadgeTestId?: string }>();
const emit = defineEmits<{ select: [uid: string]; action: [key: string, item: ResourceListItemViewModel] }>();

const menuRef = ref<InstanceType<typeof ResourceActionMenu> | null>(null);
const thumbBroken = ref(false); // 壊れた thumbnail(file:// 欠損等)は placeholder へフォールバック
const actions = computed(() => buildResourceListActions(props.kind, props.item));
function badgeClass(tone: "info" | "warning" | "neutral"): string {
  return tone === "warning" ? "bg-warning text-dark" : tone === "info" ? "bg-info text-dark" : "bg-secondary";
}
function onContextMenu(event: MouseEvent): void {
  menuRef.value?.openAt(event.clientX, event.clientY);
}
</script>

<style scoped>
.resource-master-row { display: flex; align-items: center; gap: .65rem; }
.resource-master-row__thumb { width: 40px; height: 40px; flex: 0 0 40px; display: grid; place-items: center; overflow: hidden; background: #f8f9fa; border: 1px solid var(--bs-border-color); }
.resource-master-row__thumb img { max-width: 100%; max-height: 100%; object-fit: contain; }
.resource-master-row__placeholder { color: var(--bs-secondary-color); }
.min-w-0 { min-width: 0; }
</style>
