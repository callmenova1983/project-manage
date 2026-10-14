<script setup lang="ts">
import { ElDialog } from "element-plus";
import "element-plus/es/components/dialog/style/css";
import ProjectFollow from "../components/ProjectFollow.vue";
import { memberName } from "../../../../packages/domain/members";
import ProgressHistory from "../components/ProgressHistory.vue";
import InlineUpdate from "../components/InlineUpdate.vue";
import InlineNotes from "../components/InlineNotes.vue";
import TaskDistribution from "../components/TaskDistribution.vue";
import { catalogLabel } from "../composables/catalogs";
import { t, formatDate, formatNumber } from "../locales";
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  PhArrowLeft,
  PhPencilSimple,
  PhClipboardText,
  PhChartLineUp,
  PhUserCircle,
} from "@phosphor-icons/vue";
import { useWorkspace } from "../stores/workspace";
import { statistics, statuses } from "../../../../packages/domain/types";
import ProjectEditor from "../components/ProjectEditor.vue";
import ClientLabel from "../components/ClientLabel.vue";
import ProjectQuickActions from "../components/ProjectQuickActions.vue";
import ProjectMembers from "../components/ProjectMembers.vue";
import TaskList from "../components/TaskList.vue";
import PasteTasks from "../components/PasteTasks.vue";
import StatusBadge from "../components/StatusBadge.vue";
const store = useWorkspace(),
  route = useRoute();
const sourceOpen = ref(false);
watch(
  () => route.hash,
  (hash) => {
    if (hash === "#source-records") sourceOpen.value = true;
  },
  { immediate: true },
);
const editing = ref(false),
  paste = ref(false);
const router = useRouter();
const quickActions = ref<InstanceType<typeof ProjectQuickActions> | null>(null);
const project = computed(() =>
  store.data.projects.find((p) => p.id === route.params.id),
);
const tasks = computed(() =>
  store.data.tasks.filter((t) => t.projectId === project.value?.id),
);
const taskFilter = ref("all");
const filteredTasks = computed(() => {
  if (taskFilter.value === "all") return tasks.value;
  const included = new Set(
    tasks.value.filter((t) => t.status === taskFilter.value).map((t) => t.id),
  );
  for (const task of tasks.value) {
    if (!included.has(task.id)) continue;
    let parent = tasks.value.find((t) => t.id === task.parentId);
    while (parent) {
      included.add(parent.id);
      parent = tasks.value.find((t) => t.id === parent!.parentId);
    }
  }
  return tasks.value.filter((t) => included.has(t.id));
});
const counts = computed(() => statistics(tasks.value));
const activity = computed(() =>
  store.data.activities
    .filter((a) => a.projectId === project.value?.id)
    .slice(0, 8),
);

function activityLabel(action: string) {
  const imported =
    /^Replaced workspace with (\d+) projects and (\d+) tasks$/.exec(action);
  return imported
    ? t("Replaced workspace with {projects} projects and {tasks} tasks", {
        projects: Number(imported[1]),
        tasks: Number(imported[2]),
      })
    : t(action);
}
</script>
<template>
  <section v-if="project" class="page detail-page">
    <RouterLink to="/projects" class="back-link"
      ><PhArrowLeft :size="16" />{{ t("All projects") }}</RouterLink
    >
    <p v-if="project.categoryIds?.length" class="muted">
      {{
        project.categoryIds
          .map((id) => catalogLabel("categories", id))
          .join(" · ")
      }}
    </p>
    <div class="page-heading">
      <div>
        <h1
          :title="t('Double-click to edit name and short name')"
          @dblclick="quickActions?.rename()"
        >
          {{ project.name }}
        </h1>
        <p v-if="project.shortName" class="muted">
          {{ t("Short name") }}：{{ project.shortName }}
        </p>
        <p class="page-subtitle">
          <ClientLabel :client="project.client" />
          <span v-if="project.client.trim()" class="dot-separator">·</span>
          {{ t(project.discipline) }}
        </p>
      </div>
      <div class="heading-actions">
        <ProjectFollow :id="project.id" :name="project.name" />
        <ProjectQuickActions
          ref="quickActions"
          :project="project"
          @merged="router.replace(`/projects/${$event.id}`)"
        /><button :disabled="editing" @click="editing = true">
          <PhPencilSimple :size="16" />{{ t("Edit project") }}
        </button>
      </div>
    </div>
    <ElDialog
      v-model="editing"
      :title="t('Edit project')"
      width="min(780px, calc(100vw - 24px))"
      :close-on-click-modal="false"
      :close-on-press-escape="false"
      :show-close="false"
      destroy-on-close
    >
      <ProjectEditor
        :project="project"
        @close="editing = false"
        @saved="editing = false"
      />
    </ElDialog>
    <div class="project-overview-strip">
      <StatusBadge :stage="project.stage" />
      <span
        ><PhUserCircle :size="16" />{{ t("Owner") }} ·
        {{
          t(
            memberName(
              project.ownerId,
              project.owner,
              store.data.members ?? [],
            ),
          )
        }}</span
      >
      <span class="completion-label">{{
        t("{done} of {total} tasks completed", {
          done: formatNumber(counts.done),
          total: formatNumber(counts.total),
        })
      }}</span>
      <TaskDistribution :tasks="tasks" compact :showLegend="false" />
    </div>
    <div class="project-workspace">
      <div class="project-main">
        <section class="update-card">
          <div class="update-heading">
            <PhChartLineUp :size="18" />
            <h3>{{ t("Latest progress log") }}</h3>
          </div>
          <div class="report-text"><InlineUpdate :project="project" /></div>
          <small class="muted"
            >{{
              project.reportedAt
                ? formatDate(project.reportedAt, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })
                : t("Report time unavailable")
            }}<template v-if="project.reportedBy">
              · {{ project.reportedBy }}</template
            ></small
          >
        </section>
        <section class="panel tasks-panel">
          <div class="section-heading">
            <h2>
              {{ t("Tasks") }}
              <span class="title-count">{{ formatNumber(counts.total) }}</span>
            </h2>
            <button class="text-button" :disabled="paste" @click="paste = true">
              <PhClipboardText :size="16" />{{ t("Paste tasks") }}
            </button>
          </div>
          <div
            class="detail-task-filters"
            role="group"
            :aria-label="t('Filter tasks')"
          >
            <button
              :aria-pressed="taskFilter === 'all'"
              @click="taskFilter = 'all'"
            >
              {{ t("All") }} {{ formatNumber(counts.total) }}
            </button>
            <button
              v-for="status in statuses"
              :key="status"
              :aria-pressed="taskFilter === status"
              @click="taskFilter = status"
            >
              <StatusBadge :status="status" />{{ formatNumber(counts[status]) }}
            </button>
          </div>
          <PasteTasks
            v-if="paste"
            :projectId="project.id"
            @close="paste = false"
          />
          <TaskList :tasks="filteredTasks" :projectId="project.id" />
        </section>
        <ProgressHistory :project="project" />
        <details
          id="source-records"
          class="panel source-records"
          :open="sourceOpen"
          @toggle="
            sourceOpen = ($event.currentTarget as HTMLDetailsElement).open
          "
        >
          <summary>
            {{ t("Source records") }}
            <span>{{ t("Meeting text and earlier context") }}</span>
          </summary>
          <InlineNotes :project="project" />
        </details>
        <details class="panel detail-history">
          <summary>
            {{ t("Recent activity") }}
            <span>{{ formatNumber(activity.length) }}</span>
          </summary>
          <RouterLink :to="`/activity?project=${project.id}`">{{
            t("View history")
          }}</RouterLink>
          <div v-for="event in activity" :key="event.id" class="activity-mini">
            <span class="avatar small">{{ event.actor.slice(0, 1) }}</span>
            <div>
              <strong>{{ event.actor }}</strong> {{ activityLabel(event.action)
              }}<small>{{
                formatDate(event.createdAt, {
                  dateStyle: "medium",
                  timeStyle: "short",
                })
              }}</small>
            </div>
          </div>
        </details>
      </div>
      <aside class="project-sidebar">
        <section class="panel project-facts">
          <h3>{{ t("Project overview") }}</h3>
          <dl>
            <dt>{{ t("Client") }}</dt>
            <dd>
              <ClientLabel
                v-if="project.client.trim()"
                :client="project.client"
              /><button v-else class="text-button" @click="editing = true">
                {{ t("Add client") }}
              </button>
            </dd>
            <dt>{{ t("Discipline") }}</dt>
            <dd>{{ t(project.discipline) }}</dd>
            <template v-if="project.shortName"
              ><dt>{{ t("Short name") }}</dt>
              <dd>{{ project.shortName }}</dd></template
            >
            <template v-if="project.aliases.length"
              ><dt>{{ t("Aliases:") }}</dt>
              <dd class="alias-tags">
                <span v-for="alias in project.aliases" :key="alias">{{
                  alias
                }}</span>
              </dd></template
            >
          </dl>
          <details
            v-if="
              project.description &&
              project.description.trim() !== project.latestUpdate.trim()
            "
            class="project-background"
          >
            <summary>{{ t("Project context") }}</summary>
            <p>{{ project.description }}</p>
          </details>
        </section>
        <section
          v-if="project.participantIds?.length"
          class="panel project-participants"
        >
          {{ t("Project participants:") }}
          {{
            project.participantIds
              .map((id) =>
                memberName(id, "Member unavailable", store.data.members ?? []),
              )
              .join(" · ")
          }}
        </section>
        <ProjectMembers :projectId="project.id" />
      </aside>
    </div>
  </section>
  <section v-else class="empty">
    <h1>{{ t("Project not found") }}</h1>
    <RouterLink to="/projects" class="button">{{
      t("Return to projects")
    }}</RouterLink>
  </section>
</template>

<style scoped>
.detail-page {
  max-width: 1560px;
  margin: 0 auto;
  padding: 22px 24px;
}
.back-link {
  margin-bottom: 14px;
}
.page-heading {
  margin-bottom: 18px;
}
h1 {
  font-size: 25px;
}
.project-overview-strip {
  display: flex;
  align-items: center;
  gap: 18px;
  flex-wrap: wrap;
  padding: 12px 16px;
  margin-bottom: 20px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  font-size: 12px;
}
.project-overview-strip > span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--muted);
}
.project-overview-strip .task-distribution {
  width: 150px;
  margin-left: auto;
}
.project-workspace {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 280px;
  gap: 20px;
  align-items: start;
}
.project-main,
.project-sidebar {
  min-width: 0;
}
.project-workspace .panel {
  padding: 18px;
  margin-bottom: 16px;
}
.update-card {
  padding: 18px 20px;
  border: 1px solid var(--accent-border);
  background: var(--accent-bg);
  border-radius: 10px;
  margin-bottom: 18px;
}
.update-heading {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--accent);
}
.update-heading h3 {
  margin: 0;
  font-size: 13px;
}
.report-text {
  font-size: 14px;
  line-height: 1.8;
  margin: 12px 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.tasks-panel .section-heading {
  margin-bottom: 12px;
}
.tasks-panel h2 {
  font-size: 18px;
}
.detail-task-filters {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
.detail-task-filters button {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 9px;
  font-size: 11px;
  min-height: 30px;
  background: transparent;
  border-color: transparent;
  color: var(--muted);
}
.detail-task-filters button[aria-pressed="true"] {
  border-color: var(--accent-border);
  background: var(--accent-bg);
  color: var(--accent);
}
.detail-task-filters :deep(.status-badge) {
  background: transparent;
  border: 0;
  padding: 0;
}
.project-facts h3 {
  font-size: 13px;
  margin-bottom: 18px;
}
.project-facts dl {
  display: grid;
  grid-template-columns: 68px minmax(0, 1fr);
  gap: 14px 10px;
  font-size: 12px;
  margin: 0;
}
.project-facts dt {
  color: var(--muted);
}
.project-facts dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.alias-tags {
  display: flex;
  gap: 5px;
  flex-wrap: wrap;
}
.alias-tags span {
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--surface-raised);
  color: var(--text-secondary);
  font-size: 11px;
}
.project-background {
  margin-top: 20px;
  padding-top: 14px;
  border-top: 1px solid var(--border);
  font-size: 12px;
}
.project-background p {
  line-height: 1.8;
  overflow-wrap: anywhere;
}
summary {
  cursor: pointer;
  font-size: 13px;
}
summary > span {
  color: var(--muted);
  font-size: 11px;
  margin-left: 10px;
}
.source-records[open] summary,
.detail-history[open] summary {
  margin-bottom: 18px;
}
.detail-history > a {
  display: inline-flex;
  font-size: 12px;
  margin-bottom: 12px;
}
.project-sidebar :deep(.project-team summary .muted) {
  display: block;
  margin: 8px 0 0;
}
@media (max-width: 1100px) {
  .project-workspace {
    grid-template-columns: minmax(0, 1fr) 240px;
    gap: 14px;
  }
}
@media (max-width: 850px) {
  .project-workspace {
    grid-template-columns: minmax(0, 1fr);
  }
  .project-sidebar {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
  }
}
@media (max-width: 600px) {
  .detail-page {
    padding: 16px 12px;
  }
  .page-heading {
    align-items: flex-start;
    flex-direction: column;
    gap: 12px;
  }
  h1 {
    font-size: 22px;
  }
  .project-overview-strip {
    gap: 10px;
  }
  .project-overview-strip .task-distribution {
    width: 100%;
  }
  .project-sidebar {
    display: block;
  }
  .project-workspace .panel {
    padding: 14px;
  }
  .detail-task-filters {
    gap: 2px;
  }
}
/* Keep task editing compact without shrinking touch targets. */
.tasks-panel :deep(.task-row) {
  min-height: 40px;
  padding: 5px 0;
  gap: 8px;
}
.tasks-panel :deep(.task-status select) {
  min-height: 28px;
  height: 28px;
  padding: 3px 8px;
  font-size: 11px;
}
.tasks-panel :deep(.task-row .icon-button) {
  min-height: 28px;
  width: 28px;
  height: 28px;
  padding: 4px;
}
.tasks-panel :deep(.field-value) {
  padding: 3px 4px;
  min-height: 28px;
  font-size: 12px;
}
.tasks-panel :deep(.add-task) {
  padding: 6px 0;
  margin-top: 6px;
}
@media (pointer: coarse) {
  .tasks-panel :deep(.task-row) {
    min-height: 48px;
  }
  .tasks-panel :deep(.task-row .icon-button),
  .tasks-panel :deep(.field-value) {
    min-height: 36px;
  }
}
</style>
