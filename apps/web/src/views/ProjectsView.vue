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
  PhCheckCircle,
  PhListBullets,
  PhCalendarBlank,
  PhSquaresFour,
} from "@phosphor-icons/vue";
import { useWorkspace } from "../stores/workspace";
import {
  stages,
  disciplines,
  statistics,
  type Project,
} from "../../../../packages/domain/types";
import { stageLabels } from "../locales/en";
import { confirmDiscard } from "../composables/unsaved";
import StatusBadge from "../components/StatusBadge.vue";
import ProjectEditor from "../components/ProjectEditor.vue";
import TaskList from "../components/TaskList.vue";
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
        : b.updatedAt.localeCompare(a.updatedAt),
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
function stats(id: string) {
  return statistics(tasks(id));
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
      <div>
        <div class="eyebrow">YOUR TEAM, IN FOCUS</div>
        <h1>
          Projects
          <span class="title-count">{{ store.data.projects.length }}</span>
        </h1>
        <p class="page-subtitle">
          The latest updates. The work ahead. All in one place.
        </p>
      </div>
      <div class="heading-actions">
        <RouterLink to="/meetings" class="button secondary"
          ><PhNotePencil :size="17" />Review meeting notes</RouterLink
        ><button class="primary" :disabled="creating" @click="creating = true">
          <PhPlus :size="17" />New project
        </button>
      </div>
    </section>
    <section class="overview-strip" aria-label="Workspace overview">
      <div class="metric">
        <span>Total projects</span
        ><strong
          >{{ store.data.projects.length
          }}<small>across all stages</small></strong
        >
      </div>
      <div class="metric">
        <span>Total tasks</span
        ><strong>{{ store.total.total }}<small>leaf tasks</small></strong>
      </div>
      <div class="metric">
        <span><PhCheckCircle :size="14" />Completed</span
        ><strong class="green"
          >{{ store.total.done }}<small>work delivered</small></strong
        >
      </div>
      <div class="metric">
        <span>Open tasks</span
        ><strong
          >{{ store.total.unfinished
          }}<small>across the workspace</small></strong
        >
      </div>
      <RouterLink to="/tasks?scope=week" class="metric scope-metric"
        ><span
          ><PhCalendarBlank :size="14" />This week's work<PhArrowUpRight
            :size="14" /></span
        ><strong
          >{{ store.week.total
          }}<small>{{ store.today.total }} planned for today</small></strong
        ></RouterLink
      >
    </section>
    <section class="week-summary">
      <div class="summary-title">
        <PhListBullets :size="18" /><strong>This week summary</strong
        ><span class="muted">A shared view of what is happening</span>
      </div>
      <div class="summary-counts">
        <RouterLink to="/tasks?scope=week&status=todo"
          ><span class="status-dot todo"></span>{{ store.week.todo }} To
          do</RouterLink
        ><RouterLink to="/tasks?scope=week&status=in_progress"
          ><span class="status-dot in_progress"></span
          >{{ store.week.in_progress }} In progress</RouterLink
        ><RouterLink to="/tasks?scope=week&status=done"
          ><span class="status-dot done"></span
          >{{ store.week.done }} Done</RouterLink
        ><RouterLink to="/tasks?scope=week&status=blocked"
          ><span class="status-dot blocked"></span
          >{{ store.week.blocked }} Needs coordination</RouterLink
        >
      </div>
    </section>
    <ProjectEditor v-if="creating" @close="creating = false" @saved="saved" />
    <section class="project-section">
      <div class="list-heading">
        <div class="tabs">
          <button class="active">
            All projects <span>{{ store.data.projects.length }}</span></button
          ><RouterLink to="/tasks?scope=today"
            >Today's work <span>{{ store.today.total }}</span></RouterLink
          ><RouterLink to="/activity">Activity</RouterLink>
        </div>
        <span class="muted results-label">{{ projects.length }} projects</span>
      </div>
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
            <option value="updated">Latest update</option>
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
      <div v-else class="project-table">
        <div class="project-table-head">
          <span>Project</span><span>Stage</span
          ><span>Latest reported update</span><span>This week's work</span
          ><span>Owner</span><span></span>
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
              <p>{{ project.latestUpdate || "No update reported yet." }}</p>
              <span
                >{{
                  new Date(project.updatedAt).toLocaleDateString("en", {
                    month: "short",
                    day: "numeric",
                  })
                }}
                <span class="dot-separator">·</span>
                {{ stats(project.id).done }} completed</span
              >
            </div>
            <div class="project-week">
              <strong
                >{{ statistics(tasks(project.id), "week").total }} tasks</strong
              ><span
                >{{ statistics(tasks(project.id), "week").done }} done
                <span class="dot-separator">·</span>
                {{ statistics(tasks(project.id), "week").unfinished }}
                open</span
              >
            </div>
            <div class="owner-cell">
              <span class="avatar">{{
                project.owner
                  .split(" ")
                  .map((n) => n[0])
                  .slice(0, 2)
                  .join("")
              }}</span
              ><span>{{ project.owner.split(" ")[0] }}</span>
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
            /><template v-else
              ><div class="section-heading">
                <div>
                  <h3>{{ project.name }}</h3>
                  <p class="muted">{{ project.description }}</p>
                </div>
                <button @click="edit(project.id)">Edit project & notes</button>
              </div>
              <pre v-if="project.notes" class="working-notes">{{
                project.notes
              }}</pre>
              <div class="section-heading">
                <h4>Tasks & subtasks</h4>
                <button
                  class="text-button"
                  :disabled="pasting === project.id"
                  @click="pasting = project.id"
                >
                  Paste tasks
                </button>
              </div>
              <PasteTasks
                v-if="pasting === project.id"
                :projectId="project.id"
                @close="pasting = ''" /><TaskList
                :tasks="tasks(project.id)"
                :projectId="project.id"
            /></template>
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
