<script setup lang="ts">
import { currentDay, currentWeek } from "../composables/calendar";
import { memberName } from "../../../../packages/domain/members";
import {
  channelEntries,
  projectChannel,
} from "../../../../packages/domain/channels";
import {
  stageIds as stages,
  catalogs,
  catalogLabel,
} from "../composables/catalogs";
import { computed, ref, toRefs, nextTick, onMounted, watch } from "vue";
import { useRoute, useRouter, onBeforeRouteLeave } from "vue-router";
import IntakeView from "./IntakeView.vue";
import {
  PhMagnifyingGlass,
  PhPlus,
  PhCaretDown,
  PhCaretRight,
  PhArrowUpRight,
  PhFunnel,
  PhNotePencil,
  PhDotsSixVertical,
  PhStar,
  PhCaretUp,
} from "@phosphor-icons/vue";
import { useWorkspace } from "../stores/workspace";
import {
  projectInput,
  statuses,
  disciplines,
  statistics,
  leafTasks,
  type Project,
  type Task,
} from "../../../../packages/domain/types";
import { stageLabels } from "../locales/en";
import { confirmDiscard } from "../composables/unsaved";
import StatusBadge from "../components/StatusBadge.vue";
import ProjectEditor from "../components/ProjectEditor.vue";
import ClientLabel from "../components/ClientLabel.vue";
import ProjectQuickActions from "../components/ProjectQuickActions.vue";
import { api } from "../services/api";
import { orderedProjectIds } from "../../../../packages/domain/project-order";
import ScopeWork from "../components/ScopeWork.vue";
import ProjectFollow from "../components/ProjectFollow.vue";
import TaskList from "../components/TaskList.vue";
import InlineUpdate from "../components/InlineUpdate.vue";
import PasteTasks from "../components/PasteTasks.vue";
import { t, formatDate, formatNumber } from "../locales";
import TaskDistribution from "../components/TaskDistribution.vue";
import ProjectStages from "../components/ProjectStages.vue";
import WeeklyChanges from "../components/WeeklyChanges.vue";
import NextWork from "../components/NextWork.vue";
const route = useRoute(),
  router = useRouter();
const intakeOpen = computed(() => route.query.intake === "1");
async function toggleIntake() {
  if (intakeOpen.value) return;
  if (!confirmDiscard()) return;
  await router.replace({ query: { ...route.query, intake: "1" } });
}
async function closeIntake() {
  const query = { ...route.query };
  delete query.intake;
  await router.replace({ query });
  await nextTick();
  document.querySelector<HTMLButtonElement>("[data-intake-toggle]")?.focus();
}
const store = useWorkspace();
const {
  query,
  followedOnly,
  stage,
  owner,
  discipline,
  category,
  channel,
  sort,
  expanded,
  scope,
  insightsOpen,
} = toRefs(store.projectNavigation);
const editing = ref(""),
  creating = ref(false),
  pasting = ref("");
try {
  const saved = localStorage.getItem("project-manage-project-sort");
  if (["manual", "updated", "name"].includes(saved ?? "")) sort.value = saved!;
} catch {
  /* Session sorting still works. */
}
watch(sort, (value) => {
  try {
    localStorage.setItem("project-manage-project-sort", value);
  } catch {
    /* Session sorting still works. */
  }
});
const order = computed(() =>
  orderedProjectIds(store.data.projects, store.data.projectOrder),
);
const orderRanks = computed(
  () => new Map(order.value.map((id, index) => [id, index])),
);
const actionRefs = new Map<string, InstanceType<typeof ProjectQuickActions>>();
const dragSource = ref(""),
  dropTarget = ref(""),
  dropZone = ref<"before" | "after" | "merge">("before"),
  orderError = ref("");
let dragProject: Project | null = null;
let dragOrder: string[] = [],
  dragRevision = 0;
function dragStart(project: Project, event: DragEvent) {
  if (store.busy || project.intakeInbox || !confirmDiscard()) {
    event.preventDefault();
    return;
  }
  dragProject = { ...project, ...projectInput.strip().parse(project) };
  dragSource.value = project.id;
  dragOrder = [...order.value];
  dragRevision = store.data.revision;
  event.dataTransfer?.setData("application/x-pm-project", project.id);
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    const row = (event.currentTarget as HTMLElement).closest(".project-row");
    if (row) event.dataTransfer.setDragImage(row, 30, 20);
  }
}
function dragOver(project: Project, event: DragEvent) {
  if (
    !dragSource.value ||
    dragSource.value === project.id ||
    project.intakeInbox ||
    store.busy
  )
    return;
  event.preventDefault();
  const row = (event.currentTarget as HTMLElement).querySelector(
    ".project-row",
  )!;
  const rect = row.getBoundingClientRect(),
    ratio = (event.clientY - rect.top) / rect.height;
  dropTarget.value = project.id;
  dropZone.value = ratio < 0.25 ? "before" : ratio > 0.75 ? "after" : "merge";
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
}
function endDrag() {
  dragSource.value = "";
  dragProject = null;
  dropTarget.value = "";
}
function dragLeave(event: DragEvent) {
  if (
    !(event.currentTarget as HTMLElement).contains(
      event.relatedTarget as Node | null,
    )
  )
    dropTarget.value = "";
}
async function moveProject(
  source: string,
  target: string,
  after: boolean,
  ids = [...order.value],
  revision = store.data.revision,
) {
  orderError.value = "";
  const next = ids.filter((id) => id !== source),
    index = next.indexOf(target);
  if (index < 0 || !ids.includes(source)) return;
  next.splice(index + (after ? 1 : 0), 0, source);
  try {
    await store.operation(
      () => api.saveProjectOrder({ projectIds: next, revision }),
      t("Project order saved"),
    );
    sort.value = "manual";
  } catch (e) {
    orderError.value = (e as Error).message;
  }
}
async function drop(project: Project, event: DragEvent) {
  event.preventDefault();
  const source = dragSource.value,
    zone = dropZone.value;
  if (
    !source ||
    source === project.id ||
    dropTarget.value !== project.id ||
    event.dataTransfer?.getData("application/x-pm-project") !== source
  ) {
    endDrag();
    return;
  }
  endDrag();
  if (zone === "merge") await actionRefs.get(project.id)?.mergeFrom(source);
  else
    await moveProject(
      source,
      project.id,
      zone === "after",
      dragOrder,
      dragRevision,
    );
}
async function moveToStage(targetStage: string, event: DragEvent) {
  event.preventDefault();
  const source = dragProject;
  if (
    !source ||
    store.busy ||
    event.dataTransfer?.getData("application/x-pm-project") !== source.id
  ) {
    endDrag();
    return;
  }
  const permitted =
    targetStage === "unclassified" ||
    catalogs.value.stages.some((s) => s.id === targetStage && !s.archived);
  endDrag();
  if (!permitted || targetStage === source.stage) return;
  orderError.value = "";
  try {
    await store.operation(
      () =>
        api.saveProject(
          { ...projectInput.strip().parse(source), stage: targetStage },
          source.id,
          source.version,
        ),
      t("Moved {name} to {stage}", {
        name: source.shortName || source.name,
        stage: catalogLabel("stages", targetStage),
      }),
    );
    if (stage.value === source.stage) stage.value = targetStage;
  } catch (e) {
    orderError.value = t(
      e instanceof Error ? e.message : "Changes could not be saved",
    );
  }
}
function moveByKey(project: Project, event: KeyboardEvent) {
  if (!["ArrowUp", "ArrowDown"].includes(event.key) || store.busy) return;
  event.preventDefault();
  const index = projects.value.findIndex((p) => p.id === project.id),
    next = projects.value[index + (event.key === "ArrowUp" ? -1 : 1)];
  if (next) void moveProject(project.id, next.id, event.key === "ArrowDown");
}
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
const overviewTasks = computed(() => {
  const tasks = leafTasks(store.data.tasks),
    day = currentDay(),
    week = currentWeek();
  return tasks.filter((task) =>
    scope.value === "week"
      ? task.workWeek === week
      : task.workDates.includes(day),
  );
});
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
          `${p.name} ${p.shortName ?? ""} ${p.aliases.join(" ")} ${p.client} ${p.latestUpdate} ${ownerName(p)}`
            .toLowerCase()
            .includes(query.value.toLowerCase())) &&
        (!channel.value || projectChannel(p) === channel.value) &&
        (!stage.value || p.stage === stage.value) &&
        (!owner.value ||
          ownerKey(p) === owner.value ||
          (!p.ownerId && p.owner === owner.value)) &&
        (!followedOnly.value || store.following.has(p.id)) &&
        (!discipline.value || p.discipline === discipline.value) &&
        (!category.value || p.categoryIds?.includes(category.value)),
    )
    .sort((a, b) =>
      sort.value === "manual"
        ? (orderRanks.value.get(a.id) ?? 0) - (orderRanks.value.get(b.id) ?? 0)
        : sort.value === "name"
          ? a.name.localeCompare(b.name)
          : (b.reportedAt ?? "").localeCompare(a.reportedAt ?? ""),
    ),
);
const filtered = computed(
  () =>
    !!(
      query.value ||
      followedOnly.value ||
      stage.value ||
      owner.value ||
      discipline.value ||
      category.value ||
      channel.value
    ),
);
function clear() {
  query.value = "";
  followedOnly.value = false;
  stage.value = "";
  owner.value = "";
  discipline.value = "";
  category.value = "";
  channel.value = "";
}
const tasksByProject = computed(() => {
  const grouped = new Map<string, Task[]>();
  for (const task of store.data.tasks) {
    const group = grouped.get(task.projectId);
    if (group) group.push(task);
    else grouped.set(task.projectId, [task]);
  }
  return grouped;
});
const scopedByProject = computed(() => {
  // Snapshot refresh invalidates this map, so local-day/week boundaries refresh too.
  const groups = tasksByProject.value,
    day = currentDay(),
    week = currentWeek();
  return new Map(
    [...groups].map(([id, tasks]) => {
      const scoped = leafTasks(tasks).filter((task) =>
        scope.value === "week"
          ? task.workWeek === week
          : task.workDates.includes(day),
      );
      return [id, { tasks: scoped, summary: statistics(scoped) }];
    }),
  );
});
const emptySummary = statistics([]);
const tasks = (id: string) => tasksByProject.value.get(id) ?? [];
const scopedTasks = (id: string) => scopedByProject.value.get(id)?.tasks ?? [];
const summary = (id: string) =>
  scopedByProject.value.get(id)?.summary ?? emptySummary;
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
        <button
          class="button secondary"
          data-intake-toggle
          :aria-expanded="intakeOpen"
          aria-controls="project-intake-panel"
          @click="toggleIntake"
        >
          {{ t("Quick intake") }}
        </button>
        <RouterLink to="/meetings" class="button secondary"
          ><PhNotePencil :size="17" />{{
            t("Review meeting notes")
          }}</RouterLink
        ><button class="primary" :disabled="creating" @click="creating = true">
          <PhPlus :size="17" />{{ t("New project") }}
        </button>
      </div>
    </section>
    <IntakeView
      v-if="intakeOpen"
      id="project-intake-panel"
      embedded
      @close="closeIntake"
    />
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
        :tasks="overviewTasks"
        compact
        :showLegend="false"
      />
      <span class="muted scope-caption">{{
        t("Work planned · independent of due dates")
      }}</span>
    </section>
    <ProjectStages
      :projects="portfolioProjects"
      :tasks="store.data.tasks"
      :selected="stage"
      :drag-project="store.data.projects.find((p) => p.id === dragSource)"
      :busy="store.busy"
      @move="moveToStage"
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
          <button
            class="following-filter"
            :aria-pressed="followedOnly"
            @click="followedOnly = !followedOnly"
          >
            <PhStar :size="16" :weight="followedOnly ? 'fill' : 'regular'" />{{
              t("Following")
            }}
            {{
              formatNumber(
                store.data.projects.filter((p) => store.following.has(p.id))
                  .length,
              )
            }}
          </button>
          <PhFunnel :size="16" class="muted" />
          <select v-model="channel" aria-label="按渠道筛选项目">
            <option value="">全部渠道</option>
            <option
              v-for="entry in channelEntries(catalogs)"
              :key="entry.id"
              :value="entry.id"
            >
              {{ entry.shortName }}{{ entry.archived ? "（已停用）" : "" }}
            </option></select
          ><select v-model="stage" :aria-label="t('Filter by stage')">
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
            <option value="name">{{ t("Name A–Z") }}</option>
            <option value="manual">{{ t("Manual order") }}</option></select
          ><button v-if="filtered" class="text-button" @click="clear">
            {{ t("Clear") }}
          </button>
        </div>
      </div>
      <p class="drag-instructions muted">
        {{
          t(
            "Drag the grip to a stage card to change stage, between rows to reorder, or onto a project to merge. Arrow keys also move a focused grip.",
          )
        }}
      </p>
      <p v-if="orderError" class="error-box" role="alert">
        {{ t(orderError) }}
      </p>
      <p v-if="followedOnly" class="muted following-hint">
        {{
          t(
            "Following is a personal filter saved for this account in this browser. Everyone can still view and edit all projects.",
          )
        }}
      </p>
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
          ><span>{{ t("Latest progress log") }}</span
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
          :class="{
            expanded: expanded === project.id,
            dragging: dragSource === project.id,
            'drop-before': dropTarget === project.id && dropZone === 'before',
            'drop-after': dropTarget === project.id && dropZone === 'after',
            'drop-merge': dropTarget === project.id && dropZone === 'merge',
          }"
          @dragover="dragOver(project, $event)"
          @drop="drop(project, $event)"
          @dragleave="dragLeave"
        >
          <span
            v-if="dropTarget === project.id && dropZone === 'merge'"
            class="project-drop-hint"
            >{{ t("Release to merge into this project") }}</span
          >
          <div class="project-row">
            <div class="project-cell">
              <button
                class="icon-button project-drag-grip"
                :draggable="!store.busy && !project.intakeInbox"
                :disabled="store.busy || project.intakeInbox"
                :aria-label="t('Move {name}', { name: project.name })"
                :title="t('Drag to reorder or merge')"
                @dragstart.stop="dragStart(project, $event)"
                @dragend="endDrag"
                @keydown="moveByKey(project, $event)"
              >
                <PhDotsSixVertical :size="15" />
              </button>
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
              <ProjectFollow :id="project.id" :name="project.name" />
              <div class="project-name">
                <ProjectQuickActions
                  :ref="
                    (el) => {
                      if (el)
                        actionRefs.set(
                          project.id,
                          el as InstanceType<typeof ProjectQuickActions>,
                        );
                      else actionRefs.delete(project.id);
                    }
                  "
                  :project="project"
                  showName
                />
                <ClientLabel :client="project.client" />
                <small class="muted" style="display: block; font-size: 10px"
                  >渠道：{{
                    channelEntries(catalogs).find(
                      (c) => c.id === projectChannel(project),
                    )?.shortName ?? projectChannel(project)
                  }}</small
                >
              </div>
            </div>
            <StatusBadge :stage="project.stage" />
            <div
              class="latest-update"
              :data-label="t('Latest reported update')"
            >
              <InlineUpdate :project="project" compact />
              <span
                >{{ reportTime(project) }} ·
                {{ project.reportedBy ?? t("Reporter unavailable") }}</span
              >
            </div>
            <div class="project-week" :data-label="t('Planned work')">
              <ScopeWork
                :projectId="project.id"
                :tasks="scopedTasks(project.id)"
                :scope="scope"
              />
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
              <section class="inline-subtasks">
                <div class="section-heading">
                  <h4>{{ t("Tasks & subtasks") }}</h4>
                  <div>
                    <RouterLink
                      :to="`/projects/${project.id}#source-records`"
                      class="text-button"
                      >{{ t("View source records") }}</RouterLink
                    >
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
.expanded-columns {
  display: block;
}
.inline-task-scroll {
  max-height: none;
  overflow: visible;
}
.inline-subtasks :deep(.task-row) {
  display: flex;
  flex-wrap: nowrap;
  gap: 10px;
  align-items: center;
  min-height: 38px;
  padding: 3px 0;
}
.inline-subtasks :deep(.task-name) {
  flex: 1;
  min-width: 0;
}
.inline-subtasks :deep(.task-status select) {
  width: 80px;
  min-height: 28px;
  height: 28px;
  padding: 3px 7px;
  font-size: 11px;
}
.inline-subtasks :deep(.task-row > .badge) {
  display: none;
}
.inline-subtasks :deep(.task-assignee),
.inline-subtasks :deep(.task-date) {
  display: block;
  min-width: 80px;
  font-size: 11px;
}
.inline-subtasks :deep(.task-row .icon-button) {
  min-height: 28px;
  height: 28px;
  width: 28px;
  padding: 4px;
}
.inline-subtasks :deep(.field-value) {
  padding: 3px 4px;
  min-height: 28px;
  font-size: 12px;
}
@media (max-width: 760px) {
  .inline-subtasks :deep(.task-row) {
    flex-wrap: wrap;
  }
  .inline-subtasks :deep(.task-name) {
    flex-basis: calc(100% - 96px);
  }
  .inline-subtasks :deep(.task-row .icon-button),
  .inline-subtasks :deep(.field-value) {
    min-height: 36px;
  }
}

.project-row {
  height: auto;
}
.drag-instructions {
  font-size: 11px;
  margin: 6px 0;
}
.project-record {
  position: relative;
}
.project-drag-grip {
  width: 18px;
  min-width: 18px;
  height: 28px;
  padding: 0;
  cursor: grab;
  color: var(--muted);
}
.project-drag-grip:active {
  cursor: grabbing;
}
.project-record.dragging {
  opacity: 0.45;
}
.project-record.drop-merge > .project-row {
  background: var(--surface-selected);
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}
.project-record.drop-before::before,
.project-record.drop-after::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  height: 3px;
  background: var(--accent);
  z-index: 3;
  pointer-events: none;
}
.project-record.drop-before::before {
  top: -2px;
}
.project-record.drop-after::after {
  bottom: -2px;
}
.project-drop-hint {
  position: absolute;
  top: -9px;
  left: 45px;
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 3px;
  background: var(--accent);
  color: white;
  z-index: 4;
  pointer-events: none;
}
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
