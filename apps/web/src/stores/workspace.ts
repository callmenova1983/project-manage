import {
  emptyVersions,
  savedWorkspaceEntities,
  type WorkspaceCore,
  type ReceiptInput,
} from "../../../../packages/domain/workspace-sync";
import type {
  CompanyDirectory,
  ProjectMember,
} from "../../../../packages/domain/directory";
import type { Activity } from "../../../../packages/domain/types";
import type { ModelUsage } from "../../../../packages/domain/admin";
import { createWorkspaceSync } from "../services/workspace-sync";
import { useCalendarNow } from "../composables/calendar";
import type { TaskDependency } from "../../../../packages/domain/task-dependencies";
import {
  isActiveProject,
  projectLifecycleActions,
  type ProjectLifecycleInput,
} from "../../../../packages/domain/project-lifecycle";
import type { TaskMoveInput } from "../../../../packages/domain/task-move";
import type { TaskBulkUpdate } from "../../../../packages/domain/task-bulk-update";
import type {
  TaskSchedulePatch,
  TaskScheduleBatch,
} from "../../../../packages/domain/task-schedule-write";
import type { TaskReview } from "../../../../packages/domain/task-review";
import type {
  NotificationActionInput,
  NotificationPreferences,
  NotificationResponse,
} from "../../../../packages/domain/notifications";
import { workspaceTimeZone } from "../composables/calendar";
import { setCatalogs } from "../composables/catalogs";
import { defineStore } from "pinia";
import { ref, computed, nextTick, watch } from "vue";
import { accountStorageKey } from "../services/account-storage";
import { readFollowing } from "../services/project-following";
import {
  clearAccountEditorDrafts,
  editorDraftPrefix,
} from "../services/editor-drafts";
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
  const lightweight = import.meta.env.VITE_WORKSPACE_CORE !== "0";
  const versions = ref(emptyVersions());
  let coreLoaded = false,
    refreshFlight: Promise<boolean> | undefined,
    refreshAgain = false;
  const directory = ref<CompanyDirectory>();
  const projectMembers = ref<ProjectMember[]>([]);
  const receipts = ref<Activity[]>([]);
  const usage = ref<ModelUsage>();
  const resourceErrors = ref<Record<string, string>>({});
  const loadedProjects = new Set<string>();
  const resources = new Map<string, Promise<void>>();
  const resourceAgain = new Set<string>();
  const now = useCalendarNow();
  function stableEntities<T extends { id: string }>(
    previous: T[],
    incoming: T[],
  ): T[] {
    const byId = new Map(previous.map((item) => [item.id, item]));
    const result = incoming.map((item) => {
      const old = byId.get(item.id);
      return old && JSON.stringify(old) === JSON.stringify(item) ? old : item;
    });
    return previous.length === result.length &&
      result.every((item, index) => item === previous[index])
      ? previous
      : result;
  }
  function applyCore(core: WorkspaceCore) {
    data.value.projects = stableEntities(data.value.projects, core.projects);
    data.value.tasks = stableEntities(data.value.tasks, core.tasks);
    for (const key of [
      "schemaVersion",
      "revision",
      "catalogs",
      "settings",
      "members",
      "projectOrder",
    ] as const) {
      if (JSON.stringify(data.value[key]) !== JSON.stringify(core[key]))
        Object.assign(data.value, { [key]: core[key] });
    }
    setCatalogs(data.value.catalogs);
    workspaceTimeZone.value = data.value.settings?.timeZone ?? "UTC";
  }
  function resource(key: string, load: () => Promise<void>, fresh = false) {
    if (resources.has(key)) {
      if (fresh) resourceAgain.add(key);
      return resources.get(key)!;
    }
    const generation = sessionGeneration;
    const flight = (async () => {
      do {
        resourceAgain.delete(key);
        await load();
      } while (generation === sessionGeneration && resourceAgain.has(key));
    })()
      .then(() => {
        if (generation === sessionGeneration) delete resourceErrors.value[key];
      })
      .catch((reason) => {
        if (generation === sessionGeneration)
          resourceErrors.value[key] = (reason as Error).message;
        throw reason;
      })
      .finally(() => {
        if (resources.get(key) === flight) resources.delete(key);
      });
    resources.set(key, flight);
    return flight;
  }
  async function loadDirectory(force = false) {
    if (directory.value && !force) return;
    const generation = sessionGeneration;
    return resource(
      "directory",
      async () => {
        const value = await api.companyDirectory();
        if (generation === sessionGeneration) directory.value = value;
      },
      force,
    );
  }
  async function loadProjectMembers(id: string, force = false) {
    if (loadedProjects.has(id) && !force) return;
    const generation = sessionGeneration;
    return resource(
      `members:${id}`,
      async () => {
        const result = await api.projectMembers(id);
        if (generation !== sessionGeneration) return;
        projectMembers.value = [
          ...projectMembers.value.filter((member) => member.projectId !== id),
          ...result.members,
        ];
        loadedProjects.add(id);
      },
      force,
    );
  }
  async function loadReceipts(entities: ReceiptInput["entities"]) {
    const generation = sessionGeneration;
    // Bounded batches cover large bulk changes without downloading history.
    for (let offset = 0; offset < entities.length; offset += 200) {
      const found = await api.receipts({
        entities: entities.slice(offset, offset + 200),
      });
      if (generation !== sessionGeneration) return;
      receipts.value = stableEntities(
        receipts.value,
        [
          ...found,
          ...receipts.value.filter(
            (old) => !found.some((item) => item.id === old.id),
          ),
        ].slice(0, 1000),
      );
    }
  }
  async function refreshTaskReceipt() {
    const receipt = taskFeedback.value;
    if (!receipt) return;
    const generation = sessionGeneration;
    try {
      await loadReceipts([
        { kind: "task", id: receipt.task.id, version: receipt.task.version },
      ]);
    } catch (reason) {
      if (generation === sessionGeneration)
        taskFeedbackError.value = (reason as Error).message;
    }
  }
  async function loadUsage(fresh = false) {
    const generation = sessionGeneration;
    return resource(
      "usage",
      async () => {
        const result = await api.modelUsage();
        if (generation === sessionGeneration) usage.value = result;
      },
      fresh,
    );
  }
  const sync = createWorkspaceSync({
    local: api.mode === "local",
    meta: () => api.meta(),
    applied: () => versions.value,
    async apply(domain, version) {
      const generation = sessionGeneration;
      if (domain === "core") {
        if (!(await refresh(true)))
          throw new Error("Core synchronization failed");
        return;
      }
      if (domain === "directory" && directory.value) await loadDirectory(true);
      if (domain === "projectMembers")
        await Promise.all(
          [...loadedProjects].map((id) => loadProjectMembers(id, true)),
        );
      if (
        domain === "notifications" &&
        !(await refreshNotifications(true, true))
      )
        throw new Error("Notifications synchronization failed");
      if (domain === "usage") await loadUsage(true);
      if (generation === sessionGeneration) versions.value[domain] = version;
    },
    failure(reason) {
      if (reason instanceof ApiError && reason.status === 401) {
        clearWorkspace();
        sessionState.value = "signed_out";
      }
    },
  });
  let legacyTimer: ReturnType<typeof setInterval> | undefined;
  function stopSync() {
    sync.stop();
    if (legacyTimer) clearInterval(legacyTimer);
    legacyTimer = undefined;
  }
  function resumeSync() {
    if (!user.value || document.hidden) {
      stopSync();
      return;
    }
    if (!lightweight) {
      if (!legacyTimer)
        legacyTimer = setInterval(() => {
          void refresh(true);
          void refreshNotifications(true);
          void loadUsage().catch(() => {});
        }, 20000);
      return;
    }
    sync.start();
    void sync.calibrate();
  }
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
  const followedIds = ref<string[]>([]),
    preferenceError = ref("");
  const following = computed(() => new Set(followedIds.value));
  const notifications = ref<NotificationResponse | null>(null);
  const notificationLoading = ref(false);
  const notificationBusy = ref(false);
  const notificationError = ref("");
  const followingBusy = ref(false);
  let notificationRequest = 0;
  let legacyFollowingIds: string[] = [];
  let followingMigrationKey = "";
  watch(
    user,
    (actor) => {
      const loaded = actor
        ? readFollowing(accountStorageKey("following", api.mode, actor))
        : { ids: [], unavailable: false };
      followedIds.value = loaded.ids;
      legacyFollowingIds = loaded.ids;
      followingMigrationKey = actor
        ? accountStorageKey("following-migrated", api.mode, actor)
        : "";
      notifications.value = null;
      notificationError.value = "";
      notificationLoading.value = false;
      notificationBusy.value = false;
      followingBusy.value = false;
      notificationRequest++;
      preferenceError.value = loaded.unavailable
        ? "Following preferences are unavailable in this browser. You can still view every project."
        : "";
    },
    { flush: "sync" },
  );
  function receiveNotifications(result: NotificationResponse) {
    notifications.value = result;
    followedIds.value = result.followingIds;
    notificationError.value = "";
  }
  async function refreshNotifications(quiet = false, fresh = false) {
    return resource(
      "notifications",
      async () => {
        if (!(await fetchNotifications(quiet)))
          throw new Error(
            notificationError.value || "Notification synchronization pending",
          );
      },
      fresh,
    ).then(
      () => true,
      () => false,
    );
  }
  async function fetchNotifications(quiet = false) {
    if (!user.value || notificationBusy.value || followingBusy.value) return;
    const generation = sessionGeneration;
    const request = ++notificationRequest;
    if (!quiet || !notifications.value) notificationLoading.value = true;
    try {
      let result = await api.notifications();
      let migrated = false;
      try {
        migrated = localStorage.getItem(followingMigrationKey) === "1";
      } catch {
        // A failed browser cache must not prevent server-backed preferences.
      }
      if (generation !== sessionGeneration || request !== notificationRequest)
        return;
      if (!migrated && legacyFollowingIds.length) {
        const ids = legacyFollowingIds.filter((id) =>
          data.value.projects.some((project) => project.id === id),
        );
        if (ids.length)
          result = await api.saveNotificationFollowing({
            projectIds: ids,
            mode: "merge",
          });
      }
      if (generation !== sessionGeneration || request !== notificationRequest)
        return;
      try {
        localStorage.setItem(followingMigrationKey, "1");
      } catch {
        // Merge is idempotent if browser storage is unavailable next time.
      }
      legacyFollowingIds = [];
      receiveNotifications(result);
      preferenceError.value = "";
      return true;
    } catch (reason) {
      if (generation === sessionGeneration && request === notificationRequest)
        notificationError.value = (reason as Error).message;
    } finally {
      if (generation === sessionGeneration && request === notificationRequest)
        notificationLoading.value = false;
    }
  }
  async function toggleFollowing(id: string) {
    if (
      !user.value ||
      followingBusy.value ||
      !data.value.projects.some((p) => p.id === id)
    )
      return;
    const generation = sessionGeneration;
    const wasFollowing = following.value.has(id);
    const next = following.value.has(id)
      ? followedIds.value.filter((value) => value !== id)
      : [...followedIds.value, id];
    followedIds.value = next;
    followingBusy.value = true;
    notificationRequest++;
    try {
      // Read the current account subscriptions before replacing them so this
      // browser does not overwrite another device's older unseen additions.
      const current = await api.notifications();
      const ids = new Set(current.followingIds);
      if (wasFollowing) ids.delete(id);
      else ids.add(id);
      const result = await api.saveNotificationFollowing({
        projectIds: [...ids],
        mode: "replace",
      });
      if (generation !== sessionGeneration) return;
      receiveNotifications(result);
      preferenceError.value = "";
    } catch (reason) {
      if (generation !== sessionGeneration) return;
      followedIds.value = wasFollowing
        ? [...new Set([...followedIds.value, id])]
        : followedIds.value.filter((value) => value !== id);
      preferenceError.value = `关注未保存，请重试。${(reason as Error).message}`;
    } finally {
      if (generation === sessionGeneration) followingBusy.value = false;
    }
  }
  async function changeNotifications(input: NotificationActionInput) {
    if (!user.value || notificationBusy.value) return false;
    const generation = sessionGeneration;
    notificationBusy.value = true;
    notificationRequest++;
    try {
      const result = await api.notificationAction(input);
      if (generation !== sessionGeneration) return false;
      receiveNotifications(result);
      return true;
    } catch (reason) {
      if (generation === sessionGeneration)
        notificationError.value = (reason as Error).message;
      return false;
    } finally {
      if (generation === sessionGeneration) notificationBusy.value = false;
    }
  }
  async function saveNotificationPreferences(input: NotificationPreferences) {
    if (!user.value || notificationBusy.value) return false;
    const generation = sessionGeneration;
    notificationBusy.value = true;
    notificationRequest++;
    try {
      const result = await api.saveNotificationPreferences(input);
      if (generation !== sessionGeneration) return false;
      receiveNotifications(result);
      return true;
    } catch (reason) {
      if (generation === sessionGeneration)
        notificationError.value = (reason as Error).message;
      return false;
    } finally {
      if (generation === sessionGeneration) notificationBusy.value = false;
    }
  }
  const taskFeedback = ref<{
    kind?: "status" | "assignee";
    task: Task;
    previousStatus: Status;
    previousAssignee?: string;
    previousAssigneeId?: string | null;
    undone: boolean;
  } | null>(null);
  const taskFeedbackError = ref("");
  const changingTaskId = ref("");
  const undoActivity = computed(() => {
    const receipt = taskFeedback.value;
    return receipt && !receipt.undone
      ? receipts.value.find(
          (event) =>
            event.kind === "task" &&
            event.entityId === receipt.task.id &&
            event.after?.version === receipt.task.version &&
            event.before &&
            "status" in event.before &&
            (receipt.kind === "assignee"
              ? event.before.assignee === receipt.previousAssignee &&
                (event.before.assigneeId ?? null) ===
                  (receipt.previousAssigneeId ?? null)
              : event.before.status === receipt.previousStatus),
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
    stopSync();
    versions.value = emptyVersions();
    coreLoaded = false;
    refreshFlight = undefined;
    refreshAgain = false;
    directory.value = undefined;
    projectMembers.value = [];
    receipts.value = [];
    usage.value = undefined;
    loadedProjects.clear();
    resources.clear();
    resourceAgain.clear();
    resourceErrors.value = {};
    sessionGeneration++;
    snapshotRequest++;
    busy.value = false;
    changingTaskId.value = "";
    projectNavigation.value = initialProjectNavigation();
    dismissTaskFeedback();
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
    workspaceTimeZone.value = "UTC";
    lastSynced.value = null;
    toast.value = "";
    clearTimeout(toastTimer);
    error.value = "";
    loading.value = false;
  }
  const activeTasks = computed(() => {
    const ids = new Set(
      data.value.projects.filter(isActiveProject).map((p) => p.id),
    );
    return data.value.tasks.filter((t) => ids.has(t.projectId));
  });
  const total = computed(() => statistics(activeTasks.value)),
    week = computed(() =>
      statistics(activeTasks.value, "week", now.value, workspaceTimeZone.value),
    ),
    today = computed(() =>
      statistics(
        activeTasks.value,
        "today",
        now.value,
        workspaceTimeZone.value,
      ),
    );
  const notify = (message: string) => {
    if (message) dismissTaskFeedback();
    toast.value = message;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast.value = ""), 4500);
  };
  function refresh(quiet = false): Promise<boolean> {
    if (refreshFlight) {
      refreshAgain = true;
      return refreshFlight;
    }
    const generation = sessionGeneration;
    if (!quiet) loading.value = true;
    const flight = Promise.resolve().then(async () => {
      try {
        do {
          refreshAgain = false;
          const request = ++snapshotRequest;
          if (lightweight) {
            const result = await api.core(
              coreLoaded ? versions.value.core : undefined,
            );
            if (generation !== sessionGeneration) return false;
            if (request !== snapshotRequest) {
              refreshAgain = true;
              continue;
            }
            if (!result.unchanged) applyCore(result.core);
            versions.value.core = result.version;
            coreLoaded = true;
          } else {
            const snapshot = await api.snapshot();
            if (generation !== sessionGeneration) return false;
            if (request !== snapshotRequest) {
              refreshAgain = true;
              continue;
            }
            applyCore(snapshot);
            data.value.activities = snapshot.activities;
            receipts.value = snapshot.activities;
            directory.value = snapshot.directory;
            projectMembers.value = snapshot.projectMembers ?? [];
            versions.value.core = String(snapshot.revision);
          }
          lastSynced.value = new Date();
          error.value = "";
        } while (refreshAgain);
        return true;
      } catch (reason) {
        if (generation !== sessionGeneration) return false;
        if (reason instanceof ApiError && reason.status === 401) {
          clearWorkspace();
          sessionState.value = "signed_out";
        } else error.value = (reason as Error).message;
        return false;
      } finally {
        if (refreshFlight === flight) refreshFlight = undefined;
        if (generation === sessionGeneration) loading.value = false;
      }
    });
    refreshFlight = flight;
    return flight;
  }
  async function initialize() {
    if (sessionState.value === "checking") return;
    clearWorkspace();
    const generation = sessionGeneration;
    sessionState.value = "checking";
    loading.value = true;
    try {
      if (lightweight) {
        const result = await api.bootstrap();
        if (generation !== sessionGeneration) return;
        user.value = result.actor;
        applyCore(result.core);
        coreLoaded = true;
        versions.value = { ...result.versions, notifications: "", usage: "" };
        followedIds.value = result.followingIds;
        lastSynced.value = new Date();
      } else {
        const session = await api.session();
        if (generation !== sessionGeneration) return;
        user.value = session.actor;
        await refresh();
      }
      sessionState.value = "authenticated";
      resumeSync();
    } catch (e) {
      if (generation !== sessionGeneration) return;
      if (e instanceof ApiError && e.status === 401)
        sessionState.value = "signed_out";
      else {
        sessionState.value = "unavailable";
        error.value = (e as Error).message;
      }
    } finally {
      if (generation === sessionGeneration) loading.value = false;
    }
  }
  async function login(email: string, password: string) {
    const actor = (await api.login(email, password)).actor;
    clearWorkspace();
    user.value = actor;
    sessionState.value = "authenticated";
    await refresh();
    versions.value.notifications = "";
    versions.value.usage = "";
    resumeSync();
  }
  async function logout() {
    const draftKey = user.value && intakeDraftKey(api.mode, user.value);
    const editorPrefix = user.value && editorDraftPrefix(api.mode, user.value);
    await api.logout();
    clearWorkspace();
    sessionState.value = "signed_out";
    // Let the editor flush during unmount before removing this account's draft.
    await nextTick();
    if (draftKey) clearIntakeDraft(draftKey);
    if (editorPrefix && !clearAccountEditorDrafts(editorPrefix))
      error.value =
        "You are signed out, but this browser could not clear your editor drafts. Clear this site's browser data to remove them.";
  }
  async function operation<T>(
    fn: () => Promise<T>,
    message: string,
  ): Promise<T> {
    if (busy.value)
      throw new ApiError("Another change is being saved. Please wait.");
    busy.value = true;
    const generation = sessionGeneration;
    try {
      const result = await fn();
      if (generation !== sessionGeneration) return result;
      snapshotRequest++; // Invalidate reads started before this acknowledged mutation.
      // Merge acknowledged entities before resolving the save; calibration runs independently.
      const entities = savedWorkspaceEntities(result);
      for (const item of entities) {
        if ("projectId" in item) acceptTask(item as Task);
        else {
          const old = data.value.projects.find(
            (project) => project.id === item.id,
          );
          if (!old) data.value.projects.push(item as Project);
          else if (old.version <= item.version)
            data.value.projects = data.value.projects.map((project) =>
              project.id === item.id ? (item as Project) : project,
            );
        }
      }
      if (entities.length)
        void loadReceipts(
          entities.map((item) => ({
            kind: "projectId" in item ? "task" : "project",
            id: item.id,
            version: item.version,
          })),
        ).catch(() => {});
      if (generation === sessionGeneration) notify(message);
      void refresh(true);
      if (lightweight) sync.hint();
      else void refreshNotifications(true);
      return result;
    } finally {
      if (generation === sessionGeneration) busy.value = false;
    }
  }
  function saveProject(input: ProjectInput, p?: Project) {
    const generation = sessionGeneration;
    return operation(
      async () => {
        const saved = await api.saveProject(input, p?.id, p?.version);
        if (generation === sessionGeneration) {
          snapshotRequest++;
          const current = data.value.projects.find(
            (project) => project.id === saved.id,
          );
          if (!current) data.value.projects.push(saved);
          else if (current.version <= saved.version)
            data.value.projects = data.value.projects.map((project) =>
              project.id === saved.id ? saved : project,
            );
        }
        return saved;
      },
      p ? "Project updated" : "Project created",
    );
  }
  function projectWritable(id: string) {
    const project = data.value.projects.find((p) => p.id === id);
    return !!project && project.lifecycle !== "archived";
  }
  function changeProjectLifecycle(
    project: Project,
    input: Omit<ProjectLifecycleInput, "version">,
  ) {
    const generation = sessionGeneration;
    return operation(async () => {
      const saved = await api.changeProjectLifecycle(project.id, {
        ...input,
        version: project.version,
      });
      if (generation === sessionGeneration) {
        snapshotRequest++;
        data.value.projects = data.value.projects.map((p) =>
          p.id === saved.id && p.version <= saved.version ? saved : p,
        );
      }
      return saved;
    }, projectLifecycleActions[input.lifecycle]);
  }
  async function saveTaskDependencies(
    task: Task,
    dependencies: TaskDependency[],
  ) {
    const generation = sessionGeneration;
    return operation(async () => {
      const saved = await api.saveTaskDependencies(task.id, {
        version: task.version,
        dependencies,
      });
      if (generation === sessionGeneration) acceptTask(saved);
      return saved;
    }, "Task dependencies updated");
  }
  async function saveTaskSchedule(
    task: Task,
    patch: Omit<TaskSchedulePatch, "version">,
  ) {
    const generation = sessionGeneration;
    return operation(async () => {
      const saved = await api.saveTaskSchedule(task.id, {
        ...patch,
        version: task.version,
      });
      if (generation === sessionGeneration) acceptTask(saved);
      return saved;
    }, "Task schedule updated");
  }
  async function saveTaskScheduleBatch(input: TaskScheduleBatch) {
    const generation = sessionGeneration;
    return operation(async () => {
      const saved = await api.saveTaskScheduleBatch(input);
      if (generation === sessionGeneration)
        for (const task of saved) acceptTask(task);
      return saved;
    }, "Task schedules updated");
  }
  async function bulkUpdateTasks(input: TaskBulkUpdate) {
    const generation = sessionGeneration;
    return operation(async () => {
      const saved = await api.bulkUpdateTasks(input);
      if (generation === sessionGeneration)
        for (const task of saved) acceptTask(task);
      return saved;
    }, "Selected tasks updated");
  }
  async function saveTask(input: TaskInput, task?: Task) {
    const generation = sessionGeneration;
    const result = await operation(
      async () => {
        const saved = await api.saveTask(input, task?.id, task?.version);
        if (generation === sessionGeneration) acceptTask(saved);
        return saved;
      },
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
  async function moveTask(
    task: Task,
    placement: Omit<TaskMoveInput, "version">,
  ) {
    const generation = sessionGeneration;
    return operation(async () => {
      const saved = await api.moveTask(task.id, {
        ...placement,
        version: task.version,
      });
      if (generation === sessionGeneration)
        for (const item of saved) acceptTask(item);
      return saved;
    }, "Task moved");
  }
  function acceptTask(task: Task) {
    // Acknowledged writes can update all task summaries even if the following
    // snapshot fails. History is only shown after it is read from the API.
    snapshotRequest++;
    const current = data.value.tasks.find((old) => old.id === task.id);
    if (!current) {
      data.value.tasks.push(task);
      return;
    }
    if (
      current.version > task.version ||
      (current.version === task.version &&
        JSON.stringify(current) === JSON.stringify(task))
    )
      return;
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
      if (generation === sessionGeneration) changingTaskId.value = "";
    }
  }
  async function copyTaskAssignee(
    sourceId: string,
    sourceVersion: number,
    targetId: string,
    targetVersion: number,
  ) {
    if (busy.value) return;
    const source = data.value.tasks.find((task) => task.id === sourceId);
    const target = data.value.tasks.find((task) => task.id === targetId);
    if (
      !source ||
      !target ||
      source.version !== sourceVersion ||
      target.version !== targetVersion
    )
      throw new ApiError("人员或任务已更新，请重新拖拽。", 409);
    const generation = sessionGeneration;
    return operation(async () => {
      const result = await api.copyTaskField({
        sourceId,
        sourceVersion,
        field: "assignee",
        targets: [{ id: targetId, version: targetVersion }],
        overwriteConfirmed: true,
        acrossProjects: true,
      });
      const saved = result.find((task) => task.id === targetId);
      if (saved && generation === sessionGeneration) {
        acceptTask(saved);
        taskFeedback.value = {
          kind: "assignee",
          task: saved,
          previousStatus: target.status,
          previousAssignee: target.assignee,
          previousAssigneeId: target.assigneeId ?? null,
          undone: false,
        };
        taskFeedbackError.value = "";
      }
      return saved;
    }, "");
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
    coreVersion: computed(() => versions.value.core),
    directory,
    projectMembers,
    receipts,
    resourceErrors,
    usage,
    loadUsage,
    loadDirectory,
    loadProjectMembers,
    loadReceipts,
    refreshTaskReceipt,
    resumeSync,
    stopSync,
    following,
    followingBusy,
    toggleFollowing,
    notifications,
    notificationLoading,
    notificationBusy,
    notificationError,
    refreshNotifications,
    changeNotifications,
    saveNotificationPreferences,
    preferenceError,
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
    copyTaskAssignee,
    dismissTaskFeedback,
    total,
    week,
    today,
    mode: api.mode,
    timeZone: workspaceTimeZone,
    initialize,
    login,
    logout,
    refresh,
    notify,
    operation,
    saveProject,
    projectWritable,
    changeProjectLifecycle,
    saveTask,
    moveTask,
    saveTaskSchedule,
    saveTaskDependencies,
    saveTaskScheduleBatch,
    bulkUpdateTasks,
    taskReviews,
    queueTaskReview,
    dismissTaskReview,
  };
});
