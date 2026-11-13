<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useTranslation } from "i18next-vue";
import { useRouter } from "vue-router";
import DiagnosticFeedback from "./components/editor-ui/DiagnosticFeedback.vue";
import OperationNotice from "./components/editor-ui/OperationNotice.vue";
import Header from "./components/Header.vue";
import ProgressModal from "./components/ProgressModal.vue";
import { handleMenuTextUndoRedo } from "./utils/nativeTextUndo";
import { useOperationNotice } from "./composables/useOperationNotice";
import { useHashRouteSync } from "./composables/useHashRouteSync";

const { t } = useTranslation();
const { onOperationNoticeNavigation } = useOperationNotice();
// 操作の通知は画面遷移で消す（明示したものだけ 1 回越える。useOperationNotice）。query だけの変更は遷移に数えない
const removeNoticeNavigationHook = useRouter().afterEach((to, from) => {
  if (to.path !== from.path) onOperationNoticeNavigation();
});
// hash の書き換え（openHash）が初期遷移と競合して取りこぼされないよう、行き先を寄せ直す
useHashRouteSync(useRouter());

const modalVisible = ref(false);
const modalText = ref('');
const modalPercent = ref(0);
const modalProgressText = ref('');
const modalEnableClose = ref(false);
let removeTaskProgressListener: (() => void) | null = null;
let removeMigrationReportListener: (() => void) | null = null;
let removeMenuTextUndoListener: (() => void) | null = null;

// レガシー移行レポート (ADR-0007): 移行を実行した起動で一度だけ届き、
// slug改名(ID衝突のサフィックス解消)と警告件数を一覧表示する
interface MigrationRenamedSlug { kind: string; from: string; to: string }
const migrationReportVisible = ref(false);
const migrationRenamedSlugs = ref<MigrationRenamedSlug[]>([]);
const migrationWarningCount = ref(0);
let migrationReportShown = false;
// 見出しと警告件数の行はスクロールの外（上）に固定し、IDの変更の一覧だけをスクロールさせる。
// 行が増えると見出しと件数がスクロールで隠れてしまうため
const migrationHeaderItems = computed(() => [
  { key: 'migration-title', severity: 'info' as const, message: t('database.migration_report_title') },
  ...(migrationWarningCount.value ? [{ key: 'migration-warnings', severity: 'warning' as const, message: t('database.migration_report_warnings', { count: migrationWarningCount.value }) }] : []),
]);
const migrationItems = computed(() => [
  ...(migrationRenamedSlugs.value.length ? [{ key: 'migration-renamed', severity: 'info' as const, message: t('database.migration_report_renamed') }] : []),
  ...migrationRenamedSlugs.value.map((item, index) => ({ key: `migration-${index}`, severity: 'info' as const, message: `${item.kind}: ${item.from} → ${item.to}` })),
]);

onMounted(() => {
  // メニューの Cmd/Ctrl+Z アクセラレータがネイティブのテキスト undo を横取りするため、
  // 編集可能フィールドにフォーカスがある間はここでネイティブ undo/redo に振り分ける
  // (全画面共通。各ビューのセッション undo 側は編集フィールド内では発動しない)
  removeMenuTextUndoListener = window.appEvents.onMainProcessMessage((message) => {
    handleMenuTextUndoRedo(message);
  });
  removeTaskProgressListener = window.appEvents.onTaskProgress((progress) => {
    modalText.value = progress.text;
    modalPercent.value = progress.percent ?? 0;
    modalProgressText.value = progress.progress ?? '';
    modalEnableClose.value = modalPercent.value >= 100;
    modalVisible.value = true;
  });
  removeMigrationReportListener = window.appEvents.onMigrationReport((report) => {
    if (migrationReportShown) return;
    const renamed = Array.isArray(report?.renamedSlugs) ? report.renamedSlugs : [];
    const warnings = Array.isArray(report?.warnings) ? report.warnings : [];
    // 通知すべき内容がなければモーダルは出さない (report ファイルは常に残る)
    if (renamed.length === 0 && warnings.length === 0) return;
    migrationRenamedSlugs.value = renamed;
    migrationWarningCount.value = warnings.length;
    migrationReportShown = true;
    migrationReportVisible.value = true;
  });
});

onUnmounted(() => {
  removeNoticeNavigationHook();
  removeTaskProgressListener?.();
  removeMigrationReportListener?.();
  removeMenuTextUndoListener?.();
});
</script>

<template>
  <Header />
  <div class="main-content">
    <OperationNotice fallback />
    <DiagnosticFeedback
      v-if="migrationReportVisible"
      scope="operation"
      :header-items="migrationHeaderItems"
      :items="migrationItems"
      dismissible
      data-testid="migration-report"
      @dismiss="migrationReportVisible = false"
    />
    <router-view />
  </div>
  <ProgressModal
    :visible="modalVisible"
    :text="modalText"
    :percent="modalPercent"
    :progress-text="modalProgressText"
    :enable-close="modalEnableClose"
    @close="modalVisible = false"
  />
</template>

<style>
/* Global styles or minimal reset */
#app {
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 0;
  font-family: var(--editor-ui-font-base);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  color: #2c3e50;
}
.main-content {
  margin-top: 50px;
  margin-top: var(--editor-ui-header-height, 50px);
  height: calc(100vh - 50px);
  height: calc(100vh - var(--editor-ui-header-height, 50px));
  overflow-y: auto;
  padding: 0; /* Remove padding here so scrollbar is at the edge */
  width: 100%;
}
</style>

<style>
/* Global reset to prevent body scroll */
html, body {
  height: 100%;
  margin: 0;
  overflow: hidden;
}
</style>
