<template>
  <div class="resource-list__toolbar" data-resource-toolbar>
    <button
      type="button"
      class="btn btn-outline-primary btn-sm resource-list__new"
      data-resource-new
      @click="emit('create')"
    >
      <i class="bi bi-plus-lg me-1" aria-hidden="true"></i>{{ t("resource_list.new_item") }}
      <span v-if="newDraft" class="badge bg-warning text-dark ms-1">{{ t("editor_ui.draft_badge") }}</span>
    </button>

    <slot name="secondary"></slot>

    <input
      :value="query"
      type="search"
      class="form-control form-control-sm resource-list__search"
      data-resource-search
      :aria-label="searchPlaceholder"
      :placeholder="searchPlaceholder"
      @input="emit('update:query', ($event.target as HTMLInputElement).value)"
    >

    <slot name="range"></slot>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useTranslation } from "i18next-vue";

const props = defineProps<{
  query: string;
  kindNameKey: string; // 例: "resource_list.kind_map"
  newDraft?: boolean;
  // optional: kindNameKey 構築（「{{name}}を検索…」）を上書きする完全な placeholder キー
  searchPlaceholderKey?: string;
}>();
const emit = defineEmits<{ create: []; "update:query": [value: string] }>();

const { t } = useTranslation();
const searchPlaceholder = computed(() =>
  props.searchPlaceholderKey
    ? t(props.searchPlaceholderKey)
    : t("resource_list.search_placeholder", { name: t(props.kindNameKey) }),
);
</script>
