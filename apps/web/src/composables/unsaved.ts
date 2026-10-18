import { computed, inject, onBeforeUnmount, type Ref } from "vue";
import { onBeforeRouteLeave } from "vue-router";
import { t } from "../locales";
import { dialogContextKey } from "./dialog-context";
const editors = new Map<Ref<boolean>, (() => string) | undefined>();
const retainedEditors = new Map<Ref<boolean>, (() => string) | undefined>();
export function confirmRetainedDiscard() {
  const dirty = [...retainedEditors].find(([value]) => value.value);
  return (
    !dirty || window.confirm(dirty[1]?.() ?? t("Discard unsaved changes?"))
  );
}
export function hasUnsavedChanges() {
  return [...editors.keys()].some((dirty) => dirty.value);
}
export function confirmDiscard() {
  const active = [...editors].find(
    ([dirty, message]) => dirty.value && message,
  );
  return (
    !hasUnsavedChanges() ||
    window.confirm(active?.[1]?.() ?? t("Discard unsaved changes?"))
  );
}
export function useUnsaved(dirty: Ref<boolean>, leaveMessage?: () => string) {
  const dialog = inject(dialogContextKey, undefined);
  // A hidden, retained dialog keeps its draft during same-page editing.
  // Route changes and browser reloads still check the original dirty state.
  const editorDirty = dialog
    ? computed(() => !dialog.persistent && dirty.value && dialog.active.value)
    : dirty;
  editors.set(editorDirty, leaveMessage);
  retainedEditors.set(dialog?.persistent ? editorDirty : dirty, leaveMessage);
  const ask = () =>
    !dirty.value || window.confirm(t("Discard unsaved changes?"));
  if (!dialog?.persistent)
    onBeforeRouteLeave(
      () =>
        !dirty.value ||
        window.confirm(leaveMessage?.() ?? t("Discard unsaved changes?")),
    );
  const before = (e: BeforeUnloadEvent) => {
    if (!dialog?.persistent && dirty.value) {
      e.preventDefault();
      e.returnValue = "";
    }
  };
  window.addEventListener("beforeunload", before);
  onBeforeUnmount(() => {
    window.removeEventListener("beforeunload", before);
    editors.delete(editorDirty);
    retainedEditors.delete(dialog?.persistent ? editorDirty : dirty);
  });
  return ask;
}
