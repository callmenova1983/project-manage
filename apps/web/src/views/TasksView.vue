<script setup lang="ts">
import { provideTaskViewMemory } from "../composables/task-view-memory";
import { accountStorageKey } from "../services/account-storage";
import {
  ganttEnabled,
  taskLayouts,
  resolveTaskLayout,
} from "../services/task-layout";
import {
  computed,
  defineAsyncComponent,
  nextTick,
  provide,
  ref,
  watch,
} from "vue";
import { onBeforeRouteUpdate, useRoute, useRouter } from "vue-router";
import {
  PhMagnifyingGlass,
  PhPlus,
  PhFunnelSimple,
  PhSlidersHorizontal,
  PhList,
  PhKanban,
  PhCalendarBlank,
  PhX,
  PhLink,
} from "@phosphor-icons/vue";
import { useWorkspace } from "../stores/workspace";
import { type Task } from "../../../../packages/domain/types";
import { t, formatDate, formatNumber } from "../locales";
import { confirmDiscard } from "../composables/unsaved";
import { taskDetailsKey } from "../composables/task-details";
import {
  readTaskFilters,
  taskScopes,
  taskStates,
  selectedTaskState,
  taskStateFilter,
  type TaskFilters,
} from "../composables/task-focus";
import {
  activeTaskPreset,
  taskPresetQuery,
  type TaskPreset,
} from "../composables/task-presets";
import {
  createTaskViewIndex,
  taskAssigneeKey,
} from "../../../../packages/domain/task-view";
import {
  useCalendarNow,
  currentDay,
  currentWeek,
} from "../composables/calendar";
import { useViewPreferences } from "../composables/view-preferences";
import { taskViewLink } from "../services/task-view-link";
import TaskQueryEmpty from "../components/TaskQueryEmpty.vue";
import TaskSavedViews from "../components/TaskSavedViews.vue";
import TaskBoard from "../components/TaskBoard.vue";
import TaskCollectionList from "../components/TaskCollectionList.vue";
import TaskEditor from "../components/TaskEditor.vue";
import TaskDetailPanel from "../components/TaskDetailPanel.vue";
import WorkspaceDialog from "../components/WorkspaceDialog.vue";
import VoidedTasks from "../components/VoidedTasks.vue";
const TaskGantt = defineAsyncComponent(
  () => import("../components/TaskGantt.vue"),
);
const TaskBulkEdit = defineAsyncComponent(
  () => import("../components/TaskBulkEdit.vue"),
);
const bulkOpen = ref(false);
const TaskCalendar = defineAsyncComponent(
  () => import("../components/TaskCalendar.vue"),
);
const store = useWorkspace(),
  route = useRoute(),
  router = useRouter();
const filters = computed(() => readTaskFilters(route.query));
provideTaskViewMemory(() =>
  store.user
    ? accountStorageKey("task-view-memory", store.mode, store.user)
    : "signed-out",
);
const {
  preferences,
  error: preferenceError,
  save: savePreferences,
} = useViewPreferences();
const filterOpen = ref(false),
  settingsOpen = ref(false),
  creating = ref(false);
const settingsTarget = ref<HTMLElement | null>(null);
const creatingProject = ref("");
const savedTask = ref<Task | null>(null);
const detailId = ref("");
const searchInput = ref<HTMLInputElement | null>(null);
provide(taskDetailsKey, (id) => {
  detailId.value = id;
});
const detailNotice = computed(() =>
  detailId.value && !tasks.value.some((task) => task.id === detailId.value)
    ? t("This task is outside the current filters.")
    : "",
);
async function closeDetails() {
  detailId.value = "";
  await nextTick();
  if (!document.activeElement || document.activeElement === document.body)
    searchInput.value?.focus({ preventScroll: true });
}
const copyNotice = ref(""),
  copyError = ref("");
const layoutState = computed(() =>
  resolveTaskLayout(
    route.query.view ?? preferences.value.taskLayout,
    ganttEnabled,
  ),
);
const view = computed(() => layoutState.value.layout);
const unavailableLayout = computed(() => layoutState.value.unavailable);
const availableLayouts = taskLayouts(ganttEnabled);
const showVoided = computed(() => route.query.voided === "1");
const now = useCalendarNow();
const taskIndex = computed(() =>
  createTaskViewIndex(store.data.tasks, {
    now: now.value,
    members: store.data.members,
    timeZone: store.timeZone,
    actorId: store.user?.id,
  }),
);
const taskProjection = computed(() => taskIndex.value.project(filters.value));
const tasks = computed(() => taskProjection.value.matchedLeafTasks);
const voidedTasks = computed(() => taskIndex.value.selectVoided(filters.value));
const baseFilters: TaskFilters = {
  scope: "all",
  focus: "all",
  status: "",
  project: "",
  query: "",
};
const allTasks = computed(() => taskIndex.value.select(baseFilters));
const resultCount = computed(() =>
  showVoided.value ? voidedTasks.value.length : tasks.value.length,
);
const scopeCounts = computed(() =>
  Object.fromEntries(
    taskScopes.map((scope) => [
      scope,
      taskIndex.value.select({
        ...filters.value,
        scope,
        status: "",
        focus: "all",
      }).length,
    ]),
  ),
);
const stateCounts = computed(() => {
  const counts = taskIndex.value.project({
    ...filters.value,
    status: "",
    focus: "all",
  }).counts;
  return { ...counts, all: counts.total };
});
const assigneeOptions = computed(() => {
  const entries = new Map(
    (store.data.members ?? []).map((member) => [
      `member:${member.id}`,
      `${member.name} · ${member.email}`,
    ]),
  );
  for (const task of store.data.tasks) {
    const key = taskAssigneeKey(task);
    if (key !== "none" && !entries.has(key))
      entries.set(
        key,
        `${task.assignee || task.assigneeId} · ${t("Unlinked identity")}`,
      );
  }
  if (
    filters.value.assignee &&
    !["me", "none"].includes(filters.value.assignee) &&
    !entries.has(filters.value.assignee)
  )
    entries.set(filters.value.assignee, t("Unavailable assignee filter"));
  return [...entries].map(([value, label]) => ({ value, label }));
});
const scopeLabels = {
  today: "Planned today",
  week: "Planned this week",
  all: "All time",
};
const stateLabels: Record<string, string> = {
  all: "All",
  open: "Open work",
  todo: "To do",
  in_progress: "In progress",
  blocked: "Needs coordination",
  done: "Done",
};
const riskLabels: Record<string, string> = {
  overdue: "Overdue",
  blocked: "Needs coordination",
  unplanned: "Unplanned work",
};
const activeState = computed(() => selectedTaskState(filters.value));
const preset = computed(() => {
  if (showVoided.value) return "voided";
  const matched = activeTaskPreset(filters.value);
  if (matched) return matched;
  const f = filters.value;
  if (
    f.project ||
    f.projects !== undefined ||
    f.assignee ||
    f.risk ||
    f.query ||
    f.status
  )
    return "custom";
  if (f.scope === "all" && f.focus === "all") return "all";
  if (f.scope === "all" && f.focus === "open") return "team";
  if (f.scope === "week" && f.focus === "all") return "week";
  return "custom";
});
function changeFilters(patch: Partial<TaskFilters>, replace = false) {
  const next = { ...filters.value, ...patch };
  return router[replace ? "replace" : "push"]({
    query: {
      ...route.query,
      scope: next.scope,
      status: next.status || undefined,
      focus: next.focus === "all" ? undefined : next.focus,
      project: next.project || undefined,
      projects:
        next.projects === undefined
          ? undefined
          : next.projects.length
            ? [...next.projects]
            : [""],
      assignee: next.assignee || undefined,
      risk: next.risk || undefined,
      q: next.query || undefined,
      ...("status" in patch || "focus" in patch ? { voided: undefined } : {}),
    },
    hash: route.hash,
  });
}
function clearFilters() {
  void changeFilters({
    ...baseFilters,
    projects: undefined,
    assignee: "",
    risk: "",
  });
}
function chooseWorkView(event: Event) {
  const value = (event.target as HTMLSelectElement).value;
  if (["mine", "coordination", "overdue", "unassigned"].includes(value))
    void router.push({
      query: taskPresetQuery(value as TaskPreset, route.query),
      hash: "",
    });
  else if (["all", "team", "week"].includes(value))
    void changeFilters({
      ...baseFilters,
      scope: value === "week" ? "week" : "all",
      focus: value === "team" ? "open" : "all",
      projects: undefined,
      assignee: "",
      risk: "",
    });
}
const search = computed({
  get: () => filters.value.query,
  set: (query: string) => {
    void changeFilters({ query }, true);
  },
});
const project = computed({
  get: () => filters.value.project,
  set: (project: string) => {
    void changeFilters({ project });
  },
});
const assignee = computed({
  get: () => filters.value.assignee ?? "",
  set: (assignee: string) => {
    void changeFilters({ assignee });
  },
});
const risk = computed({
  get: () => filters.value.risk ?? "",
  set: (risk: string) => {
    void changeFilters({ risk });
  },
});
const filterState = computed({
  get: () => activeState.value,
  set: (state: (typeof taskStates)[number]) => {
    void changeFilters(taskStateFilter(state));
  },
});
const assigneeLabel = computed(() =>
  filters.value.assignee === "me"
    ? t("Assigned to me")
    : filters.value.assignee === "none"
      ? t("Unassigned")
      : (assigneeOptions.value.find(
          (option) => option.value === filters.value.assignee,
        )?.label ?? ""),
);
const activeFilters = computed(() => {
  const entries: { key: string; label: string; clear: () => void }[] = [];
  const add = (key: string, label: string, patch: Partial<TaskFilters>) =>
    entries.push({
      key,
      label,
      clear: () => {
        void changeFilters(patch);
      },
    });
  if (filters.value.scope !== "all")
    add("scope", t(scopeLabels[filters.value.scope]), { scope: "all" });
  if (filters.value.project)
    add(
      "project",
      t("Project") +
        ": " +
        (store.data.projects.find((p) => p.id === filters.value.project)
          ?.name ?? t("Project unavailable")),
      { project: "" },
    );
  if (filters.value.projects !== undefined)
    add(
      "projects",
      t("Project set: {count}", { count: filters.value.projects.length }),
      { projects: undefined },
    );
  if (filters.value.assignee)
    add("assignee", t("Assignee") + ": " + assigneeLabel.value, {
      assignee: "",
    });
  if (filters.value.status || filters.value.focus !== "all")
    add("status", t("Status") + ": " + t(stateLabels[activeState.value]!), {
      status: "",
      focus: "all",
    });
  if (filters.value.risk)
    add(
      "risk",
      t("Task risk") +
        ": " +
        t(riskLabels[filters.value.risk] ?? "Unavailable risk filter"),
      { risk: "" },
    );
  if (filters.value.query)
    add("query", t("Search") + ": " + filters.value.query, { query: "" });
  return entries;
});
const savedOutsideFilters = computed(
  () =>
    savedTask.value &&
    !tasks.value.some((task) => task.id === savedTask.value!.id),
);
const emptyTitle = computed(() => {
  if (!allTasks.value.length) return t("No tasks here yet");
  if (filters.value.assignee === "me")
    return t(
      filters.value.focus === "open"
        ? "No unfinished tasks assigned to you"
        : "No tasks assigned to you in this view",
    );
  if (activeFilters.value.length === 1 && filters.value.scope !== "all")
    return t(
      filters.value.scope === "today"
        ? "No work planned today"
        : "No work planned this week",
    );
  return t("No tasks match these filters");
});
const emptyDescription = computed(() => {
  if (!allTasks.value.length)
    return t("Create a task to start tracking work with your team.");
  if (filters.value.assignee === "me")
    return t(
      "Only tasks linked to your account appear in your work. You can remove this condition to see the team’s tasks.",
    );
  if (filters.value.scope !== "all")
    return t(
      "Work scopes use planned work dates, not due dates. Try all time or remove a condition.",
    );
  return t("Remove a condition or view all tasks to find the work you need.");
});
const unlinkedCount = computed(() =>
  filters.value.assignee === "me"
    ? allTasks.value.filter((task) => !task.assigneeId && task.assignee.trim())
        .length
    : 0,
);
const emptyProps = computed(() => ({
  title: emptyTitle.value,
  description: emptyDescription.value,
  unlinkedCount: unlinkedCount.value,
  hasTasks: !!allTasks.value.length,
  hasProjects: !!store.data.projects.length,
  hasFilters: !!activeFilters.value.length,
  mine: filters.value.assignee === "me",
}));
function startCreating() {
  if (!confirmDiscard()) return;
  creatingProject.value =
    filters.value.project ||
    (filters.value.projects?.length === 1 ? filters.value.projects[0]! : "");
  if (
    !store.data.projects.some((project) => project.id === creatingProject.value)
  )
    creatingProject.value = "";
  savedTask.value = null;
  creating.value = true;
}
function changeCreationProject(event: Event) {
  const select = event.target as HTMLSelectElement;
  if (confirmDiscard()) creatingProject.value = select.value;
  else select.value = creatingProject.value;
}
function saved(task: Task) {
  creating.value = false;
  creatingProject.value = "";
  savedTask.value = task;
}
function saveDefaultLayout() {
  if (savePreferences({ taskLayout: view.value }))
    store.notify(t("Default layout saved in this browser."));
}
async function copyLink() {
  copyNotice.value = copyError.value = "";
  const owner = route.fullPath;
  try {
    const href = taskViewLink(
      window.location.href,
      route.query,
      view.value,
      preferences.value,
      {
        scope: filters.value.scope,
        calendarMode: window.matchMedia("(max-width: 760px)").matches
          ? "agenda"
          : "month",
      },
    );
    await navigator.clipboard.writeText(href);
    if (route.fullPath === owner)
      copyNotice.value =
        "View link copied. Workspace access is still required.";
  } catch {
    copyError.value =
      "The link could not be copied. Copy the address from your browser.";
  }
}
watch(
  () => route.fullPath,
  () => {
    copyNotice.value = copyError.value = "";
  },
);
onBeforeRouteUpdate(() => confirmDiscard());
</script>
<template>
  <section class="page tasks-page">
    <div class="page-heading">
      <div class="task-heading-copy">
        <div class="task-heading-title">
          <h1>{{ t("Tasks") }}</h1>
          <span class="task-result-badge" role="status">{{
            formatNumber(resultCount)
          }}</span>
          <p class="page-subtitle">
            {{ showVoided ? t("Voided tasks") : t(scopeLabels[filters.scope])
            }}<template v-if="filters.scope !== 'all'">
              ·
              {{
                formatDate(
                  filters.scope === "today"
                    ? currentDay(now)
                    : currentWeek(now),
                )
              }}</template
            >
          </p>
        </div>
      </div>
      <button
        class="primary new-task"
        :disabled="!store.data.projects.length || creating"
        @click="startCreating"
      >
        <PhPlus :size="17" />{{ t("New task") }}
      </button>
    </div>
    <div class="tasks-toolbar">
      <select
        class="work-view-select"
        :value="preset"
        :aria-label="t('Work view')"
        @change="chooseWorkView"
      >
        <option value="all">{{ t("All tasks") }}</option>
        <option value="team">{{ t("Team open work") }}</option>
        <option value="mine">{{ t("My open tasks") }}</option>
        <option value="week">{{ t("This week's plan") }}</option>
        <option value="coordination">{{ t("Coordination this week") }}</option>
        <option value="overdue">{{ t("Overdue open tasks") }}</option>
        <option value="unassigned">{{ t("Unassigned open tasks") }}</option>
        <option v-if="preset === 'custom'" value="custom" disabled>
          {{ t("Custom view") }}
        </option>
        <option v-if="showVoided" value="voided" disabled>
          {{ t("Voided tasks") }}
        </option>
      </select>
      <label class="task-search"
        ><PhMagnifyingGlass :size="17" aria-hidden="true" /><input
          ref="searchInput"
          v-model="search"
          data-global-search
          type="search"
          :placeholder="t('Search tasks or assignees')"
          :aria-label="t('Search tasks')"
      /></label>
      <div class="task-toolbar-actions">
        <button
          :disabled="store.busy || showVoided || !tasks.length"
          @click="bulkOpen = true"
        >
          {{ t("Bulk edit tasks") }}
        </button>
        <div class="task-view-tabs" role="group" :aria-label="t('Task view')">
          <button
            v-for="mode in availableLayouts"
            :key="mode"
            :aria-pressed="view === mode"
            @click="
              router.push({
                query: { ...route.query, view: mode },
                hash: route.hash,
              })
            "
          >
            <component
              :is="
                mode === 'list'
                  ? PhList
                  : mode === 'board'
                    ? PhKanban
                    : PhCalendarBlank
              "
              :size="16"
              aria-hidden="true"
            /><span>{{
              t(
                mode === "list"
                  ? "List view"
                  : mode === "board"
                    ? "Board view"
                    : mode === "gantt"
                      ? "Gantt view"
                      : "Task calendar",
              )
            }}</span>
          </button>
        </div>
        <button
          class="task-filter-trigger"
          :aria-label="t('Filter tasks')"
          :aria-expanded="filterOpen"
          @click="filterOpen = true"
        >
          <PhFunnelSimple :size="17" aria-hidden="true" /><span>{{
            t("Filters")
          }}</span
          ><span v-if="activeFilters.length" class="filter-count">{{
            formatNumber(activeFilters.length)
          }}</span>
        </button>
        <button
          class="task-settings-trigger"
          :aria-label="t('View settings')"
          :title="t('View settings')"
          :aria-expanded="settingsOpen"
          @click="settingsOpen = true"
        >
          <PhSlidersHorizontal :size="18" aria-hidden="true" /><span
            class="settings-label"
            >{{ t("View settings") }}</span
          >
        </button>
      </div>
    </div>
    <div
      v-if="activeFilters.length || showVoided"
      class="active-task-filters"
      :aria-label="t('Active filters')"
    >
      <button
        v-for="filter in activeFilters"
        :key="filter.key"
        :aria-label="t('Remove filter') + ' ' + filter.label"
        @click="filter.clear"
      >
        <span>{{ filter.label }}</span
        ><PhX :size="12" aria-hidden="true" />
      </button>
      <button
        v-if="showVoided"
        @click="router.push({ query: { ...route.query, voided: undefined } })"
      >
        {{ t("Voided tasks") }}<PhX :size="12" />
      </button>
      <button class="clear-filters" @click="clearFilters">
        {{ t("Clear filters") }}
      </button>
    </div>
    <p v-if="unavailableLayout" class="task-notice" role="status">
      {{ t("The requested layout is unavailable; showing the list.") }}
    </p>
    <p v-if="preferenceError" class="error-box" role="alert">
      {{ t(preferenceError) }}
    </p>
    <div v-if="savedOutsideFilters" class="task-save-note" role="status">
      <span>{{ t("Task saved outside the current filters.") }}</span
      ><button class="text-button" @click="detailId = savedTask!.id">
        {{ t("View saved task") }}</button
      ><button
        class="text-button"
        :aria-label="t('Dismiss')"
        @click="savedTask = null"
      >
        <PhX :size="14" />
      </button>
    </div>
    <template v-if="showVoided"><VoidedTasks :tasks="voidedTasks" /></template>
    <TaskCollectionList
      v-else-if="view === 'list'"
      :tasks="tasks"
      :context-tasks="taskProjection.contextParents"
      show-project
      compact-controls
      :settings-target="settingsTarget"
      ><template #empty
        ><TaskQueryEmpty
          v-bind="emptyProps"
          @clear="clearFilters"
          @remove-assignee="changeFilters({ assignee: '' })"
          @create="startCreating" /></template
    ></TaskCollectionList>
    <TaskQueryEmpty
      v-else-if="!tasks.length"
      v-bind="emptyProps"
      @clear="clearFilters"
      @remove-assignee="changeFilters({ assignee: '' })"
      @create="startCreating"
    />
    <TaskBoard v-else-if="view === 'board'" :tasks="tasks" show-project />
    <TaskGantt v-else-if="view === 'gantt'" :tasks="tasks" />
    <TaskCalendar v-else :tasks="tasks" :work-scope="filters.scope" />
    <TaskDetailPanel
      :task-id="detailId"
      :notice="detailNotice"
      :fallback-focus="searchInput"
      @close="closeDetails"
    />
    <TaskBulkEdit v-if="bulkOpen" :tasks="tasks" @close="bulkOpen = false" />
    <WorkspaceDialog
      :open="filterOpen"
      :title="t('Filter tasks')"
      variant="sheet"
      @close="filterOpen = false"
    >
      <div class="task-filter-fields">
        <label
          >{{ t("Work scope")
          }}<select
            :value="filters.scope"
            :aria-label="t('Work scope')"
            @change="
              changeFilters({
                scope: ($event.target as HTMLSelectElement)
                  .value as TaskFilters['scope'],
              })
            "
          >
            <option v-for="scope in taskScopes" :key="scope" :value="scope">
              {{ t(scopeLabels[scope]) }} ·
              {{ formatNumber(scopeCounts[scope] ?? 0) }}
            </option>
          </select></label
        >
        <p class="field-hint">
          {{ t("Work scopes use planned work dates, not due dates.") }}
        </p>
        <label
          >{{ t("Status")
          }}<select v-model="filterState" :aria-label="t('Filter task status')">
            <option v-for="state in taskStates" :key="state" :value="state">
              {{ t(stateLabels[state]!) }} ·
              {{ formatNumber(stateCounts[state]) }}
            </option>
          </select></label
        >
        <label
          >{{ t("Project")
          }}<select v-model="project" :aria-label="t('Filter task project')">
            <option value="">{{ t("All projects") }}</option>
            <option v-for="p in store.data.projects" :key="p.id" :value="p.id">
              {{ p.name }}
            </option>
            <option
              v-if="
                filters.project &&
                !store.data.projects.some((p) => p.id === filters.project)
              "
              :value="filters.project"
            >
              {{ t("Project unavailable") }}
            </option>
          </select></label
        >
        <p v-if="filters.projects !== undefined" class="field-hint">
          {{
            t("This link limits work to {count} projects.", {
              count: filters.projects.length,
            })
          }}
          <button
            class="text-button"
            @click="changeFilters({ projects: undefined })"
          >
            {{ t("Clear project set") }}
          </button>
        </p>
        <label
          >{{ t("Assignee")
          }}<select v-model="assignee" :aria-label="t('Filter task assignee')">
            <option value="">{{ t("All assignees") }}</option>
            <option value="me">{{ t("Assigned to me") }}</option>
            <option value="none">{{ t("Unassigned") }}</option>
            <option
              v-for="option in assigneeOptions"
              :key="option.value"
              :value="option.value"
            >
              {{ option.label }}
            </option>
          </select></label
        >
        <label
          >{{ t("Task risk")
          }}<select v-model="risk" :aria-label="t('Filter task risk')">
            <option value="">{{ t("All task risks") }}</option>
            <option value="overdue">{{ t("Overdue") }}</option>
            <option value="unplanned">{{ t("Unplanned work") }}</option>
            <option v-if="risk === 'blocked'" value="blocked">
              {{ t("Needs coordination") }}
            </option>
            <option
              v-if="risk && !['overdue', 'blocked', 'unplanned'].includes(risk)"
              :value="risk"
            >
              {{ t("Unavailable risk filter") }}
            </option>
          </select></label
        >
        <button
          class="voided-filter"
          :aria-pressed="showVoided"
          @click="
            router.push({
              query: { ...route.query, voided: showVoided ? undefined : '1' },
            })
          "
        >
          {{ t("Voided tasks") }} · {{ formatNumber(voidedTasks.length) }}
        </button>
      </div>
      <template #footer
        ><button @click="clearFilters">{{ t("Clear filters") }}</button
        ><button class="primary" @click="filterOpen = false">
          {{ t("Show tasks") }} · {{ formatNumber(resultCount) }}
        </button></template
      >
    </WorkspaceDialog>
    <WorkspaceDialog
      :open="settingsOpen"
      :title="t('View settings')"
      variant="sheet"
      @close="confirmDiscard() && (settingsOpen = false)"
    >
      <div ref="settingsTarget" class="list-settings-target"></div>
      <p v-if="view !== 'list'" class="field-hint">
        {{
          t(
            "List columns, grouping and density are available in the list view.",
          )
        }}
      </p>
      <div class="view-preference-actions">
        <button @click="saveDefaultLayout">
          {{ t("Use current layout by default") }}
        </button>
        <p class="field-hint">
          {{ t("Private to this account in this browser.") }}
        </p>
      </div>
      <TaskSavedViews :layout="view" />
      <div class="share-view">
        <button @click="copyLink">
          <PhLink :size="16" />{{ t("Copy view link") }}
        </button>
        <p class="field-hint">
          {{
            t(
              "The link includes your filters and layout. “Me” refers to the person opening it.",
            )
          }}
        </p>
        <p v-if="copyNotice" role="status">{{ t(copyNotice) }}</p>
        <p v-if="copyError" class="error-box" role="alert">
          {{ t(copyError) }}
        </p>
      </div>
      <p class="field-hint">
        {{ store.timeZone }} ·
        {{ t("Parent rows provide context and are excluded from counts.") }}
      </p>
      <template #footer
        ><button
          class="primary"
          @click="confirmDiscard() && (settingsOpen = false)"
        >
          {{ t("Finish settings") }}
        </button></template
      >
    </WorkspaceDialog>
    <WorkspaceDialog
      :open="creating"
      :title="t('New task')"
      :busy="store.busy"
      @close="confirmDiscard() && (creating = false)"
    >
      <label class="creation-project"
        >{{ t("Project for new task")
        }}<select
          :value="creatingProject"
          :aria-label="t('Project for new task')"
          @change="changeCreationProject"
        >
          <option disabled value="">{{ t("Choose a project") }}</option>
          <option v-for="p in store.data.projects" :key="p.id" :value="p.id">
            {{ p.name }}
          </option>
        </select></label
      >
      <TaskEditor
        v-if="creating && creatingProject"
        progressive
        :key="creatingProject"
        :project-id="creatingProject"
        @close="creating = false"
        @saved="saved"
      />
      <p v-else class="field-hint">
        {{ t("Choose a project to create your task.") }}
      </p>
    </WorkspaceDialog>
  </section>
</template>
<style scoped>
.tasks-page {
  padding-top: 8px;
  padding-bottom: 28px;
}
.page-heading {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}
.task-heading-title {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.task-heading-title h1 {
  margin: 0;
  font-size: 25px;
  line-height: 1.35;
}
.task-result-badge {
  font-size: 13px;
  color: var(--muted);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 1px 7px;
}
.page-subtitle {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
}
.new-task {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 38px;
  flex: none;
}
.tasks-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}
.work-view-select {
  width: 170px;
  flex: none;
  min-height: 38px;
  font-size: 13px;
}
.task-search {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  padding-left: 10px;
  min-width: 150px;
  flex: 1;
  border: 1px solid var(--border);
  background: var(--surface);
  border-radius: 6px;
  color: var(--muted);
}
.task-search:focus-within {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.task-search input {
  min-width: 0;
  width: 100%;
  border: 0;
  background: transparent;
  box-shadow: none;
  outline: none;
  min-height: 36px;
  padding: 7px 8px 7px 0;
  font-size: 13px;
}
.task-toolbar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
}
.task-view-tabs {
  display: flex;
  align-items: center;
  padding: 3px;
  gap: 2px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 7px;
}
.task-view-tabs button {
  min-height: 30px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 9px;
  border: 0;
  background: transparent;
  color: var(--muted);
  font-size: 12px;
}
.task-view-tabs button[aria-pressed="true"] {
  background: var(--accent-bg);
  color: var(--accent);
}
.task-filter-trigger,
.task-settings-trigger {
  min-height: 38px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-size: 12px;
}
.filter-count {
  border-radius: 4px;
  padding: 0 4px;
  color: var(--accent);
  background: var(--accent-bg);
}
.active-task-filters {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0 0 12px;
}
.active-task-filters button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  min-height: 28px;
  padding: 3px 8px;
  font-size: 12px;
  background: var(--accent-bg);
  border-color: var(--accent-border);
  color: var(--accent);
}
.active-task-filters button span {
  overflow-wrap: anywhere;
}
.active-task-filters .clear-filters {
  background: transparent;
  border-color: transparent;
  color: var(--muted);
}
.task-filter-fields {
  display: grid;
  gap: 14px;
}
.task-filter-fields label,
.creation-project {
  display: grid;
  gap: 6px;
  font-size: 13px;
}
.task-filter-fields select,
.creation-project select {
  width: 100%;
  min-height: 44px;
}
.field-hint {
  margin: 6px 0;
  font-size: 12px;
  line-height: 1.7;
  color: var(--muted);
}
.task-filter-fields > .field-hint {
  margin-top: -10px;
}
.view-preference-actions,
.share-view {
  border-top: 1px solid var(--border);
  padding-top: 16px;
  margin-top: 18px;
}
.share-view > button {
  display: flex;
  align-items: center;
  gap: 6px;
}
.task-save-note {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 10px 12px;
  margin: 0 0 12px;
  background: var(--accent-bg);
  border: 1px solid var(--accent-border);
  border-radius: 6px;
  font-size: 13px;
}
.task-notice {
  font-size: 12px;
  color: var(--muted);
}
.creation-project {
  margin-bottom: 18px;
}
@media (max-width: 1150px) {
  .settings-label {
    display: none;
  }
  .task-settings-trigger {
    width: 38px;
    padding: 0;
  }
  .work-view-select {
    width: 150px;
  }
}
@media (max-width: 900px) and (min-width: 761px) {
  .tasks-toolbar {
    flex-wrap: wrap;
  }
  .task-toolbar-actions {
    margin-left: auto;
  }
  .task-search {
    min-width: 220px;
  }
}
@media (max-width: 760px) {
  .tasks-page {
    padding-top: 14px;
  }
  .page-heading {
    margin-bottom: 12px;
    gap: 10px;
  }
  .task-heading-title h1 {
    font-size: 23px;
  }
  .new-task {
    min-height: 44px;
    font-size: 13px;
    padding: 8px 12px;
  }
  .tasks-toolbar {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 8px;
    margin-bottom: 10px;
  }
  .work-view-select {
    width: 100%;
    min-height: 44px;
    font-size: 14px;
  }
  .task-search {
    grid-row: 2;
    grid-column: 1 / -1;
    min-width: 0;
  }
  .task-search input {
    min-height: 44px;
    font-size: 16px;
  }
  .task-toolbar-actions {
    display: contents;
  }
  .task-view-tabs {
    grid-row: 3;
    grid-column: 1 / -1;
    justify-content: center;
    border: 0;
    background: transparent;
    padding: 0;
    gap: 4px;
  }
  .task-view-tabs button {
    flex: 1;
    justify-content: center;
    min-height: 44px;
    font-size: 13px;
  }
  .task-filter-trigger {
    grid-column: 2;
    grid-row: 1;
    min-height: 44px;
  }
  .task-settings-trigger {
    grid-row: 2;
    grid-column: 2;
    z-index: 1;
    min-height: 44px;
    width: 44px;
    border: 0;
    background: transparent;
    margin-right: 1px;
  }
  .task-search input {
    padding-right: 48px;
  }
  .active-task-filters {
    gap: 4px;
    margin-bottom: 10px;
  }
  .active-task-filters button {
    min-height: 36px;
    font-size: 11px;
    padding: 4px 6px;
  }
}
</style>
