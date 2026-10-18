import { shallowRef, type ShallowRef } from "vue";

/** Presentation state only, owned by one mounted collection; never persisted. */
export function createTaskViewMemory() {
  const entries = new Map<
    string,
    { value: ShallowRef<unknown>; initial: () => unknown }
  >();
  return {
    value<T>(key: string, initial: () => T): ShallowRef<T> {
      let entry = entries.get(key);
      if (!entry) {
        entry = { value: shallowRef(initial()), initial };
        entries.set(key, entry);
      }
      return entry.value as ShallowRef<T>;
    },
    reset() {
      for (const entry of entries.values()) entry.value.value = entry.initial();
    },
  };
}
