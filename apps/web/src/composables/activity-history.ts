import { computed, onBeforeUnmount, ref, watch } from "vue";
import { api } from "../services/api";
import { useWorkspace } from "../stores/workspace";
import type {
  ActivityQuery,
  ActivityPage,
} from "../../../../packages/domain/activity-query";
import type { Activity } from "../../../../packages/domain/types";

export function useActivityHistory(input: () => ActivityQuery) {
  const store = useWorkspace();
  const query = computed(input);
  const page = ref<ActivityPage | null>(null),
    events = ref<Activity[]>([]);
  const loading = ref(false),
    loadingMore = ref(false),
    error = ref("");
  const newChanges = ref(false);
  let generation = 0;
  async function refresh() {
    const request = ++generation;
    newChanges.value = false;
    page.value = null;
    events.value = [];
    error.value = "";
    loading.value = true;
    loadingMore.value = false;
    try {
      const result = await api.activityPage(query.value);
      if (request !== generation) return;
      page.value = result;
      events.value = result.events;
    } catch (e) {
      if (request === generation) error.value = (e as Error).message;
    } finally {
      if (request === generation) loading.value = false;
    }
  }
  async function more() {
    if (loading.value || loadingMore.value || !page.value?.nextCursor) return;
    const request = generation;
    loadingMore.value = true;
    error.value = "";
    try {
      const result = await api.activityPage({
        ...query.value,
        cursor: page.value.nextCursor,
      });
      if (request !== generation) return;
      page.value = result;
      const ids = new Set(events.value.map((a) => a.id));
      events.value.push(...result.events.filter((a) => !ids.has(a.id)));
    } catch (e) {
      if (request === generation) error.value = (e as Error).message;
    } finally {
      if (request === generation) loadingMore.value = false;
    }
  }
  watch(
    () => [JSON.stringify(query.value), store.data.revision, store.user?.id],
    (next, previous) => {
      if (
        previous &&
        next[0] === previous[0] &&
        next[2] === previous[2] &&
        events.value.length > (query.value.limit ?? 25)
      )
        newChanges.value = true;
      else void refresh();
    },
    { immediate: true },
  );
  onBeforeUnmount(() => generation++);
  return {
    page,
    events,
    loading,
    loadingMore,
    error,
    newChanges,
    refresh,
    more,
  };
}
