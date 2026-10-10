<script setup lang="ts">
import { computed, ref } from "vue";
import {
  PhMagnifyingGlass,
  PhPlus,
  PhCaretDown,
  PhCaretRight,
  PhArrowUpRight,
  PhFunnel,
  PhNotePencil,
  PhSquaresFour,
} from "@phosphor-icons/vue";
import { useWorkspace } from "../stores/workspace";
import {
  stages,
  disciplines,
  statistics,
  leafTasks,
  dayKey,
  weekKey,
  type Project,
} from "../../../../packages/domain/types";
import { stageLabels } from "../locales/en";
import { confirmDiscard } from "../composables/unsaved";
import StatusBadge from "../components/StatusBadge.vue";
import ProjectEditor from "../components/ProjectEditor.vue";
import TaskList from "../components/TaskList.vue";
import InlineNotes from "../components/InlineNotes.vue";
import PasteTasks from "../components/PasteTasks.vue";
const store = useWorkspace();
const query = ref(""),
  stage = ref(""),
  owner = ref(""),
  discipline = ref(""),
  sort = ref("updated"),
  expanded = ref(""),
  editing = ref(""),
  creating = ref(false),
  pasting = ref("");
const scope = ref<"week" | "today">("week");
const scopeStats = computed(() => statistics(store.data.tasks, scope.value));
const owners = computed(() =>
  [...new Set(store.data.projects.map((p) => p.owner))].sort(),
);
const projects = computed(() =>
  store.data.projects
    .filter(
      (p) =>
        (!query.value ||
          `${p.name} ${p.client} ${p.latestUpdate} ${p.owner}`
            .toLowerCase()
            .includes(query.value.toLowerCase())) &&
        (!stage.value || p.stage === stage.value) &&
        (!owner.value || p.owner === owner.value) &&
        (!discipline.value || p.discipline === discipline.value),
    )
    .sort((a, b) =>
      sort.value === "name"
        ? a.name.localeCompare(b.name)
        : (b.reportedAt ?? "").localeCompare(a.reportedAt ?? ""),
    ),
);
const filtered = computed(
  () => !!(query.value || stage.value || owner.value || discipline.value),
);
function clear() {
  query.value = "";
  stage.value = "";
  owner.value = "";
  discipline.value = "";
}
function tasks(id: string) {
  return store.data.tasks.filter((t) => t.projectId === id);
}
function scopedTasks(id: string) {
  return leafTasks(tasks(id)).filter((t) =>
    scope.value === "week"
      ? t.workWeek === weekKey()
      : t.workDates.includes(dayKey()),
  );
}
function summary(id: string) {
  return statistics(tasks(id), scope.value);
}
function reportTime(p: Project) {
  return p.reportedAt
    ? new Date(p.reportedAt).toLocaleString("en", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "UTC",
      }) + " UTC"
    : "Report time unavailable";
}
function saved(p: Project) {
  creating.value = false;
  editing.value = "";
  expanded.value = p.id;
}
function toggle(id: string) {
  if (!confirmDiscard()) return;
  editing.value = "";
  pasting.value = "";
  expanded.value = expanded.value === id ? "" : id;
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
          Projects
          <span class="title-count">{{ store.data.projects.length }}</span>
        </h1>
        <span class="workspace-totals"
          >{{ store.total.total }} tasks <span>·</span>
          {{ store.total.done }} completed <span>·</span>
          {{ store.total.unfinished }} open</span
        >
      </div>
      <div class="heading-actions">
        <RouterLink to="/meetings" class="button secondary"
          ><PhNotePencil :size="17" />Review meeting notes</RouterLink
        ><button class="primary" :disabled="creating" @click="creating = true">
          <PhPlus :size="17" />New project
        </button>
      </div>
    </section>
    <section class="work-scope-bar" aria-label="Workspace overview">
      <div class="scope-switch" aria-label="Project work scope">
        <button
          :aria-pressed="scope === 'today'"
          :class="{ active: scope === 'today' }"
          @click="scope = 'today'"
        >
          Today <span>{{ store.today.total }}</span></button
        ><button
          :aria-pressed="scope === 'week'"
          :class="{ active: scope === 'week' }"
          @click="scope = 'week'"
        >
          This week <span>{{ store.week.total }}</span>
        </button>
      </div>
      <div class="summary-counts">
        <span><StatusBadge status="todo" />{{ scopeStats.todo }}</span
        ><span
          ><StatusBadge status="in_progress" />{{
            scopeStats.in_progress
          }}</span
        ><span><StatusBadge status="done" />{{ scopeStats.done }}</span
        ><span><StatusBadge status="blocked" />{{ scopeStats.blocked }}</span>
      </div>
      <span class="muted scope-caption"
        >Work planned · independent of due dates</span
      >
    </section>
    <ProjectEditor v-if="creating" @close="creating = false" @saved="saved" />
    <section class="project-section">
      <div class="filterbar">
        <label class="search-field"
          ><PhMagnifyingGlass :size="17" /><input
            v-model="query"
            data-global-search
            aria-label="Search projects"
            placeholder="Search projects, updates, people…"
          /><kbd>/</kbd></label
        >
        <div class="filter-controls">
          <PhFunnel :size="16" class="muted" /><select
            v-model="stage"
            aria-label="Filter by stage"
          >
            <option value="">All stages</option>
            <option v-for="s in stages" :key="s" :value="s">
              {{ stageLabels[s] }}
            </option></select
          ><select v-model="owner" aria-label="Filter by owner">
            <option value="">All owners</option>
            <option v-for="o in owners" :key="o">{{ o }}</option></select
          ><select v-model="discipline" aria-label="Filter by responsibility">
            <option value="">All responsibilities</option>
            <option v-for="d in disciplines" :key="d">{{ d }}</option></select
          ><select v-model="sort" aria-label="Sort projects">
            <option value="updated">Latest report</option>
            <option value="name">Name A–Z</option></select
          ><button v-if="filtered" class="text-button" @click="clear">
            Clear
          </button>
        </div>
      </div>
      <div v-if="!projects.length" class="empty">
        <PhMagnifyingGlass :size="32" />
        <h2>
          {{
            filtered ? "No matching projects" : "Your next project starts here"
          }}
        </h2>
        <p>
          {{
            filtered
              ? "Try a different search or clear your filters."
              : "Create a project to bring the team’s work together."
          }}
        </p>
        <button v-if="filtered" @click="clear">Clear filters</button
        ><button v-else class="primary" @click="creating = true">
          New project
        </button>
      </div>
      <div
        v-else
        class="project-table"
        role="region"
        aria-label="Projects list"
        tabindex="0"
      >
        <div class="project-table-head">
          <span>Project</span><span>Stage</span
          ><span>Latest reported update</span
          ><span>{{
            scope === "week" ? "This week's work" : "Today's work"
          }}</span
          ><span>{{
            scope === "week" ? "This week summary" : "Today summary"
          }}</span
          ><span></span>
        </div>
        <article
          v-for="project in projects"
          :key="project.id"
          class="project-record"
          :class="{ expanded: expanded === project.id }"
        >
          <div class="project-row" @dblclick="edit(project.id)">
            <div class="project-cell">
              <button
                class="icon-button expand-button"
                :aria-label="`Expand ${project.name}`"
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
                ><span>{{ project.client }}</span>
              </div>
            </div>
            <StatusBadge :stage="project.stage" />
            <div class="latest-update">
              <p :title="project.latestUpdate">
                {{ project.latestUpdate || "No update reported yet." }}
              </p>
              <span
                >{{ reportTime(project) }} ·
                {{ project.reportedBy ?? "Reporter unavailable" }}</span
              >
            </div>
            <div class="project-week">
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
              <span v-if="!scopedTasks(project.id).length" class="muted"
                >No work planned</span
              >
            </div>
            <div class="project-scope-summary">
              <span v-if="summary(project.id).total" class="scope-counts"
                ><span :title="`${summary(project.id).todo} To do`"
                  >○ {{ summary(project.id).todo }}</span
                ><span :title="`${summary(project.id).in_progress} In progress`"
                  >◐ {{ summary(project.id).in_progress }}</span
                ><span :title="`${summary(project.id).done} Done`"
                  >✓ {{ summary(project.id).done }}</span
                ><span
                  :title="`${summary(project.id).blocked} Needs coordination`"
                  >△ {{ summary(project.id).blocked }}</span
                ></span
              >
              <span v-else class="muted">—</span>
              <RouterLink
                v-if="summary(project.id).total"
                :to="`/tasks?scope=${scope}&project=${project.id}`"
                >{{ summary(project.id).total }} planned ·
                {{ summary(project.id).unfinished }} open</RouterLink
              >
            </div>
            <RouterLink
              :to="`/projects/${project.id}`"
              class="icon-button"
              :aria-label="`Open ${project.name}`"
              ><PhArrowUpRight :size="17"
            /></RouterLink>
          </div>
          <div v-if="expanded === project.id" class="expanded-content">
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
                  <h4>Tasks & subtasks</h4>
                  <div>
                    <button class="text-button" @click="edit(project.id)">
                      Edit project</button
                    ><button
                      class="text-button"
                      :disabled="pasting === project.id"
                      @click="pasting = project.id"
                    >
                      Paste tasks
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
          </div>
        </article>
      </div>
    </section>
    <p class="list-footnote">
      {{ projects.length }} projects · All team members can view and edit · Work
      scope is independent of due dates
    </p>
  </div>
</template>
