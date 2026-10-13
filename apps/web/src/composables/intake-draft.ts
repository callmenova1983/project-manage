import { computed, onBeforeUnmount, ref, watch, type Ref } from "vue";
import type {
  IntakeCandidate,
  IntakeSource,
  IntakeField,
} from "../../../../packages/domain/intake";
import {
  clearIntakeDraft,
  readIntakeDraft,
  writeIntakeDraft,
} from "../services/intake-drafts";

export function useIntakeDraft(
  key: string,
  state: {
    step: Ref<"source" | "review" | "done">;
    text: Ref<string>;
    sources: Ref<IntakeSource[]>;
    sheetIndex: Ref<number>;
    source: Readonly<Ref<IntakeSource>>;
    mapping: Ref<IntakeField[]>;
    hasHeader: Ref<boolean>;
    candidates: Ref<IntakeCandidate[]>;
    confirmed: Ref<boolean>;
    dirty: Readonly<Ref<boolean>>;
  },
) {
  const recovery = ref(readIntakeDraft(key));
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
  let timer: ReturnType<typeof setTimeout> | undefined;
  function flush() {
    clearTimeout(timer);
    if (pending.value) return;
    if (!state.dirty.value || state.step.value === "done") {
      if (!clearIntakeDraft(key)) status.value = "unavailable";
      else status.value = "idle";
      return;
    }
    status.value = writeIntakeDraft(key, {
      version: 1,
      savedAt: Date.now(),
      step: state.step.value,
      source: state.source.value,
      fromFile: !!state.sources.value.length,
      mapping: state.mapping.value,
      hasHeader: state.hasHeader.value,
      candidates: state.step.value === "review" ? state.candidates.value : [],
    })
      ? "saved"
      : "unavailable";
  }
  watch(
    () => [
      state.step.value,
      state.source.value,
      state.mapping.value,
      state.hasHeader.value,
      state.candidates.value,
    ],
    () => {
      if (pending.value) return;
      status.value = "saving";
      clearTimeout(timer);
      timer = setTimeout(flush, 200);
    },
    { deep: true },
  );
  function restore() {
    if (recovery.value.kind !== "ready") return;
    const draft = recovery.value.draft;
    state.sources.value = draft.fromFile ? [draft.source] : [];
    state.text.value = draft.fromFile ? "" : draft.source.text;
    state.sheetIndex.value = 0;
    state.mapping.value = draft.mapping;
    state.hasHeader.value = draft.hasHeader;
    state.candidates.value = draft.candidates;
    state.confirmed.value = false;
    state.step.value = draft.step;
    recovery.value = { kind: "none" };
    flush();
  }
  function discard() {
    if (!clearIntakeDraft(key)) {
      status.value = "unavailable";
      return;
    }
    recovery.value = { kind: "none" };
    status.value = "idle";
  }
  window.addEventListener("pagehide", flush);
  // Persist before the browser's unload decision, including immediate reloads.
  window.addEventListener("beforeunload", flush);
  const hidden = () => {
    if (document.hidden) flush();
  };
  document.addEventListener("visibilitychange", hidden);
  onBeforeUnmount(() => {
    flush();
    window.removeEventListener("pagehide", flush);
    window.removeEventListener("beforeunload", flush);
    document.removeEventListener("visibilitychange", hidden);
  });
  return { recovery, pending, status, restore, discard, flush };
}
