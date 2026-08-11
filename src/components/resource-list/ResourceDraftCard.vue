<template>
  <div class="resource-grid-card" :data-resource-uid="draft.assetUid">
    <router-link :to="to" class="text-decoration-none text-dark d-block">
      <div class="resource-grid-card__thumb">
        <img :src="fallbackImage" :alt="draft.label ?? draftLabel">
      </div>
      <p class="resource-item__title text-break mt-2 mb-0">{{ draft.label ?? draftLabel }}</p>
      <small v-if="draft.slug" class="resource-item__slug d-block text-break">{{ draft.slug }}</small>
      <span class="badge ms-0 me-1 bg-warning text-dark">{{ draftLabel }}</span>
    </router-link>
    <div class="resource-grid-card__actions">
      <ResourceActionMenu :actions="actions" @select="onSelect" />
    </div>
  </div>
</template>

<script setup lang="ts">
// 新規(未保存)下書き専用カード。ResourceGridCard と同一の視覚文法で、
// payload から抽出した label/slug を表示し、下書き削除アクションを提供する。
import ResourceActionMenu from "./ResourceActionMenu.vue";
import type { ResourceListAction } from "./resourceListTypes";
import type { AssetDraftSummary } from "../../types/assetDraft";

const props = defineProps<{
  draft: AssetDraftSummary;
  to: string;
  fallbackImage: string;
  draftLabel: string;
}>();
const emit = defineEmits<{ "delete-draft": [draft: AssetDraftSummary] }>();

const actions: ResourceListAction[] = [
  { key: "delete-draft", labelKey: "editor_ui.delete_draft", destructive: true, enabled: true },
];
function onSelect(key: string): void {
  if (key === "delete-draft") emit("delete-draft", props.draft);
}
</script>

<style scoped>
/* ResourceGridCard と同一のサイズ・配置（scoped のため複製） */
.resource-grid-card { position: relative; width: 200px; }
.resource-grid-card__thumb { width: 190px; height: 190px; margin: 0 auto; overflow: hidden; position: relative; display: grid; place-items: center; }
.resource-grid-card__thumb img { max-width: 100%; max-height: 100%; width: auto; height: auto; }
.resource-grid-card__actions { position: absolute; top: 4px; right: 4px; }
</style>
