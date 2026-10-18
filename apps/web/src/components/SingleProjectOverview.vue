<script setup lang="ts">
import { computed, ref } from "vue";
import { projectWorkspaceOverview } from "../../../../packages/domain/project-view";
import type { Project } from "../../../../packages/domain/types";
import { useWorkspace } from "../stores/workspace";
import { useCalendarNow } from "../composables/calendar";
import { t, formatDate, formatNumber } from "../locales";
import NextWork from "./NextWork.vue";
import ProjectScheduleOverview from "./ProjectScheduleOverview.vue";
import TaskDetailPanel from "./TaskDetailPanel.vue";
const props = defineProps<{ project: Project }>();
const store = useWorkspace(),
  now = useCalendarNow();
const detailId = ref(""),
  coordinationLimit = ref(8);
const overview = computed(() =>
  projectWorkspaceOverview(store.data, [props.project], {
    now: now.value,
    timeZone: store.timeZone,
    scope: "all",
  }),
);
const metrics = computed(() => [
  { label: "Tasks", count: overview.value.all.total, query: {} },
  {
    label: "Open work",
    count: overview.value.all.open.length,
    query: { focus: "open" },
  },
  {
    label: "Completed",
    count: overview.value.all.done.length,
    query: { status: "done" },
  },
  {
    label: "Blocked",
    count: overview.value.all.blocked.length,
    query: { status: "blocked" },
  },
  {
    label: "Overdue",
    count: overview.value.all.overdue.length,
    query: { risk: "overdue" },
  },
  {
    label: "Unplanned work",
    count: overview.value.all.unplanned.length,
    query: { risk: "unplanned" },
  },
]);
</script>
<template>
  <section
    v-if="!project.intakeInbox"
    class="single-project-overview"
    :aria-label="t('Project overview')"
  >
    <h3>{{ t("Task summary") }}</h3>
    <p class="muted">
      {{ t("All time") }} · {{ store.timeZone }}
      <template v-if="store.lastSynced">
        ·
        {{
          t("Updated {time}", {
            time: formatDate(store.lastSynced, {
              dateStyle: "short",
              timeStyle: "short",
            }),
          })
        }}</template
      >
    </p>
    <p v-if="store.error" class="error-box" role="alert">
      {{ t(store.error) }} · {{ t("Showing the last available snapshot.") }}
    </p>
    <div class="project-summary-metrics">
      <RouterLink
        v-for="metric in metrics"
        :key="metric.label"
        :to="{
          path: '/tasks',
          query: { ...metric.query, project: project.id, scope: 'all' },
        }"
      >
        <span>{{ t(metric.label) }}</span
        ><strong>{{ formatNumber(metric.count) }}</strong>
      </RouterLink>
    </div>
    <NextWork :projects="[project]" :tasks="store.data.tasks" scope="week" />
    <h3>
      {{ t("Needs coordination") }} ({{
        formatNumber(overview.all.blocked.length)
      }})
    </h3>
    <ul class="coordination-tasks">
      <li
        v-for="task in overview.all.blocked.slice(0, coordinationLimit)"
        :key="task.id"
      >
        <button @click="detailId = task.id">{{ task.title }}</button>
      </li>
    </ul>
    <button
      v-if="overview.all.blocked.length > coordinationLimit"
      @click="coordinationLimit += 8"
    >
      {{ t("Show more") }}
    </button>
    <p v-if="!overview.all.blocked.length" class="muted">
      {{ t("No tasks in this selection") }}
    </p>
    <ProjectScheduleOverview :project-ids="[project.id]" />
    <TaskDetailPanel :task-id="detailId" @close="detailId = ''" />
  </section>
</template>
<style scoped>
.single-project-overview {
  min-width: 0;
  margin-top: 24px;
}
.project-summary-metrics {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin: 12px 0 20px;
}
.project-summary-metrics a {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px;
  min-height: 44px;
  overflow-wrap: anywhere;
}
.coordination-tasks {
  list-style: none;
  padding: 0;
}
.coordination-tasks button {
  text-align: left;
  white-space: normal;
  overflow-wrap: anywhere;
  min-height: 44px;
  width: 100%;
  margin-bottom: 8px;
}
</style>
