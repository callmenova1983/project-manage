<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  taskPresets,
  taskPresetQuery,
  activeTaskPreset,
  type TaskPreset,
} from "../composables/task-presets";
import {
  readTaskFilters,
  readProjectTaskFilters,
} from "../composables/task-focus";
import { t } from "../locales";
import { useViewPreferences } from "../composables/view-preferences";
import { taskViewLink } from "../services/task-view-link";
const props = defineProps<{ projectId?: string }>();
const route = useRoute(),
  router = useRouter();
const { preferences } = useViewPreferences();
const copyState = ref("");
const copyError = ref("");
watch(
  () => route.fullPath,
  () => {
    copyState.value = copyError.value = "";
  },
);
const active = computed(() =>
  route.query.voided === "1"
    ? undefined
    : activeTaskPreset(
        props.projectId
          ? readProjectTaskFilters(route.query, props.projectId)
          : readTaskFilters(route.query),
        props.projectId,
      ),
);
const labels = {
  mine: "My open tasks",
  coordination: "Coordination this week",
  overdue: "Overdue open tasks",
  unassigned: "Unassigned open tasks",
};
const descriptions = {
  mine: "Current account, all dates, unfinished tasks. Shared links resolve me as the person opening them.",
  coordination: "Tasks explicitly planned this week with coordination status.",
  overdue:
    "All dates, unfinished tasks with an explicit due date before workspace today.",
  unassigned:
    "All dates, unfinished tasks without a linked account or an assigned name.",
};
function apply(preset: TaskPreset) {
  copyState.value = copyError.value = "";
  void router.push({ query: taskPresetQuery(preset, route.query), hash: "" });
}
async function copyLink() {
  copyState.value = copyError.value = "";
  try {
    const source = window.location.href;
    const layout =
      route.query.view ??
      (props.projectId
        ? preferences.value.projectTaskLayout
        : preferences.value.taskLayout);
    const filters = props.projectId
      ? readProjectTaskFilters(route.query, props.projectId)
      : readTaskFilters(route.query);
    const href = taskViewLink(
      source,
      route.query,
      String(layout),
      preferences.value,
      {
        scope: filters.scope,
        calendarMode: window.matchMedia("(max-width: 760px)").matches
          ? "agenda"
          : "month",
      },
    );
    await navigator.clipboard.writeText(href);
    if (window.location.href !== source) return;
    copyState.value = "View link copied. Workspace access is still required.";
  } catch {
    copyError.value =
      "The link could not be copied. Copy the address from your browser.";
  }
}
</script>
<template>
  <div class="task-presets">
    <div role="group" :aria-label="t('Common task filters')">
      <button
        v-for="preset in taskPresets"
        :key="preset"
        :aria-pressed="active === preset"
        :title="t(descriptions[preset])"
        @click="apply(preset)"
      >
        {{ t(labels[preset]) }}</button
      ><button @click="copyLink">{{ t("Copy view link") }}</button>
    </div>
    <p v-if="active" class="preset-rule" role="status">
      {{ t(descriptions[active])
      }}<span v-if="projectId"> · {{ t("Limited to this project.") }}</span>
    </p>
    <p v-if="copyState" role="status">{{ t(copyState) }}</p>
    <p v-if="copyError" class="error-box" role="alert">{{ t(copyError) }}</p>
  </div>
</template>
<style scoped>
.task-presets {
  margin: 12px 0;
}
.task-presets > div {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
button {
  min-height: 44px;
  font-size: 12px;
}
button[aria-pressed="true"] {
  color: var(--accent);
  background: var(--accent-bg);
  border-color: var(--accent-border);
}
p {
  color: var(--muted);
  font-size: 12px;
  line-height: 1.6;
  margin: 6px 0;
}
</style>
