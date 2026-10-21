<!--
  直近の検索条件のチップ（表示専用の primitive）。

  設計: .nayuta/2026-10-21-nov26-editor-feat1-design.md §4.7
  設計レビュー NOV26-DR-EDITOR-FEATURES-0456 指示 4・5:
    - 現在の q と一致するチップに active を付ける
    - 表示専用に保つ（ブラウザのグローバルは呼ばない。保存の窓口は useRecentSearches が担う）
-->
<template>
  <div
    v-if="entries.length || error"
    class="recent-search-chips mt-2"
    data-testid="recent-search-chips"
    role="group"
    :aria-label="t('resource_list.recent_searches_label')"
  >
    <span class="recent-search-chips__list">
      <span
        v-for="entry in entries"
        :key="entry.q"
        class="recent-search-chips__item badge rounded-pill text-bg-light border"
      >
        <button
          type="button"
          class="recent-search-chips__apply"
          :class="{ active: isActive(entry.q) }"
          :data-recent-search="entry.q"
          :title="entry.q"
          :aria-label="t('resource_list.recent_search_apply', { q: entry.q })"
          @click="emit('apply', entry.q)"
        >{{ entry.q }}</button>
        <button
          type="button"
          class="recent-search-chips__remove"
          :data-recent-search-remove="entry.q"
          :aria-label="t('resource_list.recent_search_remove', { q: entry.q })"
          @click="emit('remove', entry.q)"
        ><i class="bi bi-x-lg" aria-hidden="true"></i></button>
      </span>
    </span>
    <span v-if="error" class="recent-search-chips__error text-danger d-block mt-1">{{ error }}</span>
  </div>
</template>

<script setup lang="ts">
import { useTranslation } from "i18next-vue";
import { sameSearchKey } from "../../utils/recentSearches";

const props = defineProps<{
  entries: ReadonlyArray<{ q: string }>;
  /** 現在の検索語。一致するチップを active にする */
  activeQuery?: string;
  /** 保存に失敗したときの文言（呼び出し側が文言を決める） */
  error?: string | null;
}>();
const emit = defineEmits<{
  apply: [q: string];
  remove: [q: string];
}>();

const { t } = useTranslation();

function isActive(q: string): boolean {
  const current = (props.activeQuery ?? "").trim();
  if (!current) return false;
  return sameSearchKey(current, q);
}
</script>

<style scoped>
.recent-search-chips {
  min-width: 0;
}
.recent-search-chips__list {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  max-width: 100%;
}
.recent-search-chips__item {
  display: inline-flex;
  align-items: center;
  gap: 0.15rem;
  padding: 0 0.15rem 0 0.5rem;
  font-weight: normal;
  max-width: 100%;
}
.recent-search-chips__apply,
.recent-search-chips__remove {
  border: 0;
  background: transparent;
  padding: 0;
  line-height: 1.2;
  color: inherit;
}
.recent-search-chips__apply {
  max-width: 12rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.recent-search-chips__apply.active {
  font-weight: bold;
  text-decoration: underline;
}
.recent-search-chips__remove {
  font-size: 0.7em;
  opacity: 0.6;
}
.recent-search-chips__remove:hover,
.recent-search-chips__apply:hover {
  opacity: 1;
  text-decoration: underline;
}
</style>
