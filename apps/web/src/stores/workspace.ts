import type { TaskReview } from "../../../../packages/domain/task-review";
import { setCatalogs } from "../composables/catalogs";
import { defineStore } from "pinia";
import { ref, computed, nextTick } from "vue";
import { clearIntakeDraft, intakeDraftKey } from "../services/intake-drafts";
import { api, ApiError } from "../services/api";
import {
  statistics,
  type Snapshot,
  type Actor,
  type Project,
  type ProjectInput,
  type Task,
  type TaskInput,
} from "../../../../packages/domain/types";
export const useWorkspace = defineStore("workspace", () => {
  const data = ref<Snapshot>({
    schemaVersion: 1,
    revision: 0,
    projects: [],
    tasks: [],
    activities: [],
  });
  const user = ref<Actor | null>(null),
    sessionState = ref<
      "idle" | "checking" | "authenticated" | "signed_out" | "unavailable"
    >("idle"),
    loading = ref(false),
    error = ref(""),
    toast = ref(""),
    busy = ref(false),
    lastSynced = ref<Date | null>(null);
  let toastTimer: ReturnType<typeof setTimeout>;
  let sessionGeneration = 0;
  const taskReviews = ref<
    Record<
      string,
      {
        version: number;
        status: "pending" | "ready" | "failed";
        result?: TaskReview;
      }
    >
  >({});
  const reviewQueue: { task: Task; generation: number }[] = [];
  let reviewing = false;
  function queueTaskReview(task: Task) {
    taskReviews.value[task.id] = { version: task.version, status: "pending" };
    reviewQueue.push({ task, generation: sessionGeneration });
    void drainReviews();
  }
  async function drainReviews() {
    if (reviewing) return;
    reviewing = true;
    try {
      while (reviewQueue.length) {
        const { task, generation } = reviewQueue.shift()!;
        const isCurrent = () =>
          generation === sessionGeneration &&
          data.value.tasks.some(
            (t) => t.id === task.id && t.version === task.version,
          );
        if (!isCurrent()) continue;
        try {
          const result = await api.reviewTask(task.id, task.version);
          if (
            isCurrent() &&
            result.taskId === task.id &&
            result.version === task.version
          )
            taskReviews.value[task.id] = {
              version: task.version,
              status: "ready",
              result,
            };
        } catch {
          if (isCurrent())
            taskReviews.value[task.id] = {
              version: task.version,
              status: "failed",
            };
        }
      }
    } finally {
      reviewing = false;
    }
  }
  function dismissTaskReview(id: string) {
    delete taskReviews.value[id];
  }

  function clearWorkspace() {
    sessionGeneration++;
    taskReviews.value = {};
    reviewQueue.length = 0;
    user.value = null;
    data.value = {
      schemaVersion: 1,
      revision: 0,
      projects: [],
      tasks: [],
      activities: [],
    };
    setCatalogs();
    lastSynced.value = null;
    error.value = "";
    loading.value = false;
  }
  const total = computed(() => statistics(data.value.tasks)),
    week = computed(() => statistics(data.value.tasks, "week")),
    today = computed(() => statistics(data.value.tasks, "today"));
  const notify = (message: string) => {
    toast.value = message;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast.value = ""), 4500);
  };
  async function refresh(quiet = false) {
    const generation = sessionGeneration;
    if (!quiet) loading.value = true;
    try {
      const snapshot = await api.snapshot();
      if (generation !== sessionGeneration) return;
      data.value = snapshot;
      setCatalogs(snapshot.catalogs);
      lastSynced.value = new Date();
      error.value = "";
    } catch (e) {
      if (generation !== sessionGeneration) return;
      if (e instanceof ApiError && e.status === 401) {
        clearWorkspace();
        sessionState.value = "signed_out";
      } else error.value = (e as Error).message;
    } finally {
      if (generation === sessionGeneration) loading.value = false;
    }
  }
  async function initialize() {
    if (sessionState.value === "checking") return;
    clearWorkspace();
    sessionState.value = "checking";
    loading.value = true;
    try {
      user.value = (await api.session()).actor;
      sessionState.value = "authenticated";
      await refresh();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401)
        sessionState.value = "signed_out";
      else {
        sessionState.value = "unavailable";
        error.value = (e as Error).message;
      }
    } finally {
      loading.value = false;
    }
  }
  async function login(email: string, password: string) {
    const actor = (await api.login(email, password)).actor;
    clearWorkspace();
    user.value = actor;
    sessionState.value = "authenticated";
    await refresh();
  }
  async function logout() {
    const draftKey = user.value && intakeDraftKey(api.mode, user.value);
    await api.logout();
    clearWorkspace();
    sessionState.value = "signed_out";
    // Let the editor flush during unmount before removing this account's draft.
    await nextTick();
    if (draftKey) clearIntakeDraft(draftKey);
  }
  async function operation<T>(
    fn: () => Promise<T>,
    message: string,
  ): Promise<T> {
    if (busy.value)
      throw new ApiError("Another change is being saved. Please wait.");
    busy.value = true;
    try {
      const result = await fn();
      await refresh(true);
      notify(message);
      return result;
    } finally {
      busy.value = false;
    }
  }
  const saveProject = (input: ProjectInput, p?: Project) =>
    operation(
      () => api.saveProject(input, p?.id, p?.version),
      p ? "Project updated" : "Project created",
    );
  async function saveTask(input: TaskInput, task?: Task) {
    const generation = sessionGeneration;
    const result = await operation(
      () => api.saveTask(input, task?.id, task?.version),
      task ? "Task updated" : "Task created",
    );
    if (
      generation === sessionGeneration &&
      (!task ||
        input.title !== task.title ||
        input.description !== task.description)
    )
      queueTaskReview(result);
    return result;
  }
  return {
    data,
    user,
    sessionState,
    loading,
    error,
    toast,
    busy,
    lastSynced,
    total,
    week,
    today,
    mode: api.mode,
    initialize,
    login,
    logout,
    refresh,
    notify,
    operation,
    saveProject,
    saveTask,
    taskReviews,
    queueTaskReview,
    dismissTaskReview,
  };
});
