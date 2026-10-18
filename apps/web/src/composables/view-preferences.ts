import { computed, ref, watch } from "vue";
import { useWorkspace } from "../stores/workspace";
import { accountStorageKey } from "../services/account-storage";
import {
  defaultViewPreferences,
  readViewPreferences,
  writeViewPreferences,
  type ViewPreferences,
} from "../services/view-preferences";
export function useViewPreferences() {
  const store = useWorkspace();
  const preferences = ref(defaultViewPreferences());
  const error = ref("");
  const key = computed(() =>
    store.user
      ? accountStorageKey("view-preferences", store.mode, store.user)
      : "",
  );
  watch(
    key,
    (value) => {
      preferences.value = defaultViewPreferences();
      error.value = "";
      if (!value) return;
      try {
        const result = readViewPreferences(localStorage, value);
        preferences.value = result.value;
        error.value = result.error;
      } catch {
        error.value = "View preferences could not be saved in this browser.";
      }
    },
    { immediate: true, flush: "sync" },
  );
  function save(patch: Partial<Omit<ViewPreferences, "version">>): boolean {
    if (!key.value) return false;
    try {
      const latest = readViewPreferences(localStorage, key.value);
      const value = { ...latest.value, ...patch };
      error.value = writeViewPreferences(localStorage, key.value, value);
      if (error.value) return false;
      preferences.value = value;
      return true;
    } catch {
      error.value = "View preferences could not be saved in this browser.";
      return false;
    }
  }
  return { preferences, error, save };
}
