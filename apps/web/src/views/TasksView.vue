<script setup lang="ts">
import { currentDay, currentWeek } from "../composables/calendar";
import { computed, ref } from "vue";
import { onBeforeRouteUpdate, useRoute, useRouter } from "vue-router";
import {
  PhMagnifyingGlass,
  PhPlus,
  PhCircle,
  PhCheckCircle,
  PhSquaresFour,
} from "@phosphor-icons/vue";
import { useWorkspace } from "../stores/workspace";
import { statuses, type Task } from "../../../../packages/domain/types";
import { statusLabels } from "../locales/en";
import { t, formatDate, formatNumber } from "../locales";
import { confirmDiscard } from "../composables/unsaved";
import {
  filterTaskWork,
  readTaskFilters,
  taskScopes,
  taskFocuses,
  type TaskFilters,
} from "../composables/task-focus";
import TaskDistribution from "../components/TaskDistribution.vue";
import TaskList from "../components/TaskList.vue";
import TaskEditor from "../components/TaskEditor.vue";

const store = useWorkspace(),
  route = useRoute(),
  router = useRouter();
const filters = computed(() => readTaskFilters(route.query));
const creating = ref(false),
  creatingProject = ref(""),
  savedOutsideFilters = ref(false);
const tasks = computed(() =>
  filterTaskWork(
    store.data.tasks,
    filters.value,
    new Date(),
    store.data.members,
    store.timeZone,
  ),
);
const scopeCounts = computed(() =>
  Object.fromEntries(
    taskScopes.map((scope) => [
      scope,
      filterTaskWork(
        store.data.tasks,
        { ...filters.value, scope },
        new Date(),
        store.data.members,
        store.timeZone,
      ).length,
    ]),
  ),
);
const focusCounts = computed(() =>
  Object.fromEntries(
    taskFocuses.map((focus) => [
      focus,
      filterTaskWork(
        store.data.tasks,
        { ...filters.value, focus },
        new Date(),
        store.data.members,
        store.timeZone,
      ).length,
    ]),
  ),
);
const hasFilters = computed(
  () =>
    !!(
      filters.value.status ||
      filters.value.project ||
      filters.value.query ||
      filters.value.focus !== "all"
    ),
);
const scopeLabels = { today: "Today", week: "This week", all: "All tasks" };
const focusLabels = {
  all: "All work",
  open: "Open work",
  done: "Completed work",
};
const focusIcons = { all: PhSquaresFour, open: PhCircle, done: PhCheckCircle };

function changeFilters(patch: Partial<TaskFilters>, replace = false) {
  const next = { ...filters.value, ...patch };
  const query = {
    ...route.query,
    scope: next.scope,
    status: next.status || undefined,
    project: next.project || undefined,
    q: next.query || undefined,
    focus: next.focus === "all" ? undefined : next.focus,
  };
  void router[replace ? "replace" : "push"]({ query });
}
const search = computed({
  get: () => filters.value.query,
  set: (query: string) => changeFilters({ query }, true),
});
const status = computed({
  get: () => filters.value.status,
  set: (status: TaskFilters["status"]) => changeFilters({ status }),
});
const project = computed({
  get: () => filters.value.project,
  set: (project: string) => changeFilters({ project }),
});

// A query change can remove an edited task from the list. Preserve the normal discard guard.
onBeforeRouteUpdate(() => confirmDiscard());
function startCreating() {
  creatingProject.value = filters.value.project;
  savedOutsideFilters.value = false;
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
  savedOutsideFilters.value = !tasks.value.some((item) => item.id === task.id);
}
</script>
<template>
  <section class="page tasks-page">
    <div class="page-heading">
      <div>
        <h1>{{ t("Tasks") }}</h1>
        <p class="page-subtitle">{{ t("Planned work, current status.") }}</p>
      </div>
      <button
        class="primary"
        :disabled="!store.data.projects.length || creating"
        @click="startCreating"
      >
        <PhPlus :size="16" />{{ t("New task") }}
      </button>
    </div>
    <div class="scope-tabs" role="group" :aria-label="t('Work scope')">
      <button
        v-for="scope in taskScopes"
        :key="scope"
        :class="{ active: filters.scope === scope }"
        :aria-pressed="filters.scope === scope"
        @click="changeFilters({ scope })"
      >
        {{ t(scopeLabels[scope])
        }}<span>{{ formatNumber(scopeCounts[scope] ?? 0) }}</span>
      </button>
    </div>
    <div class="task-focus" role="group" :aria-label="t('Work focus')">
      <button
        v-for="focus in taskFocuses"
        :key="focus"
        :class="{ active: filters.focus === focus }"
        :aria-pressed="filters.focus === focus"
        @click="changeFilters({ focus })"
      >
        <span class="focus-title"
          ><component :is="focusIcons[focus]" :size="16" aria-hidden="true" />{{
            t(focusLabels[focus])
          }}</span
        >
        <span>{{ formatNumber(focusCounts[focus] ?? 0) }}</span>
      </button>
    </div>
    <div class="filterbar">
      <label class="search-field"
        ><PhMagnifyingGlass :size="17" /><input
          v-model="search"
          data-global-search
          :placeholder="t('Search tasks or assignees')"
          :aria-label="t('Search tasks')"
      /></label>
      <select v-model="status" :aria-label="t('Filter task status')">
        <option value="">{{ t("All statuses") }}</option>
        <option v-for="s in statuses" :key="s" :value="s">
          {{ statusLabels[s] }}
        </option>
      </select>
      <select v-model="project" :aria-label="t('Filter task project')">
        <option value="">{{ t("All projects") }}</option>
        <option v-for="p in store.data.projects" :key="p.id" :value="p.id">
          {{ p.name }}
        </option>
      </select>
      <button
        v-if="hasFilters"
        class="text-button clear-task-filters"
        @click="
          changeFilters({ status: '', project: '', query: '', focus: 'all' })
        "
      >
        {{ t("Clear filters") }}
      </button>
    </div>
    <div v-if="creating" class="panel task-create-panel">
      <label
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
        v-if="creatingProject"
        :key="creatingProject"
        :projectId="creatingProject"
        @close="creating = false"
        @saved="saved"
      />
      <button v-else @click="creating = false">{{ t("Cancel") }}</button>
    </div>
    <p v-if="savedOutsideFilters" class="muted task-save-note">
      {{ t("Task saved outside the current filters.") }}
    </p>
    <div class="task-summary">
      <div class="section-heading">
        <div>
          <h3>
            {{
              t(
                filters.scope === "today"
                  ? "Today’s work"
                  : filters.scope === "week"
                    ? "This week's work"
                    : "All tasks",
              )
            }}
          </h3>
          <span class="muted task-summary-date"
            >{{
              filters.scope === "today"
                ? formatDate(currentDay())
                : filters.scope === "week"
                  ? t("Week of {date}", { date: formatDate(currentWeek()) })
                  : t("All planned and unplanned work")
            }}
            · {{ store.timeZone }}</span
          >
        </div>
        <span class="muted task-result-count" aria-live="polite">{{
          t("{count} leaf tasks", { count: tasks.length })
        }}</span>
      </div>
      <TaskDistribution :tasks="tasks" />
    </div>
    <TaskList :tasks="tasks" showProject />
    <p class="list-footnote">
      {{
        t(
          "Work scope is planned explicitly. Due dates do not change which tasks appear here. Parent tasks are excluded from counts.",
        )
      }}
    </p>
  </section>
</template>

<style scoped>
.task-focus {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 14px 0;
}
.task-focus button {
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--border);
  color: var(--muted);
  background: var(--surface);
}
.task-focus button.active {
  color: var(--text);
  border-color: var(--accent);
  box-shadow: inset 0 -2px var(--accent);
}
.task-focus button span {
  font-variant-numeric: tabular-nums;
  color: var(--text);
}
.focus-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.task-focus button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
}
.tasks-page .scope-tabs button,
.tasks-page .filterbar input,
.tasks-page .filterbar select,
.clear-task-filters {
  min-height: 44px;
}
.tasks-page .filterbar {
  flex-wrap: wrap;
}
.task-summary {
  padding: 16px;
  margin: 20px 0 12px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
}
.task-summary .section-heading {
  margin-bottom: 14px;
  gap: 12px;
}
.task-summary-date {
  display: block;
  margin-top: 6px;
  font-size: 12px;
}
.task-result-count {
  font-variant-numeric: tabular-nums;
}
.task-create-panel {
  padding: 16px;
}
.task-create-panel > label {
  display: grid;
  gap: 8px;
  max-width: 480px;
  margin-bottom: 12px;
}
.task-save-note {
  margin: 12px 0;
}
@media (max-width: 600px) {
  .task-focus {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 5px;
  }
  .task-focus button {
    justify-content: center;
    flex-direction: column;
    gap: 5px;
    padding: 8px 5px;
    font-size: 11px;
  }
  .task-focus button svg {
    display: none;
  }
  .task-summary {
    padding: 12px;
  }
  .task-summary .section-heading {
    flex-wrap: wrap;
    align-items: start;
  }
}
</style>
