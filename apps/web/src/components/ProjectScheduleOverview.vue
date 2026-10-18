<script setup lang="ts">
import { computed, ref } from "vue";
import { scheduleOverview } from "../../../../packages/domain/schedule-overview";
import { useWorkspace } from "../stores/workspace";
import { useCalendarNow } from "../composables/calendar";
import { t, formatDate, formatNumber } from "../locales";
import TaskDetailPanel from "./TaskDetailPanel.vue";
const props = defineProps<{ projectIds: string[] }>();
const store = useWorkspace(),
  now = useCalendarNow();
const selected = ref("");
const limit = ref(8);
const model = computed(() =>
  scheduleOverview(
    store.data.tasks,
    new Set(props.projectIds),
    now.value,
    store.timeZone,
  ),
);
const projectName = (id: string) =>
  store.data.projects.find((project) => project.id === id)?.name ??
  t("Previous project");
</script>
<template>
  <section class="schedule-overview">
    <h2>{{ t("Milestones and schedule coordination") }}</h2>
    <p class="muted">
      {{
        t("Next 30 days: {start} – {end}", {
          start: formatDate(model.today),
          end: formatDate(model.end),
        })
      }}
      · {{ store.timeZone }}
    </p>
    <h3>
      {{ t("Upcoming milestones") }} ({{ formatNumber(model.upcoming.length) }})
    </h3>
    <p v-if="!model.upcoming.length" class="muted">
      {{ t("No unfinished milestones in this window.") }}
    </p>
    <ul>
      <li v-for="task in model.upcoming.slice(0, limit)" :key="task.id">
        <button @click="selected = task.id">{{ task.title }}</button
        ><span
          >{{ formatDate(task.scheduleStart!) }} ·
          {{ projectName(task.projectId) }}</span
        >
      </li>
    </ul>
    <h3 v-if="model.overdue.length">
      {{ t("Overdue milestones") }} ({{ formatNumber(model.overdue.length) }})
    </h3>
    <ul>
      <li v-for="task in model.overdue.slice(0, limit)" :key="task.id">
        <button @click="selected = task.id">{{ task.title }}</button
        ><span
          >{{ formatDate(task.scheduleStart!) }} ·
          {{ projectName(task.projectId) }}</span
        >
      </li>
    </ul>
    <h3>
      {{ t("Dependency warnings") }} ({{ formatNumber(model.warnings.length) }})
    </h3>
    <p v-if="!model.warnings.length" class="muted">
      {{ t("No unresolved dependency warnings in this range.") }}
    </p>
    <ul>
      <li
        v-for="warning in model.warnings.slice(0, limit)"
        :key="`${warning.taskId}:${warning.predecessorId}`"
      >
        <div>
          <button @click="selected = warning.taskId">
            {{ warning.task.title }}
          </button>
          ←
          <button @click="selected = warning.predecessorId">
            {{ warning.predecessor.title }}
          </button>
        </div>
        <span
          >{{ projectName(warning.task.projectId) }} ·
          {{
            t(
              warning.kind === "voided"
                ? "Predecessor voided; action required."
                : warning.kind === "unscheduled"
                  ? "A linked task is not scheduled."
                  : "Schedule conflicts with predecessor.",
            )
          }}
          <template v-if="warning.earliestStart">{{
            t("Earliest start: {date}", {
              date: formatDate(warning.earliestStart),
            })
          }}</template></span
        >
      </li>
    </ul>
    <button
      v-if="
        Math.max(
          model.upcoming.length,
          model.overdue.length,
          model.warnings.length,
        ) > limit
      "
      @click="limit += 8"
    >
      {{ t("Show more") }}
    </button>
    <TaskDetailPanel :task-id="selected" @close="selected = ''" />
  </section>
</template>
<style scoped>
.schedule-overview {
  padding: 20px;
  border: 1px solid var(--border);
  border-radius: 10px;
  margin: 20px 0;
  background: var(--surface);
}
h3 {
  font-size: 14px;
  margin: 18px 0 8px;
}
ul {
  list-style: none;
  padding: 0;
  margin: 0;
}
li {
  padding: 10px 0;
  border-bottom: 1px solid var(--border);
  overflow-wrap: anywhere;
}
li span {
  display: block;
  color: var(--muted);
  font-size: 12px;
  margin-top: 5px;
}
li button {
  border: 0;
  background: transparent;
  padding: 4px 0;
  text-align: left;
  color: var(--primary);
  white-space: normal;
}
@media (max-width: 600px) {
  .schedule-overview {
    padding: 14px;
  }
  li button {
    min-height: 44px;
  }
}
</style>
