<template>
  <div class="resource-selector h-100">
    <div class="source-pane border-end pe-3">
      <slot name="list" :search="searchText" :filtered-items="filteredItems">
        <div class="source-pane-toolbar">
          <input
            v-model="searchText"
            type="search"
            class="form-control form-control-sm"
            :placeholder="searchPlaceholder"
          />
        </div>
        <div class="source-list">
          <button
            v-for="item in filteredItems"
            :key="itemKey(item)"
            type="button"
            class="source-row"
            :class="{ 'source-row-selected': isSelected(item) }"
            @click="$emit('add', item)"
          >
            <slot name="row" :item="item">
              <span>{{ itemLabel(item) }}</span>
            </slot>
          </button>
        </div>
      </slot>
    </div>
    <div class="selected-pane ps-3">
      <slot name="selected" :items="selected" :move="emitMove" :remove="emitRemove">
        <h5>{{ selectedHeading }}</h5>
        <div v-if="selected.length === 0" class="text-muted py-3">{{ emptyText }}</div>
        <div v-else class="selected-list">
          <div
            v-for="(item, index) in selected"
            :key="selectedKey(item, index)"
            class="selected-source border rounded p-2 mb-2"
          >
            <div class="d-flex align-items-center justify-content-between gap-2">
              <div class="min-width-0">
                <slot name="selected-title" :item="item" :index="index">
                  <div class="fw-bold">{{ itemLabel(item) }}</div>
                </slot>
              </div>
              <div class="btn-group btn-group-sm">
                <button type="button" class="btn btn-outline-secondary" :disabled="index === 0" @click="emitMove(index, -1)">↑</button>
                <button type="button" class="btn btn-outline-secondary" :disabled="index === selected.length - 1" @click="emitMove(index, 1)">↓</button>
                <button type="button" class="btn btn-outline-secondary" @click="emitRemove(index)">×</button>
              </div>
            </div>
            <slot name="selected-detail" :item="item" :index="index" />
          </div>
        </div>
      </slot>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'

const props = withDefaults(defineProps<{
  available?: any[]
  selected?: any[]
  selectedHeading?: string
  searchPlaceholder?: string
  emptyText?: string
  itemKey?: (item: any) => string | number
  selectedKey?: (item: any, index: number) => string | number
  itemLabel?: (item: any) => string
  filter?: (item: any, search: string) => boolean
}>(), {
  available: () => [],
  selected: () => [],
  selectedHeading: '',
  searchPlaceholder: 'Search...',
  emptyText: 'No items selected',
  itemKey: (item: any) => item.uid ?? item.mapID ?? item.slug ?? item._id ?? Math.random(),
  selectedKey: (_item: any, index: number) => index,
  itemLabel: (item: any) => item.title ?? item.name ?? item.slug ?? item.mapID ?? '',
  filter: (item: any, search: string) => {
    if (!search.trim()) return true
    const q = search.trim().toLowerCase()
    return Object.values(item).some(v =>
      String(v ?? '').toLowerCase().includes(q)
    )
  },
})

const emit = defineEmits<{
  add: [item: any]
  move: [payload: { index: number; delta: number }]
  remove: [index: number]
}>()

const searchText = ref('')

const filteredItems = computed(() =>
  props.available.filter(item => props.filter(item, searchText.value))
)

function isSelected(item: any): boolean {
  const key = props.itemKey(item)
  return props.selected.some(s => props.itemKey(s) === key)
}

function emitMove(index: number, delta: number): void {
  emit('move', { index, delta })
}

function emitRemove(index: number): void {
  emit('remove', index)
}
</script>

<style scoped>
.resource-selector {
  display: grid;
  grid-template-columns: minmax(280px, 36%) 1fr;
  gap: 0;
  overflow: hidden;
}
.source-pane,
.selected-pane {
  min-height: 0;
  overflow: auto;
}
.source-pane {
  display: flex;
  flex-direction: column;
}
.source-pane-toolbar {
  position: sticky;
  top: 0;
  z-index: 2;
  background: #fff;
  padding-bottom: 8px;
}
.source-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.source-row {
  display: grid;
  grid-template-columns: 48px 1fr;
  align-items: center;
  gap: 8px;
  width: 100%;
  border: 1px solid var(--bs-border-color);
  background: #fff;
  border-radius: 4px;
  padding: 6px;
  text-align: left;
  cursor: pointer;
}
.source-row:hover {
  border-color: var(--bs-primary-border-subtle);
}
.source-row-selected {
  border-color: var(--bs-primary);
  background: var(--bs-primary-bg-subtle);
}
.min-width-0 {
  min-width: 0;
}
</style>