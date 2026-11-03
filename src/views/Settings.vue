<template>
  <div class="h-100 d-flex flex-column">
    <div class="container-fluid main flex-grow-1 mt-4 px-4">
      <!-- Tabs -->
      <ul class="nav nav-tabs nav-justified mb-3" role="tablist">
        <li class="nav-item">
          <a
            class="nav-link"
            :class="{ active: activeTab === 'basic' }"
            href="#"
            @click.prevent="activeTab = 'basic'"
            >{{ t("settings.basic_settings") }}</a
          >
        </li>
        <li class="nav-item">
          <a
            class="nav-link"
            :class="{ active: activeTab === 'basemap' }"
            href="#"
            data-testid="settings-basemap-tab"
            @click.prevent="activeTab = 'basemap'"
            >{{ t("settings.base_map") }}</a
          >
        </li>
        <li v-if="mcp.status?.featureEnabled" class="nav-item">
          <a
            class="nav-link"
            :class="{ active: activeTab === 'mcp' }"
            href="#"
            data-testid="settings-mcp-tab"
            @click.prevent="activeTab = 'mcp'"
            >{{ t("settings.mcp_tab") }}</a
          >
        </li>
      </ul>

      <div class="tab-content">
        <!-- Basic Settings Tab -->
        <div
          class="tab-pane fade"
          :class="{ 'show active': activeTab === 'basic' }"
          id="basic"
          role="tabpanel"
        >
          <form class="form-horizontal">
            <!-- Language Switcher -->
            <div class="row mb-3 align-items-center">
              <label for="langSwitcher" class="col-sm-3 col-form-label text-end">{{
                t("settings.switch_lang")
              }}</label>
              <div class="col-sm-9">
                <!-- UI言語の選択肢は自言語表記(autonym): 現在のUI言語が読めなくても自分の言語を探せる -->
                <select
                  class="form-select"
                  id="langSwitcher"
                  v-model="state.lang"
                >
                  <option v-for="entry in SUPPORTED_LANGUAGES" :key="entry.code" :value="entry.code">
                    {{ entry.nativeName }}
                  </option>
                </select>
              </div>
            </div>

            <!-- Data Folder -->
            <div class="row mb-3 align-items-center">
              <label for="saveFolder" class="col-sm-3 col-form-label text-end">{{
                t("settings.data_folder")
              }}</label>
              <div class="col-sm-9">
                <div class="input-group">
                  <input
                    type="text"
                    class="form-control"
                    id="saveFolder"
                    :placeholder="t('settings.specify_data_folder')"
                    v-model="state.saveFolder"
                    @click="showFolderDialog"
                    readonly
                  />
                </div>
              </div>
            </div>

            <!-- M5-T6: JPEG デコード上限（大きな地図画像が取り込めないときに引き上げる） -->
            <div class="row mb-3 align-items-center">
              <label for="jpegDecodeMaxMemoryMB" class="col-sm-3 col-form-label text-end">{{
                t("settings.jpeg_decode_max_memory")
              }}</label>
              <div class="col-sm-9">
                <input
                  type="number"
                  class="form-control"
                  id="jpegDecodeMaxMemoryMB"
                  min="512"
                  step="1"
                  :placeholder="t('settings.jpeg_decode_auto')"
                  v-model="state.jpegDecodeMaxMemoryMB"
                />
              </div>
            </div>

            <div class="row mb-3 align-items-center">
              <label
                for="jpegDecodeMaxResolutionMP"
                class="col-sm-3 col-form-label text-end d-flex align-items-center justify-content-end gap-1"
              >
                {{ t("settings.jpeg_decode_max_resolution") }}
                <ContextHelp
                  :text="t('settings.jpeg_decode_desc')"
                  :ariaLabel="t('settings.jpeg_decode_desc')"
                  data-testid="settings-jpeg-decode-help"
                />
              </label>
              <div class="col-sm-9">
                <input
                  type="number"
                  class="form-control"
                  id="jpegDecodeMaxResolutionMP"
                  min="100"
                  step="1"
                  :placeholder="t('settings.jpeg_decode_auto')"
                  v-model="state.jpegDecodeMaxResolutionMP"
                />
              </div>
            </div>

            <!-- nov26-m7-t6 (#141): 起動時の更新の確認。既定はオン。オフでもメニューの「更新を確認…」は使える -->
            <div class="row mb-3 align-items-center">
              <label
                for="updateCheckEnabled"
                class="col-sm-3 col-form-label text-end d-flex align-items-center justify-content-end gap-1"
              >
                {{ t("settings.update_check") }}
                <ContextHelp
                  :text="t('settings.update_check_desc')"
                  :ariaLabel="t('settings.update_check_desc')"
                  data-testid="settings-update-check-help"
                />
              </label>
              <div class="col-sm-9 d-flex align-items-center">
                <div class="form-check form-switch">
                  <input
                    class="form-check-input"
                    type="checkbox"
                    role="switch"
                    id="updateCheckEnabled"
                    data-testid="settings-update-check"
                    v-model="state.updateCheckEnabled"
                  />
                </div>
              </div>
            </div>

            <!-- Buttons -->
            <div class="row">
              <div class="col-sm-9 offset-sm-3 d-flex justify-content-end gap-2">
                <button
                  type="button"
                  class="btn btn-light border"
                  :disabled="!isDirty"
                  @click="resetSettings"
                >
                  {{ t("common.reset") }}
                </button>
                <!-- UIが読めない言語のままでも保存操作が判別できるよう、言語非依存のアイコンを併記 -->
                <button
                  type="button"
                  class="btn btn-primary"
                  :disabled="!isDirty"
                  @click="saveSettings"
                >
                  <i class="bi bi-save me-1"></i>{{ t("common.save") }}
                </button>
              </div>
            </div>
          </form>
        </div>

        <!-- Base Map Settings Tab (m6-t6: API キーの3段構成) -->
        <div
          class="tab-pane fade"
          :class="{ 'show active': activeTab === 'basemap' }"
          id="basemap"
          role="tabpanel"
        >
          <form class="form-horizontal">
            <h5 class="d-flex align-items-center gap-1">{{ t("settings.editor_api_key_heading") }} <ContextHelp :text="t('settings.editor_api_key_notice')" :ariaLabel="t('settings.editor_api_key_notice')" data-testid="settings-editor-api-key-help" /></h5>

            <div class="row mb-2 align-items-center">
              <label for="editorGoogleApiKey" class="col-sm-3 col-form-label text-end">{{
                t("settings.editor_google_api_key")
              }}</label>
              <div class="col-sm-9">
                <input
                  type="text"
                  class="form-control"
                  id="editorGoogleApiKey"
                  data-testid="settings-editor-google-api-key"
                  v-model="state.editorGoogleApiKey"
                />
              </div>
            </div>
            <div class="row mb-3 align-items-center">
              <div class="col-sm-9 offset-sm-3">
                <div
                  v-if="sameKeyWarning.google"
                  class="text-warning small"
                  data-testid="settings-same-key-warning-google"
                >
                  {{ t("settings.same_key_warning", { provider: t("basemap.kind.label_google") }) }}
                </div>
              </div>
            </div>

            <div class="row mb-2 align-items-center">
              <label for="editorMapboxToken" class="col-sm-3 col-form-label text-end">{{
                t("settings.editor_mapbox_token")
              }}</label>
              <div class="col-sm-9">
                <input
                  type="text"
                  class="form-control"
                  id="editorMapboxToken"
                  data-testid="settings-editor-mapbox-token"
                  v-model="state.editorMapboxToken"
                />
              </div>
            </div>
            <div class="row mb-3 align-items-center">
              <div class="col-sm-9 offset-sm-3">
                <div
                  v-if="sameKeyWarning.mapbox"
                  class="text-warning small"
                  data-testid="settings-same-key-warning-mapbox"
                >
                  {{ t("settings.same_key_warning", { provider: t("basemap.kind.label_mapbox") }) }}
                </div>
              </div>
            </div>

            <h5 class="mt-4 d-flex align-items-center gap-1">{{ t("settings.default_publish_api_key_heading") }} <ContextHelp :text="t('settings.default_publish_api_key_notice')" :ariaLabel="t('settings.default_publish_api_key_notice')" data-testid="settings-default-publish-api-key-help" /></h5>

            <div class="row mb-3 align-items-center">
              <label for="defaultPublishGoogleApiKey" class="col-sm-3 col-form-label text-end">{{
                t("settings.default_publish_google_api_key")
              }}</label>
              <div class="col-sm-9">
                <input
                  type="text"
                  class="form-control"
                  id="defaultPublishGoogleApiKey"
                  data-testid="settings-default-publish-google-api-key"
                  v-model="state.defaultPublishGoogleApiKey"
                />
              </div>
            </div>

            <div class="row mb-3 align-items-center">
              <label for="defaultPublishMapboxToken" class="col-sm-3 col-form-label text-end">{{
                t("settings.default_publish_mapbox_token")
              }}</label>
              <div class="col-sm-9">
                <input
                  type="text"
                  class="form-control"
                  id="defaultPublishMapboxToken"
                  data-testid="settings-default-publish-mapbox-token"
                  v-model="state.defaultPublishMapboxToken"
                />
              </div>
            </div>

            <!-- Buttons（basic タブと同じ共有 state を保存/破棄する） -->
            <div class="row">
              <div class="col-sm-9 offset-sm-3 d-flex justify-content-end gap-2">
                <button
                  type="button"
                  class="btn btn-light border"
                  data-testid="settings-reset-basemap"
                  :disabled="!isDirty"
                  @click="resetSettings"
                >
                  {{ t("common.reset") }}
                </button>
                <button
                  type="button"
                  class="btn btn-primary"
                  data-testid="settings-save-basemap"
                  :disabled="!isDirty"
                  @click="saveSettings"
                >
                  <i class="bi bi-save me-1"></i>{{ t("common.save") }}
                </button>
              </div>
            </div>
          </form>
        </div>

        <!-- MCP server tab. The token is never shown: only its last 4 characters. -->
        <div
          v-if="mcp.status?.featureEnabled"
          class="tab-pane fade"
          :class="{ 'show active': activeTab === 'mcp' }"
          id="mcp"
          role="tabpanel"
        >
          <form class="form-horizontal" @submit.prevent>
            <p class="form-text" data-testid="settings-mcp-external-notice">{{ mcpNotice }}</p>

            <div class="row mb-3 align-items-center">
              <div class="col-sm-9 offset-sm-3">
                <div class="form-check form-switch">
                  <input
                    id="mcpEnabled"
                    class="form-check-input"
                    type="checkbox"
                    role="switch"
                    data-testid="settings-mcp-enabled"
                    :checked="mcp.status.enabled"
                    :disabled="mcp.busy"
                    @change="onToggleMcp($event.target as HTMLInputElement)"
                  />
                  <label class="form-check-label" for="mcpEnabled">{{ t("settings.mcp_enabled") }}</label>
                </div>
              </div>
            </div>

            <div class="row mb-3">
              <div class="col-sm-9 offset-sm-3" data-testid="settings-mcp-status">
                <div>
                  {{
                    mcp.status.listening
                      ? t("settings.mcp_status_listening", { address: mcpAddress })
                      : t("settings.mcp_status_stopped")
                  }}
                </div>
                <div class="form-text">
                  {{
                    mcp.status.lastRequestAt
                      ? t("settings.mcp_last_request", { time: new Date(mcp.status.lastRequestAt).toLocaleString() })
                      : t("settings.mcp_last_request_none")
                  }}
                </div>
                <div
                  v-if="mcp.status.lastError === 'port-in-use'"
                  class="text-danger small mt-1"
                  data-testid="settings-mcp-port-in-use"
                >
                  {{ t("settings.mcp_error_port_in_use") }}
                </div>
                <div
                  v-else-if="mcp.status.lastError === 'listen-failed'"
                  class="text-danger small mt-1"
                  data-testid="settings-mcp-listen-failed"
                >
                  {{ t("settings.mcp_error_listen_failed") }}
                </div>
              </div>
            </div>

            <div class="row mb-3 align-items-center">
              <label for="mcpPort" class="col-sm-3 col-form-label text-end">{{ t("settings.mcp_port") }}</label>
              <div class="col-sm-9 d-flex gap-2 align-items-center">
                <input
                  id="mcpPort"
                  v-model="mcp.portInput"
                  type="number"
                  min="1024"
                  max="65535"
                  step="1"
                  class="form-control w-auto"
                  data-testid="settings-mcp-port"
                />
                <button
                  type="button"
                  class="btn btn-light border"
                  data-testid="settings-mcp-port-save"
                  :disabled="mcp.busy || String(mcp.status.port) === String(mcp.portInput)"
                  @click="saveMcpPort"
                >
                  {{ t("settings.mcp_port_save") }}
                </button>
              </div>
              <div v-if="mcp.portInvalid" class="col-sm-9 offset-sm-3 text-danger small" data-testid="settings-mcp-port-invalid">
                {{ t("settings.mcp_error_port_invalid") }}
              </div>
            </div>

            <div class="row mb-3 align-items-center">
              <label class="col-sm-3 col-form-label text-end">{{ t("settings.mcp_token") }}</label>
              <div class="col-sm-9 d-flex gap-2 align-items-center">
                <span class="font-monospace" data-testid="settings-mcp-token-tail">{{
                  t("settings.mcp_token_tail", { tail: mcp.status.tokenTail })
                }}</span>
                <button
                  type="button"
                  class="btn btn-light border"
                  data-testid="settings-mcp-regenerate"
                  :disabled="mcp.busy"
                  @click="regenerateMcpToken"
                >
                  {{ t("settings.mcp_regenerate") }}
                </button>
              </div>
            </div>

            <div class="row mb-3">
              <div class="col-sm-9 offset-sm-3 d-flex flex-wrap gap-2">
                <button
                  type="button"
                  class="btn btn-light border"
                  data-testid="settings-mcp-copy-claude-code"
                  :disabled="mcp.busy"
                  @click="copyMcpCommand('claude-code')"
                >
                  <i class="bi bi-clipboard me-1"></i>{{ t("settings.mcp_copy_claude_code") }}
                </button>
                <button
                  type="button"
                  class="btn btn-light border"
                  data-testid="settings-mcp-copy-mcp-remote"
                  :disabled="mcp.busy"
                  @click="copyMcpCommand('mcp-remote')"
                >
                  <i class="bi bi-clipboard me-1"></i>{{ t("settings.mcp_copy_mcp_remote") }}
                </button>
              </div>
              <div v-if="mcp.copied" class="col-sm-9 offset-sm-3 form-text" data-testid="settings-mcp-copied">
                {{ t("settings.mcp_copied") }}
              </div>
              <div v-if="mcp.copyFailed" class="col-sm-9 offset-sm-3 text-danger small" data-testid="settings-mcp-copy-failed">
                {{ t("settings.mcp_copy_failed") }}
              </div>
            </div>

            <div class="row mb-3">
              <div class="col-sm-9 offset-sm-3">
                <p class="form-text mb-1">{{ t("settings.mcp_recommend_loopback") }}</p>
                <p class="form-text mb-0">
                  {{ t("settings.mcp_docs_link") }}:
                  <span class="user-select-all font-monospace" data-testid="settings-mcp-docs-url">{{ MCP_DOCS_URL }}</span>
                </p>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, onMounted, onUnmounted, ref, computed } from "vue";
import { useTranslation } from "i18next-vue";
import { SUPPORTED_LANGUAGES } from "../utils/editorLanguages";
import ContextHelp from "../components/editor-ui/ContextHelp.vue";
// The texts of the MCP confirmation dialogs live in the main process table; the notice on this tab is the
// same sentence, so it is read from that table instead of being translated twice.
import { mcpText } from "../../electron/mcp/messages";
import type { McpStatus } from "../electron";

// Links are shown as text: the editor window does not open external pages.
const MCP_DOCS_URL = "https://github.com/code4history/MaplatEditor/blob/master/docs/mcp.md";

// nov26-m6-t4（#26）: vue/multi-word-component-names。ファイル名・route は変えない
defineOptions({ name: "SettingsView" });

const { t, i18next } = useTranslation();
const activeTab = ref("basic");

// ---- MCP server tab ----
const mcp = reactive<{
  status: McpStatus | null;
  portInput: string;
  portInvalid: boolean;
  busy: boolean;
  copied: boolean;
  copyFailed: boolean;
}>({ status: null, portInput: "", portInvalid: false, busy: false, copied: false, copyFailed: false });
const mcpAddress = computed(() => `127.0.0.1:${mcp.status?.port ?? ""}`);
const mcpNotice = computed(() => mcpText(i18next.language, "enable.detail"));
let stopMcpStatus: (() => void) | null = null;
let copiedTimer: ReturnType<typeof setTimeout> | null = null;

function applyMcpStatus(status: McpStatus): void {
  const portChanged = mcp.status?.port !== status.port;
  mcp.status = status;
  if (portChanged) mcp.portInput = String(status.port);
}

async function runMcp(task: () => Promise<McpStatus>): Promise<void> {
  mcp.busy = true;
  try {
    applyMcpStatus(await task());
  } catch (e) {
    console.error("MCP server operation failed:", e);
    applyMcpStatus(await window.mcp.getStatus());
  } finally {
    mcp.busy = false;
  }
}

const onToggleMcp = async (input: HTMLInputElement) => {
  await runMcp(() => window.mcp.setEnabled(input.checked));
  // The switch shows the saved choice; a taken port or a failed listen is told by the error text, so the
  // user can still turn it off. Cancelling the confirmation leaves the status unchanged: put the switch back.
  input.checked = Boolean(mcp.status?.enabled);
};
const regenerateMcpToken = () => runMcp(() => window.mcp.regenerateToken());
const saveMcpPort = async () => {
  const port = Number(mcp.portInput);
  mcp.portInvalid = !(Number.isInteger(port) && port >= 1024 && port <= 65535);
  if (mcp.portInvalid) return;
  await runMcp(() => window.mcp.setPort(port));
};
const copyMcpCommand = async (client: "claude-code" | "mcp-remote") => {
  mcp.busy = true;
  mcp.copyFailed = false;
  try {
    const { copied } = await window.mcp.copyConnectionCommand(client);
    mcp.copied = copied;
    if (copiedTimer) clearTimeout(copiedTimer);
    if (copied) copiedTimer = setTimeout(() => (mcp.copied = false), 60_000);
  } catch (e) {
    console.error("Copying the MCP registration command failed:", e);
    mcp.copied = false;
    mcp.copyFailed = true;
  } finally {
    mcp.busy = false;
  }
};

onMounted(async () => {
  if (!window.mcp) return;
  stopMcpStatus = window.mcp.onStatus(applyMcpStatus);
  try {
    applyMcpStatus(await window.mcp.getStatus());
  } catch (e) {
    console.error("Failed to load the MCP server status:", e);
  }
});
onUnmounted(() => {
  stopMcpStatus?.();
  if (copiedTimer) clearTimeout(copiedTimer);
});

// m6-t6: ベースマップタブの4キー（エディタ用×2 + 既定公開用×2）。onMounted/saveSettings で
// ループ処理するための一覧（R9 の既存パターンと同型）
const BASEMAP_KEY_FIELDS = [
  "editorGoogleApiKey",
  "editorMapboxToken",
  "defaultPublishGoogleApiKey",
  "defaultPublishMapboxToken",
] as const;

// State for form values
// M5-T8: JPEG デコードのキャップは既定が「自動」。UI では**空文字**が自動を表す
// （`v-model.number` は空欄で '' を返すため、number 型では自動を表現できない。
//  ∴ 文字列で持ち、保存時に null へ写像する）
const state = reactive<{
  lang: string;
  saveFolder: string;
  jpegDecodeMaxMemoryMB: string;
  jpegDecodeMaxResolutionMP: string;
  updateCheckEnabled: boolean;
  editorGoogleApiKey: string;
  editorMapboxToken: string;
  defaultPublishGoogleApiKey: string;
  defaultPublishMapboxToken: string;
}>({
  lang: "ja",
  saveFolder: "",
  jpegDecodeMaxMemoryMB: "",
  jpegDecodeMaxResolutionMP: "",
  updateCheckEnabled: true,
  editorGoogleApiKey: "",
  editorMapboxToken: "",
  defaultPublishGoogleApiKey: "",
  defaultPublishMapboxToken: "",
});

// Original values for dirty checking
const original = reactive<{
  lang: string;
  saveFolder: string;
  jpegDecodeMaxMemoryMB: string;
  jpegDecodeMaxResolutionMP: string;
  updateCheckEnabled: boolean;
  editorGoogleApiKey: string;
  editorMapboxToken: string;
  defaultPublishGoogleApiKey: string;
  defaultPublishMapboxToken: string;
}>({
  lang: "ja",
  saveFolder: "",
  jpegDecodeMaxMemoryMB: "",
  jpegDecodeMaxResolutionMP: "",
  updateCheckEnabled: true,
  editorGoogleApiKey: "",
  editorMapboxToken: "",
  defaultPublishGoogleApiKey: "",
  defaultPublishMapboxToken: "",
});

// m6-t6 (§3.3): エディタ用キーと既定公開用キーが非空かつ同一値の場合の警告
// （マイルストーン §2.2「エディタ用キーを公開用キーとして流用するトグルは作らない。
// 同一値の場合は警告を出す」）
const sameKeyWarning = computed(() => ({
  google:
    state.editorGoogleApiKey !== "" &&
    state.editorGoogleApiKey === state.defaultPublishGoogleApiKey,
  mapbox:
    state.editorMapboxToken !== "" &&
    state.editorMapboxToken === state.defaultPublishMapboxToken,
}));

/** 保存値（number | null）を UI の文字列表現へ。null / 未設定 = 自動 = 空文字 */
const capToField = (value: unknown): string =>
  typeof value === "number" && Number.isFinite(value) ? String(value) : "";

const isDirty = computed(() => {
  return (
    state.lang !== original.lang ||
    state.saveFolder !== original.saveFolder ||
    state.jpegDecodeMaxMemoryMB !== original.jpegDecodeMaxMemoryMB ||
    state.jpegDecodeMaxResolutionMP !== original.jpegDecodeMaxResolutionMP ||
    state.updateCheckEnabled !== original.updateCheckEnabled ||
    BASEMAP_KEY_FIELDS.some((key) => state[key] !== original[key])
  );
});

onMounted(async () => {
  try {
    const lang = await window.settings.get("lang");
    if (lang) {
      state.lang = lang;
      original.lang = lang;
      if (i18next.language !== lang) {
        await i18next.changeLanguage(lang);
      }
    }
    const saveFolder = await window.settings.get("saveFolder");
    if (saveFolder) {
      state.saveFolder = saveFolder;
      original.saveFolder = saveFolder;
    }
    // M5-T6/M5-T8: 値の正規化は main 側（SettingsService）に閉じているので、ここでは受け取るだけ。
    // null（自動）は空欄として表示する
    for (const key of ["jpegDecodeMaxMemoryMB", "jpegDecodeMaxResolutionMP"] as const) {
      const value = await window.settings.get(key);
      state[key] = capToField(value);
      original[key] = state[key];
    }
    // nov26-m7-t6: 起動時の更新の確認（main 側の get が正規化する。未設定は true）
    const updateCheck = await window.settings.get("updateCheckEnabled");
    state.updateCheckEnabled = updateCheck !== false;
    original.updateCheckEnabled = state.updateCheckEnabled;
    // m6-t6: ベースマップタブの4キー（未設定時は window.settings.get が undefined を返す）
    for (const key of BASEMAP_KEY_FIELDS) {
      const value = await window.settings.get(key);
      state[key] = typeof value === "string" ? value : "";
      original[key] = state[key];
    }
  } catch (e) {
    console.error("Failed to load settings:", e);
  }
});

const showFolderDialog = async () => {
  const path = await window.settings.showSaveFolderDialog();
  if (path) {
    state.saveFolder = path; // Only update state, not original, so it becomes dirty
  } else {
    // キャンセルで main は選択を忘れるので、未保存の選択も捨てる（残すと保存が拒否される）
    state.saveFolder = original.saveFolder;
  }
};

const resetSettings = async () => {
    state.lang = original.lang;
    state.saveFolder = original.saveFolder;
    state.jpegDecodeMaxMemoryMB = original.jpegDecodeMaxMemoryMB;
    state.jpegDecodeMaxResolutionMP = original.jpegDecodeMaxResolutionMP;
    state.updateCheckEnabled = original.updateCheckEnabled;
    for (const key of BASEMAP_KEY_FIELDS) {
      state[key] = original[key];
    }
    if (i18next.language !== state.lang) {
        await i18next.changeLanguage(state.lang);
    }
};

const saveSettings = async () => {
    // 保存フォルダは main が拒否することがある（ネットワーク上のフォルダなど）。
    // 途中まで保存しないよう最初に送り、失敗したら利用者に伝えて止める
    try {
        await window.settings.set("saveFolder", state.saveFolder);
    } catch (e) {
        console.error("Failed to save the data folder:", e);
        await (window as any).dialog.showMessageBox({
            type: "error",
            buttons: ["OK"],
            message: t("settings.save_folder_failed"),
        });
        return;
    }
    await window.settings.set("lang", state.lang);
    // M5-T8: 空欄は「自動」= null として送る（main 側の normalizeJpegDecodeCap が受ける）
    await window.settings.set("jpegDecodeMaxMemoryMB", state.jpegDecodeMaxMemoryMB === "" ? null : state.jpegDecodeMaxMemoryMB);
    await window.settings.set("jpegDecodeMaxResolutionMP", state.jpegDecodeMaxResolutionMP === "" ? null : state.jpegDecodeMaxResolutionMP);
    await window.settings.set("updateCheckEnabled", state.updateCheckEnabled);
    for (const key of BASEMAP_KEY_FIELDS) {
      await window.settings.set(key, state[key]);
    }

    // Update original to match new saved state.
    // M5-T6/M5-T8: 正規化後の値を読み直す（下限で丸められた場合・**機械安全枠の上限で
    // 切り下げられた場合**に画面と保存値がずれないように）
    original.lang = state.lang;
    original.saveFolder = state.saveFolder;
    for (const key of ["jpegDecodeMaxMemoryMB", "jpegDecodeMaxResolutionMP"] as const) {
      const saved = await window.settings.get(key);
      state[key] = capToField(saved);
      original[key] = state[key];
    }
    // nov26-m7-t6: jpeg の 2 キーと同じく、正規化後の値を読み直して state と original の両方へ入れる
    // （明示の false だけが「切る」なので、保存値と画面を揃え、保存後に dirty を閉じる）
    const savedUpdateCheck = await window.settings.get("updateCheckEnabled");
    state.updateCheckEnabled = savedUpdateCheck !== false;
    original.updateCheckEnabled = state.updateCheckEnabled;
    // m6-t6: ベースマップキーは正規化を挟まないので読み直し不要。dirty 判定を閉じるだけでよい
    for (const key of BASEMAP_KEY_FIELDS) {
      original[key] = state[key];
    }

    if (i18next.language !== state.lang) {
        await i18next.changeLanguage(state.lang);
    }
};
</script>

<style scoped>
/* Removed max-width restriction to allow full expansion */
.container-fluid.main {
    width: 100%;
}
</style>
