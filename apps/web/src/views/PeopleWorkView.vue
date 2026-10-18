<script setup lang="ts">
import { computed, defineAsyncComponent, ref, watch } from "vue";
import { onBeforeRouteUpdate, useRoute, useRouter } from "vue-router";
import {
  projectPeopleWork,
  type PersonWorkGroup,
} from "../../../../packages/domain/people-work";
import { statuses, type Task } from "../../../../packages/domain/types";
import {
  readTaskFilters,
  taskScopes,
  taskStateFilter,
  selectedTaskState,
  type TaskFilters,
  type TaskState,
} from "../composables/task-focus";
import { useCalendarNow } from "../composables/calendar";
import { confirmDiscard } from "../composables/unsaved";
import { useWorkspace } from "../stores/workspace";
import { t, formatDate, formatNumber } from "../locales";
import { statusLabels } from "../locales/en";
import TaskDetailPanel from "../components/TaskDetailPanel.vue";
import StatusBadge from "../components/StatusBadge.vue";
const TaskBulkEdit = defineAsyncComponent(
  () => import("../components/TaskBulkEdit.vue"),
);
const bulkTasks = ref<Task[] | null>(null);
const route = useRoute(),
  router = useRouter(),
  store = useWorkspace();
const now = useCalendarNow();
const filters = computed(() => readTaskFilters(route.query));
const text = (key: string) =>
  typeof route.query[key] === "string" ? (route.query[key] as string) : "";
const projection = computed(() =>
  projectPeopleWork(
    store.data,
    filters.value,
    {
      department: text("department"),
      search: text("people"),
      person: text("person"),
      showAll: text("showAll") === "1",
    },
    { now: now.value, timeZone: store.timeZone, actorId: store.user?.id },
  ),
);
const limit = ref(40);
const visible = computed(() => projection.value.groups.slice(0, limit.value));
const selected = ref({ key: "", date: "", week: "", unscheduled: false });
const detailId = ref("");
const selectedGroup = computed(() =>
  projection.value.groups.find((group) => group.key === selected.value.key),
);
const detailTasks = computed(() => {
  const group = selectedGroup.value;
  if (!group) return [];
  if (selected.value.date) return group.days[selected.value.date] ?? [];
  if (selected.value.week)
    return (
      group.undatedWeeks.find((week) => week.week === selected.value.week)
        ?.tasks ?? []
    );
  if (selected.value.unscheduled) return group.unscheduled;
  return group.tasks;
});
const projectNames = computed(
  () =>
    new Map(store.data.projects.map((project) => [project.id, project.name])),
);
const taskNames = computed(
  () => new Map(store.data.tasks.map((task) => [task.id, task.title])),
);
const departments = computed(() => store.data.directory?.departments ?? []);
const scopeLabels = { today: "Today", week: "This week", all: "All time" };
const stateOptions: { value: TaskState; label: string }[] = [
  { value: "all", label: "All" },
  { value: "open", label: "Open work" },
  ...statuses.map((status) => ({ value: status, label: statusLabels[status] })),
];
function change(patch: Record<string, string | undefined>, replace = false) {
  void router[replace ? "replace" : "push"]({
    query: { ...route.query, tab: "work", ...patch },
  });
}
function filter(patch: Partial<TaskFilters>) {
  const next = { ...filters.value, ...patch };
  change({
    scope: next.scope,
    project: next.project || undefined,
    status: next.status || undefined,
    focus: next.focus === "all" ? undefined : next.focus,
  });
}
function select(
  group: PersonWorkGroup,
  bucket: Partial<typeof selected.value> = {},
) {
  if (!confirmDiscard()) return;
  const next = {
    key: group.key,
    date: "",
    week: "",
    unscheduled: false,
    ...bucket,
  };
  selected.value =
    JSON.stringify(next) === JSON.stringify(selected.value)
      ? { key: "", date: "", week: "", unscheduled: false }
      : next;
}
function open(id: string) {
  if (confirmDiscard()) detailId.value = id;
}
function openBulk() {
  if (detailTasks.value.length && confirmDiscard())
    bulkTasks.value = detailTasks.value.map((task) => ({ ...task }));
}
function personLabel(group: PersonWorkGroup) {
  return group.kind === "unassigned" ? t("Unassigned") : group.name;
}
onBeforeRouteUpdate(
  (to, from) => to.query.tab !== from.query.tab || confirmDiscard(),
);
watch(
  () => route.fullPath,
  () => {
    limit.value = 40;
    selected.value = { key: "", date: "", week: "", unscheduled: false };
  },
);
</script>
<template>
  <section class="page people-work">
    <header class="page-heading">
      <div>
        <h1>{{ t("People planning") }}</h1>
        <p class="page-subtitle">
          {{ t("Assignments and explicit work dates across projects.") }}
        </p>
      </div>
    </header>
    <p v-if="store.error" class="error-box" role="alert">
      {{ t(store.error) }}
      <button @click="store.refresh()">{{ t("Retry") }}</button>
    </p>
    <div class="people-toolbar">
      <div class="scope-tabs" role="group" :aria-label="t('Work scope')">
        <button
          v-for="scope in taskScopes"
          :key="scope"
          :aria-pressed="filters.scope === scope"
          :class="{ active: filters.scope === scope }"
          @click="filter({ scope })"
        >
          {{ t(scopeLabels[scope]) }}
        </button>
      </div>
      <label
        >{{ t("Search people")
        }}<input
          :value="text('people')"
          :placeholder="t('Name, department or employee number')"
          @input="
            change(
              {
                people: ($event.target as HTMLInputElement).value || undefined,
              },
              true,
            )
          "
      /></label>
      <label
        >{{ t("Department")
        }}<select
          :value="text('department')"
          @change="
            change({
              department:
                ($event.target as HTMLSelectElement).value || undefined,
            })
          "
        >
          <option value="">{{ t("All departments") }}</option>
          <option
            v-if="
              text('department') &&
              !departments.some(
                (department) => department.id === text('department'),
              )
            "
            :value="text('department')"
          >
            {{ t("Department unavailable") }}
          </option>
          <option
            v-for="department in departments"
            :key="department.id"
            :value="department.id"
          >
            {{ department.name }}
          </option>
        </select></label
      >
      <label
        >{{ t("Project")
        }}<select
          :value="filters.project"
          @change="
            filter({ project: ($event.target as HTMLSelectElement).value })
          "
        >
          <option value="">{{ t("All projects") }}</option>
          <option
            v-if="filters.project && !projectNames.has(filters.project)"
            :value="filters.project"
          >
            {{ t("Project unavailable") }}
          </option>
          <option
            v-for="project in store.data.projects"
            :key="project.id"
            :value="project.id"
          >
            {{ project.name }}
          </option>
        </select></label
      >
      <label
        >{{ t("Status")
        }}<select
          :value="selectedTaskState(filters)"
          @change="
            filter(
              taskStateFilter(
                ($event.target as HTMLSelectElement).value as TaskState,
              ),
            )
          "
        >
          <option
            v-for="state in stateOptions"
            :key="state.value"
            :value="state.value"
          >
            {{ t(state.label) }}
          </option>
        </select></label
      >
      <label class="all-people"
        ><input
          type="checkbox"
          :checked="text('showAll') === '1'"
          @change="
            change({
              showAll: ($event.target as HTMLInputElement).checked
                ? '1'
                : undefined,
            })
          "
        />{{ t("Include active people without linked tasks") }}</label
      >
      <button @click="router.push({ query: { tab: 'work', scope: 'week' } })">
        {{ t("Clear filters") }}
      </button>
    </div>
    <p class="muted people-scope">
      {{ t("Week of {date}", { date: formatDate(projection.week) }) }} ·
      {{ store.timeZone }} ·
      {{
        t("{count} people or assignment groups", {
          count: projection.groups.length,
        })
      }}
      · {{ t("{count} leaf tasks", { count: projection.counts.total }) }}
    </p>
    <p class="muted people-help">
      {{
        t(
          "Task counts show assignments, not effort or capacity. A task planned on several days counts once in the weekly total.",
        )
      }}
    </p>
    <p v-if="text('department')" class="muted">
      {{ t("Unlinked names cannot be attributed to a department.") }}
    </p>
    <p
      v-if="filters.assignee || filters.risk || text('person') || filters.query"
      class="filter-note"
    >
      {{ t("Additional shared-link filters are active.") }}
      <button
        @click="
          change({
            assignee: undefined,
            risk: undefined,
            person: undefined,
            q: undefined,
          })
        "
      >
        {{ t("Clear additional filters") }}
      </button>
    </p>
    <div class="people-metrics">
      <span
        >{{ t("Open work") }}
        <strong>{{ formatNumber(projection.counts.open) }}</strong></span
      ><span
        >{{ t("Completed") }}
        <strong>{{ formatNumber(projection.counts.done) }}</strong></span
      ><span
        >{{ t("Blocked") }}
        <strong>{{ formatNumber(projection.counts.blocked) }}</strong></span
      ><span
        >{{ t("Overdue") }}
        <strong>{{ formatNumber(projection.counts.overdue) }}</strong></span
      ><span
        >{{ t("Unplanned work") }}
        <strong>{{ formatNumber(projection.counts.unplanned) }}</strong></span
      >
    </div>
    <div v-if="!visible.length" class="empty">
      <h2>{{ t("No matching people or tasks") }}</h2>
      <p>
        {{ t("Adjust the filters or include people without linked tasks.") }}
      </p>
    </div>
    <section
      v-for="group in visible"
      :key="group.key"
      class="person-work"
      :data-person-key="group.key"
    >
      <div class="person-main">
        <button
          class="person-name"
          :aria-expanded="selected.key === group.key"
          @click="select(group)"
        >
          <strong>{{ personLabel(group) }}</strong
          ><small>{{
            group.departments.join(" · ") || group.member?.email
          }}</small
          ><small v-if="group.kind === 'text'">{{
            t("Unlinked name; identity has not been confirmed.")
          }}</small
          ><small v-else-if="group.kind === 'employee'">{{
            t("No linked account; task identity is unknown.")
          }}</small
          ><small
            v-else-if="group.member?.status !== 'active' && group.member"
            >{{ t("Inactive account; existing work is retained.") }}</small
          ><small v-if="group.employee && !group.employee.active">{{
            t("Inactive employee")
          }}</small>
        </button>
        <div class="person-counts">
          <span
            >{{ t("Tasks") }}
            <strong>{{ formatNumber(group.counts.total) }}</strong></span
          ><span
            >{{ t("Open work") }} {{ formatNumber(group.counts.open) }}</span
          ><span v-if="group.counts.blocked"
            >{{ t("Blocked") }} {{ formatNumber(group.counts.blocked) }}</span
          ><span v-if="group.counts.overdue"
            >{{ t("Overdue") }} {{ formatNumber(group.counts.overdue) }}</span
          >
        </div>
      </div>
      <div class="person-days" :aria-label="t('Work dates')">
        <button
          v-for="date in projection.weekDates"
          :key="date"
          :class="{
            today: date === projection.today,
            selected: selected.key === group.key && selected.date === date,
          }"
          :aria-label="
            t('{date}: {count} tasks', {
              date: formatDate(date),
              count: group.days[date]?.length ?? 0,
            })
          "
          :aria-pressed="selected.key === group.key && selected.date === date"
          @click="select(group, { date })"
        >
          <span>{{ formatDate(date, { weekday: "short" }) }}</span
          ><strong>{{ formatNumber(group.days[date]?.length ?? 0) }}</strong>
        </button>
      </div>
      <div
        v-if="group.undatedWeeks.length || group.unscheduled.length"
        class="person-buckets"
      >
        <button
          v-for="week in group.undatedWeeks"
          :key="week.week"
          @click="select(group, { week: week.week })"
        >
          {{ t("Week of {date}", { date: formatDate(week.week) }) }} ·
          {{ t("Day not assigned") }}
          {{ formatNumber(week.tasks.length) }}</button
        ><button
          v-if="group.unscheduled.length"
          @click="select(group, { unscheduled: true })"
        >
          {{ t("Not scheduled") }} {{ formatNumber(group.unscheduled.length) }}
        </button>
      </div>
      <section
        v-if="selected.key === group.key"
        class="person-details"
        :aria-label="t('Tasks for {name}', { name: personLabel(group) })"
      >
        <button v-if="detailTasks.length" @click="openBulk">
          {{ t("Bulk edit tasks") }} ({{ formatNumber(detailTasks.length) }})
        </button>
        <p v-if="!detailTasks.length" class="muted">
          {{
            group.kind === "employee"
              ? t("No linked account; task identity is unknown.")
              : t("No tasks in this selection")
          }}
        </p>
        <ul v-else>
          <li v-for="task in detailTasks" :key="task.id">
            <button class="person-task" @click="open(task.id)">
              <strong>{{ task.title }}</strong
              ><small
                >{{ projectNames.get(task.projectId)
                }}<template v-if="task.parentId">
                  / {{ taskNames.get(task.parentId) }}</template
                ></small
              ></button
            ><StatusBadge :status="task.status" /><span class="muted">{{
              task.dueDate ? formatDate(task.dueDate) : t("No due date")
            }}</span>
          </li>
        </ul>
      </section>
    </section>
    <button
      v-if="projection.groups.length > limit"
      class="load-people"
      @click="limit += 40"
    >
      {{
        t("Show {count} more people", {
          count: Math.min(40, projection.groups.length - limit),
        })
      }}
    </button>
    <TaskDetailPanel :task-id="detailId" @close="detailId = ''" />
    <TaskBulkEdit
      v-if="bulkTasks"
      :tasks="bulkTasks"
      initial-field="assignee"
      @close="bulkTasks = null"
    />
  </section>
</template>
<style scoped>
.people-work {
  min-width: 0;
}
.people-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: 12px;
}
.people-toolbar label {
  display: grid;
  gap: 5px;
  font-size: 12px;
  min-width: 140px;
}
.people-toolbar input,
.people-toolbar select {
  width: 100%;
  max-width: 270px;
  min-height: 44px;
}
.people-toolbar .all-people {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
}
.all-people input {
  width: 18px;
  min-height: 18px;
}
.scope-tabs {
  margin: 0;
}
.scope-tabs button {
  min-height: 44px;
}
.people-scope {
  margin: 20px 0 8px;
  font-size: 12px;
}
.people-help {
  font-size: 12px;
  line-height: 1.6;
}
.people-metrics {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  margin: 18px 0;
  font-size: 13px;
}
.people-metrics strong {
  font-variant-numeric: tabular-nums;
  margin-left: 4px;
}
.person-work {
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 16px;
  margin-bottom: 12px;
  background: var(--surface);
  display: grid;
  grid-template-columns: minmax(230px, 1fr) minmax(350px, 1.2fr);
  align-items: center;
  gap: 12px;
}
.person-main {
  min-width: 0;
}
.person-name {
  display: grid;
  gap: 5px;
  background: none;
  border: 0;
  padding: 2px 0;
  text-align: left;
  color: var(--text);
  min-height: 44px;
  max-width: 100%;
  overflow-wrap: anywhere;
}
.person-name small {
  color: var(--muted);
  font-size: 11px;
  white-space: normal;
}
.person-counts {
  display: flex;
  gap: 8px 14px;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--muted);
  margin-top: 10px;
}
.person-days {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 4px;
}
.person-days button {
  display: grid;
  gap: 7px;
  padding: 8px 3px;
  min-height: 64px;
  min-width: 0;
  font-size: 11px;
  background: transparent;
}
.person-days .today {
  border-color: var(--accent-border);
}
.person-days .selected {
  color: var(--accent);
  background: var(--accent-bg);
}
.person-buckets {
  grid-column: 1 / -1;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.person-buckets button {
  font-size: 11px;
  min-height: 44px;
  white-space: normal;
}
.person-details {
  grid-column: 1 / -1;
  border-top: 1px solid var(--border);
  padding-top: 12px;
}
.person-details ul {
  list-style: none;
  padding: 0;
  margin: 0;
}
.person-details li {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 10px 0;
  border-bottom: 1px solid var(--border);
  font-size: 12px;
}
.person-task {
  display: grid;
  gap: 5px;
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  text-align: left;
  color: var(--text);
  min-height: 44px;
  overflow-wrap: anywhere;
  white-space: normal;
}
.person-task small {
  color: var(--muted);
}
.load-people {
  min-height: 44px;
}
.filter-note {
  font-size: 12px;
}
@media (max-width: 820px) {
  .person-work {
    grid-template-columns: minmax(0, 1fr);
  }
}
@media (max-width: 600px) {
  .people-toolbar label {
    flex: 1 1 140px;
    min-width: 0;
  }
  .people-toolbar input,
  .people-toolbar select {
    max-width: 100%;
  }
  .person-work {
    padding: 12px;
  }
  .person-details li {
    flex-wrap: wrap;
  }
  .person-task {
    flex-basis: 100%;
  }
  .person-days button {
    font-size: 10px;
  }
}
@media (max-width: 420px) {
  .person-days {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}
</style>
