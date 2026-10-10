import { defineStore } from "pinia";
import { ref, computed } from "vue";
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
    loading = ref(false),
    error = ref(""),
    toast = ref(""),
    busy = ref(false),
    lastSynced = ref<Date | null>(null);
  let toastTimer: ReturnType<typeof setTimeout>;
  const total = computed(() => statistics(data.value.tasks)),
    week = computed(() => statistics(data.value.tasks, "week")),
    today = computed(() => statistics(data.value.tasks, "today"));
  const notify = (message: string) => {
    toast.value = message;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast.value = ""), 4500);
  };
  async function refresh(quiet = false) {
    if (!quiet) loading.value = true;
    try {
      const snapshot = await api.snapshot();
      data.value = snapshot;
      lastSynced.value = new Date();
      error.value = "";
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) user.value = null;
      else error.value = (e as Error).message;
    } finally {
      loading.value = false;
    }
  }
  async function initialize() {
    loading.value = true;
    try {
      user.value = (await api.session()).actor;
      await refresh();
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 401))
        error.value = (e as Error).message;
    } finally {
      loading.value = false;
    }
  }
  async function login(email: string, password: string) {
    user.value = (await api.login(email, password)).actor;
    await refresh();
  }
  async function logout() {
    await api.logout();
    user.value = null;
    data.value = {
      schemaVersion: 1,
      revision: 0,
      projects: [],
      tasks: [],
      activities: [],
    };
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
  const saveTask = (input: TaskInput, t?: Task) =>
    operation(
      () => api.saveTask(input, t?.id, t?.version),
      t ? "Task updated" : "Task created",
    );
  return {
    data,
    user,
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
  };
});
