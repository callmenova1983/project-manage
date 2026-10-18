<script setup lang="ts">
import { computed, ref } from "vue";
import { projectCollectionProjection } from "../../../../packages/domain/project-collection";
import { projectInput, type Project } from "../../../../packages/domain/types";
import { memberName } from "../../../../packages/domain/members";
import { useWorkspace } from "../stores/workspace";
import { useCalendarNow } from "../composables/calendar";
import { catalogs, catalogLabel } from "../composables/catalogs";
import { confirmDiscard } from "../composables/unsaved";
import { t, formatNumber } from "../locales";
import ProjectFollow from "./ProjectFollow.vue";
import StatusBadge from "./StatusBadge.vue";
const props = defineProps<{
  projects: Project[];
  mode: "board" | "cards";
  scope: "today" | "week";
}>();
const store = useWorkspace(),
  now = useCalendarNow();
const projection = computed(() =>
  projectCollectionProjection(
    props.projects,
    store.data.tasks,
    catalogs.value.stages,
    { now: now.value, timeZone: store.timeZone, scope: props.scope },
  ),
);
const error = ref("");
const dragging = ref<Project | null>(null),
  target = ref("");
const activeStages = computed(() =>
  [...catalogs.value.stages]
    .filter((stage) => !stage.archived)
    .sort((a, b) => a.order - b.order),
);
const sections = computed(() =>
  props.mode === "board"
    ? projection.value.columns
    : [
        {
          id: "all",
          archived: false,
          unknown: false,
          projects: props.projects.filter((project) => !project.intakeInbox),
        },
      ],
);
function permitted(stage: string) {
  return (
    stage === "unclassified" ||
    activeStages.value.some((item) => item.id === stage)
  );
}
async function move(project: Project, stage: string) {
  if (store.busy || !permitted(stage) || project.stage === stage) return;
  error.value = "";
  try {
    await store.saveProject(
      projectInput.parse({ ...projectInput.strip().parse(project), stage }),
      project,
    );
    store.notify(
      t("Project moved to {stage}. Current filters may hide it.", {
        stage: catalogLabel("stages", stage),
      }),
    );
  } catch (reason) {
    error.value = (reason as Error).message;
  }
}
async function selectStage(project: Project, event: Event) {
  const control = event.target as HTMLSelectElement;
  if (confirmDiscard()) await move({ ...project }, control.value);
  control.value =
    store.data.projects.find((item) => item.id === project.id)?.stage ??
    project.stage;
}
function start(project: Project, event: DragEvent) {
  if (
    props.mode !== "board" ||
    store.busy ||
    (event.target as HTMLElement).closest("button, select, a, input") ||
    !confirmDiscard()
  ) {
    event.preventDefault();
    return;
  }
  dragging.value = { ...project };
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-pm-project-stage", project.id);
  }
}
async function drop(stage: string, event: DragEvent) {
  event.preventDefault();
  const source = dragging.value;
  dragging.value = null;
  target.value = "";
  if (
    !source ||
    !permitted(stage) ||
    event.dataTransfer?.getData("application/x-pm-project-stage") !== source.id
  )
    return;
  const current = store.data.projects.find(
    (project) => project.id === source.id,
  );
  if (!current || current.version !== source.version) {
    error.value = t(
      "The project changed while dragging. Start again from its latest version.",
    );
    return;
  }
  await move(source, stage);
}
</script>
<template>
  <div class="project-collection-layout">
    <p class="layout-explanation">
      {{
        t(
          mode === "board"
            ? "Drag project cards between stage columns or use the stage menu. Only the project stage changes."
            : "Project cards use the same filters and ordering as the list.",
        )
      }}
    </p>
    <p v-if="error" class="error-box" role="alert">{{ t(error) }}</p>
    <p v-if="projection.inbox.length" class="inbox-note">
      {{
        t("{count} intake projects are kept outside business stage columns.", {
          count: projection.inbox.length,
        })
      }}
      <RouterLink
        v-for="project in projection.inbox"
        :key="project.id"
        :to="`/projects/${project.id}`"
        >{{ project.name }}</RouterLink
      >
    </p>
    <div class="project-layout-columns" :class="`mode-${mode}`">
      <section
        v-for="section in sections"
        :key="section.id"
        class="project-stage-column"
        :class="{ 'is-drop-target': target === section.id }"
        :aria-label="
          mode === 'board'
            ? catalogLabel('stages', section.id)
            : t('Project cards')
        "
        @dragover="
          if (dragging && permitted(section.id)) {
            $event.preventDefault();
            target = section.id;
          }
        "
        @drop="drop(section.id, $event)"
      >
        <h3 v-if="mode === 'board'">
          {{ catalogLabel("stages", section.id) }} ·
          {{ formatNumber(section.projects.length)
          }}<small v-if="section.archived || section.unknown">{{
            t("Existing stage; new moves are unavailable")
          }}</small>
        </h3>
        <div class="project-cards">
          <article
            v-for="project in section.projects"
            :key="project.id"
            class="project-layout-card"
            :draggable="mode === 'board' && !store.busy"
            @dragstart="start(project, $event)"
            @dragend="
              dragging = null;
              target = '';
            "
          >
            <header>
              <RouterLink
                :to="{
                  path: `/projects/${project.id}`,
                  query: { returnView: mode },
                }"
                >{{ project.name }}</RouterLink
              ><ProjectFollow :id="project.id" :name="project.name" />
            </header>
            <StatusBadge :stage="project.stage" />
            <p class="card-owner">
              {{ t("Owner") }} ·
              {{
                memberName(
                  project.ownerId,
                  project.owner,
                  store.data.members ?? [],
                )
              }}
            </p>
            <p class="card-progress">
              {{
                project.latestUpdate || t("No progress reports in this range")
              }}
            </p>
            <dl>
              <div>
                <dt>{{ t("Open work") }}</dt>
                <dd>{{ projection.stats.get(project.id)?.open ?? 0 }}</dd>
              </div>
              <div>
                <dt>{{ t(scope === "today" ? "Today" : "This week") }}</dt>
                <dd>{{ projection.stats.get(project.id)?.planned ?? 0 }}</dd>
              </div>
              <div>
                <dt>{{ t("Overdue") }}</dt>
                <dd>{{ projection.stats.get(project.id)?.overdue ?? 0 }}</dd>
              </div>
              <div>
                <dt>{{ t("Needs coordination") }}</dt>
                <dd>{{ projection.stats.get(project.id)?.blocked ?? 0 }}</dd>
              </div>
            </dl>
            <label
              >{{ t("Stage")
              }}<select
                :value="project.stage"
                :disabled="store.busy"
                :aria-label="t('Stage for {name}', { name: project.name })"
                @change="selectStage(project, $event)"
              >
                <option
                  v-if="!permitted(project.stage)"
                  :value="project.stage"
                  disabled
                >
                  {{ catalogLabel("stages", project.stage) }}
                </option>
                <option
                  v-for="stage in activeStages"
                  :key="stage.id"
                  :value="stage.id"
                >
                  {{ catalogLabel("stages", stage.id) }}
                </option>
                <option value="unclassified">
                  {{ catalogLabel("stages", "unclassified") }}
                </option>
              </select></label
            >
          </article>
          <p v-if="!section.projects.length" class="empty-column">
            {{ t("No matching projects") }}
          </p>
        </div>
      </section>
    </div>
    <p class="layout-explanation">
      {{
        t(
          "Open, overdue and coordination counts use all dates; planned work follows the selected work scope.",
        )
      }}
      · {{ store.timeZone }}
    </p>
  </div>
</template>
<style scoped>
.layout-explanation,
.inbox-note {
  font-size: 12px;
  color: var(--muted);
  line-height: 1.6;
}
.inbox-note a {
  margin: 0 6px;
}
.project-layout-columns.mode-board {
  display: flex;
  gap: 12px;
  overflow-x: auto;
  align-items: flex-start;
  padding-bottom: 12px;
}
.mode-board .project-stage-column {
  flex: 0 0 290px;
  padding: 10px;
  background: var(--surface-raised);
  border: 1px solid var(--border);
  border-radius: 10px;
}
.project-stage-column h3 {
  font-size: 14px;
  margin: 0 0 10px;
}
h3 small {
  display: block;
  font-size: 11px;
  font-weight: 400;
  margin-top: 4px;
  color: var(--muted);
}
.mode-cards .project-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 12px;
}
.project-layout-card {
  min-width: 0;
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  margin-bottom: 10px;
}
.project-layout-card header {
  display: flex;
  gap: 8px;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 8px;
}
header a {
  font-weight: 600;
  overflow-wrap: anywhere;
}
p {
  overflow-wrap: anywhere;
}
.card-owner {
  font-size: 12px;
  color: var(--muted);
}
.card-progress {
  font-size: 13px;
  line-height: 1.6;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
dl {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  font-size: 12px;
}
dl div {
  display: flex;
  gap: 8px;
  justify-content: space-between;
}
dt {
  color: var(--muted);
}
dd {
  margin: 0;
  font-weight: 600;
}
label {
  display: block;
  font-size: 12px;
}
select {
  width: 100%;
  min-height: 44px;
  margin-top: 4px;
}
.is-drop-target {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}
.empty-column {
  font-size: 12px;
  color: var(--muted);
  padding: 20px 0;
}
@media (max-width: 760px) {
  .mode-board .project-stage-column {
    flex-basis: min(290px, 85vw);
  }
  .mode-cards .project-cards {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
