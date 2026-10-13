<script setup lang="ts">
import { computed, ref } from "vue";
import { PhPlus } from "@phosphor-icons/vue";
import {
  taskInput,
  statuses,
  type Task,
} from "../../../../packages/domain/types";
import { useWorkspace } from "../stores/workspace";
import { confirmDiscard } from "../composables/unsaved";
import { t } from "../locales";
import { statusLabels } from "../locales/en";
import TaskReviewPanel from "./TaskReviewPanel.vue";
import TaskQuickAdd from "./TaskQuickAdd.vue";
import TaskQuickField from "./TaskQuickField.vue";
const props = defineProps<{
  projectId: string;
  tasks: Task[];
  scope: "week" | "today";
}>();
const store = useWorkspace();
const preview = computed(() =>
  [...props.tasks]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 2),
);
const adding = ref(false),
  error = ref("");
function add() {
  if (confirmDiscard()) adding.value = true;
}
async function change(task: Task, event: Event) {
  error.value = "";
  try {
    await store.saveTask(
      {
        ...taskInput.strip().parse(task),
        status: (event.target as HTMLSelectElement).value as Task["status"],
      },
      task,
    );
  } catch (e) {
    error.value = t(
      e instanceof Error ? e.message : "Changes could not be saved",
    );
  }
}
</script>
<template>
  <div class="scope-work">
    <div v-for="task in preview" :key="task.id">
      <div class="scope-work-task">
        <select
          :value="task.status"
          :class="task.status"
          :aria-label="t('Status for {title}', { title: task.title })"
          :disabled="store.busy"
          @change="change(task, $event)"
        >
          <option v-for="status in statuses" :key="status" :value="status">
            {{ statusLabels[status] }}
          </option>
        </select>
        <TaskQuickField :task="task" field="title" singleClick />
      </div>
      <TaskReviewPanel :task="task" />
    </div>
    <TaskQuickAdd
      v-if="adding"
      :projectId="projectId"
      :scope="scope"
      compact
      @close="adding = false"
    />
    <button
      v-else
      class="text-button plan-work"
      :class="{ unplanned: !tasks.length }"
      :disabled="store.busy"
      :aria-label="
        t('Plan work for {name}', {
          name: store.data.projects.find((p) => p.id === projectId)?.name ?? '',
        })
      "
      @click="add"
    >
      <PhPlus :size="12" />{{
        t(tasks.length ? "Add planned work" : "No work planned")
      }}
    </button>
    <small v-if="error" class="error-box" role="alert">{{ error }}</small>
  </div>
</template>
<style scoped>
.scope-work {
  min-width: 0;
}
.scope-work-task {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
}
.scope-work-task > select {
  padding: 0;
  border: 0;
  background: transparent;
  width: 57px;
  min-height: 23px;
  height: 23px;
  flex: none;
  font-size: 11px;
  color: var(--status-todo);
  cursor: pointer;
}
.scope-work-task > select.done {
  color: var(--status-done);
}
.scope-work-task > select.in_progress {
  color: var(--status-in-progress);
}
.scope-work-task > select.blocked {
  color: var(--status-blocked);
}
.scope-work-task .quick-task-field {
  flex: 1;
  min-width: 0;
}
.scope-work-task :deep(.field-value) {
  display: block;
  padding: 0;
  min-height: 23px;
  line-height: 23px;
  font-size: 12px;
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.scope-work-task :deep(.quick-task-field.editing) {
  min-width: 130px;
}
.plan-work {
  display: flex;
  gap: 4px;
  min-height: 22px;
  padding: 0;
  color: var(--muted);
  font-size: 10px;
}
.plan-work:hover {
  color: var(--accent);
}
.plan-work.unplanned {
  font-size: 11px;
}
@media (pointer: coarse) {
  .plan-work {
    min-height: 32px;
  }
  .scope-work-task > select,
  .scope-work-task :deep(.field-value) {
    min-height: 32px;
  }
}
</style>
