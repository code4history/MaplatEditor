<template>
  <header class="editor-action-header bg-white border-bottom px-3 py-2">
    <div class="editor-action-header__identity">
      <button
        type="button"
        class="btn btn-sm btn-link text-decoration-none px-0"
        data-editor-action="back"
        data-testid="editor-back"
        @click="emit('back')"
      >
        <i class="bi bi-chevron-left" aria-hidden="true"></i>
        {{ t("editor_ui.back") }}
      </button>
      <strong class="text-truncate">{{ title }}</strong>
      <span
        class="small text-nowrap"
        :class="saveStateMeta.className"
        role="status"
      >
        {{ t(saveStateMeta.key) }}
      </span>
      <button
        v-if="discardDraftVisible"
        type="button"
        class="btn btn-sm btn-link text-danger text-decoration-none p-0"
        data-editor-action="discard-draft"
        :disabled="saving || actionsDisabled"
        @click="emit('discard-draft')"
      >
        {{ t("editor_ui.discard_draft") }}
      </button>
    </div>

    <div class="editor-action-header__actions">
      <select
        :value="activeLang"
        class="form-select form-select-sm editor-action-header__language"
        data-editor-action="language"
        :aria-label="t('common.language')"
        :disabled="saving || actionsDisabled"
        @change="emit('update:activeLang', ($event.target as HTMLSelectElement).value as LangCode)"
      >
        <option v-for="language in languageOptions" :key="language.code" :value="language.code">
          {{ language.nativeName }}
        </option>
      </select>
      <button
        type="button"
        class="btn btn-sm btn-outline-secondary"
        data-editor-action="undo"
        :disabled="saving || actionsDisabled || !canUndo"
        :title="t('menu.undo')"
        @click="emit('undo')"
      >
        <i class="bi bi-arrow-counterclockwise" aria-hidden="true"></i>
        <span class="visually-hidden">{{ t("menu.undo") }}</span>
      </button>
      <button
        type="button"
        class="btn btn-sm btn-outline-secondary"
        data-editor-action="redo"
        :disabled="saving || actionsDisabled || !canRedo"
        :title="t('menu.redo')"
        @click="emit('redo')"
      >
        <i class="bi bi-arrow-clockwise" aria-hidden="true"></i>
        <span class="visually-hidden">{{ t("menu.redo") }}</span>
      </button>
      <slot name="actions" :disabled="saving || actionsDisabled"></slot>
      <button
        v-if="saveVisible"
        type="button"
        class="btn btn-sm btn-primary"
        data-editor-action="save"
        data-testid="editor-save"
        :disabled="saving || actionsDisabled || saveDisabled"
        @click="emit('save')"
      >
        <span v-if="saving" class="spinner-border spinner-border-sm me-1" aria-hidden="true"></span>
        {{ t("common.save") }}
      </button>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useTranslation } from "i18next-vue";
import type { LangCode } from "../../utils/editorLanguages";
import {
  EDITOR_SAVE_STATE_META,
  type EditorSaveState,
} from "./editorUiTypes";

interface LanguageOption {
  code: LangCode;
  nativeName: string;
}

const props = withDefaults(defineProps<{
  title: string;
  saveState: EditorSaveState;
  activeLang: LangCode;
  languageOptions: readonly LanguageOption[];
  canUndo: boolean;
  canRedo: boolean;
  saveDisabled?: boolean;
  saving?: boolean;
  actionsDisabled?: boolean;
  saveVisible?: boolean;
  discardDraftVisible?: boolean;
}>(), {
  saveDisabled: false,
  saving: false,
  actionsDisabled: false,
  saveVisible: true,
  discardDraftVisible: false,
});

const emit = defineEmits<{
  "back": [];
  "update:activeLang": [value: LangCode];
  "undo": [];
  "redo": [];
  "save": [];
  "discard-draft": [];
}>();

const { t } = useTranslation();
const saveStateMeta = computed(() => EDITOR_SAVE_STATE_META[props.saveState]);
</script>

<style scoped>
.editor-action-header {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  min-width: 0;
}

.editor-action-header__identity,
.editor-action-header__actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
}

.editor-action-header__language {
  width: auto;
  min-width: 7.5rem;
}
</style>
