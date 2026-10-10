import { onBeforeUnmount, type Ref } from "vue";
import { onBeforeRouteLeave } from "vue-router";
const editors = new Set<Ref<boolean>>();
export function hasUnsavedChanges() {
  return [...editors].some((dirty) => dirty.value);
}
export function confirmDiscard() {
  return !hasUnsavedChanges() || window.confirm("Discard unsaved changes?");
}
export function useUnsaved(dirty: Ref<boolean>) {
  editors.add(dirty);
  const ask = () => !dirty.value || window.confirm("Discard unsaved changes?");
  onBeforeRouteLeave(() => ask());
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
