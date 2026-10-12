import { setCatalogs } from "../composables/catalogs";
import { defineStore } from "pinia";
import { ref, computed, nextTick } from "vue";
import { clearIntakeDraft, intakeDraftKey } from "../services/intake-drafts";
import { initialProjectNavigation } from "../composables/project-navigation";
import { api, ApiError } from "../services/api";
import {
  statistics,
  taskInput,
  type Status,
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
  let snapshotRequest = 0;
  const projectNavigation = ref(initialProjectNavigation());
  const taskFeedback = ref<{
    task: Task;
    previousStatus: Status;
    undone: boolean;
  } | null>(null);
  const taskFeedbackError = ref("");
  const changingTaskId = ref("");
  const undoActivity = computed(() => {
    const receipt = taskFeedback.value;
    return receipt && !receipt.undone
      ? data.value.activities.find(
          (event) =>
            event.kind === "task" &&
            event.entityId === receipt.task.id &&
            event.after?.version === receipt.task.version &&
            event.before &&
            "status" in event.before &&
            event.before.status === receipt.previousStatus,
        )
      : undefined;
  });
  const undoState = computed(() => {
    const receipt = taskFeedback.value;
    if (!receipt || receipt.undone) return "done";
    const current = data.value.tasks.find(
      (task) => task.id === receipt.task.id,
    );
    if (!current || current.version !== receipt.task.version) return "changed";
    return undoActivity.value ? "ready" : "sync";
  });
  function dismissTaskFeedback() {
    taskFeedback.value = null;
    taskFeedbackError.value = "";
  }
  function clearWorkspace() {
    sessionGeneration++;
    snapshotRequest++;
    projectNavigation.value = initialProjectNavigation();
    dismissTaskFeedback();
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
    if (message) dismissTaskFeedback();
    toast.value = message;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast.value = ""), 4500);
  };
  async function refresh(quiet = false) {
    const generation = sessionGeneration;
    const request = ++snapshotRequest;
    if (!quiet) loading.value = true;
    try {
      const snapshot = await api.snapshot();
      if (generation !== sessionGeneration || request !== snapshotRequest)
        return;
      data.value = snapshot;
      setCatalogs(snapshot.catalogs);
      lastSynced.value = new Date();
      error.value = "";
    } catch (e) {
      if (generation !== sessionGeneration || request !== snapshotRequest)
        return;
      if (e instanceof ApiError && e.status === 401) {
        clearWorkspace();
        sessionState.value = "signed_out";
      } else error.value = (e as Error).message;
    } finally {
      if (generation === sessionGeneration && request === snapshotRequest)
        loading.value = false;
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
  const saveTask = (input: TaskInput, t?: Task) =>
    operation(
      () => api.saveTask(input, t?.id, t?.version),
      t ? "Task updated" : "Task created",
    );
  function acceptTask(task: Task) {
    // Acknowledged writes can update all task summaries even if the following
    // snapshot fails. History is only shown after it is read from the API.
    snapshotRequest++;
    data.value.tasks = data.value.tasks.map((old) =>
      old.id === task.id ? task : old,
    );
  }
  async function changeTaskStatus(task: Task, status: Status) {
    if (busy.value || task.status === status) return;
    if (data.value.tasks.some((child) => child.parentId === task.id))
      throw new ApiError("Complete the subtasks individually.");
    const generation = sessionGeneration;
    changingTaskId.value = task.id;
    try {
      await operation(async () => {
        const saved = await api.saveTask(
          { ...taskInput.strip().parse(task), status },
          task.id,
          task.version,
        );
        if (generation !== sessionGeneration) return saved;
        acceptTask(saved);
        taskFeedback.value = {
          task: saved,
          previousStatus: task.status,
          undone: false,
        };
        taskFeedbackError.value = "";
        return saved;
      }, "");
    } finally {
      changingTaskId.value = "";
    }
  }
  async function undoTaskStatus() {
    if (busy.value || !taskFeedback.value || taskFeedback.value.undone) return;
    const receipt = taskFeedback.value,
      activity = undoActivity.value;
    if (undoState.value !== "ready" || !activity) return;
    const generation = sessionGeneration;
    taskFeedbackError.value = "";
    try {
      await operation(async () => {
        // Use the version we saved, never the latest observed version. A later
        // edit must block undo rather than silently restoring over it.
        const restored = await api.restore(activity.id, receipt.task.version);
        if (generation === sessionGeneration && "projectId" in restored) {
          acceptTask(restored);
          taskFeedback.value = { ...receipt, task: restored, undone: true };
        }
        return restored;
      }, "");
    } catch (e) {
      if (generation !== sessionGeneration) return;
      taskFeedbackError.value =
        e instanceof ApiError && e.status === 409
          ? "This task changed after your action. Review its current state before editing."
          : (e as Error).message;
      await refresh(true);
    }
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
    projectNavigation,
    taskFeedback,
    taskFeedbackError,
    changingTaskId,
    undoState,
    changeTaskStatus,
    undoTaskStatus,
    dismissTaskFeedback,
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
