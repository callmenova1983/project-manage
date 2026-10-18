<script setup lang="ts">
import {
  projectViewQuery,
  type ProjectViewFilters,
} from "../../../../packages/domain/project-view";
import ProjectFollow from "../components/ProjectFollow.vue";
import { memberName } from "../../../../packages/domain/members";
import ProgressHistory from "../components/ProgressHistory.vue";
import ProjectFiles from "../components/ProjectFiles.vue";
import InlineUpdate from "../components/InlineUpdate.vue";
import InlineNotes from "../components/InlineNotes.vue";
import ProjectWorkspacePane from "../components/ProjectWorkspacePane.vue";
import WorkspaceDialog from "../components/WorkspaceDialog.vue";
import ProjectQuickField from "../components/ProjectQuickField.vue";
import ProjectOwner from "../components/ProjectOwner.vue";
import { catalogLabel } from "../composables/catalogs";
import { t, formatDate, formatNumber } from "../locales";
import { computed, defineAsyncComponent, nextTick, ref, watch } from "vue";
import { onBeforeRouteUpdate, useRoute, useRouter } from "vue-router";
import { confirmDiscard, confirmRetainedDiscard } from "../composables/unsaved";
import {
  PhArrowLeft,
  PhPencilSimple,
  PhChartLineUp,
  PhDotsThree,
  PhInfo,
  PhMapPin,
} from "@phosphor-icons/vue";
import { useWorkspace } from "../stores/workspace";
import { statistics } from "../../../../packages/domain/types";
import {
  locationLabel,
  locationPrecisionLabel,
} from "../../../../packages/domain/project-location";
import ProjectEditor from "../components/ProjectEditor.vue";
import ProjectQuickActions from "../components/ProjectQuickActions.vue";
import ProjectMembers from "../components/ProjectMembers.vue";
import ProjectTaskWorkspace from "../components/ProjectTaskWorkspace.vue";
const SingleProjectOverview = defineAsyncComponent(
  () => import("../components/SingleProjectOverview.vue"),
);
const store = useWorkspace(),
  route = useRoute();
const sourceOpen = ref(false);
const tab = ref<"tasks" | "progress" | "materials">("tasks");
const infoOpen = ref(false),
  moreOpen = ref(false);
const progressEditor = ref<InstanceType<typeof InlineUpdate>>();
function selectTab(value: typeof tab.value) {
  tab.value = value;
}
function tabKey(event: KeyboardEvent, value: typeof tab.value) {
  const values = ["tasks", "progress", "materials"] as const;
  const index = values.indexOf(value);
  const next =
    event.key === "ArrowRight"
      ? values[(index + 1) % 3]
      : event.key === "ArrowLeft"
        ? values[(index + 2) % 3]
        : event.key === "Home"
          ? values[0]
          : event.key === "End"
            ? values[2]
            : undefined;
  if (!next) return;
  event.preventDefault();
  selectTab(next);
  void nextTick(() => document.getElementById(`project-tab-${next}`)?.focus());
}
function reportProgress() {
  if (!confirmDiscard()) return;
  tab.value = "progress";
  void nextTick(() => progressEditor.value?.edit());
}
watch(
  () => route.hash,
  (hash) => {
    if (hash === "#source-records" || hash === "#project-files") {
      sourceOpen.value = hash === "#source-records";
      tab.value = "materials";
    }
    if (hash === "#progress-history") tab.value = "progress";
    if (hash.startsWith("#task-")) tab.value = "tasks";
  },
  { immediate: true },
);
const editing = ref(false);
const router = useRouter();
const quickActions = ref<InstanceType<typeof ProjectQuickActions> | null>(null);
const project = computed(() =>
  store.data.projects.find((p) => p.id === route.params.id),
);
const tasks = computed(() =>
  store.data.tasks.filter((t) => t.projectId === project.value?.id),
);
onBeforeRouteUpdate((to, from) =>
  to.params.id !== from.params.id ? confirmRetainedDiscard() : confirmDiscard(),
);
const counts = computed(() => statistics(tasks.value));
watch(
  () => route.params.id,
  (value, previous) => {
    if (value !== previous) {
      tab.value = ["#source-records", "#project-files"].includes(route.hash)
        ? "materials"
        : route.hash === "#progress-history"
          ? "progress"
          : "tasks";
      infoOpen.value = moreOpen.value = editing.value = false;
      sourceOpen.value = route.hash === "#source-records";
    }
  },
);
</script>
<template>
  <section v-if="project" :key="project.id" class="page detail-page">
    <RouterLink
      :to="{
        path: '/projects',
        query: {
          ...projectViewQuery(store.projectNavigation as ProjectViewFilters),
          view: ['board', 'cards'].includes(String(route.query.returnView))
            ? String(route.query.returnView)
            : undefined,
        },
      }"
      class="back-link"
      ><PhArrowLeft :size="16" />{{ t("All projects") }}</RouterLink
    >
    <header class="project-header">
      <div class="project-heading">
        <h1
          :title="t('Double-click to edit name and short name')"
          @dblclick="quickActions?.rename()"
        >
          {{ project.name }}
        </h1>
        <ProjectFollow :id="project.id" :name="project.name" />
        <span class="heading-spacer"></span>
        <button @click="infoOpen = true">
          <PhInfo :size="17" />{{ t("Project details") }}
        </button>
        <button
          :aria-label="t('More project actions')"
          class="icon-button"
          @click="moreOpen = true"
        >
          <PhDotsThree :size="22" />
        </button>
      </div>
      <div class="project-metadata">
        <ProjectQuickField :project="project" field="stage" />
        <ProjectOwner :project="project" />
        <ProjectQuickField :project="project" field="client" />
        <ProjectQuickField :project="project" field="channelId" />
        <span class="completion-label">{{
          t("{done} of {total} tasks completed", {
            done: formatNumber(counts.done),
            total: formatNumber(counts.total),
          })
        }}</span>
      </div>
    </header>
    <div class="latest-progress-summary">
      <PhChartLineUp :size="17" aria-hidden="true" />
      <button
        class="text-button progress-summary-text"
        :title="project.latestUpdate"
        @click="selectTab('progress')"
      >
        <strong>{{ t("Latest progress log") }}</strong>
        <span>{{ project.latestUpdate || t("No update reported yet.") }}</span>
      </button>
      <time v-if="project.reportedAt" :datetime="project.reportedAt">{{
        formatDate(project.reportedAt, { month: "short", day: "numeric" })
      }}</time>
      <button class="text-button report-progress" @click="reportProgress">
        {{ t("Record progress") }}
      </button>
    </div>
    <div
      class="project-tabs"
      role="tablist"
      :aria-label="t('Project workspace')"
    >
      <button
        v-for="item in [
          ['tasks', 'Tasks'],
          ['progress', 'Progress'],
          ['materials', 'Materials'],
        ] as const"
        :id="`project-tab-${item[0]}`"
        :key="item[0]"
        role="tab"
        :aria-selected="tab === item[0]"
        :aria-controls="`project-panel-${item[0]}`"
        :tabindex="tab === item[0] ? 0 : -1"
        @keydown="tabKey($event, item[0])"
        @click="selectTab(item[0])"
      >
        {{ t(item[1])
        }}<span v-if="item[0] === 'tasks'">{{
          formatNumber(counts.total)
        }}</span>
      </button>
    </div>
    <ProjectWorkspacePane
      :active="tab === 'tasks'"
      id="project-panel-tasks"
      class="project-tab-panel"
      role="tabpanel"
      aria-labelledby="project-tab-tasks"
    >
      <ProjectTaskWorkspace :key="project.id" :project-id="project.id" />
    </ProjectWorkspacePane>
    <ProjectWorkspacePane
      :active="tab === 'progress'"
      id="project-panel-progress"
      class="project-tab-panel progress-panel"
      role="tabpanel"
      aria-labelledby="project-tab-progress"
    >
      <section class="panel progress-composer">
        <div class="section-heading">
          <h2>{{ t("Latest progress log") }}</h2>
        </div>
        <InlineUpdate ref="progressEditor" :project="project" />
        <small class="muted" v-if="project.reportedAt"
          >{{
            formatDate(project.reportedAt, {
              dateStyle: "medium",
              timeStyle: "short",
            })
          }}<template v-if="project.reportedBy">
            · {{ project.reportedBy }}</template
          ></small
        >
      </section>
      <ProgressHistory
        :project="project"
        expanded
        :active="tab === 'progress'"
      />
    </ProjectWorkspacePane>
    <ProjectWorkspacePane
      :active="tab === 'materials'"
      id="project-panel-materials"
      class="project-tab-panel materials-panel"
      role="tabpanel"
      aria-labelledby="project-tab-materials"
    >
      <ProjectFiles
        v-if="tab === 'materials'"
        :key="project.id"
        :project-id="project.id"
      />
      <section class="panel project-background">
        <h2>{{ t("Project context") }}</h2>
        <p v-if="project.description">{{ project.description }}</p>
        <p v-else class="muted">{{ t("No project context yet.") }}</p>
        <button class="text-button" @click="editing = true">
          {{ t("Edit project context") }}
        </button>
      </section>
      <details
        id="source-records"
        class="panel source-records"
        :open="sourceOpen"
        @toggle="sourceOpen = ($event.currentTarget as HTMLDetailsElement).open"
      >
        <summary>
          {{ t("Source records")
          }}<span>{{ t("Meeting text and earlier context") }}</span>
        </summary>
        <InlineNotes :project="project" />
      </details>
    </ProjectWorkspacePane>
    <WorkspaceDialog
      :open="infoOpen"
      :title="t('Project details')"
      variant="drawer"
      @close="confirmDiscard() && (infoOpen = false)"
    >
      <div class="project-facts">
        <h3>{{ project.name }}</h3>
        <dl>
          <dt>{{ t("Stage") }}</dt>
          <dd><ProjectQuickField :project="project" field="stage" /></dd>
          <dt>{{ t("Project owner") }}</dt>
          <dd><ProjectOwner :project="project" /></dd>
          <dt>{{ t("Client") }}</dt>
          <dd><ProjectQuickField :project="project" field="client" /></dd>
          <dt>{{ t("Channel") }}</dt>
          <dd><ProjectQuickField :project="project" field="channelId" /></dd>
          <dt>{{ t("Project location") }}</dt>
          <dd class="project-city-fact">
            <template v-if="project.location">
              <strong
                ><PhMapPin :size="15" aria-hidden="true" />{{
                  locationLabel(project.location)
                }}</strong
              >
              <small
                >{{
                  t(
                    project.location.confirmed
                      ? "Location confirmed"
                      : "Location confirmation pending",
                  )
                }}
                · {{ t(locationPrecisionLabel(project.location)) }}</small
              >
              <small v-if="project.location.precision === 'point'">{{
                t(
                  "Coordinates are supplied by the user; accuracy depends on the entered or selected position.",
                )
              }}</small>
            </template>
            <span v-else class="muted">{{ t("No location set") }}</span>
            <div class="project-city-actions">
              <button
                type="button"
                class="text-button"
                @click="
                  if (confirmDiscard()) {
                    infoOpen = false;
                    editing = true;
                  }
                "
              >
                {{
                  t(
                    project.location
                      ? "Change project location"
                      : "Set project location",
                  )
                }}
              </button>
              <RouterLink
                :to="{ path: '/project-map', query: { project: project.id } }"
                @click="infoOpen = false"
                >{{ t("Open project map") }}</RouterLink
              >
            </div>
          </dd>
          <dt>{{ t("Discipline") }}</dt>
          <dd>{{ t(project.discipline) }}</dd>
          <template v-if="project.shortName"
            ><dt>{{ t("Short name") }}</dt>
            <dd>{{ project.shortName }}</dd></template
          >
          <template v-if="project.aliases.length"
            ><dt>{{ t("Aliases:") }}</dt>
            <dd>{{ project.aliases.join(" · ") }}</dd></template
          >
          <template v-if="project.categoryIds?.length"
            ><dt>{{ t("Categories") }}</dt>
            <dd>
              {{
                project.categoryIds
                  .map((id) => catalogLabel("categories", id))
                  .join(" · ")
              }}
            </dd></template
          >
        </dl>
        <button
          @click="
            if (confirmDiscard()) {
              infoOpen = false;
              editing = true;
            }
          "
        >
          <PhPencilSimple :size="16" />{{ t("Edit project") }}
        </button>
        <section
          v-if="project.participantIds?.length"
          class="project-participants"
        >
          <h3>{{ t("Project participants:") }}</h3>
          <p>
            {{
              project.participantIds
                .map((id) =>
                  memberName(
                    id,
                    "Member unavailable",
                    store.data.members ?? [],
                  ),
                )
                .join(" · ")
            }}
          </p>
        </section>
        <ProjectMembers :project-id="project.id" />
        <SingleProjectOverview
          v-if="infoOpen"
          :key="project.id"
          :project="project"
        />
      </div>
    </WorkspaceDialog>
    <WorkspaceDialog
      :open="moreOpen"
      :title="t('More project actions')"
      variant="sheet"
      @close="moreOpen = false"
    >
      <div class="project-action-list">
        <button
          @click="
            moreOpen = false;
            editing = true;
          "
        >
          <PhPencilSimple :size="18" />{{ t("Edit project") }}
        </button>
        <ProjectQuickActions
          ref="quickActions"
          :project="project"
          labeled
          @merged="
            moreOpen = false;
            router.replace(`/projects/${$event.id}`);
          "
        />
        <RouterLink :to="`/activity?project=${project.id}`">{{
          t("Recent activity")
        }}</RouterLink>
      </div>
    </WorkspaceDialog>
    <WorkspaceDialog
      :open="editing"
      :title="t('Edit project')"
      :busy="store.busy"
      @close="confirmDiscard() && (editing = false)"
    >
      <ProjectEditor
        v-if="editing"
        :project="project"
        @close="editing = false"
        @saved="editing = false"
      />
    </WorkspaceDialog>
  </section>
  <section v-else class="empty">
    <h1>{{ t("Project not found") }}</h1>
    <RouterLink to="/projects" class="button">{{
      t("Return to projects")
    }}</RouterLink>
  </section>
</template>

<style scoped>
.project-city-fact {
  display: grid;
  gap: 6px;
}
.project-city-fact strong,
.project-city-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.project-city-fact small {
  color: var(--muted);
}
.project-city-actions {
  font-size: 12px;
}
.back-link {
  margin-bottom: 4px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--muted);
  font-size: 12px;
  text-decoration: none;
  min-height: 32px;
}
.project-header {
  padding: 4px 0 10px;
}
.project-heading {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.project-heading h1 {
  margin: 0;
  font-size: 25px;
  line-height: 1.4;
  overflow-wrap: anywhere;
}
.heading-spacer {
  flex: 1;
}
.project-heading > button {
  flex: none;
}
.project-metadata {
  display: flex;
  align-items: center;
  gap: 4px 16px;
  flex-wrap: wrap;
  margin-top: 6px;
}
.completion-label {
  font-size: 12px;
  color: var(--muted);
  margin-left: auto;
}
.latest-progress-summary {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 50px;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
}
.latest-progress-summary > svg {
  color: var(--accent);
  flex: none;
}
.progress-summary-text {
  min-width: 0;
  flex: 1;
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding: 0;
  text-align: left;
  color: var(--text);
}
.progress-summary-text strong {
  color: var(--muted);
  font-size: 12px;
  white-space: nowrap;
  font-weight: 500;
}
.progress-summary-text span {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-size: 13px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.latest-progress-summary time {
  color: var(--muted);
  font-size: 12px;
  white-space: nowrap;
}
.report-progress {
  flex: none;
  color: var(--accent);
  font-size: 13px;
}
.project-tabs {
  display: flex;
  border-bottom: 1px solid var(--border);
  margin: 14px 0 0;
  gap: 20px;
}
.project-tabs button {
  border: 0;
  border-radius: 0;
  background: transparent;
  padding: 10px 4px;
  min-height: 44px;
  color: var(--muted);
  display: flex;
  align-items: center;
  gap: 6px;
}
.project-tabs button[aria-selected="true"] {
  color: var(--accent);
  box-shadow: inset 0 -2px var(--accent);
}
.project-tabs span {
  font-size: 11px;
  background: var(--surface-subtle);
  padding: 1px 5px;
  border-radius: 4px;
}
.project-tab-panel {
  padding-top: 14px;
}
.progress-panel,
.materials-panel {
  max-width: 1000px;
}
.project-tab-panel[style*="display: none"] {
  display: none;
}
.progress-composer {
  margin-bottom: 14px;
}
.progress-composer h2,
.project-background h2 {
  font-size: 16px;
  margin: 0;
}
.progress-composer small {
  display: block;
  margin-top: 8px;
}
.project-background p {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 14px;
  line-height: 1.7;
}
.source-records summary {
  cursor: pointer;
  font-size: 14px;
}
.source-records summary span {
  color: var(--muted);
  font-size: 12px;
  margin-left: 12px;
}
.project-facts h3 {
  font-size: 17px;
  margin: 0 0 12px;
  overflow-wrap: anywhere;
}
.project-facts dl {
  display: grid;
  grid-template-columns: 80px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  font-size: 13px;
}
.project-facts dt {
  color: var(--muted);
}
.project-facts dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.project-participants {
  border-top: 1px solid var(--border);
  margin-top: 24px;
  padding-top: 16px;
}
.project-participants h3 {
  font-size: 14px;
}
.project-facts :deep(.project-team) {
  margin-top: 20px;
  padding: 14px 0;
  border: 0;
  border-top: 1px solid var(--border);
  border-radius: 0;
}
.project-action-list {
  display: grid;
  gap: 6px;
}
.project-action-list > button,
.project-action-list > a {
  display: flex;
  gap: 10px;
  align-items: center;
  min-height: 44px;
  padding: 10px 12px;
  text-align: left;
  text-decoration: none;
}
@media (max-width: 760px) {
  .back-link,
  .project-metadata :deep(.owner-value),
  .project-facts :deep(.owner-value) {
    min-height: 44px;
  }
  .detail-page {
    padding-block: 12px 24px;
  }
  .project-heading {
    gap: 4px;
  }
  .project-heading h1 {
    font-size: 21px;
  }
  .project-heading > button {
    min-height: 44px;
  }
  .project-metadata {
    gap: 0 8px;
  }
  .project-metadata > :nth-child(3),
  .project-metadata > :nth-child(4) {
    display: none;
  }
  .completion-label {
    width: 100%;
    margin: 0 0 4px 6px;
  }
  .latest-progress-summary {
    gap: 6px;
    padding: 6px 8px;
  }
  .progress-summary-text {
    display: block;
  }
  .progress-summary-text strong,
  .latest-progress-summary time {
    display: none;
  }
  .report-progress {
    min-height: 44px;
    padding: 4px;
  }
  .project-tabs {
    margin-top: 8px;
    gap: 24px;
  }
  .project-tab-panel {
    padding-top: 10px;
  }
}
</style>
