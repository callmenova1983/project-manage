import {
  computed,
  onBeforeUnmount,
  ref,
  shallowRef,
  watch,
  nextTick,
  type Ref,
} from "vue";
import type { z } from "zod";
import { useWorkspace } from "../stores/workspace";
import {
  clearEditorDraft,
  editorDraftKey,
  editorDraftPrefix,
  readEditorDraft,
  writeEditorDraft,
} from "../services/editor-drafts";
export function useEditorDraft<T>(config: {
  kind: "project" | "task" | "notes";
  projectId: string;
  entityId: string;
  parentId?: string;
  schema: z.ZodType<T>;
  value: Readonly<Ref<T>>;
  dirty: Readonly<Ref<boolean>>;
  baseVersion: () => number | null;
  currentVersion: () => number | null | undefined;
  restore: (value: T) => void;
}) {
  const store = useWorkspace(),
    prefix = editorDraftPrefix(store.mode, store.user!),
    key = editorDraftKey(
      prefix,
      config.kind,
      config.projectId,
      config.entityId,
      config.parentId,
    );
  const recovery = shallowRef(readEditorDraft(key, config.schema));
  const pending = computed(() =>
    ["ready", "invalid"].includes(recovery.value.kind),
  );
  const status = ref(
    recovery.value.kind === "unavailable"
      ? "unavailable"
      : recovery.value.kind === "expired"
        ? "expired"
        : "idle",
  );
  const checking = ref(false),
    problem = ref("");
  const preview = computed(() =>
    recovery.value.kind === "ready"
      ? JSON.stringify(recovery.value.draft.value, null, 2)
      : "",
  );
  let timer: ReturnType<typeof setTimeout> | undefined,
    alive = true,
    suppressed = false,
    attempted = false;
  function returnFocus() {
    const container = document.activeElement?.closest(".editor, .inline-notes");
    void nextTick(() => {
      if (container?.isConnected)
        container
          .querySelector<HTMLElement>(
            "input:not([disabled]), textarea:not([disabled]), select:not([disabled])",
          )
          ?.focus();
    });
  }
  function flush() {
    clearTimeout(timer);
    if (pending.value || suppressed) return;
    if (!config.dirty.value) {
      if (!clearEditorDraft(key)) status.value = "unavailable";
      else status.value = "idle";
      return;
    }
    status.value = writeEditorDraft(key, config.schema, {
      version: 1,
      savedAt: Date.now(),
      baseVersion: config.baseVersion(),
      attempted,
      value: config.value.value,
    })
      ? "saved"
      : "unavailable";
  }
  watch(
    config.value,
    () => {
      if (pending.value || suppressed) return;
      clearTimeout(timer);
      timer = setTimeout(flush, 200);
    },
    { deep: true },
  );
  async function restore() {
    if (recovery.value.kind !== "ready" || checking.value) return;
    const draft = recovery.value.draft;
    checking.value = true;
    problem.value = "";
    const refreshed = await store.refresh(true);
    if (
      !alive ||
      !store.user ||
      editorDraftPrefix(store.mode, store.user) !== prefix
    ) {
      checking.value = false;
      return;
    }
    if (!refreshed || store.error) {
      problem.value =
        "Could not check the latest version. Keep the draft and retry.";
      checking.value = false;
      return;
    }
    const current = config.currentVersion();
    if (current === undefined || current !== draft.baseVersion) {
      problem.value =
        "The item changed or is no longer available. This older draft stays read-only; copy anything you need, then discard it and edit the latest version.";
      checking.value = false;
      return;
    }
    if (draft.attempted && !config.entityId) {
      problem.value =
        "A save was attempted for this new item. Check the workspace for its result before starting again. This draft stays read-only to avoid duplicate creation.";
      checking.value = false;
      return;
    }
    config.restore(draft.value);
    attempted = false;
    recovery.value = { kind: "none" };
    checking.value = false;
    flush();
    returnFocus();
  }
  function discard() {
    clearTimeout(timer);
    if (!clearEditorDraft(key)) {
      status.value = "unavailable";
      return false;
    }
    recovery.value = { kind: "none" };
    problem.value = "";
    status.value = "idle";
    attempted = false;
    returnFocus();
    return true;
  }
  function complete(continueEditing = false) {
    suppressed = !continueEditing;
    attempted = false;
    clearTimeout(timer);
    status.value = "idle";
    if (!clearEditorDraft(key))
      store.preferenceError =
        "The item was saved, but this browser could not remove its old draft. Do not create it again; check the workspace first.";
  }
  function cancel() {
    if (!discard()) return false;
    suppressed = true;
    return true;
  }
  function beforeSave() {
    if (pending.value) return false;
    attempted = true;
    flush();
    return true;
  }
  window.addEventListener("beforeunload", flush);
  window.addEventListener("pagehide", flush);
  const hidden = () => {
    if (document.hidden) flush();
  };
  document.addEventListener("visibilitychange", hidden);
  onBeforeUnmount(() => {
    flush();
    alive = false;
    clearTimeout(timer);
    window.removeEventListener("beforeunload", flush);
    window.removeEventListener("pagehide", flush);
    document.removeEventListener("visibilitychange", hidden);
  });
  const notice = computed(() => ({
    pending: pending.value,
    status: status.value,
    checking: checking.value,
    problem: problem.value,
    preview: preview.value,
  }));
  return {
    pending,
    status,
    notice,
    restore,
    discard,
    complete,
    cancel,
    beforeSave,
    flush,
  };
}
