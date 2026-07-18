<template>
  <div class="resource-selector h-100">
    <div class="source-pane border-end pe-3">
      <slot name="list" />
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
withDefaults(defineProps<{
  selected?: any[]
  selectedHeading?: string
  emptyText?: string
  selectedKey?: (item: any, index: number) => string | number
  itemLabel?: (item: any) => string
}>(), {
  selected: () => [],
  selectedHeading: '',
  emptyText: 'No items selected',
  selectedKey: (_item: any, index: number) => index,
  itemLabel: (item: any) => item.title ?? item.name ?? item.slug ?? item.mapID ?? '',
})

const emit = defineEmits<{
  move: [payload: { index: number; delta: number }]
  remove: [index: number]
}>()

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
.min-width-0 {
  min-width: 0;
}
</style>
