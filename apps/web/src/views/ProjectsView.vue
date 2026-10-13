<script setup lang="ts">
import { currentDay, currentWeek } from "../composables/calendar";
import { memberName } from "../../../../packages/domain/members";
import {
  stageIds as stages,
  catalogs,
  catalogLabel,
} from "../composables/catalogs";
import { computed, ref, toRefs, nextTick, onMounted, watch } from "vue";
import { onBeforeRouteLeave } from "vue-router";
import {
  PhMagnifyingGlass,
  PhPlus,
  PhCaretDown,
  PhCaretRight,
  PhArrowUpRight,
  PhFunnel,
  PhNotePencil,
  PhSquaresFour,
  PhCaretUp,
} from "@phosphor-icons/vue";
import { useWorkspace } from "../stores/workspace";
import {
  statuses,
  disciplines,
  statistics,
  leafTasks,
  type Project,
} from "../../../../packages/domain/types";
import { stageLabels } from "../locales/en";
import { confirmDiscard } from "../composables/unsaved";
import StatusBadge from "../components/StatusBadge.vue";
import ProjectEditor from "../components/ProjectEditor.vue";
import TaskList from "../components/TaskList.vue";
import InlineNotes from "../components/InlineNotes.vue";
import PasteTasks from "../components/PasteTasks.vue";
import { t, formatDate, formatNumber } from "../locales";
import TaskDistribution from "../components/TaskDistribution.vue";
import ProjectStages from "../components/ProjectStages.vue";
import WeeklyChanges from "../components/WeeklyChanges.vue";
import NextWork from "../components/NextWork.vue";
const store = useWorkspace();
const {
  query,
  stage,
  owner,
  discipline,
  category,
  sort,
  expanded,
  scope,
  insightsOpen,
} = toRefs(store.projectNavigation);
const editing = ref(""),
  creating = ref(false),
  pasting = ref("");
const expandButtons = new Map<string, HTMLElement>();
function rememberButton(id: string, element: unknown) {
  if (element instanceof HTMLElement) expandButtons.set(id, element);
  else expandButtons.delete(id);
}
async function returnFocus() {
  const id = store.projectNavigation.returnFocus;
  if (!id) return;
  await nextTick();
  const button = expandButtons.get(id);
  if (button) {
    button.focus({ preventScroll: true });
    store.projectNavigation.returnFocus = "";
  }
}
onMounted(returnFocus);
watch(() => store.data.projects.length, returnFocus);
onBeforeRouteLeave(() => {
  const record = document.activeElement?.closest<HTMLElement>(
    "[data-project-record]",
  );
  store.projectNavigation.returnFocus =
    record?.dataset.projectRecord ?? expanded.value;
});
const scopeDate = computed(() => {
  const format = (date: string) =>
    formatDate(date, { month: "short", day: "numeric" });
  if (scope.value === "today")
    return `${format(currentDay())}, ${currentDay().slice(0, 4)} · ${store.timeZone}`;
  const start = currentWeek();
  const end = new Date(Date.parse(start) + 6 * 86400000)
    .toISOString()
    .slice(0, 10);
  return `${format(start)}–${format(end)}, ${end.slice(0, 4)} · ${store.timeZone}`;
});
const scopeStats = computed(() =>
  statistics(store.data.tasks, scope.value, new Date(), store.timeZone),
);
const ownerKey = (p: Project) =>
  JSON.stringify(p.ownerId ? ["member", p.ownerId] : ["text", p.owner]);
const ownerName = (p: Project) =>
  memberName(p.ownerId, p.owner, store.data.members ?? []);
const owners = computed(() =>
  [
    ...new Map(
      store.data.projects.map((p) => {
        const member = store.data.members?.find((m) => m.id === p.ownerId);
        return [
          ownerKey(p),
          {
            id: ownerKey(p),
            label: member
              ? `${member.name} · ${member.email}${member.status !== "active" ? ` · ${t(member.status)}` : ""}`
              : p.owner,
          },
        ];
      }),
    ).values(),
  ].sort((a, b) => a.label.localeCompare(b.label)),
);
const projects = computed(() =>
  store.data.projects
    .filter(
      (p) =>
        (!query.value ||
          `${p.name} ${p.client} ${p.latestUpdate} ${ownerName(p)}`
            .toLowerCase()
            .includes(query.value.toLowerCase())) &&
        (!stage.value || p.stage === stage.value) &&
        (!owner.value ||
          ownerKey(p) === owner.value ||
          (!p.ownerId && p.owner === owner.value)) &&
        (!discipline.value || p.discipline === discipline.value) &&
        (!category.value || p.categoryIds?.includes(category.value)),
    )
    .sort((a, b) =>
      sort.value === "name"
        ? a.name.localeCompare(b.name)
        : (b.reportedAt ?? "").localeCompare(a.reportedAt ?? ""),
    ),
);
const filtered = computed(
  () =>
    !!(
      query.value ||
      stage.value ||
      owner.value ||
      discipline.value ||
      category.value
    ),
);
function clear() {
  query.value = "";
  stage.value = "";
  owner.value = "";
  discipline.value = "";
  category.value = "";
}
function tasks(id: string) {
  return store.data.tasks.filter((t) => t.projectId === id);
}
function scopedTasks(id: string) {
  return leafTasks(tasks(id)).filter((t) =>
    scope.value === "week"
      ? t.workWeek === currentWeek()
      : t.workDates.includes(currentDay()),
  );
}
function summary(id: string) {
  return statistics(tasks(id), scope.value, new Date(), store.timeZone);
}
function reportTime(p: Project) {
  return p.reportedAt
    ? formatDate(p.reportedAt, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }) +
        " " +
        store.timeZone
    : t("Report time unavailable");
}
function saved(p: Project) {
  creating.value = false;
  editing.value = "";
  expanded.value = p.id;
}
const portfolioProjects = computed(() =>
  store.data.projects.filter((p) => !p.intakeInbox),
);
const inbox = computed(() => store.data.projects.find((p) => p.intakeInbox));
async function toggle(id: string) {
  if (!confirmDiscard()) return;
  editing.value = "";
  pasting.value = "";
  expanded.value = expanded.value === id ? "" : id;
  await nextTick();
  expandButtons.get(id)?.focus({ preventScroll: !!expanded.value });
}
function edit(id: string) {
  if (!confirmDiscard()) return;
  expanded.value = id;
  editing.value = id;
}
</script>
<template>
  <div class="page projects-page">
    <section class="page-heading">
      <div class="compact-title">
        <h1>
          {{ t("Projects") + " "
          }}<span class="title-count">{{
            formatNumber(portfolioProjects.length)
          }}</span>
        </h1>
        <span class="workspace-totals"
          >{{ t("{count} tasks", { count: store.total.total }) }} <span>·</span>
          {{ t("{count} completed", { count: store.total.done }) }}
          <span>·</span>
          {{ t("{count} open", { count: store.total.unfinished }) }}</span
        >
      </div>
      <div class="heading-actions">
        <RouterLink to="/intake" class="button secondary">{{
          t("Quick intake")
        }}</RouterLink>
        <RouterLink to="/meetings" class="button secondary"
          ><PhNotePencil :size="17" />{{
            t("Review meeting notes")
          }}</RouterLink
        ><button class="primary" :disabled="creating" @click="creating = true">
          <PhPlus :size="17" />{{ t("New project") }}
        </button>
      </div>
    </section>
    <section class="work-scope-bar" :aria-label="t('Workspace overview')">
      <div class="scope-switch" :aria-label="t('Project work scope')">
        <button
          :aria-pressed="scope === 'today'"
          :class="{ active: scope === 'today' }"
          @click="scope = 'today'"
        >
          {{ t("Today")
          }}<span>{{ formatNumber(store.today.total) }}</span></button
        ><button
          :aria-pressed="scope === 'week'"
          :class="{ active: scope === 'week' }"
          @click="scope = 'week'"
        >
          {{ t("This week") }}<span>{{ formatNumber(store.week.total) }}</span>
        </button>
      </div>
      <span class="scope-date" aria-live="polite">{{ scopeDate }}</span>
      <div class="summary-counts">
        <span><StatusBadge status="todo" />{{ scopeStats.todo }}</span
        ><span
          ><StatusBadge status="in_progress" />{{
            scopeStats.in_progress
          }}</span
        ><span><StatusBadge status="done" />{{ scopeStats.done }}</span
        ><span><StatusBadge status="blocked" />{{ scopeStats.blocked }}</span>
      </div>
      <TaskDistribution
        class="overview-distribution"
        :tasks="
          leafTasks(store.data.tasks).filter((task) =>
            scope === 'week'
              ? task.workWeek === currentWeek()
              : task.workDates.includes(currentDay()),
          )
        "
        compact
        :showLegend="false"
      />
      <span class="muted scope-caption">{{
        t("Work planned · independent of due dates")
      }}</span>
    </section>
    <ProjectStages
      :projects="portfolioProjects"
      :selected="stage"
      @select="stage = $event"
    />
    <p v-if="inbox" class="muted">
      {{ t("Unassigned work is kept separately in") }}
      <RouterLink :to="`/projects/${inbox.id}`">{{
        t("Intake inbox")
      }}</RouterLink
      >.
    </p>
    <div class="insights-control">
      <button
        class="text-button"
        :aria-expanded="insightsOpen"
        aria-controls="portfolio-insights"
        @click="insightsOpen = !insightsOpen"
      >
        <PhCaretDown :size="14" :class="{ collapsed: !insightsOpen }" />{{
          t("Changes & next work")
        }}</button
      ><span class="muted">{{ t("Saved history · upcoming tasks") }}</span>
    </div>
    <div v-if="insightsOpen" id="portfolio-insights" class="portfolio-insights">
      <WeeklyChanges
        :activities="store.data.activities"
        :projects="portfolioProjects"
        :projectIds="
          filtered ? projects.map((project) => project.id) : undefined
        "
      /><NextWork
        :tasks="store.data.tasks"
        :projects="projects"
        :scope="scope"
      />
    </div>
    <ProjectEditor v-if="creating" @close="creating = false" @saved="saved" />
    <section class="project-section">
      <div class="filterbar">
        <label class="search-field"
          ><PhMagnifyingGlass :size="17" /><input
            v-model="query"
            data-global-search
            :aria-label="t('Search projects')"
            :placeholder="t('Search projects, updates, people…')"
          /><kbd>/</kbd></label
        >
        <div class="filter-controls">
          <PhFunnel :size="16" class="muted" /><select
            v-model="stage"
            :aria-label="t('Filter by stage')"
          >
            <option value="">{{ t("All stages") }}</option>
            <option value="unclassified">{{ stageLabels.unclassified }}</option>
            <option v-for="s in stages" :key="s" :value="s">
              {{ stageLabels[s] }}
            </option></select
          ><select v-model="owner" :aria-label="t('Filter by owner')">
            <option value="">{{ t("All owners") }}</option>
            <option v-for="o in owners" :key="o.id" :value="o.id">
              {{ o.label }}
            </option></select
          ><select
            v-model="discipline"
            :aria-label="t('Filter by responsibility')"
          >
            <option value="">{{ t("All responsibilities") }}</option>
            <option v-for="d in disciplines" :key="d" :value="d">
              {{ t(d) }}
            </option></select
          ><select
            v-if="catalogs.categories.length"
            v-model="category"
            :aria-label="t('Filter by category')"
          >
            <option value="">{{ t("All categories") }}</option>
            <option
              v-for="item in catalogs.categories"
              :key="item.id"
              :value="item.id"
            >
              {{ catalogLabel("categories", item.id) }}
            </option></select
          ><select v-model="sort" :aria-label="t('Sort projects')">
            <option value="updated">{{ t("Latest report") }}</option>
            <option value="name">{{ t("Name A–Z") }}</option></select
          ><button v-if="filtered" class="text-button" @click="clear">
            {{ t("Clear") }}
          </button>
        </div>
      </div>
      <div v-if="!projects.length" class="empty">
        <PhMagnifyingGlass :size="32" />
        <h2>
          {{
            t(
              filtered
                ? "No matching projects"
                : "Your next project starts here",
            )
          }}
        </h2>
        <p>
          {{
            t(
              filtered
                ? "Try a different search or clear your filters."
                : "Create a project to bring the team’s work together.",
            )
          }}
        </p>
        <button v-if="filtered" @click="clear">{{ t("Clear filters") }}</button
        ><button v-else class="primary" @click="creating = true">
          {{ t("New project") }}
        </button>
      </div>
      <div
        v-else
        class="project-table"
        role="region"
        :aria-label="t('Projects list')"
        tabindex="0"
      >
        <div class="project-table-head">
          <span>{{ t("Project") }}</span
          ><span>{{ t("Stage") }}</span
          ><span>{{ t("Latest reported update") }}</span
          ><span>{{
            t(scope === "week" ? "This week's work" : "Today's work")
          }}</span
          ><span>{{
            t(scope === "week" ? "This week summary" : "Today summary")
          }}</span
          ><span></span>
        </div>
        <article
          v-for="project in projects"
          :key="project.id"
          class="project-record"
          :data-project-record="project.id"
          :class="{ expanded: expanded === project.id }"
        >
          <div class="project-row">
            <div class="project-cell">
              <button
                class="icon-button expand-button"
                :ref="(element) => rememberButton(project.id, element)"
                :aria-controls="`project-details-${project.id}`"
                :aria-label="t('Expand {name}', { name: project.name })"
                :aria-expanded="expanded === project.id"
                @click="toggle(project.id)"
              >
                <PhCaretDown
                  v-if="expanded === project.id"
                  :size="15"
                /><PhCaretRight v-else :size="15" />
              </button>
              <div class="project-monogram" :class="project.stage">
                <PhSquaresFour :size="18" weight="duotone" />
              </div>
              <div class="project-name">
                <RouterLink :to="`/projects/${project.id}`">{{
                  project.name
                }}</RouterLink
                ><span>{{ project.client || t("Client to complete") }}</span>
              </div>
            </div>
            <StatusBadge :stage="project.stage" />
            <div
              class="latest-update"
              :data-label="t('Latest reported update')"
            >
              <p :title="project.latestUpdate">
                {{ project.latestUpdate || t("No update reported yet.") }}
              </p>
              <span
                >{{ reportTime(project) }} ·
                {{ project.reportedBy ?? t("Reporter unavailable") }}</span
              >
            </div>
            <div class="project-week" :data-label="t('Planned work')">
              <RouterLink
                v-for="task in scopedTasks(project.id).slice(0, 2)"
                :key="task.id"
                :to="`/projects/${project.id}`"
                class="week-task"
                ><StatusBadge :status="task.status" /><span
                  :title="task.title"
                  >{{ task.title }}</span
                ></RouterLink
              >
              <span v-if="!scopedTasks(project.id).length" class="muted">{{
                t("No work planned")
              }}</span>
            </div>
            <div class="project-scope-summary">
              <RouterLink
                v-if="summary(project.id).total"
                class="scope-summary-link"
                :to="`/tasks?scope=${scope}&project=${project.id}`"
                :aria-label="
                  t('View {count} planned tasks for {name}', {
                    count: summary(project.id).total,
                    name: project.name,
                  })
                "
              >
                <TaskDistribution
                  :tasks="scopedTasks(project.id)"
                  compact
                  :showLegend="false"
                />
                <span class="scope-counts"
                  ><span v-for="status in statuses" :key="status"
                    ><StatusBadge :status="status" iconOnly />{{
                      " " + formatNumber(summary(project.id)[status])
                    }}</span
                  ></span
                >
              </RouterLink>
              <span v-else class="muted" :aria-label="t('No work planned')"
                >—</span
              >
            </div>
            <RouterLink
              :to="`/projects/${project.id}`"
              class="icon-button"
              :aria-label="t('Open {name}', { name: project.name })"
              ><PhArrowUpRight :size="17"
            /></RouterLink>
          </div>
          <div
            v-if="expanded === project.id"
            :id="`project-details-${project.id}`"
            class="expanded-content"
          >
            <ProjectEditor
              v-if="editing === project.id"
              :project="project"
              @close="editing = ''"
              @saved="saved"
            />
            <div v-else class="expanded-columns">
              <InlineNotes :project="project" />
              <section class="inline-subtasks">
                <div class="section-heading">
                  <h4>{{ t("Tasks & subtasks") }}</h4>
                  <div>
                    <button class="text-button" @click="edit(project.id)">
                      {{ t("Edit project") }}</button
                    ><button
                      class="text-button"
                      :disabled="pasting === project.id"
                      @click="pasting = project.id"
                    >
                      {{ t("Paste tasks") }}
                    </button>
                  </div>
                </div>
                <PasteTasks
                  v-if="pasting === project.id"
                  :projectId="project.id"
                  @close="pasting = ''"
                />
                <div class="inline-task-scroll">
                  <TaskList
                    :tasks="tasks(project.id)"
                    :projectId="project.id"
                  />
                </div>
              </section>
            </div>
            <div class="project-return-actions">
              <button
                class="text-button"
                :aria-label="t('Collapse {name}', { name: project.name })"
                @click="toggle(project.id)"
              >
                <PhCaretUp :size="16" />{{ t("Collapse project details") }}
              </button>
              <RouterLink class="text-button" to="/intake"
                ><PhNotePencil :size="16" />{{ t("Quick intake") }}</RouterLink
              >
            </div>
          </div>
        </article>
      </div>
    </section>
    <p class="list-footnote">
      {{
        t(
          "{count} projects · All team members can view and edit · Work scope is independent of due dates",
          { count: projects.filter((p) => !p.intakeInbox).length },
        )
      }}
    </p>
  </div>
</template>

<style scoped>
.project-return-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  border-top: 1px solid var(--border);
  padding-top: 10px;
  margin-top: 12px;
}
.project-return-actions > * {
  min-height: 36px;
  font-size: 12px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.project-record {
  scroll-margin-top: 72px;
}
.expanded-content {
  animation: project-reveal 0.16s ease-out;
}
@keyframes project-reveal {
  from {
    opacity: 0.6;
    transform: translateY(-3px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
@media (max-width: 760px) {
  .project-return-actions > * {
    min-height: 44px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .expanded-content {
    animation: none;
  }
}
.overview-distribution {
  width: 130px;
  flex-shrink: 0;
}
.insights-control {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 5px 0 7px;
}
.insights-control > button {
  min-height: 36px;
  font-size: 12px;
  gap: 6px;
}
.insights-control > span {
  font-size: 11px;
}
.insights-control .collapsed {
  transform: rotate(-90deg);
}
.portfolio-insights {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
  gap: 12px;
  margin-bottom: 12px;
  align-items: start;
}
.project-scope-summary .scope-summary-link {
  display: block;
}
.project-scope-summary :deep(.distribution-track) {
  margin-bottom: 3px;
}
.project-scope-summary .scope-counts {
  font-size: 11px;
  display: flex;
  justify-content: space-between;
}
.scope-counts > span {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
.scope-counts :deep(.badge) {
  border: 0;
  background: none;
  padding: 0;
}
@media (max-width: 1200px) {
  .overview-distribution {
    display: none;
  }
}
@media (max-width: 700px) {
  .portfolio-insights {
    grid-template-columns: 1fr;
  }
  .insights-control > button {
    min-height: 44px;
  }
  .insights-control > span {
    display: none;
  }
}
</style>
