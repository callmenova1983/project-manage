<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  PhArrowRight,
  PhCalendarBlank,
  PhCheckCircle,
  PhClipboardText,
  PhClock,
  PhFunnelSimple,
  PhInfo,
  PhPlus,
  PhWarning,
  PhWarningCircle,
  PhCaretDown,
  PhNoteBlank,
  PhArrowClockwise,
} from "@phosphor-icons/vue";
import {
  selectProjects,
  projectWorkspaceOverview,
  projectViewQuery,
  type ProjectViewFilters,
} from "../../../../packages/domain/project-view";
import { weekBounds } from "../../../../packages/domain/time-zone";
import { useWorkspace } from "../stores/workspace";
import { useCalendarNow } from "../composables/calendar";
import { catalogs, catalogLabel } from "../composables/catalogs";
import { t, formatDate, formatNumber } from "../locales";
import {
  workbenchTaskGroups,
  validWorkbenchDay,
} from "../services/workspace-workbench";
import WeeklyChanges from "../components/WeeklyChanges.vue";
import StatusBadge from "../components/StatusBadge.vue";
import ProjectScheduleOverview from "../components/ProjectScheduleOverview.vue";
import WorkspaceTaskRows from "../components/WorkspaceTaskRows.vue";
import TaskDetailPanel from "../components/TaskDetailPanel.vue";
import CalendarDateEdit from "../components/CalendarDateEdit.vue";
const store = useWorkspace(),
  route = useRoute(),
  router = useRouter(),
  now = useCalendarNow();
const showFilters = ref(false),
  selectedTaskId = ref(""),
  arrangingId = ref(""),
  actionError = ref("");
const limits = ref({ scheduled: 4, undated: 2, done: 2 });
const scopeControl = ref<HTMLSelectElement | null>(null);
const range = computed(() =>
  route.query.overviewRange === "filtered" ? "filtered" : "workspace",
);
const scope = computed(() =>
  route.query.overviewScope === "today"
    ? "today"
    : route.query.overviewScope === "all"
      ? "all"
      : "week",
);
const selectedProjects = computed(() =>
  range.value === "workspace"
    ? store.data.projects
    : selectProjects(
        store.data.projects,
        store.data.members,
        store.projectNavigation as ProjectViewFilters,
        store.following,
        store.data.projectOrder,
      ),
);
const overview = computed(() =>
  projectWorkspaceOverview(store.data, selectedProjects.value, {
    now: now.value,
    timeZone: store.timeZone,
    scope: scope.value,
  }),
);
const days = computed(
  () => weekBounds(overview.value.week, store.timeZone).days,
);
const selectedDay = computed(() =>
  scope.value === "week"
    ? validWorkbenchDay(route.query.overviewDay, days.value)
    : "",
);
const groups = computed(() =>
  workbenchTaskGroups(overview.value.tasks, selectedDay.value),
);
const percent = computed(() =>
  overview.value.selected.total
    ? Math.round(
        (overview.value.selected.done.length / overview.value.selected.total) *
          100,
      )
    : 0,
);
const weekLabel = computed(
  () => shortDate(days.value[0]!) + " – " + shortDate(days.value[6]!),
);
const taskTitle = computed(() =>
  t(
    scope.value === "today"
      ? "Today's tasks"
      : scope.value === "week"
        ? "Weekly tasks"
        : "All tasks",
  ),
);
const pageTitle = computed(() =>
  t(
    scope.value === "today"
      ? "Today, focus on the next step."
      : scope.value === "week"
        ? "This week, move key work forward."
        : "Keep every next step in view.",
  ),
);
const planTitle = computed(() =>
  t(
    scope.value === "today"
      ? "Today's plan"
      : scope.value === "week"
        ? "Weekly plan"
        : "Work plan",
  ),
);
const stageIds = computed(() =>
  [
    ...new Set([
      ...catalogs.value.stages.map((stage) => stage.id),
      ...Object.keys(overview.value.stages),
    ]),
  ].filter((id) => overview.value.stages[id]),
);
const arrangingTask = computed(() =>
  store.data.tasks.find((task) => task.id === arrangingId.value),
);
const overdue = computed(() =>
  [...overview.value.all.overdue].sort(
    (a, b) =>
      (a.dueDate ?? "").localeCompare(b.dueDate ?? "") ||
      a.id.localeCompare(b.id),
  ),
);
const scopeLabels = { today: "Today", week: "This week", all: "All time" };
function shortDate(day: string) {
  return formatDate(day, { month: "2-digit", day: "2-digit" });
}
function change(patch: Record<string, string | undefined>) {
  void router.push({ query: { ...route.query, tab: "overview", ...patch } });
}
function updateFilter(key: "query" | "stage", value: string) {
  store.projectNavigation[key] = value;
  void router.replace({
    query: {
      ...route.query,
      ...projectViewQuery(store.projectNavigation as ProjectViewFilters),
      overviewRange: "filtered",
      tab: "overview",
    },
  });
}
function taskLink(query: Record<string, string | undefined>) {
  return {
    path: "/tasks",
    query: {
      ...query,
      projects: overview.value.projectIds.length
        ? overview.value.projectIds
        : [""],
    },
  };
}
function more(group: keyof typeof limits.value) {
  limits.value[group] += 8;
}
async function closeOverlay(kind: "task" | "dates") {
  if (kind === "task") selectedTaskId.value = "";
  else arrangingId.value = "";
  await nextTick();
  if (document.activeElement === document.body)
    scopeControl.value?.focus({ preventScroll: true });
}
</script>
<template>
  <section class="page workspace-overview">
    <header class="workbench-heading">
      <div class="workbench-heading-copy">
        <h1>{{ pageTitle }}</h1>
        <p class="workbench-meta">
          <span>{{
            formatDate(overview.today, {
              year: "numeric",
              month: "long",
              day: "numeric",
              weekday: "short",
            })
          }}</span
          ><span>{{
            t("{count} projects", { count: overview.projects.length })
          }}</span
          ><span>{{ store.timeZone }}</span>
        </p>
      </div>
      <div class="workbench-actions">
        <label class="workbench-scope"
          ><PhCalendarBlank :size="18" aria-hidden="true" /><select
            ref="scopeControl"
            :value="scope"
            :aria-label="t('Work scope')"
            @change="
              change({
                overviewScope: ($event.target as HTMLSelectElement).value,
                overviewDay: undefined,
              })
            "
          >
            <option
              v-for="value in ['today', 'week', 'all'] as const"
              :key="value"
              :value="value"
            >
              {{ t(scopeLabels[value])
              }}{{ value === "week" ? " (" + weekLabel + ")" : "" }}
            </option>
          </select></label
        >
        <button
          class="filter-toggle"
          :class="{ active: showFilters || range === 'filtered' }"
          :aria-expanded="showFilters"
          aria-controls="workbench-filters"
          @click="showFilters = !showFilters"
        >
          <PhFunnelSimple :size="18" />{{ t("More filters") }}
        </button>
        <RouterLink
          class="primary plan-action"
          :to="taskLink({ scope: 'all', risk: 'unplanned' })"
          ><PhPlus :size="18" />{{ t("Plan work") }}</RouterLink
        >
      </div>
    </header>
    <div v-if="showFilters" id="workbench-filters" class="workbench-filters">
      <label
        >{{ t("Overview range")
        }}<select
          :value="range"
          @change="
            change({
              overviewRange: ($event.target as HTMLSelectElement).value,
            })
          "
        >
          <option value="workspace">{{ t("All workspace projects") }}</option>
          <option value="filtered">{{ t("Current project filters") }}</option>
        </select></label
      >
      <label
        >{{ t("Search projects")
        }}<input
          :value="store.projectNavigation.query"
          @input="
            updateFilter('query', ($event.target as HTMLInputElement).value)
          "
      /></label>
      <label
        >{{ t("Stage")
        }}<select
          :value="store.projectNavigation.stage"
          @change="
            updateFilter('stage', ($event.target as HTMLSelectElement).value)
          "
        >
          <option value="">{{ t("All stages") }}</option>
          <option
            v-for="stage in catalogs.stages"
            :key="stage.id"
            :value="stage.id"
          >
            {{ catalogLabel("stages", stage.id) }}
          </option>
        </select></label
      >
      <RouterLink
        :to="{ path: '/projects', query: { ...route.query, tab: 'projects' } }"
        >{{ t("Review all project filters") }}<PhArrowRight :size="14"
      /></RouterLink>
    </div>
    <p v-if="range === 'filtered'" class="filtered-note">
      <PhFunnelSimple :size="14" />{{ t("Current project filters") }} ·
      {{ t("{count} projects", { count: overview.projects.length })
      }}<button @click="change({ overviewRange: 'workspace' })">
        {{ t("All workspace projects") }}
      </button>
    </p>
    <p v-if="store.error" class="error-box" role="alert">
      {{ t(store.error) }} · {{ t("Showing the last available snapshot.") }}
    </p>
    <p v-if="actionError" class="error-box" role="alert">
      {{ t(actionError) }}
    </p>
    <section class="workbench-summary" :aria-label="t('Task summary')">
      <RouterLink class="summary-metric total" :to="taskLink({ scope })"
        ><span class="summary-icon"><PhClipboardText :size="28" /></span
        ><span
          ><span class="metric-label">{{ taskTitle }}</span
          ><strong
            >{{ formatNumber(overview.selected.total)
            }}<small>{{ t("Tasks") }}</small></strong
          ></span
        ></RouterLink
      >
      <RouterLink
        class="summary-metric done"
        :to="taskLink({ scope, status: 'done' })"
        ><PhCheckCircle :size="26" /><span
          ><span class="metric-label">{{ t("Completed") }}</span
          ><strong>{{
            formatNumber(overview.selected.done.length)
          }}</strong></span
        ></RouterLink
      >
      <RouterLink
        class="summary-metric open"
        :to="taskLink({ scope, focus: 'open' })"
        ><PhClock :size="26" /><span
          ><span class="metric-label">{{ t("Open work") }}</span
          ><strong>{{
            formatNumber(overview.selected.open.length)
          }}</strong></span
        ></RouterLink
      >
      <div class="summary-progress">
        <div>
          <span
            >{{ t("Completion in this scope") }}
            <strong>{{ formatNumber(percent) }}%</strong></span
          ><span
            >{{ formatNumber(overview.selected.done.length) }} /
            {{ formatNumber(overview.selected.total) }}</span
          >
        </div>
        <progress
          :value="overview.selected.done.length"
          :max="overview.selected.total || 1"
          :aria-label="t('Completion in this scope')"
        />
      </div>
    </section>
    <p v-if="!overview.projects.length" class="empty">
      {{ t("No projects in this overview range") }}
    </p>
    <div v-else class="workbench-grid">
      <section class="workbench-plan" :aria-label="planTitle">
        <header class="plan-heading">
          <div class="panel-heading">
            <PhCalendarBlank :size="27" />
            <div>
              <h2>{{ planTitle }}</h2>
              <p>
                {{
                  scope === "week"
                    ? weekLabel
                    : scope === "today"
                      ? shortDate(overview.today)
                      : t("All time")
                }}
                · {{ t("{count} tasks", { count: overview.selected.total }) }}
              </p>
            </div>
          </div>
          <div
            v-if="scope !== 'all'"
            class="week-days"
            role="group"
            :aria-label="t('Filter work by day')"
          >
            <button
              v-for="day in days"
              :key="day"
              :class="{
                today: day === overview.today,
                selected:
                  (scope === 'today' ? overview.today : selectedDay) === day,
              }"
              :aria-pressed="
                (scope === 'today' ? overview.today : selectedDay) === day
              "
              :aria-label="
                t('Work planned for {date}', {
                  date: formatDate(day, { dateStyle: 'full' }),
                })
              "
              @click="
                change({
                  overviewScope: 'week',
                  overviewDay: selectedDay === day ? undefined : day,
                })
              "
            >
              <span>{{ formatDate(day, { weekday: "short" }) }}</span
              ><strong>{{ shortDate(day) }}</strong
              ><small v-if="day === overview.today">{{ t("Today") }}</small>
            </button>
          </div>
        </header>
        <p v-if="selectedDay" class="day-filter">
          <span
            >{{
              formatDate(selectedDay, {
                month: "long",
                day: "numeric",
                weekday: "long",
              })
            }}
            ·
            {{
              t("{count} tasks", {
                count: groups.scheduled.length + groups.done.length,
              })
            }}</span
          ><button @click="change({ overviewDay: undefined })">
            {{ t("Show the whole week") }}
          </button>
        </p>
        <section class="work-group">
          <header class="group-heading">
            <PhCalendarBlank :size="18" />
            <h3>{{ t("Scheduled work") }}</h3>
            <span>{{
              t("{count} tasks", { count: groups.scheduled.length })
            }}</span>
            <button
              v-if="groups.scheduled.length > limits.scheduled"
              class="more-rows"
              @click="more('scheduled')"
              :aria-label="
                t('Show {count} more', {
                  count: Math.min(
                    8,
                    groups.scheduled.length - limits.scheduled,
                  ),
                })
              "
            >
              {{ t("More work") }}<PhCaretDown :size="14" />
            </button>
          </header>
          <WorkspaceTaskRows
            v-if="groups.scheduled.length"
            :tasks="groups.scheduled.slice(0, limits.scheduled)"
            :projects="overview.projects"
            :today="overview.today"
            variant="scheduled"
            @inspect="selectedTaskId = $event"
            @arrange="arrangingId = $event"
            @error="actionError = $event"
          />
          <p v-else class="workbench-empty">
            {{
              t(
                selectedDay
                  ? "No work planned for this day."
                  : "No work planned in this scope.",
              )
            }}
          </p>
        </section>
        <section v-if="!selectedDay && scope !== 'today'" class="work-group">
          <header class="group-heading">
            <PhClock :size="18" />
            <h3>
              {{
                t(
                  scope === "week"
                    ? "This week · day to arrange"
                    : "Dates to arrange",
                )
              }}
            </h3>
            <span>{{
              t("{count} tasks", { count: groups.undated.length })
            }}</span>
            <button
              v-if="groups.undated.length > limits.undated"
              class="more-rows"
              @click="more('undated')"
              :aria-label="
                t('Show {count} more', {
                  count: Math.min(8, groups.undated.length - limits.undated),
                })
              "
            >
              {{ t("More work") }}<PhCaretDown :size="14" />
            </button>
          </header>
          <WorkspaceTaskRows
            v-if="groups.undated.length"
            :tasks="groups.undated.slice(0, limits.undated)"
            :projects="overview.projects"
            :today="overview.today"
            variant="undated"
            @inspect="selectedTaskId = $event"
            @arrange="arrangingId = $event"
            @error="actionError = $event"
          />
          <p v-else class="workbench-empty">
            {{ t("No work waiting for a date.") }}
          </p>
        </section>
        <details class="work-group completed-group" open>
          <summary class="group-heading">
            <PhCheckCircle :size="18" />
            <h3>{{ t("Completed") }}</h3>
            <span>{{ t("{count} tasks", { count: groups.done.length }) }}</span
            ><PhCaretDown class="group-caret" :size="16" />
          </summary>
          <WorkspaceTaskRows
            v-if="groups.done.length"
            :tasks="groups.done.slice(0, limits.done)"
            :projects="overview.projects"
            :today="overview.today"
            variant="done"
            @inspect="selectedTaskId = $event"
            @arrange="arrangingId = $event"
            @error="actionError = $event"
          />
          <p v-else class="workbench-empty">
            {{ t("No completed work in this scope.") }}
          </p>
          <button
            v-if="groups.done.length > limits.done"
            class="more-rows"
            @click="more('done')"
          >
            {{
              t("Show {count} more", {
                count: Math.min(8, groups.done.length - limits.done),
              })
            }}<PhCaretDown :size="14" />
          </button>
        </details>
        <section class="workbench-latest">
          <header>
            <h3><PhNoteBlank :size="21" />{{ t("Latest progress log") }}</h3>
            <RouterLink to="/activity"
              >{{ t("Activity") }}<PhArrowRight :size="14"
            /></RouterLink>
          </header>
          <p v-if="!overview.recentProjects.length" class="workbench-empty">
            {{ t("No progress reports in this range") }}
          </p>
          <RouterLink
            v-for="project in overview.recentProjects.slice(0, 2)"
            :key="project.id"
            :to="'/projects/' + project.id"
            class="progress-row"
            ><time>{{
              project.reportedAt
                ? formatDate(project.reportedAt, {
                    month: "short",
                    day: "numeric",
                  })
                : t("Report time unavailable")
            }}</time
            ><strong>{{ project.name }}</strong
            ><span :title="project.latestUpdate">{{
              project.latestUpdate
            }}</span></RouterLink
          >
        </section>
      </section>
      <aside class="workbench-attention" :aria-label="t('Needs attention')">
        <header class="panel-heading">
          <PhWarning :size="26" />
          <div>
            <h2>{{ t("Needs attention") }}</h2>
            <p>{{ t("All dates · independent of the work scope") }}</p>
          </div>
        </header>
        <section class="risk-section overdue-section">
          <header>
            <PhWarningCircle :size="22" weight="fill" />
            <h3>{{ t("{count} overdue", { count: overdue.length }) }}</h3>
          </header>
          <WorkspaceTaskRows
            v-if="overdue.length"
            :tasks="overdue.slice(0, 2)"
            :projects="overview.projects"
            :today="overview.today"
            variant="risk"
            risk="overdue"
            @inspect="selectedTaskId = $event"
          />
          <p v-else class="workbench-empty">
            {{ t("No overdue work in these projects.") }}
          </p>
          <RouterLink
            v-if="overdue.length"
            class="risk-link"
            :to="taskLink({ scope: 'all', risk: 'overdue' })"
            >{{ t("View all {count}", { count: overdue.length })
            }}<PhArrowRight :size="14"
          /></RouterLink>
        </section>
        <section class="risk-section blocked-section">
          <header>
            <PhWarning :size="22" weight="fill" />
            <h3>
              {{
                t("{count} need coordination", {
                  count: overview.all.blocked.length,
                })
              }}
            </h3>
          </header>
          <WorkspaceTaskRows
            v-if="overview.all.blocked.length"
            :tasks="overview.all.blocked.slice(0, 2)"
            :projects="overview.projects"
            :today="overview.today"
            variant="risk"
            risk="blocked"
            @inspect="selectedTaskId = $event"
          />
          <p v-else class="workbench-empty">
            {{ t("No work needs coordination.") }}
          </p>
          <RouterLink
            v-if="overview.all.blocked.length"
            class="risk-link"
            :to="taskLink({ scope: 'all', status: 'blocked' })"
            >{{ t("View all {count}", { count: overview.all.blocked.length })
            }}<PhArrowRight :size="14"
          /></RouterLink>
        </section>
        <section class="unplanned-section">
          <PhClock :size="23" weight="fill" />
          <div>
            <h3>
              {{
                t("{count} unplanned", { count: overview.all.unplanned.length })
              }}
            </h3>
            <p>{{ t("No work week or day assigned yet.") }}</p>
          </div>
          <RouterLink :to="taskLink({ scope: 'all', risk: 'unplanned' })"
            >{{ t("Plan work") }}<PhArrowRight :size="14"
          /></RouterLink>
        </section>
        <p class="risk-note">
          <PhInfo :size="16" />{{ t("Task categories can overlap.") }}
        </p>
      </aside>
    </div>
    <footer class="workbench-footer">
      <span v-if="store.lastSynced">{{
        t("Updated {time}", {
          time: formatDate(store.lastSynced, {
            hour: "2-digit",
            minute: "2-digit",
          }),
        })
      }}</span
      ><button :disabled="store.loading || store.busy" @click="store.refresh()">
        <PhArrowClockwise :size="15" />{{ t("Refresh") }}</button
      ><RouterLink to="/directory?tab=work"
        >{{ t("Open people planning") }}<PhArrowRight :size="14"
      /></RouterLink>
    </footer>
    <details v-if="overview.projects.length" class="workbench-context">
      <summary>
        {{ t("Project context")
        }}<span>{{ t("Milestones, stages and weekly changes") }}</span
        ><PhCaretDown :size="16" />
      </summary>
      <ProjectScheduleOverview :project-ids="overview.projectIds" />
      <section class="workbench-stages">
        <h2>{{ t("Project stages") }}</h2>
        <div>
          <article v-for="id in stageIds" :key="id">
            <StatusBadge :stage="id" /><strong>{{
              formatNumber(overview.stages[id]!.projects)
            }}</strong
            ><span>{{
              t("{count} open", { count: overview.stages[id]!.open })
            }}</span>
          </article>
        </div>
      </section>
      <WeeklyChanges
        :activities="store.data.activities"
        :projects="overview.projects"
        :project-ids="overview.projectIds"
      />
    </details>
    <TaskDetailPanel
      v-if="selectedTaskId"
      :task-id="selectedTaskId"
      :fallback-focus="scopeControl"
      @close="closeOverlay('task')"
    />
    <CalendarDateEdit
      v-if="arrangingTask"
      :key="arrangingTask.id"
      :task="arrangingTask"
      basis="work"
      @close="closeOverlay('dates')"
    />
  </section>
</template>
<style scoped>
.workspace-overview {
  min-width: 0;
  padding-top: 18px;
  padding-bottom: 24px;
}
.workbench-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 22px;
}
.workbench-heading-copy {
  min-width: 0;
}
.workbench-heading h1 {
  font-size: 28px;
  letter-spacing: -0.7px;
  line-height: 1.4;
  margin: 0 0 8px;
}
.workbench-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
  margin: 0;
  color: var(--muted);
  font-size: 12px;
}
.workbench-meta span + span {
  border-left: 1px solid var(--border);
  padding-left: 14px;
}
.workbench-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}
.workbench-actions button,
.plan-action {
  min-height: 42px;
  gap: 7px;
}
.workbench-scope {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--border);
  background: var(--surface);
  border-radius: 7px;
  padding-left: 12px;
  color: var(--text-secondary);
}
.workbench-scope select {
  min-height: 40px;
  padding: 8px 26px 8px 0;
  border: 0;
  background-color: transparent;
  font-size: 13px;
}
.plan-action {
  display: inline-flex;
  align-items: center;
  padding: 9px 16px;
  border-radius: 7px;
  text-decoration: none;
  font-size: 13px;
  font-weight: 600;
  background: var(--primary);
  color: var(--on-primary);
}
.plan-action:hover {
  background: var(--primary-hover);
}
.filter-toggle {
  background: var(--surface);
  font-size: 13px;
}
.filter-toggle.active {
  background: var(--accent-bg);
  color: var(--accent);
  border-color: var(--accent-border);
}
.workbench-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  align-items: end;
  margin-bottom: 20px;
  padding: 16px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 9px;
}
.workbench-filters label {
  display: grid;
  gap: 6px;
  flex: 1;
  min-width: 150px;
  font-size: 12px;
}
.workbench-filters input,
.workbench-filters select {
  width: 100%;
  min-height: 42px;
}
.workbench-filters a {
  display: flex;
  align-items: center;
  gap: 5px;
  min-height: 42px;
  font-size: 12px;
}
.filtered-note {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--muted);
}
.filtered-note button {
  background: none;
  border: 0;
  color: var(--accent);
  font-size: 12px;
}
.workbench-summary {
  display: grid;
  grid-template-columns: 1.1fr 0.8fr 0.8fr 2.1fr;
  align-items: center;
  padding: 15px 24px;
  margin-bottom: 22px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
}
.summary-metric {
  display: flex;
  align-items: center;
  gap: 18px;
  color: var(--text);
  text-decoration: none;
  min-width: 0;
  border-right: 1px solid var(--border);
  padding: 0 22px;
}
.summary-metric:first-child {
  padding-left: 0;
}
.summary-metric:hover .metric-label {
  color: var(--accent);
}
.summary-icon {
  background: var(--accent-bg);
  color: var(--primary);
  border-radius: 8px;
  padding: 10px;
  display: inline-flex;
}
.summary-metric > svg {
  flex-shrink: 0;
  align-self: flex-start;
  margin-top: 2px;
}
.summary-metric.done > svg {
  color: var(--status-done);
}
.summary-metric.open > svg {
  color: var(--primary);
}
.metric-label {
  display: block;
  color: var(--text-secondary);
  font-size: 13px;
  margin-bottom: 5px;
}
.summary-metric strong {
  font-size: 28px;
  font-variant-numeric: tabular-nums;
  line-height: 1.15;
}
.summary-metric small {
  font-size: 12px;
  font-weight: 400;
  margin-left: 7px;
  color: var(--muted);
}
.summary-progress {
  padding-left: 30px;
  min-width: 0;
}
.summary-progress > div {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  color: var(--muted);
  font-size: 12px;
  margin-bottom: 12px;
}
.summary-progress strong {
  font-size: 15px;
  color: var(--primary);
  padding-left: 8px;
}
.summary-progress progress {
  appearance: none;
  display: block;
  width: 100%;
  height: 11px;
  border: 0;
  border-radius: 20px;
  overflow: hidden;
  background: var(--surface-raised);
  accent-color: var(--primary);
}
progress::-webkit-progress-bar {
  background: var(--surface-raised);
  border-radius: 20px;
}
progress::-webkit-progress-value {
  background: var(--primary);
  border-radius: 20px;
}
progress::-moz-progress-bar {
  background: var(--primary);
  border-radius: 20px;
}
.workbench-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.85fr) minmax(340px, 1fr);
  gap: 18px;
  align-items: start;
}
.workbench-plan,
.workbench-attention {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  min-width: 0;
}
.workbench-plan {
  padding: 20px 18px 0;
}
.plan-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  margin-bottom: 20px;
}
.panel-heading {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  min-width: 0;
}
.panel-heading > svg {
  flex-shrink: 0;
  color: var(--primary);
  margin-top: 1px;
}
.panel-heading h2 {
  font-size: 19px;
  line-height: 1.4;
  margin: 0;
}
.panel-heading p {
  color: var(--muted);
  font-size: 12px;
  margin: 5px 0 0;
  line-height: 1.6;
}
.week-days {
  display: flex;
  gap: 5px;
}
.week-days button {
  min-height: 62px;
  width: 48px;
  padding: 6px 3px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  justify-content: center;
  border: 1px solid transparent;
  background: var(--surface-subtle);
  border-radius: 7px;
  font-size: 10px;
  color: var(--muted);
}
.week-days strong {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-secondary);
}
.week-days button.today {
  border-color: var(--accent-border);
  background: var(--accent-bg);
  color: var(--accent);
}
.week-days .today strong,
.week-days .selected strong {
  color: var(--accent);
}
.week-days button.selected {
  border-color: var(--primary);
  box-shadow: inset 0 0 0 1px var(--primary);
  background: var(--accent-bg);
}
.week-days small {
  font-size: 10px;
  line-height: 1;
}
.day-filter {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  color: var(--muted);
}
.day-filter button {
  border: 0;
  background: none;
  font-size: 12px;
  color: var(--accent);
  padding: 4px;
}
.work-group {
  margin: 0 0 15px;
}
.group-heading {
  display: flex;
  align-items: center;
  gap: 9px;
  min-height: 38px;
  padding: 8px 12px;
  background: var(--accent-bg);
  color: var(--accent);
  border-radius: 6px;
  list-style: none;
}
.group-heading::-webkit-details-marker {
  display: none;
}
.group-heading h3 {
  font-size: 14px;
  margin: 0;
  font-weight: 600;
}
.group-heading > span {
  color: var(--muted);
  font-size: 12px;
}
.group-heading .more-rows {
  margin-left: auto;
  min-height: 24px;
  padding: 0;
  flex-shrink: 0;
}
.completed-group .group-heading {
  background: var(--surface-subtle);
  color: var(--status-done);
  cursor: pointer;
}
.group-caret {
  margin-left: auto;
  color: var(--muted);
}
.completed-group[open] .group-caret {
  transform: rotate(180deg);
}
.workbench-empty {
  padding: 16px 12px;
  margin: 0;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.7;
}
.more-rows {
  background: transparent;
  border: 0;
  color: var(--accent);
  font-size: 12px;
  min-height: 36px;
  padding: 8px 10px;
  gap: 5px;
}
.workbench-latest {
  margin: 0 -18px;
  padding: 15px 18px 13px;
  border-top: 1px solid var(--border);
}
.workbench-latest header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 6px;
}
.workbench-latest h3 {
  display: flex;
  gap: 9px;
  align-items: center;
  font-size: 14px;
  margin: 0;
}
.workbench-latest h3 svg {
  color: var(--primary);
}
.workbench-latest header a {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
}
.progress-row {
  display: grid;
  grid-template-columns: 66px minmax(90px, 0.7fr) minmax(0, 1.3fr);
  gap: 12px;
  color: var(--text-secondary);
  text-decoration: none;
  padding: 9px 0;
  font-size: 12px;
}
.progress-row time {
  color: var(--muted);
}
.progress-row strong,
.progress-row > span {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.progress-row:hover strong {
  color: var(--accent);
}
.workbench-attention {
  padding: 20px 16px 18px;
}
.workbench-attention > .panel-heading {
  margin-bottom: 24px;
}
.workbench-attention > .panel-heading > svg {
  color: var(--danger);
}
.risk-section {
  margin-bottom: 20px;
  border: 1px solid var(--border);
  border-radius: 7px;
  overflow: hidden;
}
.risk-section > header {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 11px 12px;
}
.risk-section h3 {
  margin: 0;
  font-size: 14px;
}
.overdue-section > header {
  color: var(--danger);
  background: var(--danger-bg);
}
.blocked-section > header {
  color: var(--status-blocked);
  background: var(--status-blocked-bg);
}
.risk-link {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 5px;
  min-height: 36px;
  padding: 9px 12px;
  font-size: 12px;
  text-decoration: none;
  border-top: 1px solid var(--border);
}
.unplanned-section {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 16px 12px;
  border-radius: 7px;
  background: var(--surface-subtle);
}
.unplanned-section > svg {
  color: var(--muted);
  flex-shrink: 0;
}
.unplanned-section h3 {
  margin: 0;
  font-size: 15px;
}
.unplanned-section p {
  color: var(--muted);
  font-size: 12px;
  line-height: 1.7;
  margin: 8px 0 0;
}
.unplanned-section > a {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-left: auto;
  flex-shrink: 0;
  padding: 6px 8px;
  font-size: 12px;
  border: 1px solid var(--accent-border);
  border-radius: 5px;
  text-decoration: none;
}
.risk-note {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 11px;
  color: var(--muted);
  line-height: 1.7;
  margin: 18px 0 0;
}
.risk-note svg {
  flex-shrink: 0;
}
.workbench-footer {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 12px;
  font-size: 11px;
  color: var(--muted);
}
.workbench-footer button {
  border: 0;
  background: none;
  padding: 6px;
  gap: 5px;
  font-size: 11px;
}
.workbench-footer a {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-left: auto;
}
.workbench-context {
  margin-top: 14px;
}
.workbench-context > summary {
  display: flex;
  gap: 12px;
  align-items: center;
  font-size: 13px;
  cursor: pointer;
  padding: 12px 0;
  border-top: 1px solid var(--border);
}
.workbench-context > summary span {
  color: var(--muted);
  font-size: 11px;
}
.workbench-context > summary svg {
  margin-left: auto;
}
.workbench-stages {
  padding: 20px;
  background: var(--surface);
  margin: 16px 0;
  border: 1px solid var(--border);
  border-radius: 8px;
}
.workbench-stages h2 {
  font-size: 16px;
  margin: 0 0 16px;
}
.workbench-stages > div {
  display: flex;
  flex-wrap: wrap;
  gap: 24px;
}
.workbench-stages article {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
}
.workbench-stages article > span {
  color: var(--muted);
}
@media (min-width: 1780px) {
  .workbench-grid {
    grid-template-columns: minmax(0, 1.85fr) minmax(440px, 1fr);
  }
  .week-days button {
    width: 54px;
  }
}
@media (max-width: 1440px) {
  .workbench-heading {
    align-items: flex-start;
  }
  .workbench-heading h1 {
    font-size: 24px;
  }
  .filter-toggle {
    font-size: 0;
    gap: 0;
    padding: 10px;
  }
  .plan-heading {
    flex-wrap: wrap;
  }
  .week-days {
    margin-left: auto;
  }
  .summary-metric {
    padding: 0 14px;
    gap: 10px;
  }
  .summary-progress {
    padding-left: 20px;
  }
}
@media (max-width: 1050px) {
  .workbench-grid {
    grid-template-columns: minmax(0, 1fr);
  }
  .workbench-attention {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  }
  .workbench-attention > .panel-heading,
  .unplanned-section,
  .risk-note {
    grid-column: 1/-1;
  }
  .workbench-attention > .panel-heading,
  .risk-section,
  .risk-note {
    margin-bottom: 0;
    margin-top: 0;
  }
  .workbench-heading {
    flex-wrap: wrap;
  }
}
@media (max-width: 760px) {
  .workspace-overview {
    padding-top: 20px;
  }
  .workbench-heading {
    gap: 14px;
    margin-bottom: 16px;
  }
  .workbench-heading h1 {
    font-size: 23px;
  }
  .workbench-actions {
    width: 100%;
    gap: 8px;
    flex-wrap: wrap;
  }
  .workbench-scope {
    flex: 1;
  }
  .workbench-scope select {
    width: 100%;
  }
  .workbench-actions button,
  .plan-action {
    min-height: 44px;
  }
  .workbench-summary {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 18px 0;
    padding: 16px 12px;
  }
  .summary-metric {
    gap: 7px;
    padding: 0 10px;
    align-items: flex-start;
  }
  .summary-metric > svg {
    width: 20px;
  }
  .summary-metric.total .summary-icon {
    display: none;
  }
  .summary-metric.open {
    border: 0;
  }
  .summary-metric strong {
    font-size: 24px;
  }
  .summary-metric small {
    display: none;
  }
  .metric-label {
    font-size: 12px;
  }
  .summary-progress {
    grid-column: 1/-1;
    padding: 0;
    border-top: 1px solid var(--border);
    padding-top: 14px;
  }
  .summary-progress > div {
    margin-bottom: 9px;
  }
  .workbench-plan {
    padding: 16px 12px 0;
  }
  .plan-heading {
    gap: 16px;
    margin-bottom: 16px;
  }
  .panel-heading h2 {
    font-size: 18px;
  }
  .week-days {
    width: 100%;
    margin: 0;
    gap: 4px;
  }
  .week-days button {
    flex: 1;
    width: 0;
    min-width: 0;
    min-height: 60px;
  }
  .workbench-latest {
    margin: 0 -12px;
    padding: 15px 12px;
  }
  .progress-row {
    grid-template-columns: 60px minmax(0, 1fr);
    gap: 5px 8px;
  }
  .progress-row > span {
    grid-column: 2;
  }
  .workbench-attention {
    display: block;
    padding: 16px 12px;
  }
  .workbench-attention > .panel-heading {
    margin-bottom: 20px;
  }
  .risk-section {
    margin-bottom: 16px;
  }
  .risk-note {
    margin-top: 16px;
  }
  .workbench-footer a {
    min-height: 44px;
  }
  .workbench-context > summary span {
    display: none;
  }
  .unplanned-section {
    flex-wrap: wrap;
  }
  .unplanned-section > div {
    flex: 1;
    min-width: 120px;
  }
  .workbench-filters label {
    min-width: 100%;
  }
}
</style>
