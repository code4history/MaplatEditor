<template>
  <!-- M12-T10 v2.0: empty state 共有コンポーネント（正本: AssetList.vue:44-45 / BaseMapList.vue:50-54 の文法）。
       上下左右中央揃えアイコン + メッセージ。master-detail の Detail 空状態・selector の右ペイン空状態で共用。 -->
  <div class="resource-empty-state h-100 d-grid place-items-center text-muted p-4 text-center">
    <div>
      <i :class="iconClass" class="fs-1 d-block mb-2" aria-hidden="true"></i>
      <slot>{{ message }}</slot>
      <!-- M12-T11 (R3/C47-C48): not found 画面の戻るボタン等を配置する optional actions slot -->
      <div v-if="$slots.actions" class="mt-3">
        <slot name="actions"></slot>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// iconClass: Bootstrap Icons クラス（例: "bi bi-images", "bi bi-map", "bi bi-geo-alt", "bi bi-layers"）
// message: デフォルトメッセージ。slot で上書き可能
withDefaults(defineProps<{
  iconClass: string;
  message?: string;
}>(), { message: "" });
</script>

<style scoped>
.d-grid.place-items-center {
  place-items: center;
}
</style>
