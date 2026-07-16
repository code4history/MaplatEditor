<template>
  <!-- M11-T10: Resource List の #secondary slot 用 Import button。
       MapList / PoiSourceList の toolbar に配置する共通部品 -->
  <button
    v-if="kind"
    type="button"
    class="btn btn-outline-secondary btn-sm"
    data-resource-import
    @click="emit('import')"
  >
    {{ t(labelKey) }}
  </button>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useTranslation } from "i18next-vue";
import type { ResourceListKind } from "./resourceListTypes";

const props = withDefaults(
  defineProps<{
    kind?: ResourceListKind;
  }>(),
  { kind: undefined },
);

const emit = defineEmits<{
  import: [];
}>();

const { t } = useTranslation();

const labelKey = computed(() => {
  if (props.kind === "poi-source") return "resource_list.import_poi";
  if (props.kind === "map") return "resource_list.import_map";
  return "";
});
</script>