<template>
  <div
    role="button"
    tabindex="0"
    class="resource-master-row"
    :class="rowClass"
    :data-resource-uid="item.uid"
    :aria-current="item.selected ? 'true' : undefined"
    :aria-disabled="isDisabled ? 'true' : undefined"
    :title="isDisabled && item.disabledReason ? item.disabledReason : undefined"
    @click="onActivate"
    @keydown.enter.prevent="onActivate"
    @keydown.space.prevent="onActivate"
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
      <small v-if="isDisabled && item.disabledReason" class="resource-master-row__reason d-block text-danger">{{ item.disabledReason }}</small>
    </span>
    <span v-if="item.hasDraft && draftLabel" class="badge bg-warning text-dark" data-resource-draft-badge :data-testid="draftBadgeTestId">{{ draftLabel }}</span>
    <span v-for="badge in item.badges" :key="badge.key" class="badge" :class="badgeClass(badge.tone)">{{ badge.label }}</span>
    <slot name="extra"></slot>
    <ResourceActionMenu v-if="showActionMenu" ref="menuRef" :actions="actions" @select="(key) => emit('action', key, item)" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import ResourceActionMenu from "./ResourceActionMenu.vue";
import { buildResourceListActions } from "./buildResourceListActions";
import type { ResourceListItemViewModel, ResourceListKind } from "./resourceListTypes";

const props = withDefaults(defineProps<{
  item: ResourceListItemViewModel;
  kind: ResourceListKind;
  // selector variant では使用しないため optional。master variant では必須
  draftLabel?: string;
  draftBadgeTestId?: string;
  // variant: 'master' (default) = master-detail 用。action menu 表示、.selected で選択中表示
  //          'selector' = Master-Selection 用。action menu 非表示、disabled で追加不可表示
  variant?: "master" | "selector";
  // selector variant 専用: 行がクリック不可（previewDisabled 等）の場合 true
  disabled?: boolean;
}>(), { variant: "master", disabled: false, draftLabel: "", draftBadgeTestId: undefined });
const emit = defineEmits<{ select: [uid: string]; action: [key: string, item: ResourceListItemViewModel] }>();

const menuRef = ref<InstanceType<typeof ResourceActionMenu> | null>(null);
const thumbBroken = ref(false); // 壊れた thumbnail(file:// 欠損等)は placeholder へフォールバック
const isDisabled = computed(() => props.variant === "selector" && props.disabled);
const showActionMenu = computed(() => props.variant === "master");
const actions = computed(() => buildResourceListActions(props.kind, props.item));
// M12-T10 v2.0: .active → .selected rename（Bootstrap 競合回避）。
// selector variant では added（selected=true）を青で表示（HM6）。disabled は追加不可。
// 優先順位: selected（added）が最優先（追加済みかつ previewDisabled の場合、追加済みが意味を持つ）
const rowClass = computed(() => {
  const classes: Record<string, boolean> = {};
  if (props.item.selected) classes["selected"] = true;
  if (isDisabled.value && !props.item.selected) classes["disabled"] = true;
  return classes;
});
function badgeClass(tone: "info" | "warning" | "neutral"): string {
  return tone === "warning" ? "bg-warning text-dark" : tone === "info" ? "bg-info text-dark" : "bg-secondary";
}
function onActivate(): void {
  if (isDisabled.value || props.item.selected) return;
  emit("select", props.item.uid);
}
function onContextMenu(event: MouseEvent): void {
  if (isDisabled.value) return;
  menuRef.value?.openAt(event.clientX, event.clientY);
}
</script>

<style scoped>
/* M12-T10 v2.0: 行の見た目は resource-list.scss（global 正本）へ集約。scoped CSS は全廃（C1 対応） */
.min-w-0 { min-width: 0; }
</style>
