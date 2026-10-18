<script setup lang="ts">
import { computed, ref } from "vue";
import type { Task } from "../../../../packages/domain/types";
import { taskPlanningImpact } from "../../../../packages/domain/task-planning-impact";
import { useWorkspace } from "../stores/workspace";
import { t } from "../locales";
import TaskPlanningEdit from "./TaskPlanningEdit.vue";
import TaskVoidAction from "./TaskVoidAction.vue";
const props = defineProps<{ taskId: string; mode: "parent" | "project" }>();
const store = useWorkspace();
const impact = computed(() =>
  taskPlanningImpact(store.data.tasks, props.taskId),
);
const blocked = computed(() =>
  props.mode === "parent"
    ? impact.value.blocksParent
    : impact.value.blocksProjectMove,
);
const editing = ref<{ task: Task; mode: "schedule" | "dependencies" } | null>(
  null,
);
const dependents = computed(() => [
  ...new Map(
    impact.value.edges.map((edge) => [edge.task.id, edge.task]),
  ).values(),
]);
</script>
<template>
  <section v-if="blocked" class="planning-impact" role="status">
    <h4>
      {{
        t(
          mode === "parent"
            ? "Resolve planning before adding subtasks"
            : "Resolve dependencies before moving projects",
        )
      }}
    </h4>
    <p>
      {{
        t(
          "These changes are saved separately. Reopen or reload the task editor after resolving them.",
        )
      }}
    </p>
    <template v-if="mode === 'parent' && impact.hasSchedule && impact.task">
      <p>
        {{ impact.task.title }} ·
        {{ t("Clear the independent schedule first.") }}
      </p>
      <button
        type="button"
        :disabled="store.busy || !!impact.task.voided"
        @click="editing = { task: impact.task, mode: 'schedule' }"
      >
        {{ t("Edit schedule") }}
      </button>
    </template>
    <p v-if="impact.edges.length">{{ t('Successor task ← predecessor task') }}</p>
    <ul>
      <li
        v-for="edge in impact.edges"
        :key="`${edge.task.id}:${edge.predecessor?.id}`"
      >
        {{ edge.task.title }} ←
        {{ edge.predecessor?.title ?? t("Previous task")
        }}<span v-if="edge.task.voided"> · {{ t("Voided task") }}</span>
      </li>
    </ul>
    <div
      v-for="dependent in dependents"
      :key="dependent.id"
      class="impact-action"
    >
      <span>{{ dependent.title }}</span>
      <TaskVoidAction v-if="dependent.voided" :task="dependent" labeled />
      <button
        v-else
        type="button"
        :disabled="store.busy"
        @click="editing = { task: dependent, mode: 'dependencies' }"
      >
        {{ t("Edit predecessors") }}
      </button>
    </div>
    <TaskPlanningEdit
      v-if="editing"
      :key="`${editing.task.id}:${editing.mode}`"
      :task="editing.task"
      :mode="editing.mode"
      @close="editing = null"
    />
  </section>
</template>
<style scoped>
.planning-impact {
  padding: 12px;
  border: 1px solid var(--border);
  background: var(--surface-raised);
  border-radius: 8px;
  margin: 10px 0;
  overflow-wrap: anywhere;
}
h4 {
  margin: 0 0 8px;
}
p,
li {
  font-size: 12px;
}
.impact-action {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  margin-top: 8px;
}
</style>
