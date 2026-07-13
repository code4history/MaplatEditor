// POI エディタの編集セッション composable (Phase 4 Task 4)。
// 仕様 §5: UndoStack<PoiEditState> を流用し、明示 commit() のみが 1 Undo 単位として push する
// (MapEdit のデバウンス deep-watch 方式は使わない)。snapshot は slug/title/features/layerMeta を
// 含むセッション全体で、未変更 feature オブジェクトは snapshot 間で共有する (structural sharing)。
// selectedUid は Undo 対象外。表示 ID 採番は poiGeoJson の ensureDisplayIds を再利用する。
import { computed, ref, shallowRef, type ComputedRef, type Ref } from "vue";
import { UndoStack } from "../services/editorUndoStack";
import type { LangResource } from "../utils/langResource";
import type { LangCode } from "../utils/editorLanguages";
import {
  ensureDisplayIds,
  type PoiEditorFC,
  type PoiEditorFeature,
} from "../utils/poiGeoJson";

export interface PoiEditState {
  lang: LangCode;
  slug: string;
  title: LangResource;
  features: PoiEditorFeature[];
  /** fc の features 以外のトップレベル (name 等 layer metadata)。type は含めず toSaveFc が再構成する */
  layerMeta: Record<string, unknown>;
}

export interface PoiEditSession {
  state: Readonly<Ref<PoiEditState | null>>;
  /** 選択中 feature の _maplatUid。Undo 対象外 (現在 snapshot から消えたら自動解除) */
  selectedUid: Ref<string | null>;
  isDirty: ComputedRef<boolean>;
  canUndo: ComputedRef<boolean>;
  canRedo: ComputedRef<boolean>;
  load(detail: { lang: LangCode; slug: string; title: LangResource; fc: PoiEditorFC }): void;
  reset(state: PoiEditState, restoredDraft?: boolean): void;
  /** 仕様 §5 の 1 Undo 単位 = commit 1 回。draft は state の shallow copy (features は新配列)。
   * mutate 内で feature を変更する場合は clone してから書くこと (未変更 feature は共有のまま)。
   * slug/title/layerMeta の変更は値・オブジェクトごと差し替えで書く。 */
  commit(mutate: (draft: PoiEditState) => void): void;
  /** 表示 ID 自動採番 (ensureDisplayIds 規則) + 空属性 + 新 uid。1 commit。返り値 = 新 feature uid */
  addFeature(lngLat: [number, number]): string;
  removeFeature(uid: string): void;
  moveFeature(uid: string, lngLat: [number, number]): void;
  patchFeatureProperties(uid: string, patch: Record<string, unknown>): void;
  undo(): void;
  redo(): void;
  /** resetHistoryBase 相当 (UndoStack.save(): 履歴を現在 snapshot 1 件へ再基準化) */
  markSaved(): void;
  /** layerMeta + 現在 features を FC に再構成 (保存・診断用) */
  toSaveFc(): PoiEditorFC;
}

function featureUid(feature: PoiEditorFeature): unknown {
  return feature.properties?._maplatUid;
}

export function usePoiEditSession(): PoiEditSession {
  let stack: UndoStack<PoiEditState> | null = null;

  // stack は非リアクティブなので、変更のたびに stateRef を差し替え version で computed を再評価させる。
  // deep reactive にしない (shallowRef): snapshot 間の feature オブジェクト同一性 (structural
  // sharing) を proxy 化で壊さないため。
  const stateRef = shallowRef<PoiEditState | null>(null);
  const version = ref(0);
  const selectedUid = ref<string | null>(null);

  const touch = (): void => {
    version.value += 1;
    const current = stack ? stack.current() : null;
    stateRef.value = current;
    // selectedUid は Undo 対象外だが、現在 snapshot に存在しない feature の選択は解除する
    // (remove の commit / redo で消えた場合など)。
    if (
      selectedUid.value !== null &&
      (!current ||
        !current.features.some((f) => featureUid(f) === selectedUid.value))
    ) {
      selectedUid.value = null;
    }
  };

  const isDirty = computed(() => {
    void version.value;
    return stack ? stack.isDirty() : false;
  });
  const canUndo = computed(() => {
    void version.value;
    return stack ? stack.canUndo() : false;
  });
  const canRedo = computed(() => {
    void version.value;
    return stack ? stack.canRedo() : false;
  });

  const reset = (state: PoiEditState, restoredDraft = false): void => {
    stack = new UndoStack<PoiEditState>({
      ...state,
      title: structuredClone(state.title),
      features: state.features.slice(),
      layerMeta: structuredClone(state.layerMeta),
    });
    if (restoredDraft) stack.markDirty();
    selectedUid.value = null;
    touch();
  };

  const load = (detail: {
    lang: LangCode;
    slug: string;
    title: LangResource;
    fc: PoiEditorFC;
  }): void => {
    const { features, type: _type, lang: _lang, ...rest } = detail.fc;
    void _type;
    void _lang;
    reset({
      lang: detail.lang,
      slug: detail.slug,
      title: detail.title,
      features: features.slice(),
      layerMeta: rest as Record<string, unknown>,
    });
  };

  const requireStack = (): UndoStack<PoiEditState> => {
    if (!stack) throw new Error("usePoiEditSession: load() before editing");
    return stack;
  };

  const commit = (mutate: (draft: PoiEditState) => void): void => {
    const s = requireStack();
    const current = s.current();
    const draft: PoiEditState = { ...current, features: current.features.slice() };
    mutate(draft);
    s.push(draft);
    touch();
  };

  const addFeature = (lngLat: [number, number]): string => {
    const uid = globalThis.crypto.randomUUID();
    commit((draft) => {
      const feature: PoiEditorFeature = {
        type: "Feature",
        id: "",
        geometry: { type: "Point", coordinates: [lngLat[0], lngLat[1]] },
        properties: { _maplatUid: uid },
      };
      // 表示 ID 採番は既存ヘルパへ委譲。非空 id の既存 feature は同一オブジェクトのまま返るため
      // structural sharing は保たれる。
      draft.features = ensureDisplayIds([...draft.features, feature]).features;
    });
    return uid;
  };

  const findFeatureIndex = (uid: string): number => {
    const s = requireStack();
    return s.current().features.findIndex((f) => featureUid(f) === uid);
  };

  const removeFeature = (uid: string): void => {
    if (findFeatureIndex(uid) < 0) return;
    commit((draft) => {
      draft.features = draft.features.filter((f) => featureUid(f) !== uid);
    });
  };

  const moveFeature = (uid: string, lngLat: [number, number]): void => {
    const index = findFeatureIndex(uid);
    if (index < 0) return;
    commit((draft) => {
      const cloned = structuredClone(draft.features[index]) as PoiEditorFeature;
      cloned.geometry = { type: "Point", coordinates: [lngLat[0], lngLat[1]] };
      draft.features[index] = cloned;
    });
  };

  const patchFeatureProperties = (
    uid: string,
    patch: Record<string, unknown>,
  ): void => {
    const index = findFeatureIndex(uid);
    if (index < 0) return;
    commit((draft) => {
      const cloned = structuredClone(draft.features[index]) as PoiEditorFeature;
      cloned.properties = { ...cloned.properties, ...patch };
      draft.features[index] = cloned;
    });
  };

  const undo = (): void => {
    if (!stack) return;
    stack.undo();
    touch();
  };

  const redo = (): void => {
    if (!stack) return;
    stack.redo();
    touch();
  };

  const markSaved = (): void => {
    if (!stack) return;
    stack.save();
    touch();
  };

  const toSaveFc = (): PoiEditorFC => {
    const s = requireStack();
    const current = s.current();
    return {
      ...current.layerMeta,
      type: "FeatureCollection",
      lang: current.lang,
      features: current.features.slice(),
    } as PoiEditorFC;
  };

  return {
    state: stateRef as Readonly<Ref<PoiEditState | null>>,
    selectedUid,
    isDirty,
    canUndo,
    canRedo,
    load,
    reset,
    commit,
    addFeature,
    removeFeature,
    moveFeature,
    patchFeatureProperties,
    undo,
    redo,
    markSaved,
    toSaveFc,
  };
}
