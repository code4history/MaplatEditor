<template>
  <div class="container-fluid p-3">
    <DraftConflictDialog
      :visible="!!modalDraftLifecycle.conflictDraft.value"
      @discard="modalDraftLifecycle.resolveConflict('discard')"
      @apply="modalDraftLifecycle.resolveConflict('apply')"
    />
    <!-- Controls Row -->
    <div class="row mb-3 gx-2 align-items-center">
      <div class="col-auto">
        <button class="btn btn-light border shadow-sm px-4" @click="openAddModal">
          {{ t("basemap.add") }}
        </button>
      </div>
      <div class="col">
        <div><span class="text-muted" style="font-size: 13px;">{{ t("basemap.description") }}</span></div>
        <div><span class="text-muted" style="font-size: 13px;">{{ t("basemap.always_note") }}</span></div>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="text-muted text-center py-3">
      {{ t("basemap.loading") }}
    </div>

    <!-- Error -->
    <div v-else-if="error" class="alert alert-danger">
      {{ error }}
    </div>

    <template v-else>
      <!-- User-defined base maps -->
      <h6 class="fw-bold mb-2">{{ t("basemap.user_section") }}</h6>
      <div v-if="userBaseMaps.length === 0" class="text-muted py-3">
        {{ t("basemap.no_user_basemaps") }}
      </div>
      <div v-else class="table-responsive mb-4">
        <table class="table table-hover table-sm align-middle bg-white shadow-sm">
          <thead class="table-light">
            <tr>
              <th style="width: 60px;">{{ t("basemap.icon") }}</th>
              <th style="width: 160px;">{{ t("basemap.id") }}</th>
              <th style="width: 220px;">{{ t("basemap.map_title") }}</th>
              <th>{{ t("basemap.url") }}</th>
              <th style="width: 180px;">{{ t("basemap.coverage") }}</th>
              <th style="width: 90px;">{{ t("basemap.always_visible") }}</th>
              <th style="width: 90px;">{{ t("basemap.min_zoom") }}</th>
              <th style="width: 90px;">{{ t("basemap.max_zoom") }}</th>
              <th style="width: 140px;">{{ t("basemap.actions") }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in userBaseMaps" :key="item.uid">
              <td>
                <img v-if="item.thumbnailUrl" :src="item.thumbnailUrl" class="basemap-icon" loading="lazy" decoding="async" :alt="item.mapID">
                <span v-else class="text-muted">-</span>
              </td>
              <td class="text-break">
                {{ item.mapID }}
                <span v-if="hasDraft(item.uid)" class="badge bg-warning text-dark">{{ t('editor_ui.draft_badge') }}</span>
              </td>
              <td class="text-break">{{ item.data.title }}</td>
              <td class="text-break"><small>{{ item.data.url }}</small></td>
              <td><small>{{ coverageLabel(item.data) }}</small></td>
              <td class="text-center">
                <input
                  class="form-check-input"
                  type="checkbox"
                  :checked="item.alwaysVisible"
                  :disabled="item.alwaysLocked"
                  @change="toggleAlways(item, $event)"
                >
              </td>
              <td>{{ item.data.minZoom ?? '-' }}</td>
              <td>{{ item.data.maxZoom ?? '-' }}</td>
              <td>
                <button class="btn btn-sm btn-outline-secondary me-1" @click="openEditModal(item)">
                  {{ t("basemap.edit") }}
                </button>
                <button class="btn btn-sm btn-outline-danger" @click="deleteBaseMap(item)">
                  {{ t("basemap.delete") }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Builtin base maps (read-only) -->
      <details class="mb-3">
        <summary class="fw-bold mb-2" style="cursor: pointer;">
          {{ t("basemap.builtin_section") }} ({{ builtinBaseMaps.length }})
        </summary>
        <div class="table-responsive mt-2">
          <table class="table table-sm align-middle bg-white shadow-sm">
            <thead class="table-light">
              <tr>
                <th style="width: 60px;">{{ t("basemap.icon") }}</th>
                <th style="width: 160px;">{{ t("basemap.id") }}</th>
                <th style="width: 220px;">{{ t("basemap.map_title") }}</th>
                <th>{{ t("basemap.url") }}</th>
                <th style="width: 180px;">{{ t("basemap.coverage") }}</th>
                <th style="width: 90px;">{{ t("basemap.always_visible") }}</th>
                <th style="width: 90px;">{{ t("basemap.max_zoom") }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in builtinBaseMaps" :key="item.uid">
                <td>
                  <img v-if="item.thumbnailUrl" :src="item.thumbnailUrl" class="basemap-icon" loading="lazy" decoding="async" :alt="item.mapID">
                  <span v-else class="text-muted">-</span>
                </td>
                <td class="text-break text-muted">{{ item.mapID }}</td>
                <td class="text-break text-muted">{{ item.data.title }}</td>
                <td class="text-break text-muted"><small>{{ item.data.url || '-' }}</small></td>
                <td class="text-muted"><small>{{ coverageLabel(item.data) }}</small></td>
                <td class="text-center">
                  <input
                    class="form-check-input"
                    type="checkbox"
                    :checked="item.alwaysVisible"
                    :disabled="item.alwaysLocked"
                    @change="toggleAlways(item, $event)"
                  >
                </td>
                <td class="text-muted">{{ item.data.maxZoom ?? '-' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </details>
    </template>

    <!-- Add/Edit Modal -->
    <div v-if="showModal" class="modal show d-block" tabindex="-1">
      <div class="modal-dialog modal-lg">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">
              {{ editing ? t("basemap.modal.edit_title") : t("basemap.modal.add_title") }}
            </h5>
            <button type="button" class="btn-close" @click="closeModal"></button>
          </div>
          <div class="modal-body">
            <div v-if="formError" class="alert alert-danger py-2">{{ formError }}</div>
            <!-- IDは編集時も変更可能(改名)。正本キーはuid(ADR-0007)のため、
                 表示設定・常時表示設定・アイコンは改名の影響を受けない -->

            <label class="form-label">{{ t("basemap.modal.id_label") }}</label>
            <input
              type="text"
              class="form-control"
              v-model="form.mapID"
              :placeholder="t('basemap.modal.id_placeholder')"
            />
            <label class="form-label mt-2">{{ t("basemap.modal.title_label") }}</label>
            <input
              type="text"
              class="form-control"
              v-model="form.title"
              :placeholder="t('basemap.modal.title_placeholder')"
            />
            <label class="form-label mt-2">{{ t("basemap.modal.url_label") }}</label>
            <input
              type="text"
              class="form-control"
              v-model="form.url"
              :placeholder="t('basemap.modal.url_placeholder')"
            />
            <label class="form-label mt-2">{{ t("basemap.modal.attr_label") }}</label>
            <input
              type="text"
              class="form-control"
              v-model="form.attr"
              :placeholder="t('basemap.modal.attr_placeholder')"
            />
            <div class="row">
              <div class="col">
                <label class="form-label mt-2">{{ t("basemap.modal.min_zoom_label") }}</label>
                <input
                  type="number"
                  class="form-control"
                  v-model="form.minZoom"
                  min="0"
                  max="25"
                />
              </div>
              <div class="col">
                <label class="form-label mt-2">{{ t("basemap.modal.max_zoom_label") }}</label>
                <input
                  type="number"
                  class="form-control"
                  v-model="form.maxZoom"
                  min="1"
                  max="25"
                />
              </div>
            </div>
            <!-- アイコン(52px正方形)。アプリ登録時のデフォルトとして継承される -->
            <label class="form-label mt-2">{{ t("basemap.icon") }}</label>
            <div class="d-flex align-items-center gap-2 flex-wrap">
              <img v-if="formThumbnailUrl" :src="formThumbnailUrl" class="basemap-icon" :alt="form.mapID">
              <button type="button" class="btn btn-sm btn-outline-secondary" @click="uploadIcon">
                {{ t("appedit.upload") }}
              </button>
              <!-- タイルURLと存在範囲が揃っている場合、範囲の画像から52pxアイコンを自動生成できる -->
              <button
                type="button"
                class="btn btn-sm btn-outline-primary"
                :disabled="!canGenerateIcon || generatingIcon"
                @click="generateIcon"
              >
                {{ generatingIcon ? t("basemap.generating_icon") : t("basemap.generate_icon") }}
              </button>
              <small class="text-muted">{{ t("appedit.thumbnail_note") }}</small>
            </div>
            <!-- 提供範囲(経緯度)。アプリ登録時のデフォルトとして継承される -->
            <label class="form-label mt-2">{{ t("basemap.coverage") }}</label>
            <div class="d-flex align-items-center gap-2 flex-wrap">
              <span class="small font-monospace">{{ coverageLabel({ coverageLngLats: form.coverageLngLats }) }}</span>
              <button type="button" class="btn btn-sm btn-outline-primary" @click="showEnvelopeModal = true">
                {{ t("appedit.envelope_pick") }}
              </button>
              <button v-if="form.coverageLngLats" type="button" class="btn btn-sm btn-outline-danger" @click="form.coverageLngLats = null">
                {{ t("appedit.envelope_clear") }}
              </button>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" @click="closeModal">
              {{ t("basemap.modal.cancel") }}
            </button>
            <button type="button" class="btn btn-primary" @click="saveBaseMap" :disabled="saving">
              {{ t("basemap.modal.save") }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- タイルURL定義済みなら当該タイルをオーバーレイし、実在範囲を見ながら指定できる -->
    <EnvelopeEditorModal
      v-if="showEnvelopeModal"
      :model-value="form.coverageLngLats"
      :overlay-tms="overlayTms"
      title-key="basemap.coverage_modal_title"
      help-key="basemap.coverage_modal_help"
      @update:model-value="form.coverageLngLats = $event"
      @close="showEnvelopeModal = false"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { useTranslation } from "i18next-vue";
import EnvelopeEditorModal from "../components/EnvelopeEditorModal.vue";
import DraftConflictDialog from "../components/editor-ui/DraftConflictDialog.vue";
import { envelopeToBbox } from "../utils/appSourceModel";
import { useAssetDraftBadges } from "../composables/useAssetDraftBadges";
import { useAssetDraftLifecycle } from "../composables/useAssetDraftLifecycle";

interface BaseMapCatalogItem {
  uid: string;
  mapID: string;
  scope: "builtin" | "user";
  data: any;
  revision: number;
  thumbnailUrl?: string | null;
  alwaysVisible: boolean;
  alwaysLocked: boolean;
}

const { t } = useTranslation();
const { hasDraft, refreshDrafts } = useAssetDraftBadges('base-map');

const items = ref<BaseMapCatalogItem[]>([]);
const loading = ref(false);
const error = ref("");

const userBaseMaps = computed(() => items.value.filter((item) => item.scope === "user"));
const builtinBaseMaps = computed(() => items.value.filter((item) => item.scope === "builtin"));

// Modal state
const showModal = ref(false);
const showEnvelopeModal = ref(false);
// 編集対象のuid(正本キー、ADR-0007)。新規作成時はnull
const editingUid = ref<string | null>(null);
// 編集モード判定はeditingUidから導出する(並行stateの不整合を作らない)
const editing = computed(() => editingUid.value !== null);
// 編集対象の元slug(改名判定用)。新規作成時は空
const originalMapID = ref("");
const saving = ref(false);
const formError = ref("");
const form = ref({
  mapID: "",
  title: "",
  url: "",
  attr: "",
  minZoom: "" as string | number,
  maxZoom: "" as string | number,
  thumbnail: "" as string,
  coverageLngLats: null as [number, number][] | null,
});
const formThumbnailUrl = ref<string | null>(null);
const modalDraftReady = ref(false);
const modalDraftLifecycle = useAssetDraftLifecycle<typeof form.value>({
  kind: 'base-map',
  serialize: () => JSON.parse(JSON.stringify(form.value)),
  apply: (payload) => { form.value = JSON.parse(JSON.stringify(payload)); },
});

function coverageLabel(data: any): string {
  const bbox = envelopeToBbox(data?.coverageLngLats);
  if (!bbox) return "-";
  return `W${bbox[0]} S${bbox[1]} E${bbox[2]} N${bbox[3]}`;
}

const loadBaseMaps = async () => {
  loading.value = true;
  error.value = "";
  try {
    items.value = await window.baseMaps.list();
    await refreshDrafts();
  } catch (e) {
    console.error("Failed to load base maps", e);
    error.value = t("basemap.errors.load_failed");
  } finally {
    loading.value = false;
  }
};

onMounted(() => {
  loadBaseMaps();
});

const openAddModal = async () => {
  modalDraftReady.value = false;
  editingUid.value = null;
  originalMapID.value = "";
  form.value = { mapID: "", title: "", url: "", attr: "", minZoom: "", maxZoom: "", thumbnail: "", coverageLngLats: null };
  formThumbnailUrl.value = null;
  formError.value = "";
  showModal.value = true;
  await modalDraftLifecycle.open(crypto.randomUUID(), null);
  modalDraftReady.value = true;
};

const openEditModal = async (item: BaseMapCatalogItem) => {
  modalDraftReady.value = false;
  editingUid.value = item.uid;
  originalMapID.value = item.mapID;
  form.value = {
    mapID: item.mapID,
    title: item.data.title || "",
    url: item.data.url || "",
    attr: item.data.attr || "",
    minZoom: item.data.minZoom ?? "",
    maxZoom: item.data.maxZoom ?? "",
    thumbnail: typeof item.data.thumbnail === "string" ? item.data.thumbnail : "",
    coverageLngLats: Array.isArray(item.data.coverageLngLats)
      ? JSON.parse(JSON.stringify(item.data.coverageLngLats))
      : null,
  };
  formThumbnailUrl.value = item.thumbnailUrl || null;
  formError.value = "";
  showModal.value = true;
  await modalDraftLifecycle.open(item.uid, item.revision);
  modalDraftReady.value = true;
};

const closeModal = async () => {
  if (modalDraftReady.value) await modalDraftLifecycle.flush();
  modalDraftReady.value = false;
  showModal.value = false;
};

watch(form, () => {
  if (showModal.value && modalDraftReady.value) modalDraftLifecycle.schedule(true);
}, { deep: true, flush: 'post' });

// アイコンのファイルキー: 既存ベースマップはuid(tmbs/{uid}.png)、
// 新規はuid未採番のため入力IDの暫定名(保存時にsaveUserBaseMapがuid名へ付け替える)
const iconFileKey = (): string => editingUid.value || form.value.mapID.trim();

const uploadIcon = async () => {
  const fileKey = iconFileKey();
  if (!fileKey) {
    formError.value = t("basemap.errors.id_required");
    return;
  }
  formError.value = "";
  const result = await window.appAssets.uploadTmsThumbnail(fileKey);
  if (result.err === "Canceled") return;
  if (result.err) {
    formError.value = t("appedit.error_invalid_image");
    return;
  }
  form.value.thumbnail = result.path || "";
  formThumbnailUrl.value = result.fileUrl || null;
};

// タイルURLテンプレートが有効な形なら、範囲指定モーダルへのオーバーレイ用定義を返す
const overlayTms = computed(() => {
  const url = String(form.value.url || "").trim();
  if (!(url.includes("{z}") && url.includes("{x}") && (url.includes("{y}") || url.includes("{-y}")))) {
    return null;
  }
  return {
    url,
    minZoom: form.value.minZoom !== "" && form.value.minZoom !== null ? Number(form.value.minZoom) : undefined,
    maxZoom: form.value.maxZoom !== "" && form.value.maxZoom !== null ? Number(form.value.maxZoom) : undefined,
  };
});

// アイコン自動生成はタイルURLと存在範囲の両方が設定済みの場合のみ
const canGenerateIcon = computed(() => overlayTms.value != null && form.value.coverageLngLats != null);
const generatingIcon = ref(false);

const generateIcon = async () => {
  const fileKey = iconFileKey();
  if (!fileKey) {
    formError.value = t("basemap.errors.id_required");
    return;
  }
  if (!overlayTms.value || !form.value.coverageLngLats) return;
  formError.value = "";
  generatingIcon.value = true;
  try {
    // IPCの構造化クローンはVueのreactiveプロキシを受け付けない("An object could not be cloned")
    // ため、プレーンなデータに落としてから渡す
    const coverage = JSON.parse(JSON.stringify(form.value.coverageLngLats));
    const result = await window.appAssets.generateTmsThumbnail(fileKey, { ...overlayTms.value }, coverage);
    if (result.err || !result.path) {
      formError.value = t("basemap.errors.icon_generate_failed");
      return;
    }
    form.value.thumbnail = result.path;
    formThumbnailUrl.value = result.fileUrl ? `${result.fileUrl}?t=${Date.now()}` : null;
  } catch (e) {
    console.error("Failed to generate base map icon", e);
    formError.value = t("basemap.errors.icon_generate_failed");
  } finally {
    generatingIcon.value = false;
  }
};

const validateForm = (): string | null => {
  const mapID = form.value.mapID.trim();
  const title = form.value.title.trim();
  const url = form.value.url.trim();
  if (!mapID) return t("basemap.errors.id_required");
  if (!/^[a-zA-Z0-9_-]+$/.test(mapID)) return t("basemap.errors.id_invalid");
  // ID変更(新規または改名)時のみ重複を検査する(自分自身のuidは除外)
  if (mapID !== originalMapID.value &&
      items.value.some((item) => item.mapID === mapID && item.uid !== editingUid.value)) {
    return t("basemap.errors.id_duplicate");
  }
  if (!title) return t("basemap.errors.title_required");
  if (!url) return t("basemap.errors.url_required");
  if (!(url.includes("{z}") && url.includes("{x}") && (url.includes("{y}") || url.includes("{-y}")))) {
    return t("basemap.errors.url_invalid");
  }
  const hasMinZoom = form.value.minZoom !== "" && form.value.minZoom !== null;
  const hasMaxZoom = form.value.maxZoom !== "" && form.value.maxZoom !== null;
  if (hasMinZoom) {
    const zoom = Number(form.value.minZoom);
    if (!Number.isInteger(zoom) || zoom < 0 || zoom > 25) {
      return t("basemap.errors.min_zoom_invalid");
    }
  }
  if (hasMaxZoom) {
    const zoom = Number(form.value.maxZoom);
    if (!Number.isInteger(zoom) || zoom < 1 || zoom > 25) {
      return t("basemap.errors.max_zoom_invalid");
    }
  }
  if (hasMinZoom && hasMaxZoom && Number(form.value.minZoom) > Number(form.value.maxZoom)) {
    return t("basemap.errors.zoom_order_invalid");
  }
  return null;
};

const saveBaseMap = async () => {
  const validationError = validateForm();
  if (validationError) {
    formError.value = validationError;
    return;
  }
  // IDはMaplat地図・アプリ・ビルトイン含む全アセットと共通の空間で一意 (ADR-0007)。
  // 自分自身のuidを除外して(excludeUid)Write Store横断で確認する
  const slug = form.value.mapID.trim();
  if (slug !== originalMapID.value) {
    try {
      const available = await window.assets.checkSlug({ slug, excludeUid: editingUid.value ?? undefined });
      if (!available) {
        formError.value = t("basemap.errors.id_duplicate");
        return;
      }
    } catch (e) {
      console.error("Failed to check base map ID availability", e);
    }
  }
  const tms: any = {
    mapID: slug,
    title: form.value.title.trim(),
    url: form.value.url.trim(),
  };
  const attr = form.value.attr.trim();
  if (attr) tms.attr = attr;
  if (form.value.minZoom !== "" && form.value.minZoom !== null) {
    tms.minZoom = Number(form.value.minZoom);
  }
  if (form.value.maxZoom !== "" && form.value.maxZoom !== null) {
    tms.maxZoom = Number(form.value.maxZoom);
  }
  if (form.value.thumbnail) tms.thumbnail = form.value.thumbnail;
  // IPCの構造化クローン対策: reactiveプロキシの配列はプレーンに落としてから渡す
  if (form.value.coverageLngLats) tms.coverageLngLats = JSON.parse(JSON.stringify(form.value.coverageLngLats));
  saving.value = true;
  try {
    // uid正準の保存 (ADR-0007): 編集時はuid指定(slug変更=同一uidの付け替え)、新規はuid採番
    await window.baseMaps.saveUser({ uid: editingUid.value ?? undefined, slug, tms });
    await modalDraftLifecycle.markSaved();
    modalDraftReady.value = false;
    showModal.value = false;
    await loadBaseMaps();
  } catch (e) {
    console.error("Failed to save base map", e);
    formError.value = t("basemap.errors.save_failed");
  } finally {
    saving.value = false;
  }
};

const deleteBaseMap = async (item: BaseMapCatalogItem) => {
  const name = item.data.title || item.mapID;
  if (!confirm(t("basemap.delete_confirm", { name }))) return;
  try {
    await window.baseMaps.deleteUser(item.uid);
    await window.assetDrafts.remove('base-map', item.uid);
    await loadBaseMaps();
  } catch (e) {
    console.error("Failed to delete base map", e);
    error.value = t("basemap.errors.delete_failed");
  }
};

const toggleAlways = async (item: BaseMapCatalogItem, event: Event) => {
  const input = event.target as HTMLInputElement;
  const always = input.checked;
  try {
    await window.baseMaps.setAlways(item.uid, always);
    item.alwaysVisible = always;
  } catch (e) {
    console.error("Failed to update always-visible setting", e);
    input.checked = !always;
    error.value = t("basemap.errors.always_failed");
  }
};
</script>

<style scoped>
.table {
    font-size: 13px;
}
.basemap-icon {
    width: 40px;
    height: 40px;
    object-fit: contain;
    background: #f8f9fa;
    border: 1px solid var(--bs-border-color);
}
</style>
