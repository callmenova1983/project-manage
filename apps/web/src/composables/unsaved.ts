import { onBeforeUnmount, type Ref } from "vue";
import { onBeforeRouteLeave } from "vue-router";
import { t } from "../locales";
const editors = new Map<Ref<boolean>, (() => string) | undefined>();
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
  editors.set(dirty, leaveMessage);
  const ask = () =>
    !dirty.value || window.confirm(t("Discard unsaved changes?"));
  onBeforeRouteLeave(
    () =>
      !dirty.value ||
      window.confirm(leaveMessage?.() ?? t("Discard unsaved changes?")),
  );
  const before = (e: BeforeUnloadEvent) => {
    if (dirty.value) {
      e.preventDefault();
      e.returnValue = "";
    }
  };
  window.addEventListener("beforeunload", before);
  onBeforeUnmount(() => {
    window.removeEventListener("beforeunload", before);
    editors.delete(dirty);
  });
  return ask;
}
