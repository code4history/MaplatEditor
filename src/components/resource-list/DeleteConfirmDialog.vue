<template>
  <!-- M11-T10: 共通削除確認 dialog。Bootstrap Modal で実装、native confirm() を全廃 -->
  <div v-if="visible" class="modal show d-block" tabindex="-1" role="dialog" style="background: rgba(0,0,0,0.5);">
    <div class="modal-dialog">
      <div class="modal-content">
        <div class="modal-header border-0 pb-0">
          <h6 class="modal-title">{{ title }}</h6>
        </div>
        <div class="modal-body">
          <p class="mb-0">{{ t("resource_list.delete_irreversible") }}</p>
          <div v-if="references && references.length" class="mt-2 small">
            <p class="mb-1 fw-bold">{{ t("resource_list.delete_referenced_by") }}</p>
            <ul class="mb-0 ps-3">
              <li v-for="ref in references" :key="`${ref.kind}-${ref.slug}`">
                {{ ref.kind }}: {{ ref.title || ref.slug }}
              </li>
            </ul>
          </div>
          <div v-if="referencesUnavailable" class="mt-2 small text-warning">
            {{ t("resource_list.delete_references_unavailable") }}
          </div>
        </div>
        <div class="modal-footer border-0 pt-0">
          <button type="button" class="btn btn-sm btn-outline-secondary" :disabled="deleting" @click="cancel">
            {{ t("common.cancel") }}
          </button>
          <button
            type="button"
            class="btn btn-sm btn-danger"
            :disabled="deleting"
            data-testid="delete-confirm-button"
            @click="confirm"
          >
            {{ deleting ? t("resource_list.deleting") : t("resource_list.menu_delete") }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useTranslation } from "i18next-vue";

export interface DeleteReference {
  kind: string;
  slug: string;
  title?: string;
}

const { t } = useTranslation();

defineProps<{
  visible: boolean;
  title: string;
  references?: DeleteReference[];
  referencesUnavailable?: boolean;
  deleting: boolean;
}>();

const emit = defineEmits<{
  confirm: [];
  cancel: [];
}>();

function confirm(): void { emit("confirm"); }
function cancel(): void { emit("cancel"); }
</script>