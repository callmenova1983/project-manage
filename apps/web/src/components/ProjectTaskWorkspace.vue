<script setup lang="ts">
import { provideTaskViewMemory } from "../composables/task-view-memory";
import { accountStorageKey } from "../services/account-storage";
import {
  ganttEnabled,
  taskLayouts,
  resolveTaskLayout,
} from "../services/task-layout";
import TaskSavedViews from "./TaskSavedViews.vue";
import TaskPresetBar from "./TaskPresetBar.vue";
import { useViewPreferences } from "../composables/view-preferences";
import {
  computed,
  defineAsyncComponent,
  nextTick,
  provide,
  ref,
  watch,
} from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  createTaskViewIndex,
  taskAssigneeKey,
} from "../../../../packages/domain/task-view";
import { statuses } from "../../../../packages/domain/types";
import {
  readProjectTaskFilters,
  taskScopes,
  type TaskFilters,
} from "../composables/task-focus";
import { useCalendarNow } from "../composables/calendar";
import { useWorkspace } from "../stores/workspace";
import { t, formatNumber } from "../locales";
import {
  PhPlus,
  PhFunnelSimple,
  PhSlidersHorizontal,
  PhCaretDown,
  PhX,
} from "@phosphor-icons/vue";
import WorkspaceDialog from "./WorkspaceDialog.vue";
import TaskQuickAdd from "./TaskQuickAdd.vue";
import PasteTasks from "./PasteTasks.vue";
import { confirmDiscard } from "../composables/unsaved";
import { taskDetailsKey } from "../composables/task-details";
import TaskCollectionList from "./TaskCollectionList.vue";
import TaskDetailPanel from "./TaskDetailPanel.vue";
const TaskGantt = defineAsyncComponent(() => import("./TaskGantt.vue"));
const TaskBulkEdit = defineAsyncComponent(() => import("./TaskBulkEdit.vue"));
const bulkOpen = ref(false);
const TaskCalendar = defineAsyncComponent(() => import("./TaskCalendar.vue"));
const TaskBoard = defineAsyncComponent(() => import("./TaskBoard.vue"));
const props = defineProps<{ projectId: string }>();
const route = useRoute(),
  router = useRouter(),
  store = useWorkspace();
provideTaskViewMemory(
  () =>
    `${store.user ? accountStorageKey("task-view-memory", store.mode, store.user) : "signed-out"}:${props.projectId}`,
);
const filterOpen = ref(false),
  settingsOpen = ref(false),
  adding = ref(false),
  paste = ref(false),
  createMenu = ref(false);
const settingsTarget = ref<HTMLElement | null>(null);
const searchInput = ref<HTMLInputElement | null>(null);
const openedTaskId = ref("");
provide(taskDetailsKey, (id) => {
  if (
    store.data.tasks.some(
      (task) => task.id === id && task.projectId === props.projectId,
    )
  )
    openedTaskId.value = id;
});
watch([() => props.projectId, () => route.hash], () => {
  openedTaskId.value = "";
});
const activeFilters = computed(() => [
  ...(filters.value.scope !== "all"
    ? [
        {
          key: "scope",
          label: t(scopeLabels[filters.value.scope]),
          clear: () => change({ scope: "all" }),
        },
      ]
    : []),
  ...(filters.value.status || filters.value.focus === "done"
    ? [
        {
          key: "status",
          label: t(
            {
              todo: "To do",
              in_progress: "In progress",
              done: "Done",
              blocked: "Needs coordination",
            }[filters.value.status || "done"],
          ),
          clear: () => change({ status: "", focus: "all" }),
        },
      ]
    : []),
  ...(filters.value.assignee
    ? [
        {
          key: "assignee",
          label:
            t("Assignee") +
            ": " +
            (filters.value.assignee === "me"
              ? t("Assigned to me")
              : filters.value.assignee === "none"
                ? t("Unassigned")
                : assignees.value.find(
                    ([key]) => key === filters.value.assignee,
                  )?.[1] || filters.value.assignee),
          clear: () => change({ assignee: "" }),
        },
      ]
    : []),
  ...(filters.value.risk
    ? [
        {
          key: "risk",
          label: t(
            (
              {
                overdue: "Overdue",
                unplanned: "Unplanned",
                blocked: "Needs coordination",
              } as Record<string, string>
            )[filters.value.risk] || "Unavailable risk filter",
          ),
          clear: () => change({ risk: "" }),
        },
      ]
    : []),
]);
function clearFilters() {
  change({
    scope: "all",
    status: "",
    focus: "all",
    assignee: "",
    risk: "",
    query: "",
  });
}
function newTask() {
  if (confirmDiscard()) {
    createMenu.value = false;
    adding.value = true;
  }
}
const now = useCalendarNow();
const filters = computed(() =>
  readProjectTaskFilters(route.query, props.projectId),
);
const index = computed(() =>
  createTaskViewIndex(store.data.tasks, {
    now: now.value,
    timeZone: store.timeZone,
    members: store.data.members,
    actorId: store.user?.id,
  }),
);
const projection = computed(() => index.value.project(filters.value));
const counts = computed(
  () =>
    index.value.project({ ...filters.value, status: "", focus: "all" }).counts,
);
const stageHighlight = computed(() => {
  const stage = store.data.projects.find(
    (project) => project.id === props.projectId,
  )?.stage;
  const candidates =
    stage === "implementation"
      ? [
          ["blocked", "Needs coordination"],
          ["overdue", "Overdue"],
        ]
      : stage === "operations"
        ? [["", "Open work"]]
        : stage === "approved"
          ? [["unassigned", "Unassigned"]]
          : [
              ["unplanned", "Needs scheduling"],
              ["blocked", "Needs coordination"],
            ];
  for (const [risk, label] of candidates) {
    const patch: Partial<TaskFilters> = {
      scope: "all",
      status: "",
      focus: "open",
      assignee: risk === "unassigned" ? "none" : "",
      risk: risk === "unassigned" ? "" : risk,
      query: "",
    };
    const count = index.value.project({ ...filters.value, ...patch }).counts
      .total;
    if (count) return { label: t(label!), count, patch };
  }
  return undefined;
});
const {
  preferences,
  error: preferenceError,
  save: savePreferences,
} = useViewPreferences();
const layoutState = computed(() =>
  resolveTaskLayout(
    route.query.view ?? preferences.value.projectTaskLayout,
    ganttEnabled,
  ),
);
const view = computed(() => layoutState.value.layout);
const unavailableLayout = computed(() => layoutState.value.unavailable);
const availableLayouts = taskLayouts(ganttEnabled);
function saveDefaultLayout() {
  if (savePreferences({ projectTaskLayout: view.value }))
    store.notify(t("Default layout saved in this browser."));
}

const assignees = computed(() => {
  const names = new Map(
    (store.data.members ?? []).map((member) => [
      `member:${member.id}`,
      `${member.name} · ${member.email}`,
    ]),
  );
  for (const task of store.data.tasks) {
    const key = taskAssigneeKey(task);
    if (task.projectId === props.projectId && key !== "none" && !names.has(key))
      names.set(key, task.assignee || t("Unavailable assignee filter"));
  }
  if (
    filters.value.assignee &&
    !["me", "none"].includes(filters.value.assignee) &&
    !names.has(filters.value.assignee)
  )
    names.set(filters.value.assignee, t("Unavailable assignee filter"));
  return [...names];
});
function change(
  patch: Partial<TaskFilters> & { view?: string },
  replace = false,
) {
  const next = { ...filters.value, ...patch };
  void router[replace ? "replace" : "push"]({
    query: {
      ...route.query,
      scope: next.scope,
      status: next.status || undefined,
      focus: next.focus === "all" ? undefined : next.focus,
      q: next.query || undefined,
      assignee: next.assignee || undefined,
      risk: next.risk || undefined,
      ...(patch.view ? { view: patch.view } : {}),
    },
    hash: route.hash,
  });
}
const search = computed({
  get: () => filters.value.query,
  set: (query) => change({ query }, true),
});
const scopeLabels = { all: "All time", today: "Today", week: "This week" };
const linkedId = computed(() => {
  if (!route.hash.startsWith("#task-")) return "";
  try {
    return decodeURIComponent(route.hash.slice(6));
  } catch {
    return "";
  }
});
const linkedTask = computed(() =>
  store.data.tasks.find(
    (task) => task.id === linkedId.value && task.projectId === props.projectId,
  ),
);
const detailId = computed(
  () => openedTaskId.value || linkedTask.value?.id || "",
);
const detailNotice = computed(() => {
  if (
    !detailId.value ||
    projection.value.matchedLeafTasks.some((task) => task.id === detailId.value)
  )
    return "";
  return t(
    openedTaskId.value
      ? "This task is outside the current filters."
      : "The linked task is outside the current filters and is shown separately.",
  );
});
async function closeDetails() {
  openedTaskId.value = "";
  if (linkedId.value) await router.replace({ query: route.query, hash: "" });
  await nextTick();
  if (!document.activeElement || document.activeElement === document.body)
    searchInput.value?.focus({ preventScroll: true });
}
</script>
<template>
  <div class="project-task-workspace">
    <div class="workspace-toolbar-primary">
      <div class="task-layout-switch" role="group" :aria-label="t('Task view')">
        <button
          v-for="layout in availableLayouts"
          :key="layout"
          :aria-pressed="view === layout"
          @click="change({ view: layout })"
        >
          {{
            t(
              layout === "list"
                ? "List view"
                : layout === "board"
                  ? "Board view"
                  : layout === "gantt"
                    ? "Gantt view"
                    : "Task calendar",
            )
          }}
        </button>
      </div>
      <button
        v-if="stageHighlight"
        class="stage-highlight"
        :aria-label="t('Stage focus') + ': ' + stageHighlight.label"
        @click="change(stageHighlight.patch)"
      >
        {{ stageHighlight.label }} <span>{{ stageHighlight.count }}</span>
      </button>
      <span class="toolbar-spacer"></span>
      <button
        :disabled="store.busy || !projection.matchedLeafTasks.length"
        @click="bulkOpen = true"
      >
        {{ t("Bulk edit tasks") }}
      </button>
      <div class="create-actions">
        <button class="primary new-task" @click="newTask">
          <PhPlus :size="17" />{{ t("New task") }}
        </button>
        <button
          class="primary create-menu-trigger"
          :aria-label="t('More task creation options')"
          :aria-expanded="createMenu"
          @click="createMenu = true"
        >
          <PhCaretDown :size="16" />
        </button>
      </div>
    </div>
    <div class="workspace-toolbar-secondary">
      <input
        ref="searchInput"
        v-model="search"
        type="search"
        :aria-label="t('Search tasks')"
        :placeholder="t('Search tasks')"
      />
      <div
        class="task-focus-switch"
        role="group"
        :aria-label="t('Filter tasks')"
      >
        <button
          :aria-pressed="!filters.status && filters.focus === 'all'"
          @click="change({ status: '', focus: 'all' })"
        >
          {{ t("All") }} {{ formatNumber(counts.total) }}
        </button>
        <button
          :aria-pressed="!filters.status && filters.focus === 'open'"
          @click="change({ status: '', focus: 'open' })"
        >
          {{ t("Open work") }} {{ formatNumber(counts.open) }}
        </button>
      </div>
      <button
        class="filter-trigger"
        :aria-label="t('Filter tasks')"
        :aria-expanded="filterOpen"
        @click="filterOpen = true"
      >
        <PhFunnelSimple :size="17" /><span>{{ t("Filters") }}</span
        ><span v-if="activeFilters.length" class="filter-count">{{
          activeFilters.length
        }}</span>
      </button>
      <button
        class="settings-trigger"
        :aria-label="t('View settings')"
        :aria-expanded="settingsOpen"
        @click="settingsOpen = true"
      >
        <PhSlidersHorizontal :size="17" /><span>{{ t("View settings") }}</span>
      </button>
    </div>
    <div
      v-if="activeFilters.length"
      class="active-task-filters"
      :aria-label="t('Active filters')"
    >
      <button
        v-for="filter in activeFilters"
        :key="filter.key"
        :aria-label="t('Remove filter') + ' ' + filter.label"
        @click="filter.clear"
      >
        {{ filter.label }}<PhX :size="12" />
      </button>
      <button class="text-button" @click="clearFilters">
        {{ t("Clear filters") }}
      </button>
    </div>
    <p v-if="unavailableLayout" class="list-footnote" role="status">
      {{ t("The requested layout is unavailable; showing the list.") }}
    </p>
    <p v-if="preferenceError" class="error-box" role="alert">
      {{ t(preferenceError) }}
    </p>
    <p v-if="linkedId && !linkedTask" class="error-box" role="alert">
      {{ t("Task unavailable in this project.") }}
    </p>
    <TaskBoard v-if="view === 'board'" :tasks="projection.matchedLeafTasks" />
    <TaskCalendar
      v-else-if="view === 'calendar'"
      :tasks="projection.matchedLeafTasks"
      :work-scope="filters.scope"
      :project-id="projectId"
    />
    <TaskGantt
      v-else-if="view === 'gantt'"
      :tasks="projection.matchedLeafTasks"
      :project-id="projectId"
    />
    <TaskCollectionList
      v-else
      :tasks="projection.matchedLeafTasks"
      :context-tasks="projection.contextParents"
      :project-id="projectId"
      compact-controls
      :settings-target="settingsTarget"
    />
    <p class="workspace-result-count" role="status">
      {{ t("{count} leaf tasks", { count: projection.counts.total }) }}
    </p>
    <TaskDetailPanel
      :task-id="detailId"
      :notice="detailNotice"
      :fallback-focus="searchInput"
      @close="closeDetails"
    />
    <TaskBulkEdit
      v-if="bulkOpen"
      :tasks="projection.matchedLeafTasks"
      @close="bulkOpen = false"
    />
    <WorkspaceDialog
      :open="filterOpen"
      :title="t('Filter tasks')"
      variant="sheet"
      @close="filterOpen = false"
    >
      <button
        v-if="stageHighlight"
        class="stage-highlight mobile-stage-highlight"
        @click="change(stageHighlight.patch)"
      >
        {{ t("Stage focus") }} · {{ stageHighlight.label }}
        {{ stageHighlight.count }}
      </button>
      <div class="filter-fields">
        <label
          >{{ t("Work scope")
          }}<select
            :value="filters.scope"
            :aria-label="t('Work scope')"
            @change="
              change({
                scope: ($event.target as HTMLSelectElement)
                  .value as TaskFilters['scope'],
              })
            "
          >
            <option v-for="scope in taskScopes" :key="scope" :value="scope">
              {{ t(scopeLabels[scope]) }}
            </option>
          </select></label
        >
        <label
          >{{ t("Status")
          }}<select
            :value="filters.status || ''"
            :aria-label="t('Status')"
            @change="
              change({
                status: ($event.target as HTMLSelectElement)
                  .value as TaskFilters['status'],
                focus: 'all',
              })
            "
          >
            <option value="">{{ t("All") }}</option>
            <option v-for="status in statuses" :key="status" :value="status">
              {{
                t(
                  {
                    todo: "To do",
                    in_progress: "In progress",
                    done: "Done",
                    blocked: "Needs coordination",
                  }[status],
                )
              }}
              · {{ counts[status] }}
            </option>
          </select></label
        >
        <label
          >{{ t("Assignee")
          }}<select
            :value="filters.assignee ?? ''"
            :aria-label="t('Filter task assignee')"
            @change="
              change({ assignee: ($event.target as HTMLSelectElement).value })
            "
          >
            <option value="">{{ t("All assignees") }}</option>
            <option value="me">{{ t("Assigned to me") }}</option>
            <option value="none">{{ t("Unassigned") }}</option>
            <option v-for="[key, name] in assignees" :key="key" :value="key">
              {{ name }}
            </option>
          </select></label
        >
        <label
          >{{ t("Task risk")
          }}<select
            :value="filters.risk ?? ''"
            :aria-label="t('Filter task risk')"
            @change="
              change({ risk: ($event.target as HTMLSelectElement).value })
            "
          >
            <option value="">{{ t("All task risks") }}</option>
            <option value="overdue">{{ t("Overdue") }}</option>
            <option value="unplanned">{{ t("Unplanned") }}</option>
            <option value="blocked">{{ t("Needs coordination") }}</option>
            <option
              v-if="
                filters.risk &&
                !['overdue', 'unplanned', 'blocked'].includes(filters.risk)
              "
              :value="filters.risk"
            >
              {{ t("Unavailable risk filter") }}
            </option>
          </select></label
        >
      </div>
      <details class="advanced-filter-options">
        <summary>{{ t("Common task filters") }}</summary>
        <TaskPresetBar :project-id="projectId" />
      </details>
      <template #footer
        ><button @click="clearFilters">{{ t("Clear filters") }}</button
        ><button class="primary" @click="filterOpen = false">
          {{ t("Show tasks") }} · {{ projection.counts.total }}
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
      <div class="view-preference-actions">
        <button @click="saveDefaultLayout">
          {{ t("Use current layout by default") }}</button
        ><small>{{ t("Private to this account in this browser.") }}</small>
      </div>
      <details class="advanced-filter-options">
        <summary>{{ t("Saved filters") }}</summary>
        <TaskSavedViews :layout="view" :project-id="projectId" />
      </details>
      <p class="settings-explanation">
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
      :open="createMenu"
      :title="t('More task creation options')"
      variant="sheet"
      @close="createMenu = false"
      ><div class="creation-menu">
        <button @click="newTask">{{ t("New task") }}</button
        ><button
          @click="
            createMenu = false;
            paste = true;
          "
        >
          {{ t("Paste tasks") }}
        </button>
      </div></WorkspaceDialog
    >
    <WorkspaceDialog
      :open="adding"
      :title="t('New task')"
      :busy="store.busy"
      @close="confirmDiscard() && (adding = false)"
      ><TaskQuickAdd
        v-if="adding"
        :project-id="projectId"
        unscheduled
        @close="adding = false"
    /></WorkspaceDialog>
    <WorkspaceDialog
      :open="paste"
      :title="t('Paste tasks')"
      :busy="store.busy"
      @close="confirmDiscard() && (paste = false)"
      ><PasteTasks
        v-if="paste"
        :project-id="projectId"
        unscheduled
        @close="paste = false"
    /></WorkspaceDialog>
  </div>
</template>
<style scoped>
.workspace-toolbar-primary,
.workspace-toolbar-secondary {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.workspace-toolbar-primary {
  flex-wrap: wrap;
  min-width: 0;
}
.task-layout-switch,
.task-focus-switch,
.create-actions {
  display: flex;
  align-items: center;
}
.stage-highlight {
  border: 0;
  background: transparent;
  color: var(--accent);
  font-size: 12px;
  min-height: 36px;
}
.mobile-stage-highlight {
  display: none;
}
.toolbar-spacer {
  flex: 1;
}
.task-layout-switch {
  border-bottom: 0;
  gap: 2px;
}
.task-layout-switch button {
  background: transparent;
  border: 0;
  color: var(--muted);
  padding: 6px 12px;
  min-height: 36px;
}
.task-layout-switch button[aria-pressed="true"] {
  background: var(--surface);
  color: var(--text);
  box-shadow: 0 1px 4px #0001;
}
.create-actions button {
  min-height: 36px;
}
.new-task {
  border-radius: 6px 0 0 6px;
}
.create-menu-trigger {
  border-radius: 0 6px 6px 0;
  border-left: 1px solid rgb(255 255 255 / 30%);
  padding-left: 8px;
  padding-right: 8px;
}
.workspace-toolbar-secondary {
  padding-bottom: 4px;
}
.workspace-toolbar-secondary > input {
  width: min(340px, 40%);
  min-width: 100px;
  height: 36px;
  margin-right: auto;
  font-size: 13px;
}
.workspace-toolbar-secondary button {
  font-size: 12px;
  min-height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}
.task-focus-switch {
  gap: 2px;
}
.task-focus-switch button {
  border: 0;
  background: transparent;
  color: var(--muted);
}
.task-focus-switch button[aria-pressed="true"] {
  background: var(--accent-bg);
  color: var(--accent);
}
.filter-count {
  color: var(--accent);
}
.active-task-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 10px;
}
.active-task-filters button {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 30px;
  padding: 3px 8px;
  font-size: 12px;
  color: var(--accent);
  background: var(--accent-bg);
  border-color: var(--accent-border);
  max-width: 100%;
  overflow-wrap: anywhere;
}
.workspace-result-count,
.settings-explanation {
  margin: 8px 0;
  font-size: 11px;
  color: var(--muted);
}
.filter-fields {
  display: grid;
  gap: 16px;
}
.filter-fields label {
  display: grid;
  gap: 6px;
  font-size: 13px;
}
.filter-fields select {
  min-height: 44px;
  width: 100%;
}
.advanced-filter-options {
  margin-top: 20px;
  border-top: 1px solid var(--border);
  padding-top: 16px;
  font-size: 13px;
}
.advanced-filter-options summary {
  cursor: pointer;
  min-height: 30px;
}
.view-preference-actions {
  display: grid;
  gap: 8px;
  margin: 18px 0;
  font-size: 12px;
}
.view-preference-actions small {
  color: var(--muted);
}
.creation-menu {
  display: grid;
  gap: 8px;
}
.creation-menu button {
  min-height: 44px;
  justify-content: flex-start;
}
@media (max-width: 760px) {
  .workspace-toolbar-primary .stage-highlight {
    display: none;
  }
  .mobile-stage-highlight {
    display: block;
    margin: 0 0 16px;
  }
  .workspace-toolbar-primary,
  .workspace-toolbar-secondary {
    gap: 6px;
  }
  .workspace-toolbar-primary button,
  .workspace-toolbar-secondary button {
    min-height: 44px;
  }
  .workspace-toolbar-primary .task-layout-switch button {
    padding: 6px 10px;
    font-size: 13px;
  }
  .workspace-toolbar-secondary {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 44px 44px;
  }
  .workspace-toolbar-secondary > input {
    width: 100%;
    min-height: 44px;
    font-size: 16px;
  }
  .task-focus-switch {
    grid-row: 2;
    grid-column: 1 / -1;
  }
  .settings-trigger > span,
  .filter-trigger > span:not(.filter-count) {
    display: none;
  }
  .settings-trigger,
  .filter-trigger {
    padding: 6px;
    min-width: 44px;
  }
  .active-task-filters button {
    min-height: 44px;
  }
}
</style>
